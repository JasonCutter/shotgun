import { createHash } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  PostgresSemanticActiveGenerationReader,
  PostgresSemanticIndexRepository,
} from '../../adapters/semantic-index-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { SemanticProjectionConvergenceCoordinator } from '../../modules/semantic-generation/src/convergence.js';
import {
  SEMANTIC_REPRESENTATION_VERSION_V2,
  SemanticEmbeddingError,
  type SemanticCorpusSourceSnapshotReaderPort,
  type SemanticEmbeddingProfile,
  type SemanticEmbeddingProfilePort,
  type SemanticProjectionGeneration,
  type SemanticProjectionRefreshPort,
} from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const projectId = 'project-c7-convergence-postgres';
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const profile: SemanticEmbeddingProfile = {
  profileId: 'profile-c7-postgres',
  projectId,
  profileRevision: 1,
  providerId: 'provider-c7-postgres',
  embeddingModelId: 'model-c7-postgres',
  credentialId: 'credential-c7-postgres',
  credentialRevision: 1,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension: 2,
  distanceMetric: 'cosine',
  normalizationPolicy: 'unit_length',
  status: 'ACTIVE',
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedBy: 'c7-postgres-test',
  updatedAt: '2026-09-16T00:00:00.000Z',
};

const makeGeneration = (
  generationId: string,
  watermark: SourceWatermark,
): SemanticProjectionGeneration => ({
  projectId,
  generationId,
  sourceProjectionDigest: watermark.sourceSnapshotDigest,
  canonicalBaseVersion: watermark.canonicalVersion,
  credentialId: profile.credentialId,
  credentialRevision: profile.credentialRevision,
  providerPolicyFingerprint: digest('policy'),
  providerId: profile.providerId,
  embeddingModelId: profile.embeddingModelId,
  embeddingProfileId: profile.profileId,
  embeddingProfileRevision: profile.profileRevision,
  providerRegistryRevision: 'providers:c7-postgres',
  capabilityCatalogRevision: 'catalog:c7-postgres',
  representationVersion: profile.representationVersion,
  dimension: profile.dimension,
  distanceMetric: profile.distanceMetric,
  normalizationPolicy: profile.normalizationPolicy,
  buildStatus: 'BUILDING',
  createdAt: '2026-09-16T00:00:00.000Z',
});

type SourceWatermark = {
  readonly projectId: string;
  readonly canonicalVersion: number;
  readonly canonicalSnapshotDigest: string;
  readonly approvedKnowledgeDigest: string;
  readonly sourceSnapshotDigest: string;
};

const watermark = (version: number): SourceWatermark => ({
  projectId,
  canonicalVersion: version,
  canonicalSnapshotDigest: digest(`canonical:${version}`),
  approvedKnowledgeDigest: digest('approved'),
  sourceSnapshotDigest: digest(`source:${version}`),
});

