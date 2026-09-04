import { randomUUID } from 'node:crypto';

import { createPostgresPool } from '../adapters/postgres/src/index.js';
import {
  PostgresDeadLetterStore,
  PostgresDedupStore,
  PostgresJobRuntime,
  PostgresOrderingStore,
} from '../adapters/connector-runtime-postgres/src/index.js';
import { ShotgunError, type CommandEnvelope } from '../packages/contracts/src/index.js';
import type { ConnectorSemanticIdentity } from '../packages/connector-runtime/src/ports.js';
import { ShotgunKernel } from '../packages/kernel/src/index.js';
import { InProcessTransport } from '../adapters/transport-in-process/src/index.js';
import { createPingModule } from '../modules/ping/src/index.js';
import { createPongModule } from '../modules/pong/src/index.js';
import { securePingCommand } from '../tests/helpers/stage-1.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
const pool = createPostgresPool(databaseUrl);

const identity = (
  projectId: string,
  semanticKey: string,
  fingerprint: string,
): ConnectorSemanticIdentity => ({
  projectId,
  securityScope: JSON.stringify({
    accessScope: ['owner'],
    sensitivity: 'internal',
    dataClassification: 'test',
  }),
  consumerId: 'smoke:command:Correction',
  messageKind: 'command',
  messageType: 'Correction',
  semanticKey,
  fingerprint,
});

const envelope = (value: ConnectorSemanticIdentity): CommandEnvelope => ({
  messageId: randomUUID(),
  messageType: value.messageType,
  messageKind: 'command',
  schemaVersion: '1.0.0',
  producerModule: 'smoke',
  producerVersion: '1.0.0',
  correlationId: randomUUID(),
  projectId: value.projectId,
  security: { accessScope: ['owner'], sensitivity: 'internal', dataClassification: 'test' },
  payload: { ok: true },
  createdAt: new Date().toISOString(),
  traceId: randomUUID(),
  idempotencyKey: value.semanticKey,
  orderingKey: 'stream',
  sequence: 1,
});

