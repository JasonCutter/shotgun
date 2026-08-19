import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-postgres/src/index.js';
import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import {
  initialSemanticEmbeddingRegistry,
  SemanticEmbeddingProfileService,
} from '../../modules/semantic-embedding/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import type { EmbeddingCredentialMetadataReference } from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe('AKP-1R R1: PostgreSQL SemanticEmbeddingProfile Persistence & CAS Authority', () => {
  if (!pool) {
    it.skip('PostgreSQL test database not available', () => {});
    return;
  }

  const testProjectA = 'project-akp-1r-profile-test-a';
  const testProjectB = 'project-akp-1r-profile-test-b';

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM projection.semantic_embedding_profiles WHERE project_id IN ($1, $2)`,
      [testProjectA, testProjectB],
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(
        `DELETE FROM projection.semantic_embedding_profiles WHERE project_id IN ($1, $2)`,
        [testProjectA, testProjectB],
      );
      await pool.end();
    }
  });

  const createService = (
    repo: PostgresSemanticEmbeddingProfileRepository | InMemorySemanticEmbeddingProfileRepository,
    customCredentials?: readonly EmbeddingCredentialMetadataReference[],
  ) => {
    const embeddingRegistry = initialSemanticEmbeddingRegistry();
    const providerRegistry = initialProviderRegistry();

    const credentialsList: EmbeddingCredentialMetadataReference[] = customCredentials
      ? [...customCredentials]
      : [
          {
            credentialId: 'cred-openai-1',
            projectId: testProjectA,
            providerId: 'openai',
            credentialRevision: 1,
            lifecycleState: 'active',
          },
          {
            credentialId: 'cred-openai-2',
            projectId: testProjectA,
            providerId: 'openai',
            credentialRevision: 2,
            lifecycleState: 'active',
          },
          {
            credentialId: 'cred-gemini-1',
            projectId: testProjectA,
            providerId: 'google-gemini',
            credentialRevision: 1,
            lifecycleState: 'active',
          },
          {
            credentialId: 'cred-revoked-1',
            projectId: testProjectA,
            providerId: 'openai',
            credentialRevision: 3,
            lifecycleState: 'revoked',
          },
        ];

    const credentialReader = {
      getMetadata: async (scope: {
        projectId: string;
        providerId: string;
        credentialId: string;
        credentialRevision: number;
      }) =>
        credentialsList.find(
          (c) =>
            c.projectId === scope.projectId &&
            c.providerId === scope.providerId &&
            c.credentialId === scope.credentialId &&
            c.credentialRevision === scope.credentialRevision,
        ),
    };

    return new SemanticEmbeddingProfileService(
      providerRegistry,
      embeddingRegistry,
      repo,
      credentialReader,
    );
  };

  it('1. PostgreSQL profile revision survives repository reconstruction and restart', async () => {
    const repo1 = new PostgresSemanticEmbeddingProfileRepository(pool);
    const service1 = createService(repo1);

    const profile = await service1.createProfile({
      projectId: testProjectA,
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-init',
      now: '2026-08-19T10:00:00.000Z',
    });

    expect(profile.profileRevision).toBe(1);
    expect(profile.status).toBe('PREPARED');

    // Simulate service restart by reconstructing repository
    const repo2 = new PostgresSemanticEmbeddingProfileRepository(pool);
    const service2 = createService(repo2);

    const retrieved = await service2.getRevision(testProjectA, 1);
    expect(retrieved).toBeDefined();
    expect(retrieved?.profileId).toBe(profile.profileId);
    expect(retrieved?.projectId).toBe(testProjectA);
    expect(retrieved?.profileRevision).toBe(1);
    expect(retrieved?.providerId).toBe('openai');
    expect(retrieved?.embeddingModelId).toBe('text-embedding-3-small');
    expect(retrieved?.credentialId).toBe('cred-openai-1');
    expect(retrieved?.credentialRevision).toBe(1);
    expect(retrieved?.dimension).toBe(1536);
    expect(retrieved?.distanceMetric).toBe('cosine');
    expect(retrieved?.normalizationPolicy).toBe('unit_length');
    expect(retrieved?.status).toBe('PREPARED');
    expect(retrieved?.updatedBy).toBe('actor-init');
  });

  it('2. expected revision CAS rejects stale profile creation', async () => {
    const repo = new PostgresSemanticEmbeddingProfileRepository(pool);
    const service = createService(repo);

    await service.createProfile({
      projectId: testProjectA,
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-first',
    });

    // Stale revision 0 rejected
    await expect(
      service.createProfile({
        projectId: testProjectA,
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-large',
        credentialId: 'cred-openai-1',
        credentialRevision: 1,
        updatedBy: 'actor-conflict',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFLICT',
    });
  });

  it('3. Project/provider/credential ownership mismatch is rejected', async () => {
    const repo = new PostgresSemanticEmbeddingProfileRepository(pool);
    const service = createService(repo);

    // Mismatched provider (cred-gemini-1 is google-gemini, but request says openai)
    await expect(
      service.createProfile({
        projectId: testProjectA,
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-gemini-1',
        credentialRevision: 1,
        updatedBy: 'actor-owner',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('4. revoked/missing credential revision cannot create a usable profile', async () => {
    const repo = new PostgresSemanticEmbeddingProfileRepository(pool);
    const service = createService(repo);

    // Revoked credential
    await expect(
      service.createProfile({
        projectId: testProjectA,
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-revoked-1',
        credentialRevision: 3,
        updatedBy: 'actor-owner',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });

    // Missing credential revision 99
    await expect(
      service.createProfile({
        projectId: testProjectA,
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-openai-1',
        credentialRevision: 99,
        updatedBy: 'actor-owner',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('5. preparing P2 does not retire/invalidate P1 merely because P2 is newer', async () => {
    const repo = new PostgresSemanticEmbeddingProfileRepository(pool);
    const service = createService(repo);

    const p1 = await service.createProfile({
      projectId: testProjectA,
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-p1',
      now: '2026-08-19T09:00:00.000Z',
    });

    await service.activateProfile({
      projectId: testProjectA,
      profileId: p1.profileId,
      profileRevision: 1,
      updatedBy: 'actor-p1-activate',
      now: '2026-08-19T09:30:00.000Z',
    });

    // Prepare P2 (e.g. switching to Gemini)
    const p2 = await service.createProfile({
      projectId: testProjectA,
      expectedRevision: 1,
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      credentialId: 'cred-gemini-1',
      credentialRevision: 1,
      updatedBy: 'actor-p2-prep',
      now: '2026-08-19T10:00:00.000Z',
    });

    expect(p2.status).toBe('PREPARED');

    // P1 remains ACTIVE
    const activeProfile = await service.getActive(testProjectA);
    expect(activeProfile?.profileId).toBe(p1.profileId);
    expect(activeProfile?.status).toBe('ACTIVE');

    const rev1 = await service.getRevision(testProjectA, 1);
    expect(rev1?.status).toBe('ACTIVE');

    const rev2 = await service.getRevision(testProjectA, 2);
    expect(rev2?.status).toBe('PREPARED');
  });

  it('6. PostgreSQL and in-memory profile semantics match for R1 behaviors', async () => {
    const pgRepo = new PostgresSemanticEmbeddingProfileRepository(pool);
    const memRepo = new InMemorySemanticEmbeddingProfileRepository();

    const pgService = createService(pgRepo);
    const memService = createService(memRepo);

    // Create revision 1 in both
    const pgP1 = await pgService.createProfile({
      projectId: testProjectA,
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-sync',
      now: '2026-08-19T08:00:00.000Z',
    });

    const memP1 = await memService.createProfile({
      projectId: testProjectA,
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-sync',
      now: '2026-08-19T08:00:00.000Z',
    });

    expect(pgP1.status).toBe(memP1.status);
    expect(pgP1.profileRevision).toBe(memP1.profileRevision);
    expect(pgP1.dimension).toBe(memP1.dimension);

    // Conflict on stale revision in both
    await expect(
      pgService.createProfile({
        projectId: testProjectA,
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-openai-1',
        credentialRevision: 1,
        updatedBy: 'actor-conflict',
      }),
    ).rejects.toMatchObject({ embeddingErrorCode: 'CONFLICT' });

    await expect(
      memService.createProfile({
        projectId: testProjectA,
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-openai-1',
        credentialRevision: 1,
        updatedBy: 'actor-conflict',
      }),
    ).rejects.toMatchObject({ embeddingErrorCode: 'CONFLICT' });
  });
});
