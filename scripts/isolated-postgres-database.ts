import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

export type IsolatedPostgresNamespace = 'restore' | 'test';

export type IsolatedPostgresDatabase = {
  readonly databaseName: string;
  readonly databaseUrl: string;
};

const namespacePrefix: Record<IsolatedPostgresNamespace, string> = {
  restore: 'shotgun_restore_',
  test: 'shotgun_test_iso_',
};

const withClient = async <T>(
  connectionString: string,
  action: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
};

const adminDatabaseUrl = (sourceDatabaseUrl: string): string => {
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = '/postgres';
  return admin.toString();
};

const databaseUrlFor = (sourceDatabaseUrl: string, databaseName: string): string => {
  const isolated = new URL(sourceDatabaseUrl);
  isolated.pathname = '/' + databaseName;
  return isolated.toString();
};

const generatedDatabaseName = (namespace: IsolatedPostgresNamespace): string =>
  namespacePrefix[namespace] + Date.now() + '_' + randomUUID().replaceAll('-', '').slice(0, 12);

const assertDatabaseName = (namespace: IsolatedPostgresNamespace, databaseName: string): void => {
  const prefix = namespacePrefix[namespace];
  const pattern =
    namespace === 'restore' ? /^shotgun_restore_[a-z0-9_]+$/u : /^shotgun_test_iso_[a-z0-9_]+$/u;
  if (!pattern.test(databaseName) || !databaseName.startsWith(prefix)) {
    throw new Error(
      'Refusing to operate outside the ' + namespace + ' isolated database namespace.',
    );
  }
};

export const createIsolatedPostgresDatabase = async (
  sourceDatabaseUrl: string,
  namespace: IsolatedPostgresNamespace,
): Promise<IsolatedPostgresDatabase> => {
  const databaseName = generatedDatabaseName(namespace);
  await withClient(adminDatabaseUrl(sourceDatabaseUrl), async (client) => {
    await client.query('CREATE DATABASE "' + databaseName + '" WITH TEMPLATE template0');
  });
  return {
    databaseName,
    databaseUrl: databaseUrlFor(sourceDatabaseUrl, databaseName),
  };
};

export const dropIsolatedPostgresDatabase = async (
  sourceDatabaseUrl: string,
  namespace: IsolatedPostgresNamespace,
  databaseName: string,
): Promise<void> => {
  assertDatabaseName(namespace, databaseName);
  await withClient(adminDatabaseUrl(sourceDatabaseUrl), async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await client.query('DROP DATABASE "' + databaseName + '"');
  });
};

export const isolatedPostgresNamespacePrefix = (namespace: IsolatedPostgresNamespace): string =>
  namespacePrefix[namespace];
