import { Client } from 'pg';

export type DatabaseTargetIdentity = {
  readonly host: string;
  readonly port: string;
  readonly database: string;
};

export type DatabaseTargetProbeResult = {
  readonly database: string;
  readonly serverAddress: string | null;
  readonly serverPort: number | null;
};

export type DatabaseTargetProbe = (databaseUrl: string) => Promise<DatabaseTargetProbeResult>;

type DatabaseTargetEnvironment = {
  readonly DATABASE_URL?: string;
  readonly TEST_DATABASE_URL?: string;
};

const TEST_DATABASE_NAMESPACE = /^shotgun_test(?:_[a-z0-9]+)*$/;

const normalizedHost = (hostname: string): string => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'loopback';
  return host;
};

export const parseDatabaseTargetIdentity = (
  databaseUrl: string,
  variableName: string,
): DatabaseTargetIdentity => {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${variableName} must use the postgres or postgresql protocol.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database || database.includes('/')) {
    throw new Error(`${variableName} must identify one PostgreSQL server and database.`);
  }
  return {
    host: normalizedHost(parsed.hostname),
    port: parsed.port || '5432',
    database,
  };
};

export const databaseTargetIdentityKey = (identity: DatabaseTargetIdentity): string =>
  `${identity.host}:${identity.port}/${identity.database}`;

const defaultProbe: DatabaseTargetProbe = async (databaseUrl) => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{
      database: string;
      server_address: string | null;
      server_port: number | null;
    }>(`
      SELECT
        current_database() AS database,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port
    `);
    const row = result.rows[0];
    if (!row) throw new Error('PostgreSQL target verification returned no row.');
    return {
      database: row.database,
      serverAddress: row.server_address,
      serverPort: row.server_port,
    };
  } finally {
    await client.end();
  }
};

export const requireTestDatabaseTarget = async (options?: {
  readonly environment?: DatabaseTargetEnvironment;
  readonly probe?: DatabaseTargetProbe;
}): Promise<string> => {
  const environment = options?.environment ?? process.env;
  const testDatabaseUrl = environment.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required for database-backed tests; DATABASE_URL fallback is forbidden.',
    );
  }

  const testIdentity = parseDatabaseTargetIdentity(testDatabaseUrl, 'TEST_DATABASE_URL');
  if (!TEST_DATABASE_NAMESPACE.test(testIdentity.database)) {
    throw new Error(
      `TEST_DATABASE_URL database must match ${TEST_DATABASE_NAMESPACE}; received ${testIdentity.database}.`,
    );
  }

  const normalDatabaseUrl = environment.DATABASE_URL?.trim();
  if (normalDatabaseUrl) {
    const normalIdentity = parseDatabaseTargetIdentity(normalDatabaseUrl, 'DATABASE_URL');
    if (databaseTargetIdentityKey(normalIdentity) === databaseTargetIdentityKey(testIdentity)) {
      throw new Error(
        'TEST_DATABASE_URL must not identify the same server/database as DATABASE_URL.',
      );
    }
  }

  const observed = await (options?.probe ?? defaultProbe)(testDatabaseUrl);
  if (observed.database !== testIdentity.database) {
    throw new Error(
      `TEST_DATABASE_URL resolved to current_database()=${observed.database}; expected ${testIdentity.database}.`,
    );
  }
  return testDatabaseUrl;
};

export const databaseResetConfirmation = (databaseUrl: string): string =>
  databaseTargetIdentityKey(parseDatabaseTargetIdentity(databaseUrl, 'DATABASE_URL'));

export const requireConfirmedDestructiveDatabaseTarget = async (options: {
  readonly databaseUrl: string;
  readonly confirmation?: string;
  readonly probe?: DatabaseTargetProbe;
}): Promise<void> => {
  const expected = databaseResetConfirmation(options.databaseUrl);
  if (options.confirmation !== expected) {
    throw new Error(
      `Destructive database reset refused. Set SHOTGUN_CONFIRM_DATABASE_RESET=${expected} for this exact target.`,
    );
  }
  const identity = parseDatabaseTargetIdentity(options.databaseUrl, 'DATABASE_URL');
  const observed = await (options.probe ?? defaultProbe)(options.databaseUrl);
  if (observed.database !== identity.database) {
    throw new Error(
      `Destructive database target resolved to current_database()=${observed.database}; expected ${identity.database}.`,
    );
  }
};
