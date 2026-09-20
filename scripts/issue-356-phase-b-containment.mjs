import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import process from 'node:process';

import { Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\/[^/]+\/shotgun_test$/i.test(databaseUrl)) {
  throw new Error('TEST_DATABASE_URL must target the guarded parent shotgun_test database');
}
if (process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be unset for containment proofs');
}

const parentPool = new Pool({ connectionString: databaseUrl });
const digest = 'sha256:' + '2'.repeat(64);
const stage4Digest = 'sha256:' + '3'.repeat(64);
const reviewContextId = 'phase-b-parent-review-' + randomUUID();
const stage4 = {
  projectId: 'phase-b-parent-stage4-' + randomUUID(),
  sourceId: randomUUID(),
  sourceVersionId: randomUUID(),
  assetId: randomUUID(),
  revisionId: randomUUID(),
  indexingResultId: randomUUID(),
  continuationId: randomUUID(),
};
const stage4StorageKey = 'phase-b-parent-stage4-' + randomUUID();
const sentinelStorageKey = 'phase-b-parent-stage4-sentinel-' + randomUUID();
const askStoragePrefix = 'ask-uploaded-resolution-';
const cleanupScopeEvidence = [];

const queryExactFixtures = async () => {
  const review = await parentPool.query(
    'SELECT count(*)::int AS count FROM frontend_review.context_revision WHERE review_context_id = $1',
    [reviewContextId],
  );
  const continuation = await parentPool.query(
    'SELECT count(*)::int AS count FROM evidence.stage4_continuations WHERE continuation_id = $1',
    [stage4.continuationId],
  );
  const indexing = await parentPool.query(
    'SELECT count(*)::int AS count FROM evidence.indexing_results WHERE indexing_result_id = $1',
    [stage4.indexingResultId],
  );
  const revision = await parentPool.query(
    'SELECT count(*)::int AS count FROM transformation.revisions WHERE revision_id = $1',
    [stage4.revisionId],
  );
  const sourceVersion = await parentPool.query(
    'SELECT count(*)::int AS count FROM asset.source_versions WHERE source_version_id = $1',
    [stage4.sourceVersionId],
  );
  const source = await parentPool.query(
    'SELECT count(*)::int AS count FROM asset.sources WHERE source_id = $1',
    [stage4.sourceId],
  );
  const stage4Asset = await parentPool.query(
    'SELECT count(*)::int AS count FROM asset.original_assets WHERE asset_id = $1',
    [stage4.assetId],
  );
  const sentinelAsset = await parentPool.query(
    'SELECT count(*)::int AS count FROM asset.original_assets WHERE storage_key = $1',
    [sentinelStorageKey],
  );
  return {
    review: review.rows[0]?.count ?? 0,
    continuation: continuation.rows[0]?.count ?? 0,
    indexing: indexing.rows[0]?.count ?? 0,
    revision: revision.rows[0]?.count ?? 0,
    sourceVersion: sourceVersion.rows[0]?.count ?? 0,
    source: source.rows[0]?.count ?? 0,
    stage4Asset: stage4Asset.rows[0]?.count ?? 0,
    sentinelAsset: sentinelAsset.rows[0]?.count ?? 0,
  };
};

const files = [
  'tests/database/frontend-ask-uploaded-source-resolution.database.test.ts',
  'tests/database/akp-8-wp2-cross-section-causal-acceptance.database.test.ts',
  'tests/database/akp-8-wp3-remaining-e2e-acceptance.database.test.ts',
  'tests/database/runtime-data-integrity-wp04-schema.test.ts',
  'tests/database/frontend-sources-stage4-isolation.test.ts',
  'tests/database/post-tf-risk001a-proof-matrix.test.ts',
  'tests/database/akp-8-wp3-final-acceptance-correction.database.test.ts',
];

const queryParent = async () => {
  const review = await parentPool.query(
    'SELECT count(*)::int AS count FROM frontend_review.context_revision WHERE review_context_id = $1',
    [reviewContextId],
  );
  const continuation = await parentPool.query(
    'SELECT state, lease_owner, fencing_token::text AS fencing_token ' +
      'FROM evidence.stage4_continuations WHERE continuation_id = $1',
    [stage4.continuationId],
  );
  const sentinel = await parentPool.query(
    'SELECT count(*)::int AS count FROM asset.original_assets WHERE storage_key = $1',
    [sentinelStorageKey],
  );
  const ask = await parentPool.query(
    'SELECT count(*)::int AS count FROM asset.original_assets WHERE storage_key LIKE $1',
    [askStoragePrefix + '%'],
  );
  const databases = await parentPool.query(
    "SELECT datname FROM pg_database WHERE datname LIKE 'shotgun_test_iso_%' ORDER BY datname",
  );
  return {
    review: review.rows[0]?.count ?? 0,
    continuation: continuation.rows[0] ?? null,
    sentinel: sentinel.rows[0]?.count ?? 0,
    ask: ask.rows[0]?.count ?? 0,
    databases: databases.rows.map((row) => row.datname),
    exactFixtures: await queryExactFixtures(),
  };
};

