import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import { createProjectionSearchModule } from '../../modules/projection-search/src/index.js';
import {
  type CanonicalSearchResponse,
  type CanonicalSnapshot,
  createQuery,
  createQueryResult,
} from '../../packages/contracts/src/index.js';
import {
  createSearchBaselineSeed,
  evaluateSearchObservations,
  type SearchQueryObservation,
  validateCorpus,
} from '../../packages/quality-evaluation/src/index.js';
import type { HandlerContext } from '../../packages/module-sdk/src/index.js';
import { loadQualityCorpus } from '../helpers/quality-evaluation.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Quality Section 3 PostgreSQL search baseline', () => {
  afterAll(async () => {
    await pool!.end();
  });

  it('seeds reviewed Golden Claims and measures ranking, citation, and stale rejection', async () => {
    const corpus = await loadQualityCorpus();
    validateCorpus(corpus, 'baseline');
    const projectId = `quality-baseline-${randomUUID()}`;
    const seed = createSearchBaselineSeed(corpus, projectId);
    const repository = new PostgresSearchProjectionRepository(pool!);
    const module = createProjectionSearchModule(repository);
    const handler = module.handlers.queries.find(
      (entry) => entry.messageType === 'SearchCanonicalKnowledge',
    )!;
    const snapshot: CanonicalSnapshot = {
      snapshotId: `snapshot:${projectId}`,
      projectId,
      version: seed.canonicalVersion,
      digest: seed.snapshotDigest,
      claims: seed.entries.map((entry) => ({
        claimId: entry.document.claimId,
        text: entry.document.claimText,
        revisionNumber: 1,
        evidenceIds: entry.document.evidenceIds,
      })),
      createdAt: corpus.manifest.updatedAt,
    };

    const invokeSearch = async (
      activeSnapshot: CanonicalSnapshot,
      queryText: string,
      limit: number,
    ): Promise<CanonicalSearchResponse> => {
      const query = createQuery({
        messageType: 'SearchCanonicalKnowledge',
        schemaVersion: '1.0.0',
        producerModule: 'quality-baseline-test',
        producerVersion: '1.0.0',
        projectId,
        actor: { type: 'user', id: 'quality-reviewer' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'public',
          dataClassification: 'SYNTHETIC',
        },
        payload: { query: queryText, limit },
      });
      const context: HandlerContext = {
        moduleId: 'quality-baseline-test',
        attemptNumber: 1,
        async publish() {},
        async query<TPayload, TResult>(input: {
          readonly messageType: string;
          readonly schemaVersion: string;
          readonly payload: TPayload;
        }) {
          return createQueryResult(query, {
            messageType: `${input.messageType}Result`,
            schemaVersion: input.schemaVersion,
            producerModule: 'quality-baseline-test',
            producerVersion: '1.0.0',
            payload: activeSnapshot as TResult,
          });
        },
      };
      return (await handler.handle(query, context)) as CanonicalSearchResponse;
    };

    try {
      await repository.rebuild(projectId, {
        documents: seed.entries.map((entry) => entry.document),
        watermark: {
          projectId,
          canonicalVersion: seed.canonicalVersion,
          snapshotDigest: seed.snapshotDigest,
          status: 'READY',
          updatedAt: corpus.manifest.updatedAt,
        },
      });
      const seedByClaimId = new Map(
        seed.entries.map((entry) => [entry.document.claimId, entry] as const),
      );
      const observations: SearchQueryObservation[] = [];
      for (const query of corpus.cases.flatMap((entry) => entry.queries)) {
        const response = await invokeSearch(snapshot, query.queryText, Math.max(...query.kValues));
        expect(response.readiness.status).toBe('READY');
        observations.push({
          queryId: query.queryId,
          results: response.items.map((item) => {
            const entry = seedByClaimId.get(item.claimId);
            if (!entry) throw new Error(`Unexpected search Claim '${item.claimId}'.`);
            return {
              goldenClaimId: entry.goldenClaimId,
              citationCorrect:
                item.revisionId === entry.document.revisionId &&
                item.sourceVersionId === entry.document.sourceVersionId &&
                JSON.stringify(item.evidenceIds) === JSON.stringify(entry.document.evidenceIds),
            };
          }),
        });
      }

      const staleResponse = await invokeSearch(
        { ...snapshot, version: snapshot.version + 1, digest: `sha256:${'f'.repeat(64)}` },
        'Milo',
        3,
      );
      await repository.markDegraded(
        projectId,
        'QUALITY_BASELINE_DEGRADED_TRIAL',
        corpus.manifest.updatedAt,
      );
      const degradedResponse = await invokeSearch(snapshot, 'Milo', 3);
      const results = evaluateSearchObservations(corpus, observations, [
        {
          trialId: 'stale-watermark',
          readinessStatus: staleResponse.readiness.status as 'STALE',
          resultCount: staleResponse.items.length,
        },
        {
          trialId: 'degraded-watermark',
          readinessStatus: degradedResponse.readiness.status as 'DEGRADED',
          resultCount: degradedResponse.items.length,
        },
      ]);

      expect(results.caseResults).toHaveLength(6);
      expect(results.aggregateResults.metrics.citationCorrectness!.value).toBe(1);
      expect(results.aggregateResults.metrics.staleResultRejectionRate!.value).toBe(1);
      expect(results.aggregateResults.metrics.noResultAccuracy!.value).toBe(1);
      expect(results.aggregateResults.metrics).toHaveProperty('precisionAt3');
      expect(results.aggregateResults.metrics).toHaveProperty('recallAt3');
      expect(results.aggregateResults.metrics).toHaveProperty('hitRateAt3');
      expect(results.aggregateResults.metrics).toHaveProperty('mrr');
      expect(results.aggregateResults.metrics).toHaveProperty('ndcgAt3');
    } finally {
      await pool!.query('DELETE FROM projection.search_documents WHERE project_id = $1', [
        projectId,
      ]);
      await pool!.query('DELETE FROM projection.watermarks WHERE project_id = $1', [projectId]);
    }
  });
});