describe('RUS-2-C7 real PostgreSQL semantic convergence acceptance', () => {
  if (!pool) {
    it.skip('TEST_DATABASE_URL is unavailable; PostgreSQL causal proof is deferred to CI.', () => {});
    return;
  }

  let sourceWatermark: SourceWatermark;
  let refreshCalls: number;
  let refresh: SemanticProjectionRefreshPort;
  let source: SemanticCorpusSourceSnapshotReaderPort;
  let profileService: SemanticEmbeddingProfilePort;
  let repository: PostgresSemanticIndexRepository;
  let activeReader: PostgresSemanticActiveGenerationReader;

  beforeEach(async () => {
    await pool!.query('DELETE FROM projection.semantic_items WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM projection.semantic_generation_pointers WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM projection.semantic_generations WHERE project_id = $1', [
      projectId,
    ]);
    sourceWatermark = watermark(1);
    refreshCalls = 0;
    repository = new PostgresSemanticIndexRepository(pool!);
    activeReader = new PostgresSemanticActiveGenerationReader(repository);
    profileService = {
      getCurrent: async () => profile,
    } as unknown as SemanticEmbeddingProfilePort;
    source = {
      readSnapshot: async () => {
        throw new Error('C7 test snapshot path is not used by convergence.');
      },
      readWatermark: async () => sourceWatermark,
    };
    refresh = {
      refresh: async ({ projectId: requestedProjectId }) => {
        refreshCalls += 1;
        const generationId = `generation-c7-postgres-${refreshCalls}`;
        const generation = makeGeneration(generationId, sourceWatermark);
        expect(requestedProjectId).toBe(projectId);
        expect(await repository.saveGeneration(generation)).toBe('CREATED');
        expect(
          await repository.transitionGenerationStatus({
            projectId,
            generationId,
            expectedStatus: 'BUILDING',
            nextStatus: 'READY',
          }),
        ).toBe('UPDATED');
        const pointer = await repository.getActiveGenerationPointer(projectId);
        const activation = await repository.activateGeneration({
          projectId,
          generationId,
          expectedPointer: pointer
            ? {
                kind: 'EXISTING',
                activeGenerationId: pointer.activeGenerationId,
                pointerRevision: pointer.pointerRevision,
              }
            : { kind: 'NONE' },
          sourceProjectionDigest: sourceWatermark.sourceSnapshotDigest,
          canonicalBaseVersion: sourceWatermark.canonicalVersion,
          updatedAt: '2026-09-16T01:00:00.000Z',
        });
        if (activation.status !== 'ACTIVATED') {
          return {
            projectId,
            profileRevision: profile.profileRevision,
            status: 'CONFLICT' as const,
            generationId,
            itemCount: 0,
            membershipDigest: digest('empty-membership'),
          };
        }
        return {
          projectId,
          profileRevision: profile.profileRevision,
          status: 'ACTIVATED' as const,
          generationId,
          itemCount: 0,
          membershipDigest: digest('empty-membership'),
        };
      },
    };
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM projection.semantic_items WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM projection.semantic_generation_pointers WHERE project_id = $1', [
      projectId,
    ]);
    await pool.query('DELETE FROM projection.semantic_generations WHERE project_id = $1', [
      projectId,
    ]);
    await pool.end();
  });

  const createCoordinator = (): SemanticProjectionConvergenceCoordinator =>
    new SemanticProjectionConvergenceCoordinator({
      profileService,
      source,
      activeGenerationReader: activeReader,
      refresh,
    });

  it('converges through real PostgreSQL generation/pointer state and keeps Canonical source read-only', async () => {
    const coordinator = createCoordinator();
    await expect(
      coordinator.converge({
        projectId,
        actor: { type: 'service', id: 'c7-postgres' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'restricted',
          dataClassification: 'c7-postgres',
        },
        trigger: 'EVENT',
      }),
    ).resolves.toMatchObject({ action: 'REFRESHED', generationId: 'generation-c7-postgres-1' });
    expect(refreshCalls).toBe(1);
    expect(await activeReader.getActiveGeneration(projectId)).toMatchObject({
      generationId: 'generation-c7-postgres-1',
      canonicalBaseVersion: 1,
    });

    sourceWatermark = watermark(2);
    const restarted = createCoordinator();
    await expect(
      restarted.converge({
        projectId,
        actor: { type: 'service', id: 'c7-recovery' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'restricted',
          dataClassification: 'semantic-projection-recovery',
        },
        trigger: 'STARTUP',
      }),
    ).resolves.toMatchObject({ action: 'REFRESHED', generationId: 'generation-c7-postgres-2' });
    expect(await activeReader.getActiveGeneration(projectId)).toMatchObject({
      generationId: 'generation-c7-postgres-2',
      canonicalBaseVersion: 2,
    });
  });

  it('is idempotent for duplicate event/recovery delivery and isolates provider failure until restore', async () => {
    const coordinator = createCoordinator();
    const input = {
      projectId,
      actor: { type: 'service' as const, id: 'c7-postgres' },
      security: {
        accessScope: ['owner'],
        sensitivity: 'restricted' as const,
        dataClassification: 'c7-postgres',
      },
      trigger: 'EVENT' as const,
    };
    await Promise.all([coordinator.converge(input), coordinator.converge(input)]);
    expect(refreshCalls).toBe(1);

    sourceWatermark = watermark(2);
    refresh = {
      refresh: async () => {
        throw new SemanticEmbeddingError({
          code: 'PROVIDER_FAILURE',
          safeMessage: 'Provider unavailable.',
          operation: 'c7-postgres-provider',
          retryable: true,
        });
      },
    };
    await expect(coordinator.converge({ ...input, trigger: 'PERIODIC' })).rejects.toMatchObject({
      embeddingErrorCode: 'PROVIDER_FAILURE',
    });
    expect(coordinator.observations()).toMatchObject([
      { projectId, status: 'RECOVERY_PENDING', safeFailureCode: 'PROVIDER_FAILURE' },
    ]);

    refresh = {
      refresh: async () => {
        refreshCalls += 1;
        const generationId = 'generation-c7-postgres-restored';
        const generation = makeGeneration(generationId, sourceWatermark);
        await repository.saveGeneration(generation);
        await repository.transitionGenerationStatus({
          projectId,
          generationId,
          expectedStatus: 'BUILDING',
          nextStatus: 'READY',
        });
        const pointer = await repository.getActiveGenerationPointer(projectId);
        const activation = await repository.activateGeneration({
          projectId,
          generationId,
          expectedPointer: pointer
            ? {
                kind: 'EXISTING',
                activeGenerationId: pointer.activeGenerationId,
                pointerRevision: pointer.pointerRevision,
              }
            : { kind: 'NONE' },
          sourceProjectionDigest: sourceWatermark.sourceSnapshotDigest,
          canonicalBaseVersion: sourceWatermark.canonicalVersion,
          updatedAt: '2026-09-16T02:00:00.000Z',
        });
        expect(activation.status).toBe('ACTIVATED');
        return {
          projectId,
          profileRevision: profile.profileRevision,
          status: 'ACTIVATED' as const,
          generationId,
          itemCount: 0,
          membershipDigest: digest('empty-membership'),
        };
      },
    };
    await expect(coordinator.converge({ ...input, trigger: 'PERIODIC' })).resolves.toMatchObject({
      action: 'REFRESHED',
      generationId: 'generation-c7-postgres-restored',
    });
  });
});
