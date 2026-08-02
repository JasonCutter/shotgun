import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import type {
  ProjectionCommitWrite,
  ProjectionRebuildWrite,
  SearchProjectionRepositoryPort,
} from '../../modules/projection-search/src/index.js';
import { buildCompiledTruthCommand, runDiscoveryCommand } from '../helpers/stage-10.js';
import { evidenceListQuery } from '../helpers/stage-3.js';
import { decisionCommand } from '../helpers/stage-5.js';
import { createDraft } from '../helpers/stage-6.js';
import { createStage7Harness, workspaceSearchQuery } from '../helpers/stage-7.js';
import { entityCandidate, reviewGroupCommand, stageGroupCommand } from '../helpers/stage-9.js';
import type {
  KnowledgeReviewGroup,
  ProjectionWatermark,
  SearchKnowledgeWorkspaceResult,
  SearchProjectionDocument,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

type ProjectionBackend = 'memory' | 'postgres' | 'postgres-reversed';

class DualSearchProjectionRepository implements SearchProjectionRepositoryPort {
  readonly memory = new InMemorySearchProjectionRepository();
  mode: ProjectionBackend = 'memory';

  constructor(readonly postgres: PostgresSearchProjectionRepository) {}

  async applyCommit(projectId: string, write: ProjectionCommitWrite): Promise<void> {
    await this.memory.applyCommit(projectId, write);
    await this.postgres.applyCommit(projectId, write);
  }

  async rebuild(projectId: string, write: ProjectionRebuildWrite): Promise<void> {
    await this.memory.rebuild(projectId, write);
    await this.postgres.rebuild(projectId, write);
  }

  async markDegraded(projectId: string, error: string, updatedAt: string): Promise<void> {
    await this.memory.markDegraded(projectId, error, updatedAt);
    await this.postgres.markDegraded(projectId, error, updatedAt);
  }

  async findWatermark(projectId: string): Promise<ProjectionWatermark | undefined> {
    return this.active().findWatermark(projectId);
  }

  async search(projectId: string, query: string, limit: number, accessScopes: readonly string[]) {
    const results = await this.active().search(projectId, query, limit, accessScopes);
    return this.mode === 'postgres-reversed' ? [...results].reverse() : results;
  }

  private active(): SearchProjectionRepositoryPort {
    return this.mode === 'memory' ? this.memory : this.postgres;
  }
}

const documentFor = (
  projectId: string,
  claimText = 'Milo weighs 5 kg.',
): SearchProjectionDocument => ({
  projectId,
  claimId: `claim:${randomUUID()}`,
  commitId: randomUUID(),
  revisionId: `revision:${randomUUID()}`,
  canonicalVersion: 1,
  claimText,
  sourceVersionId: randomUUID(),
  evidenceIds: [randomUUID()],
  accessScope: ['owner'],
  sensitivity: 'private',
  projectedAt: new Date().toISOString(),
});

describe.runIf(pool)('Stage 7 PostgreSQL projection and search', () => {
  beforeEach(async () => {
    await pool!.query('TRUNCATE projection.search_documents, projection.watermarks CASCADE');
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('uses pg_trgm plus GIN indexes and restores the Watermark after restart', async () => {
    const extensions = await pool!.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    const indexes = await pool!.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'projection'
       ORDER BY indexname`,
    );
    expect(extensions.rows).toEqual([{ extname: 'pg_trgm' }]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining(['projection_search_fts_idx', 'projection_search_trgm_idx']),
    );

    const projectId = `stage7-db-${randomUUID()}`;
    const document = documentFor(projectId);
    const digest = `sha256:${'1'.repeat(64)}`;
    const first = new PostgresSearchProjectionRepository(pool!);
    await first.applyCommit(projectId, {
      document,
      commitId: document.commitId,
      operation: 'ADD_CLAIM',
      canonicalVersion: 1,
      snapshotDigest: digest,
      projectedAt: document.projectedAt,
    });

    const exact = await first.search(projectId, 'Milo weighs', 10, ['owner']);
    const typo = await first.search(projectId, 'Milo weighs 5 kf.', 10, ['owner']);
    expect(exact[0]).toMatchObject({ claimId: document.claimId, matchType: 'SUBSTRING' });
    expect(typo[0]).toMatchObject({ claimId: document.claimId, matchType: 'TRIGRAM' });
    expect(await first.search(projectId, 'Milo', 10, ['reader'])).toEqual([]);

    const restarted = new PostgresSearchProjectionRepository(pool!);
    expect(await restarted.findWatermark(projectId)).toMatchObject({
      lastCommitId: document.commitId,
      canonicalVersion: 1,
      snapshotDigest: digest,
      status: 'READY',
    });
  });

  it('rolls back a partial document write and supports an atomic rebuild', async () => {
    const projectId = `stage7-db-failure-${randomUUID()}`;
    const document = documentFor(projectId);
    const digest = `sha256:${'2'.repeat(64)}`;
    const failing = new PostgresSearchProjectionRepository(pool!, {
      failpoint: 'after-document',
    });
    await expect(
      failing.applyCommit(projectId, {
        document,
        commitId: document.commitId,
        operation: 'ADD_CLAIM',
        canonicalVersion: 1,
        snapshotDigest: digest,
        projectedAt: document.projectedAt,
      }),
    ).rejects.toThrow('failpoint');
    const count = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM projection.search_documents WHERE project_id = $1',
      [projectId],
    );
    expect(count.rows[0]?.count).toBe('0');

    const healthy = new PostgresSearchProjectionRepository(pool!);
    await healthy.rebuild(projectId, {
      documents: [document],
      watermark: {
        projectId,
        lastCommitId: document.commitId,
        canonicalVersion: 1,
        snapshotDigest: digest,
        status: 'READY',
        updatedAt: document.projectedAt,
      },
    });
    await healthy.rebuild(projectId, {
      documents: [document],
      watermark: {
        projectId,
        lastCommitId: document.commitId,
        canonicalVersion: 1,
        snapshotDigest: digest,
        status: 'READY',
        updatedAt: document.projectedAt,
      },
    });
    expect(await healthy.search(projectId, 'Milo', 10, ['owner'])).toHaveLength(1);
  });

  it('runs the QX-01 handler on PostgreSQL with exact in-memory parity and boundary coverage', async () => {
    const dualRepository = new DualSearchProjectionRepository(
      new PostgresSearchProjectionRepository(pool!),
    );
    const harness = await createStage7Harness({ projectionRepository: dualRepository });

    const approveCanonical = async (submissionId: string, claimText: string) => {
      const fixture = await createDraft(harness.kernel, submissionId, claimText);
      await harness.kernel.connector.sendCommand(
        decisionCommand(
          fixture.command,
          fixture.draft,
          'APPROVE',
          `${submissionId}-approval`,
          'Checked.',
        ),
      );
      return fixture;
    };

    const first = await approveCanonical('qx-01-parity-primary', 'Milo weighs 5 kg.');
    await approveCanonical('qx-01-parity-full-text', 'Milo weighs five kilograms.');
    await approveCanonical('qx-01-parity-trigram', 'Mila weighs 5 kg.');

    const { command, intake } = first;
    {
      const evidence = (
        await harness.kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
          evidenceListQuery(command, intake.sourceVersionId),
        )
      ).result.payload.items[0]!;
      const group = (
        await harness.kernel.connector.sendCommand<KnowledgeReviewGroup>(
          stageGroupCommand(command, 'qx-01-parity-group', intake.sourceVersionId, [
            entityCandidate(
              'qx-01-parity-approved-candidate',
              intake.sourceVersionId,
              evidence.evidenceId,
              'Milo',
            ),
          ]),
        )
      ).result;
      await harness.kernel.connector.sendCommand(reviewGroupCommand(command, group, 'APPROVE'));
      await harness.kernel.connector.sendCommand(
        buildCompiledTruthCommand(command, 'FULL_REBUILD', 'qx-01-parity'),
      );
      await harness.kernel.connector.sendCommand(
        runDiscoveryCommand(command, 'INCREMENTAL', 'qx-01-parity', 100, 10),
      );
    }

    const runWorkspaceQuery = async (
      mode: ProjectionBackend,
      query: string,
      pageSize = 20,
      filters?: SearchKnowledgeWorkspaceResult['matches'][number]['source']['authority'][],
    ) => {
      dualRepository.mode = mode;
      return (
        await harness.kernel.connector.query<SearchKnowledgeWorkspaceResult>(
          workspaceSearchQuery(command, {
            schemaVersion: '1.0.0',
            query,
            pageSize,
            ...(filters ? { filters: { authorities: filters } } : {}),
          }),
        )
      ).result.payload;
    };

    const sourceIdentity = (match: SearchKnowledgeWorkspaceResult['matches'][number]): string => {
      switch (match.source.authority) {
        case 'CANONICAL':
          return match.source.canonicalResourceId;
        case 'APPROVED_KNOWLEDGE':
          return match.source.candidateId;
        case 'COMPILED_TRUTH':
          return match.source.compiledItemId;
        case 'DERIVED_INFERENCE':
          return match.source.inferenceId;
      }
    };
    const parityTuple = (result: SearchKnowledgeWorkspaceResult) =>
      result.matches.map((match) => ({
        authority: match.authority,
        sourceIdentity: sourceIdentity(match),
        score: match.score,
        matchType: match.matchType,
        rank: match.rank,
        label: match.label,
      }));

    for (const queryCase of [
      { query: 'Milo', expectedMatchType: 'SUBSTRING' as const },
      { query: 'weighs kilograms', expectedMatchType: 'FULL_TEXT' as const },
      { query: 'Milo weighs 5 kf.', expectedMatchType: 'TRIGRAM' as const },
    ]) {
      const memoryResult = await runWorkspaceQuery('memory', queryCase.query);
      const postgresResult = await runWorkspaceQuery('postgres', queryCase.query);
      expect(parityTuple(postgresResult)).toEqual(parityTuple(memoryResult));
      expect(
        postgresResult.matches.some((match) => match.matchType === queryCase.expectedMatchType),
      ).toBe(true);
    }

    const canonicalResult = await runWorkspaceQuery('postgres', 'Milo', 20, ['CANONICAL']);
    const canonicalSourceIds = canonicalResult.matches.map(sourceIdentity);
    expect(canonicalSourceIds).toEqual(
      [...canonicalSourceIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    const reversedInputResult = await runWorkspaceQuery('postgres-reversed', 'Milo', 20, [
      'CANONICAL',
    ]);
    expect(parityTuple(reversedInputResult)).toEqual(parityTuple(canonicalResult));

    const cursorSource = await runWorkspaceQuery('postgres', 'Milo', 1);
    expect(cursorSource.nextCursor).toEqual(expect.any(String));
    if (!cursorSource.nextCursor) throw new Error('Expected PostgreSQL cursor.');
    await expect(
      harness.kernel.connector.query(
        workspaceSearchQuery(command, {
          schemaVersion: '1.0.0',
          query: 'Mila',
          cursor: cursorSource.nextCursor,
          pageSize: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