const insertParentFixtures = async () => {
  await parentPool.query(
    'INSERT INTO frontend_review.context_revision ' +
      '(review_context_id, context_revision, review_resource_id, target_kind, ' +
      'target_id, target_revision, target_digest, resource_project_id, ' +
      'effective_project_id, access_revision, policy_context_revision, ' +
      'canonical_base, artifact_refs, aggregate_state, capabilities, ' +
      'generated_at, source_revision, source_digest, source_updated_at, materialized_at) ' +
      "VALUES ($1, 1, $1, 'DISCOVERY_CANDIDATE', $1, '1', $2, $3, $3, '1', '1', " +
      "'{}'::jsonb, '{}'::jsonb, 'PENDING', '{}'::jsonb, now(), '1', $2, now(), now())",
    [reviewContextId, digest, stage4.projectId],
  );
  await parentPool.query(
    'INSERT INTO asset.original_assets ' +
      '(asset_id, content_hash, size_bytes, storage_key, created_at) ' +
      'VALUES ($1, $2, 1, $3, now())',
    [randomUUID(), digest, sentinelStorageKey],
  );
  await parentPool.query(
    'INSERT INTO asset.original_assets ' +
      '(asset_id, content_hash, size_bytes, storage_key, created_at) ' +
      'VALUES ($1, $2, 1, $3, now())',
    [stage4.assetId, stage4Digest, stage4StorageKey],
  );
  await parentPool.query(
    'INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at) ' +
      'VALUES ($1, $2, $3, now())',
    [stage4.sourceId, stage4.projectId, 'phase-b-containment'],
  );
  await parentPool.query(
    'INSERT INTO asset.source_versions ' +
      '(source_version_id, source_id, version_number, original_asset_id, media_type, ' +
      'access_scope, sensitivity, created_at) ' +
      "VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'public', now())",
    [stage4.sourceVersionId, stage4.sourceId, stage4.assetId],
  );
  await parentPool.query(
    'INSERT INTO transformation.revisions ' +
      '(revision_id, project_id, source_id, source_version_id, source_content_hash, ' +
      'transformer_id, transformer_version, document_ir, source_map, document_hash, ' +
      'source_map_hash, access_scope, sensitivity, created_at) ' +
      "VALUES ($1, $2, $3, $4, $5, 'phase-b-containment', '1', '{}'::jsonb, '{}'::jsonb, " +
      "$5, $5, '{owner}', 'public', now())",
    [stage4.revisionId, stage4.projectId, stage4.sourceId, stage4.sourceVersionId, stage4Digest],
  );
  await parentPool.query(
    'INSERT INTO evidence.indexing_results ' +
      '(indexing_result_id, project_id, source_id, source_version_id, revision_id, ' +
      'transformer_id, transformer_version, status, evidence_count, reused_count, ' +
      'evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, $4, $5, 'phase-b-containment', '1', 'INDEXED', 1, 0, " +
      "$6, 'stage3-evidence-index.v1', $6, now(), now())",
    [
      stage4.indexingResultId,
      stage4.projectId,
      stage4.sourceId,
      stage4.sourceVersionId,
      stage4.revisionId,
      stage4Digest,
    ],
  );
  await parentPool.query(
    'INSERT INTO evidence.stage4_continuations ' +
      '(continuation_id, project_id, source_id, source_version_id, revision_id, ' +
      'indexing_result_id, continuation_key, evidence_snapshot, evidence_set_digest, ' +
      'evidence_count, access_scope, sensitivity, data_classification, state, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, $4, $5, $6, 'phase-b-containment', '[]'::jsonb, $7, 1, " +
      "'{owner}', 'public', 'source-content', 'PENDING', now(), now())",
    [
      stage4.continuationId,
      stage4.projectId,
      stage4.sourceId,
      stage4.sourceVersionId,
      stage4.revisionId,
      stage4.indexingResultId,
      stage4Digest,
    ],
  );
};