const main = async (): Promise<void> => {
  const dedup = new PostgresDedupStore(pool);
  const ordering = new PostgresOrderingStore(pool);
  const deadLetters = new PostgresDeadLetterStore(pool);
  const a = identity('correction-project-a', 'same-key', 'fp-a');
  const b = identity('correction-project-b', 'same-key', 'fp-b');

  const [aBegin, bBegin] = await Promise.all([
    dedup.begin({ ...a, jobId: randomUUID() }),
    dedup.begin({ ...b, jobId: randomUUID() }),
  ]);
  if (aBegin.kind !== 'ACQUIRED' || bBegin.kind !== 'ACQUIRED')
    throw new Error('scope isolation failed');
  const aJob = await new PostgresJobRuntime(pool).run(a, randomUUID(), async () => 'a');
  const bJob = await new PostgresJobRuntime(pool).run(b, randomUUID(), async () => 'b');
  if (aJob.result !== 'a' || bJob.result !== 'b') throw new Error('job identity isolation failed');

  const orderedA = identity('ordered-a', 'ordered-key', 'ordered-fp-a');
  const orderedB = identity('ordered-b', 'ordered-key', 'ordered-fp-b');
  await Promise.all([
    dedup.begin({ ...orderedA, jobId: randomUUID() }),
    dedup.begin({ ...orderedB, jobId: randomUUID() }),
  ]);
  const [fenceA, fenceB] = await Promise.all([
    ordering.acquireNext(orderedA, envelope(orderedA), randomUUID(), 60_000),
    ordering.acquireNext(orderedB, envelope(orderedB), randomUUID(), 60_000),
  ]);
  let sameScopeBlocked = false;
  try {
    await ordering.acquireNext(orderedA, envelope(orderedA), randomUUID(), 60_000);
  } catch (error) {
    sameScopeBlocked = error instanceof ShotgunError && error.code === 'RETRYABLE_DEPENDENCY';
  }
  if (!sameScopeBlocked) throw new Error('ordering pre-handler fence failed');
  await ordering.commit(orderedA, envelope(orderedA), fenceA.fencingToken);
  await ordering.commit(orderedB, envelope(orderedB), fenceB.fencingToken);

  const retryIdentity = identity('retry-project', 'retry-key', 'retry-fp');
  const retryBegin = await dedup.begin({ ...retryIdentity, jobId: randomUUID() });
  if (retryBegin.kind !== 'ACQUIRED') throw new Error('retry dedup setup failed');
  const dedupRow = await pool.query<{ dedup_record_id: string }>(
    'SELECT dedup_record_id FROM connector.dedup_records WHERE project_id=$1 AND semantic_key=$2',
    [retryIdentity.projectId, retryIdentity.semanticKey],
  );
  const retryJobs = new PostgresJobRuntime(pool, 3, 1);
  await retryJobs.enqueue({
    jobId: retryBegin.record.jobId!,
    dedupRecordId: dedupRow.rows[0]!.dedup_record_id,
    identity: retryIdentity,
    correlationId: randomUUID(),
  });
  const retryLease = await retryJobs.claim({
    jobId: retryBegin.record.jobId!,
    leaseOwner: 'smoke-worker',
    leaseDurationMs: 60_000,
  });
  if (!retryLease) throw new Error('retry claim setup failed');
  if (
    !(await retryJobs.retry({
      jobId: retryBegin.record.jobId!,
      fencingToken: retryLease.fencingToken,
      nextAttemptAt: new Date(Date.now() + 1).toISOString(),
      safeErrorCode: 'RETRYABLE_DEPENDENCY',
      safeErrorMessage: 'persisted retry',
    }))
  )
    throw new Error('retry persistence failed');
  const restarted = await new PostgresJobRuntime(pool, 3, 1).run(
    retryIdentity,
    randomUUID(),
    async () => 'after-restart',
  );
  if (restarted.result !== 'after-restart') throw new Error('restart-safe retry failed');

  const dlqIdentity = identity('replay-project', 'replay-key', 'replay-fp');
  const dlqBegin = await dedup.begin({ ...dlqIdentity, jobId: randomUUID() });
  if (dlqBegin.kind !== 'ACQUIRED') throw new Error('replay dedup setup failed');
  await dedup.fail({
    identity: dlqIdentity,
    fenceToken: dlqBegin.record.fenceToken,
    jobId: dlqBegin.record.jobId!,
    safeErrorCode: 'TERMINAL_FAILURE',
    safeErrorMessage: 'smoke failure',
  });
  const dlq = await deadLetters.add({
    projectId: dlqIdentity.projectId,
    securityScope: dlqIdentity.securityScope,
    kind: 'command',
    consumerId: 'smoke',
    identity: dlqIdentity,
    messageType: dlqIdentity.messageType,
    semanticKey: dlqIdentity.semanticKey,
    fingerprint: dlqIdentity.fingerprint,
    envelope: envelope(dlqIdentity),
    error: new ShotgunError({
      code: 'TERMINAL_FAILURE',
      safeMessage: 'smoke failure',
      module: 'smoke',
      operation: 'smoke',
    }),
  });
  let denied = false;
  try {
    await deadLetters.authorizeReplay(dlq.deadLetterId, {
      actor: { type: 'user', id: 'operator' },
      projectId: 'wrong-project',
      securityScope: dlqIdentity.securityScope,
      reason: 'wrong scope',
    });
  } catch (error) {
    denied = error instanceof ShotgunError && error.code === 'REPLAY_BLOCKED';
  }
  if (!denied) throw new Error('replay project isolation failed');
  await deadLetters.authorizeReplay(dlq.deadLetterId, {
    actor: { type: 'user', id: 'operator' },
    projectId: dlqIdentity.projectId,
    securityScope: dlqIdentity.securityScope,
    reason: 'approved smoke replay',
  });

  const firstPing = createPingModule();
  const firstPong = createPongModule();
  const firstKernel = new ShotgunKernel(new InProcessTransport(), {
    connectorRuntimeState: { dedup, jobs: new PostgresJobRuntime(pool), deadLetters, ordering },
  });
  firstKernel.register(firstPing.module, firstPong.module);
  await firstKernel.start();
  const command = securePingCommand('correction-runtime-restart');
  await firstKernel.connector.sendCommand(command);
  await firstKernel.shutdown();

  const secondPing = createPingModule();
  const secondPong = createPongModule();
  const secondKernel = new ShotgunKernel(new InProcessTransport(), {
    connectorRuntimeState: {
      dedup: new PostgresDedupStore(pool),
      jobs: new PostgresJobRuntime(pool),
      deadLetters: new PostgresDeadLetterStore(pool),
      ordering: new PostgresOrderingStore(pool),
    },
  });
  secondKernel.register(secondPing.module, secondPong.module);
  await secondKernel.start();
  const duplicate = await secondKernel.connector.sendCommand(command);
  if (duplicate.status !== 'duplicate' || secondPing.state.commandSideEffects !== 0)
    throw new Error('runtime restart dedup failed');
  let durableLegacyReplayDenied = false;
  try {
    await secondKernel.connector.replay(dlq.deadLetterId, 'legacy string replay');
  } catch (error) {
    durableLegacyReplayDenied = error instanceof ShotgunError && error.code === 'REPLAY_BLOCKED';
  }
  if (!durableLegacyReplayDenied) throw new Error('durable legacy replay bypass was not blocked');
  await secondKernel.shutdown();
  console.log('wp05-correction-smoke: PASS');
};

try {
  await main();
} finally {
  await pool.end();
}
