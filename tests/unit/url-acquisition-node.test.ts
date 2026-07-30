import { createServer, type RequestListener } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeUrlHopTransport } from '../../adapters/url-acquisition-node/src/index.js';

const limits = {
  maxRedirects: 3,
  connectTimeoutMs: 1000,
  headerTimeoutMs: 1000,
  bodyTimeoutMs: 1000,
  totalTimeoutMs: 4000,
  maxCompressedBytes: 64,
  maxDecompressedBytes: 64,
};

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

const listen = async (handler: RequestListener): Promise<number> => {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server address missing');
  return address.port;
};

describe('Node URL hop transport', () => {
  it('pins the approved address while preserving the requested Host', async () => {
    const port = await listen((request, response) => {
      expect(request.headers.host).toBe(`example.test:${port}`);
      expect(request.headers['accept-encoding']).toBe('identity');
      response.writeHead(200, { 'content-type': 'text/plain', etag: 'v1' });
      response.end('transport body');
    });

    const result = await new NodeUrlHopTransport().request({
      url: `http://example.test:${port}/document?q=1`,
      approvedAddresses: ['127.0.0.1'],
      headers: {},
      limits,
    });

    expect(result).toMatchObject({
      status: 200,
      connectedAddress: '127.0.0.1',
      compressedBytes: 14,
    });
    expect(new TextDecoder().decode(result.body)).toBe('transport body');
    expect(result.headers['etag']).toBe('v1');
  });

  it('stops streaming when the approved compressed byte limit is exceeded', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(65));
    });

    await expect(
      new NodeUrlHopTransport().request({
        url: `http://example.test:${port}/large`,
        approvedAddresses: ['127.0.0.1'],
        headers: {},
        limits,
      }),
    ).rejects.toThrow(/byte limit/);
  });

  it('rejects compressed responses before body acceptance', async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      });
      response.end('not actually compressed');
    });

    await expect(
      new NodeUrlHopTransport().request({
        url: `http://example.test:${port}/compressed`,
        approvedAddresses: ['127.0.0.1'],
        headers: {},
        limits,
      }),
    ).rejects.toThrow(/Compressed URL responses/);
  });
});