const cleanupParentFixtures = async () => {
  const errors = [];
  const scope = {
    reviewDeleteOnlyReplica: true,
    reviewReplicaEntered: false,
    reviewOriginRestored: false,
    originRestoredBeforeNormalDeletes: false,
    normalCleanupRole: null,
    normalDeletesStarted: false,
  };
  let reviewClient;
  let normalClient;
  try {
    try {
      reviewClient = await parentPool.connect();
      try {
        await reviewClient.query('SET session_replication_role = replica');
        scope.reviewReplicaEntered = true;
        await reviewClient.query(
          'DELETE FROM frontend_review.context_revision WHERE review_context_id = $1',
          [reviewContextId],
        );
      } catch (error) {
        errors.push(error);
      } finally {
        if (scope.reviewReplicaEntered) {
          try {
            await reviewClient.query('SET session_replication_role = origin');
            scope.reviewOriginRestored = true;
          } catch (error) {
            errors.push(error);
          }
        }
        reviewClient.release(!scope.reviewOriginRestored && scope.reviewReplicaEntered);
        reviewClient = undefined;
      }
    } catch (error) {
      errors.push(error);
    }
    scope.originRestoredBeforeNormalDeletes =
      !scope.reviewReplicaEntered || scope.reviewOriginRestored;
    try {
      normalClient = await parentPool.connect();
      const role = await normalClient.query('SHOW session_replication_role');
      scope.normalCleanupRole = role.rows[0]?.session_replication_role ?? null;
      if (scope.normalCleanupRole !== 'origin') {
        throw new Error(
          'Normal exact fixture cleanup acquired a client outside origin session_replication_role.',
        );
      }
      scope.normalDeletesStarted = true;
      const run = async (query, parameters) => {
        try {
          await normalClient.query(query, parameters);
        } catch (error) {
          errors.push(error);
        }
      };
      await run('DELETE FROM evidence.stage4_continuations WHERE continuation_id = $1', [
        stage4.continuationId,
      ]);
      await run('DELETE FROM evidence.indexing_results WHERE indexing_result_id = $1', [
        stage4.indexingResultId,
      ]);
      await run('DELETE FROM transformation.revisions WHERE revision_id = $1', [stage4.revisionId]);
      await run('DELETE FROM asset.source_versions WHERE source_version_id = $1', [
        stage4.sourceVersionId,
      ]);
      await run('DELETE FROM asset.sources WHERE source_id = $1', [stage4.sourceId]);
      await run('DELETE FROM asset.original_assets WHERE asset_id = $1', [stage4.assetId]);
      await run('DELETE FROM asset.original_assets WHERE storage_key = $1', [sentinelStorageKey]);
    } catch (error) {
      errors.push(error);
    } finally {
      if (normalClient) {
        normalClient.release();
        normalClient = undefined;
      }
    }
  } finally {
    if (reviewClient) {
      try {
        reviewClient.release(true);
      } catch (error) {
        errors.push(error);
      }
    }
    if (normalClient) {
      try {
        normalClient.release();
      } catch (error) {
        errors.push(error);
      }
    }
    cleanupScopeEvidence.push(scope);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to clean up exact Phase B parent fixtures.');
  }
};

const assertExactFixturesClean = (snapshot, label) => {
  const residue = Object.entries(snapshot.exactFixtures).filter(([, count]) => count !== 0);
  if (residue.length > 0) {
    throw new Error(label + ' left exact parent fixtures: ' + JSON.stringify(residue));
  }
};

const runFile = (file) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        file,
        '--maxWorkers=1',
        '--fileParallelism=false',
        '--testTimeout=60000',
        '--hookTimeout=60000',
      ],
      { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve({ file, code, signal, output });
      else
        reject(new Error(file + ' failed with code=' + code + ' signal=' + signal + '\n' + output));
    });
  });

try {
  await insertParentFixtures();
  const initial = await queryParent();
  const results = [];
  for (const file of files) {
    const before = await queryParent();
    const result = await runFile(file);
    const after = await queryParent();
    if (after.review !== 1 || after.sentinel !== 1 || after.ask !== 0) {
      throw new Error(
        'Parent sentinel containment failed after ' + file + ': ' + JSON.stringify(after),
      );
    }
    if (
      after.continuation?.state !== 'PENDING' ||
      after.continuation?.lease_owner !== null ||
      after.continuation?.fencing_token !== '0'
    ) {
      throw new Error(
        'Parent Stage 4 continuation changed after ' + file + ': ' + JSON.stringify(after),
      );
    }
    if (after.databases.join('|') !== before.databases.join('|')) {
      throw new Error(
        'Isolated database remained after ' + file + ': ' + JSON.stringify(after.databases),
      );
    }
    results.push({
      file,
      parent: {
        review: after.review,
        stage4: after.continuation,
        stage4Sentinel: after.sentinel,
        askRows: after.ask,
      },
      output: result.output,
    });
  }
  await cleanupParentFixtures();
  const afterNormalCleanup = await queryParent();
  assertExactFixturesClean(afterNormalCleanup, 'Normal containment sequence');

  await insertParentFixtures();
  let inducedError;
  try {
    throw new Error('intentional ordinary containment harness failure');
  } catch (error) {
    inducedError = error instanceof Error ? error.message : String(error);
    await cleanupParentFixtures();
  }
  const afterInducedErrorCleanup = await queryParent();
  assertExactFixturesClean(afterInducedErrorCleanup, 'Induced ordinary error cleanup');
  process.stdout.write(
    JSON.stringify(
      {
        initial,
        results,
        afterNormalCleanup,
        inducedError,
        afterInducedErrorCleanup,
        cleanupScopeEvidence,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  try {
    await cleanupParentFixtures();
  } finally {
    await parentPool.end();
  }
}
