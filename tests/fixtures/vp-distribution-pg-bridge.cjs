/* Test transport only. The pg implementation comes from the fresh distribution. */
/* global require, __dirname, URL */
/* eslint-disable @typescript-eslint/no-require-imports -- Node --require preloads this synchronous test-only bridge. */
const { execFileSync, spawn } = require('node:child_process');
const { Duplex } = require('node:stream');
const path = require('node:path');
const expectedId = 'e2904dccdfe5ada0d224efbea46486ab185242258cb54efaf7eda5457910dd2e';
const expectedVolume = '1a55beb0c18fc5f6fa948b6c3fa46a2e1fbee984f841d67506311a9e2c6cd21d';
const inspected = JSON.parse(
  execFileSync('docker', ['inspect', expectedId], { encoding: 'utf8', windowsHide: true }),
)[0];
if (
  inspected.Id !== expectedId ||
  !inspected.State.Running ||
  inspected.Mounts.length !== 1 ||
  inspected.Mounts[0].Name !== expectedVolume ||
  !inspected.NetworkSettings.Networks['vp-full-test-20261012']
)
  throw Error('UNSAFE_DISTRIBUTION_TEST_CONTAINER');
const pg = require(path.resolve(__dirname, '../../node_modules/pg'));
const BaseClient = pg.Client,
  BasePool = pg.Pool;
class DockerSocket extends Duplex {
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  connect() {
    this.child = spawn(
      'docker',
      [
        'exec',
        '-i',
        expectedId,
        'bash',
        '-c',
        'exec 3<>/dev/tcp/127.0.0.1/5432; exec 4<&0; cat <&4 >&3 & task_write=$!; cat <&3; kill "$task_write" 2>/dev/null; wait',
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child.stdout.on('data', (bytes) => {
      if (!this.push(bytes)) this.child.stdout.pause();
    });
    this.child.stdout.on('end', () =>
      this.destroy(this.expectedEnd ? undefined : Error('ISOLATED_CONNECTION_CLOSED')),
    );
    this.child.on('error', (error) => this.destroy(error));
    this.child.once('spawn', () => this.emit('connect'));
    return this;
  }
  _read() {
    this.child?.stdout.resume();
  }
  _write(bytes, _encoding, callback) {
    this.child.stdin.write(bytes, callback);
  }
  _final(callback) {
    this.child?.stdin.end(callback);
  }
  _destroy(error, callback) {
    this.child?.stdin.end();
    this.child?.kill();
    callback(error);
  }
}
const config = (input = {}) => {
  const value = typeof input === 'string' ? { connectionString: input } : input;
  const url = value.connectionString ? new URL(value.connectionString) : null;
  const database = url ? decodeURIComponent(url.pathname.slice(1)) : value.database;
  const host = url?.hostname ?? value.host,
    port = Number(url?.port ?? value.port);
  if (
    !['127.0.0.1', 'localhost'].includes(host) ||
    port !== 55432 ||
    !(database === 'postgres' || /^shotgun_test_iso_[a-z0-9_]+$/.test(database))
  )
    throw Error('DISTRIBUTION_PG_TARGET_DENIED');
  return {
    ...value,
    host,
    port,
    database,
    ssl: false,
    stream: () => new DockerSocket(),
    connectionTimeoutMillis: 15000,
    options: ((value.options ?? '') + ' -c timezone=UTC').trim(),
  };
};
class IsolatedClient extends BaseClient {
  constructor(value) {
    super(config(value));
  }
  end(...args) {
    this.connection.stream.expectedEnd = true;
    return super.end(...args);
  }
}
class IsolatedPool extends BasePool {
  constructor(value) {
    super({ ...config(value), Client: IsolatedClient });
  }
}
pg.Client = IsolatedClient;
pg.Pool = IsolatedPool;
