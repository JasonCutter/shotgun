import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decodeShotgunEnvironment,
  formatEnvironmentIssues,
  SHOTGUN_ENVIRONMENT_CONTRACT,
} from '../../packages/runtime-configuration/src/index.js';
import { readBootstrapConfiguration } from '../../scripts/auth-bootstrap-owner.js';

const validSecret = 'runtime-staging-secret-with-at-least-32-characters';
const validDatabaseUrl = 'postgres://localhost/shotgun';

describe('shared runtime environment decoder', () => {
  it('reports every missing runtime key in one pass', () => {
    const decoded = decodeShotgunEnvironment({}, 'runtime-production');

    expect(decoded.issues).toEqual([
      { key: 'DATABASE_URL', code: 'MISSING' },
      { key: 'SOURCES_STAGING_SECRET', code: 'MISSING' },
      { key: 'SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID', code: 'MISSING' },
    ]);
  });

  it('rejects a short secret without exposing its value', () => {
    const secret = 'short-secret';
    const decoded = decodeShotgunEnvironment(
      { DATABASE_URL: validDatabaseUrl, SOURCES_STAGING_SECRET: secret },
      'runtime-development',
    );
    const message = formatEnvironmentIssues(decoded.issues);

    expect(decoded.issues).toEqual([{ key: 'SOURCES_STAGING_SECRET', code: 'TOO_SHORT' }]);
    expect(message).toContain('SOURCES_STAGING_SECRET (TOO_SHORT)');
    expect(message).not.toContain(secret);
  });

  it('accepts a valid development runtime without requiring an owner authority', () => {
    const decoded = decodeShotgunEnvironment(
      { DATABASE_URL: ` ${validDatabaseUrl} `, SOURCES_STAGING_SECRET: validSecret },
      'runtime-development',
    );

    expect(decoded.issues).toEqual([]);
    expect(decoded.databaseUrl).toBe(validDatabaseUrl);
    expect(decoded.stagingSecret).toBe(validSecret);
    expect(decoded.runtimeOwnerAccountId).toBeUndefined();
  });

  it('requires and trims the production runtime owner identity', () => {
    const decoded = decodeShotgunEnvironment(
      {
        DATABASE_URL: validDatabaseUrl,
        SOURCES_STAGING_SECRET: validSecret,
        SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID: ' runtime-owner ',
      },
      'runtime-production',
    );

    expect(decoded.issues).toEqual([]);
    expect(decoded.runtimeOwnerAccountId).toBe('runtime-owner');
  });

  it('decodes bootstrap settings using the repository string identity contract', () => {
    const decoded = decodeShotgunEnvironment(
      {
        DATABASE_URL: validDatabaseUrl,
        SHOTGUN_BOOTSTRAP_ACCOUNT_ID: ' Owner.Account ',
        SHOTGUN_BOOTSTRAP_PASSWORD: 'existing-auth-contract-password',
        SHOTGUN_BOOTSTRAP_PROJECT_ID: 'project-alpha',
      },
      'bootstrap',
    );

    expect(decoded.issues).toEqual([]);
    expect(decoded.bootstrap).toEqual({
      databaseUrl: validDatabaseUrl,
      accountId: 'owner.account',
      password: 'existing-auth-contract-password',
      projectId: 'project-alpha',
    });
  });

  it('preserves the existing shotgun default project and reports malformed identity fields together', () => {
    const decoded = decodeShotgunEnvironment(
      {
        DATABASE_URL: validDatabaseUrl,
        SHOTGUN_BOOTSTRAP_ACCOUNT_ID: '   ',
        SHOTGUN_BOOTSTRAP_PASSWORD: '',
        SHOTGUN_BOOTSTRAP_PROJECT_ID: '   ',
      },
      'bootstrap',
    );
    const missingProject = decodeShotgunEnvironment(
      {
        DATABASE_URL: validDatabaseUrl,
        SHOTGUN_BOOTSTRAP_ACCOUNT_ID: 'owner',
        SHOTGUN_BOOTSTRAP_PASSWORD: 'password',
      },
      'bootstrap',
    );

    expect(decoded.issues).toEqual([
      { key: 'SHOTGUN_BOOTSTRAP_ACCOUNT_ID', code: 'EMPTY' },
      { key: 'SHOTGUN_BOOTSTRAP_PASSWORD', code: 'EMPTY' },
      { key: 'SHOTGUN_BOOTSTRAP_PROJECT_ID', code: 'EMPTY' },
    ]);
    expect(missingProject.bootstrap?.projectId).toBe('shotgun');
  });

  it('allows explicit recovery injection and does not require runtime owner authority', () => {
    const decoded = decodeShotgunEnvironment(
      { SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID: 'ignored-in-recovery' },
      'recovery',
      { databaseUrl: validDatabaseUrl, stagingSecret: validSecret },
    );

    expect(decoded.issues).toEqual([]);
    expect(decoded.databaseUrl).toBe(validDatabaseUrl);
    expect(decoded.stagingSecret).toBe(validSecret);
  });
});

describe('declared environment contract and owner-facing consumers', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  it('.env.example contains every declared owner-facing example key and no sensitive value', () => {
    const example = readFileSync(path.join(repositoryRoot, '.env.example'), 'utf8');
    const declared = new Set(
      example
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
        .filter((key): key is string => key !== undefined),
    );
    const contractKeys = new Set<string>(SHOTGUN_ENVIRONMENT_CONTRACT.map((entry) => entry.key));

    for (const entry of SHOTGUN_ENVIRONMENT_CONTRACT.filter(
      (item) => 'decoderOwned' in item && item.decoderOwned && item.example,
    )) {
      expect(declared.has(entry.key), `${entry.key} missing from .env.example`).toBe(true);
    }
    expect(contractKeys.has('SHOTGUN_BOOTSTRAP_PASSWORD')).toBe(true);
    expect(example).toContain('replace-with-at-least-32-character-staging-secret');
    expect(example).toContain('replace-with-bootstrap-password');
  });

  it('application, launch, and bootstrap consumers import the same decoder', () => {
    const consumers = [
      'assemblies/shotgun-app/src/application.ts',
      'scripts/launch-core.ts',
      'scripts/auth-bootstrap-owner.ts',
    ];
    for (const relativePath of consumers) {
      expect(readFileSync(path.join(repositoryRoot, relativePath), 'utf8')).toContain(
        'decodeShotgunEnvironment',
      );
    }
  });

  it('bootstrap entrypoint returns the shared decoder contract without logging secrets', () => {
    const password = 'bootstrap-password-never-printed';
    expect(
      readBootstrapConfiguration({
        DATABASE_URL: validDatabaseUrl,
        SHOTGUN_BOOTSTRAP_ACCOUNT_ID: 'Owner',
        SHOTGUN_BOOTSTRAP_PASSWORD: password,
      }),
    ).toEqual({
      databaseUrl: validDatabaseUrl,
      accountId: 'owner',
      password,
      projectId: 'shotgun',
    });
    expect(
      formatEnvironmentIssues([{ key: 'SHOTGUN_BOOTSTRAP_PASSWORD', code: 'EMPTY' }]),
    ).not.toContain(password);
  });

  it('Discovery runtime authority has no bootstrap-variable fallback', () => {
    const source = readFileSync(
      path.join(repositoryRoot, 'assemblies/shotgun-app/src/application.ts'),
      'utf8',
    );
    expect(source).toContain('configuration.runtimeOwnerAccountId');
    expect(source).not.toContain('SHOTGUN_BOOTSTRAP_ACCOUNT_ID');
  });
});
