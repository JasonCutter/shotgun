import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

import { createPostgresPool } from '../adapters/postgres/src/index.js';
import { PostgresSearchProjectionRepository } from '../adapters/postgres-stage7/src/index.js';
import { createProjectionSearchModule } from '../modules/projection-search/src/index.js';
import {
  type CanonicalSearchResponse,
  type CanonicalSnapshot,
  createQuery,
  createQueryResult,
  stableJson,
} from '../packages/contracts/src/index.js';
import {
  createEvaluationRun,
  createSearchBaselineSeed,
  evaluateSearchObservations,
  type SearchQueryObservation,
  validateCorpus,
  validateEvaluationRun,
} from '../packages/quality-evaluation/src/index.js';
import type { HandlerContext } from '../packages/module-sdk/src/index.js';
import { loadQualityCorpus } from '../tests/helpers/quality-evaluation.js';

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl)
  throw new Error('DATABASE_URL is required for the PostgreSQL search baseline.');

const outputFile = path.resolve('docs', 'engineering', 'baselines', 'search-baseline.v1.json');
const migrationDirectory = path.resolve('db', 'migrations');
const applicationCommitSha = (): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const baseUrl = new URL(baseDatabaseUrl);
const isolatedDatabaseName = `shotgun_quality_${process.pid}_${Date.now().toString(16)}`;
if (!/^shotgun_quality_[a-z0-9_]+$/.test(isolatedDatabaseName)) {
  throw new Error('Generated Quality baseline Database name is unsafe.');
}
const isolatedUrl = new URL(baseUrl);
isolatedUrl.pathname = `/${isolatedDatabaseName}`;
const admin = new Client({ connectionString: baseUrl.toString() });
let databaseCreated = false;

const applyMigrations = async (connectionString: string): Promise<void> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS runtime');
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) {
      await client.query(await readFile(path.join(migrationDirectory, file), 'utf8'));
    }
  } finally {
    await client.end();
  }
};

await admin.connect();
try {
  const collision = await admin.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
    [isolatedDatabaseName],
  );
  if (collision.rows[0]?.exists)
    throw new Error('Isolated Quality baseline Database already exists.');
  await admin.query(`CREATE DATABASE "${isolatedDatabaseName}"`);
  databaseCreated = true;
  await applyMigrations(isolatedUrl.toString());

  const corpus = await loadQualityCorpus();
  validateCorpus(corpus, 'baseline');
  const projectId = `quality:${corpus.manifest.corpusDigest}`;
  const seed = createSearchBaselineSeed(corpus, projectId);
  const pool = createPostgresPool(isolatedUrl.toString());
  try {
    const repository = new PostgresSearchProjectionRepository(pool);
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
        producerModule: 'quality-baseline-runner',
        producerVersion: '1.0.0',
        projectId,
        actor: { type: 'service', id: 'quality-baseline-runner' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'public',
          dataClassification: 'SYNTHETIC',
        },
        payload: { query: queryText, limit },
      });
      const context: HandlerContext = {
        moduleId: 'quality-baseline-runner',
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
            producerModule: 'quality-baseline-runner',
            producerVersion: '1.0.0',
            payload: activeSnapshot as TResult,
          });
        },
      };
      return (await handler.handle(query, context)) as CanonicalSearchResponse;
    };

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
      if (response.readiness.status !== 'READY') {
        throw new Error(`Search query '${query.queryId}' did not run against a READY Projection.`);
      }
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
              stableJson(item.evidenceIds) === stableJson(entry.document.evidenceIds),
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

    const version = await pool.query<{ server_version: string }>('SHOW server_version');
    const extension = await pool.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    const searchConfig = await pool.query<{ default_text_search_config: string }>(
      'SHOW default_text_search_config',
    );
    const collation = await pool.query<{ datcollate: string }>(
      'SELECT datcollate FROM pg_database WHERE datname = current_database()',
    );
    const run = createEvaluationRun(corpus.manifest, results, {
      runId: `search:${corpus.manifest.corpusDigest}`,
      runMode: 'deterministic-recorded',
      evaluationKind: 'SEARCH',
      applicationCommitSha: applicationCommitSha(),
      startedAt: corpus.manifest.updatedAt,
      completedAt: corpus.manifest.updatedAt,
      moduleVersions: { 'projection-search': '1.0.0' },
      adapterVersions: { 'postgres-stage7': '1.0.0' },
      projectorVersions: { 'search-projection': '1.0.0' },
      databaseVersion: version.rows[0]?.server_version ?? 'unknown',
      databaseExtensionVersions: { pg_trgm: extension.rows[0]?.extversion ?? 'unknown' },
      databaseSearchConfiguration: {
        fts: 'simple',
        ranking: 'greatest(ts_rank_cd,similarity,substring)',
        tieBreak: 'claim_id-ascending',
        defaultTextSearchConfig: searchConfig.rows[0]?.default_text_search_config ?? 'unknown',
        collation: collation.rows[0]?.datcollate ?? 'unknown',
        kValues: '1,3',
      },
      provider: {
        providerName: 'postgresql-search-adapter',
        providerAdapterVersion: '1.0.0',
        providerModel: 'not-applicable',
        providerModelVersion: 'not-applicable',
        promptVersion: 'not-applicable',
        policyVersion: 'canonical-only-readiness-v1',
      },
      deterministicSettings: 'isolated-database;approved-labels;stable-seed-ids',
      environmentSummary: {
        node: process.version,
        platform: process.platform,
        databaseIsolation: 'ephemeral-database-created-and-dropped',
        thresholdPolicy: 'quality-gate-v1-regression-floor',
      },
    });
    validateEvaluationRun(run);
    if (process.argv.includes('--write')) {
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
    }
    console.log(
      stableJson({
        runId: run.runId,
        evaluationKind: run.evaluationKind,
        corpusId: run.corpusId,
        corpusVersion: run.corpusVersion,
        corpusDigest: run.corpusDigest,
        labelSetRevision: run.labelSetRevision,
        metricImplementationVersion: run.metricImplementationVersion,
        aggregateResults: run.aggregateResults,
        failedQueries: run.caseResults
          .filter((entry) => !entry.passed)
          .map((entry) => entry.evaluationUnitId),
        runDigest: run.runDigest,
        ...(process.argv.includes('--write') ? { outputFile } : {}),
      }),
    );
  } finally {
    await pool.end();
  }
} finally {
  if (databaseCreated) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      isolatedDatabaseName,
    ]);
    await admin.query(`DROP DATABASE "${isolatedDatabaseName}"`);
  }
  await admin.end();
}
