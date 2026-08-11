import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  databaseResetConfirmation,
  requireConfirmedDestructiveDatabaseTarget,
  requireTestDatabaseTarget,
  type DatabaseTargetProbe,
} from '../../scripts/database-target-guard.js';

const successfulProbe = (database = 'shotgun_test'): DatabaseTargetProbe =>
  vi.fn(async () => ({ database, serverAddress: '127.0.0.1', serverPort: 5432 }));

describe('database target guard', () => {
  it('fails closed when TEST_DATABASE_URL is missing without probing DATABASE_URL', async () => {
    const probe = successfulProbe();
    await expect(
      requireTestDatabaseTarget({
        environment: { DATABASE_URL: 'postgres://user:secret@localhost:5432/shotgun' },
        probe,
      }),
    ).rejects.toThrow(/TEST_DATABASE_URL is required/);
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects normalized normal/test server and database identity equality', async () => {
    const probe = successfulProbe();
    await expect(
      requireTestDatabaseTarget({
        environment: {
          DATABASE_URL: 'postgres://local@localhost/shotgun_test',
          TEST_DATABASE_URL: 'postgresql://test@127.0.0.1:5432/shotgun_test',
        },
        probe,
      }),
    ).rejects.toThrow(/same server\/database/);
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects a database outside the approved test namespace before connecting', async () => {
    const probe = successfulProbe('shotgun');
    await expect(
      requireTestDatabaseTarget({
        environment: { TEST_DATABASE_URL: 'postgres://test@localhost:5433/shotgun' },
        probe,
      }),
    ).rejects.toThrow(/must match/);
    expect(probe).not.toHaveBeenCalled();
  });

  it('accepts a distinct test target only after current_database verification', async () => {
    const probe = successfulProbe();
    const url = 'postgres://test:secret@localhost:5433/shotgun_test';
    await expect(
      requireTestDatabaseTarget({
        environment: {
          DATABASE_URL: 'postgres://local:secret@localhost:5432/shotgun',
          TEST_DATABASE_URL: url,
        },
        probe,
      }),
    ).resolves.toBe(url);
    expect(probe).toHaveBeenCalledWith(url);
  });

  it('rejects a URL whose live current_database differs from its path', async () => {
    await expect(
      requireTestDatabaseTarget({
        environment: { TEST_DATABASE_URL: 'postgres://test@localhost:5433/shotgun_test' },
        probe: successfulProbe('other_test'),
      }),
    ).rejects.toThrow(/current_database\(\)=other_test/);
  });

  it('requires an exact automation-safe confirmation before a general reset', async () => {
    const url = 'postgres://local:secret@localhost:5432/shotgun';
    const probe = successfulProbe('shotgun');
    await expect(
      requireConfirmedDestructiveDatabaseTarget({ databaseUrl: url, probe }),
    ).rejects.toThrow(/reset refused/);
    expect(probe).not.toHaveBeenCalled();

    await expect(
      requireConfirmedDestructiveDatabaseTarget({
        databaseUrl: url,
        confirmation: databaseResetConfirmation(url),
        probe,
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps every database-backed test entrypoint off raw DATABASE_URL', async () => {
    const databaseDirectory = path.resolve('tests/database');
    const databaseFiles = (await readdir(databaseDirectory))
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => path.join(databaseDirectory, file));
    const guardedFixtures = [
      path.resolve('tests/browser/fixtures/frontend-test-backend.ts'),
      path.resolve('tests/browser/fixtures/frontend-cross-phase-backend.ts'),
      path.resolve('tests/integration/recovery-harness-isolation.test.ts'),
      path.resolve('scripts/quality-search-baseline.ts'),
    ];

    for (const file of [...databaseFiles, ...guardedFixtures]) {
      const source = await readFile(file, 'utf8');
      expect(source, file).toContain('requireTestDatabaseTarget');
      expect(source, file).not.toContain('process.env.DATABASE_URL');
    }
  });
});
