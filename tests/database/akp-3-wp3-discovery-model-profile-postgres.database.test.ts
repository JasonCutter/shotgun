import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryModelProfileRepository } from '../../adapters/discovery-model-profile-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION,
  type DiscoveryModelProfileV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectA = 'akp-3-wp3-profile-project-a';
const projectB = 'akp-3-wp3-profile-project-b';

const profile = (projectId: string, revision: number, id: string): DiscoveryModelProfileV1 => ({
  schemaVersion: DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION,
  profileId: id,
  projectId,
  profileRevision: revision,
  aiConfigurationRevision: 4,
  providerId: 'openai',
  modelId: 'gpt-discovery',
  providerRegistryRevision: 'provider-registry:v1',
  modelCapabilityRevision: 'model-capability:v1',
  promptVersion: 'discovery-ai-prompt:v1',
  outputSchemaVersion: 'discovery-ai-output:v1',
  status: 'PREPARED',
  createdBy: 'owner-1',
  createdAt: '2026-08-30T00:00:00.000Z',
});

describe.runIf(pool)('AKP-3 WP3 Discovery model profile PostgreSQL authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  beforeEach(async () => {
    await pool!.query('DELETE FROM discovery.model_profiles WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
  });

  afterAll(async () => {
    await pool!.query('DELETE FROM discovery.model_profiles WHERE project_id IN ($1, $2)', [
      projectA,
      projectB,
    ]);
    await pool!.end();
  });

  it('persists exact revisions, preserves history, and isolates Projects', async () => {
    const repository = new PostgresDiscoveryModelProfileRepository(pool!);
    const first = profile(projectA, 1, 'profile-a-1');
    const second = { ...profile(projectA, 2, 'profile-a-2'), status: 'ACTIVE' as const };
    const otherProject = profile(projectB, 1, 'profile-b-1');

    expect(await repository.saveRevision({ expectedRevision: 0, next: first })).toBe('CREATED');
    expect(await repository.saveRevision({ expectedRevision: 1, next: second })).toBe('UPDATED');
    expect(await repository.saveRevision({ expectedRevision: 0, next: otherProject })).toBe(
      'CREATED',
    );
    expect(await repository.findRevision(projectA, 1)).toEqual(first);
    expect(await repository.findRevision(projectA, 2)).toEqual(second);
    expect(await repository.findCurrent(projectA)).toEqual(second);
    expect(await repository.findCurrent(projectB)).toEqual(otherProject);
  });

  it('retire/activate is transactional and leaves at most one active profile', async () => {
    const repository = new PostgresDiscoveryModelProfileRepository(pool!);
    const first = profile(projectA, 1, 'profile-a-1');
    const second = profile(projectA, 2, 'profile-a-2');
    await repository.saveRevision({ expectedRevision: 0, next: first });
    await repository.saveRevision({ expectedRevision: 1, next: second });

    expect(
      await repository.updateStatus({
        projectId: projectA,
        profileId: first.profileId,
        profileRevision: 1,
        expectedStatus: 'PREPARED',
        status: 'ACTIVE',
        updatedAt: '2026-08-30T00:01:00.000Z',
      }),
    ).toMatchObject({ profileId: first.profileId, status: 'ACTIVE' });
    expect(
      await repository.updateStatus({
        projectId: projectA,
        profileId: second.profileId,
        profileRevision: 2,
        expectedStatus: 'PREPARED',
        status: 'ACTIVE',
        updatedAt: '2026-08-30T00:02:00.000Z',
      }),
    ).toMatchObject({ profileId: second.profileId, status: 'ACTIVE' });
    expect(await repository.findActive(projectA)).toMatchObject({
      profileId: second.profileId,
      status: 'ACTIVE',
    });
    const retiredFirst = await repository.findRevision(projectA, 1);
    expect(retiredFirst).toMatchObject({
      profileId: first.profileId,
      status: 'RETIRED',
    });
    expect(
      await repository.updateStatus({
        projectId: projectA,
        profileId: first.profileId,
        profileRevision: 1,
        expectedStatus: 'RETIRED',
        status: 'ACTIVE',
        updatedAt: '2026-08-30T00:03:00.000Z',
      }),
    ).toBe('CONFLICT');
    expect(await repository.findRevision(projectA, 1)).toEqual(retiredFirst);
  });

  it('rejects a stale concurrent revision without overwriting the accepted revision', async () => {
    const repository = new PostgresDiscoveryModelProfileRepository(pool!);
    const first = profile(projectA, 1, 'profile-a-1');
    const results = await Promise.all([
      repository.saveRevision({ expectedRevision: 0, next: first }),
      repository.saveRevision({
        expectedRevision: 0,
        next: { ...first, profileId: 'profile-a-race' },
      }),
    ]);
    expect(results.filter((result) => result === 'CREATED')).toHaveLength(1);
    expect(results.filter((result) => result === 'CONFLICT')).toHaveLength(1);
    expect(await repository.findCurrent(projectA)).toBeDefined();
    expect(await repository.findRevision(projectA, 2)).toBeUndefined();
  });
});
