import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { EmptyCanonicalSnapshotAdapter } from '../../adapters/canonical-snapshot-empty/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import {
  PostgresAIProviderCallRepository,
  PostgresCandidateRepository,
  PostgresValidationRepository,
} from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresComparisonRepository,
} from '../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createCanonicalKnowledgeModule } from '../../modules/canonical-knowledge/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import {
  type ApprovedChangeSetManifest,
  type CanonicalHistoryEvent,
  type CanonicalOutboxRecord,
  type CanonicalSnapshot,
  createChildEvent,
  type DraftChangeSet,
} from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import {
  changesQuery,
  decisionCommand,
  directTextCommand,
  intakeResultQuery,
  manifestQuery,
} from '../helpers/stage-5.js';
import { historyQuery, outboxQuery, snapshotQuery } from '../helpers/stage-6.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const registerThroughStage5 = (
  kernel: ShotgunKernel,
  storage: InMemoryAssetStorage,
  snapshot: EmptyCanonicalSnapshotAdapter | PostgresCanonicalKnowledgeRepository,
) => {
  const adapter = new LucasAugmentedPlainTextAdapter();
  kernel.register(
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), adapter),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), adapter),
    createAIProviderModule(
      new PostgresAIProviderCallRepository(pool!),
      new FakeAIProviderAdapter(),
      {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 2,
      },
    ),
    createCandidateGenerationModule(new PostgresCandidateRepository(pool!)),
    createValidationModule(new PostgresValidationRepository(pool!)),
    createComparisonModule(new PostgresComparisonRepository(pool!), snapshot, new JsDiffAdapter()),
    createChangeSetReviewModule(new PostgresChangeSetReviewRepository(pool!)),
  );
};

const createHarness = async (
  storage: InMemoryAssetStorage,
  options: { readonly canonical?: boolean; readonly failpoint?: 'after-history' } = {},
) => {
  const kernel = new ShotgunKernel(new InProcessTransport());
  const canonicalRepository = options.canonical
    ? new PostgresCanonicalKnowledgeRepository(pool!, { failpoint: options.failpoint })
    : undefined;
  registerThroughStage5(
    kernel,
    storage,
    canonicalRepository ?? new EmptyCanonicalSnapshotAdapter(),
  );
  if (canonicalRepository) {
    kernel.register(createCanonicalKnowledgeModule(canonicalRepository));
  }
  await kernel.start();
  return { kernel, canonicalRepository };
};

const createDraft = async (
  kernel: ShotgunKernel,
  submissionId: string,
  text = 'Milo weighs 5 kg.',
) => {
  const command = directTextCommand(submissionId, text);
  await kernel.connector.sendCommand(command);
  const intake = (
    await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
  ).result.payload;
  const draft = (
    await kernel.connector.query<{ items: readonly DraftChangeSet[] }>(
      changesQuery(command, intake.sourceVersionId),
    )
  ).result.payload.items[0]!;
  return { command, draft };
};

const approve = async (
  kernel: ShotgunKernel,
  command: ReturnType<typeof directTextCommand>,
  draft: DraftChangeSet,
  reason: string,
) => {
  await kernel.connector.sendCommand(
    decisionCommand(command, draft, 'APPROVE', randomUUID(), reason),
  );
  return (
    await kernel.connector.query<ApprovedChangeSetManifest>(
      manifestQuery(command, draft.changeSetId),
    )
  ).result.payload;
};

const writeFor = (manifest: ApprovedChangeSetManifest) => ({
  commitId: manifest.manifestId,
  revisionId: `revision:${manifest.manifestId}`,
  historyEventId: `history:${manifest.manifestId}`,
  outboxId: `outbox:${manifest.manifestId}`,
  claimId: manifest.operation === 'ADD_CLAIM' ? `claim:${manifest.manifestId}` : undefined,
  manifest,
  actor: { type: 'user' as const, id: manifest.approvalToken.actorId },
  committedAt: new Date().toISOString(),
});

describe.runIf(pool)('Stage 6 PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        canonical.outbox,
        canonical.history_events,
        canonical.revisions,
        canonical.commits,
        canonical.claims,
        canonical.project_state,
        review.decisions,
        review.change_sets,
        comparison.results,
        validation.results,
        candidate.claim_candidates,
        candidate.batches,
        ai.provider_attempts,
        ai.provider_calls,
        evidence.spans,
        transformation.attempts,
        transformation.revisions,
        intake.submissions,
        asset.storage_receipts,
        asset.source_versions,
        asset.sources,
        asset.original_assets
      CASCADE
    `);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('restores Canonical Claim, History and published Outbox after restart and replay', async () => {
    const storage = new InMemoryAssetStorage();
    const first = await createHarness(storage, { canonical: true });
    const created = await createDraft(first.kernel, 'stage6-postgres-restart');
    const manifest = await approve(
      first.kernel,
      created.command,
      created.draft,
      'Persistent owner approval.',
    );
    await first.kernel.shutdown();

    const second = await createHarness(storage, { canonical: true });
    const snapshot = (
      await second.kernel.connector.query<CanonicalSnapshot>(snapshotQuery(created.command))
    ).result.payload;
    const history = (
      await second.kernel.connector.query<{ items: readonly CanonicalHistoryEvent[] }>(
        historyQuery(created.command),
      )
    ).result.payload.items;
    const outbox = (
      await second.kernel.connector.query<CanonicalOutboxRecord>(
        outboxQuery(created.command, `outbox:${manifest.manifestId}`),
      )
    ).result.payload;
    expect(snapshot).toMatchObject({ version: 1, claims: [{ text: 'Milo weighs 5 kg.' }] });
    expect(history).toHaveLength(1);
    expect(outbox).toMatchObject({ status: 'published', attempts: 1 });

    const replay = createChildEvent(created.command, {
      messageType: 'ChangeSetApproved',
      schemaVersion: '1.0.0',
      producerModule: 'stage6-database-test',
      producerVersion: '1.0.0',
      idempotencyKey: `restart-replay:${randomUUID()}`,
      payload: {
        manifestId: manifest.manifestId,
        changeSetId: manifest.changeSetId,
        candidateId: manifest.candidateId,
        operation: manifest.operation,
        contentDigest: manifest.contentDigest,
        expectedCanonicalVersion: manifest.expectedCanonicalVersion,
        approvalTokenDigest: manifest.approvalToken.tokenDigest,
        manifestDigest: manifest.manifestDigest,
      },
    });
    await second.kernel.connector.publishEvent(replay);
    const counts = await pool!.query<{
      claims: string;
      commits: string;
      history: string;
      outbox: string;
    }>(`
      SELECT
        (SELECT count(*) FROM canonical.claims)::text AS claims,
        (SELECT count(*) FROM canonical.commits)::text AS commits,
        (SELECT count(*) FROM canonical.history_events)::text AS history,
        (SELECT count(*) FROM canonical.outbox)::text AS outbox
    `);
    expect(counts.rows[0]).toEqual({
      claims: '1',
      commits: '1',
      history: '1',
      outbox: '1',
    });
    await expect(
      pool!.query(
        `UPDATE canonical.history_events
         SET event_json = event_json
         WHERE history_event_id = $1`,
        [`history:${manifest.manifestId}`],
      ),
    ).rejects.toThrow(/append-only/);
    await second.kernel.shutdown();
  });

  it('rolls back Claim, Commit, History and Outbox together after a partial failure', async () => {
    const harness = await createHarness(new InMemoryAssetStorage(), {
      canonical: true,
      failpoint: 'after-history',
    });
    const created = await createDraft(harness.kernel, 'stage6-postgres-rollback');
    await approve(harness.kernel, created.command, created.draft, 'Trigger rollback test.');
    const deadLetter = harness.kernel.connector.deadLetters
      .list()
      .find((entry) => entry.consumerId === 'stage6.canonical-knowledge');
    expect(deadLetter?.error.code).toBe('TERMINAL_FAILURE');
    const counts = await pool!.query<{
      states: string;
      claims: string;
      commits: string;
      history: string;
      outbox: string;
    }>(`
      SELECT
        (SELECT count(*) FROM canonical.project_state)::text AS states,
        (SELECT count(*) FROM canonical.claims)::text AS claims,
        (SELECT count(*) FROM canonical.commits)::text AS commits,
        (SELECT count(*) FROM canonical.history_events)::text AS history,
        (SELECT count(*) FROM canonical.outbox)::text AS outbox
    `);
    expect(counts.rows[0]).toEqual({
      states: '0',
      claims: '0',
      commits: '0',
      history: '0',
      outbox: '0',
    });
    await harness.kernel.shutdown();
  });

  it('serializes concurrent approved writes and rejects the stale one', async () => {
    const review = await createHarness(new InMemoryAssetStorage());
    const first = await createDraft(review.kernel, 'stage6-concurrent-a', 'Milo weighs 5 kg.');
    const second = await createDraft(review.kernel, 'stage6-concurrent-b', 'Milo weighs 6 kg.');
    const firstManifest = await approve(
      review.kernel,
      first.command,
      first.draft,
      'First delayed Manifest.',
    );
    const secondManifest = await approve(
      review.kernel,
      second.command,
      second.draft,
      'Second delayed Manifest.',
    );
    const repository = new PostgresCanonicalKnowledgeRepository(pool!);
    const results = await Promise.allSettled([
      repository.commit(writeFor(firstManifest)),
      repository.commit(writeFor(secondManifest)),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({ reason: { code: 'STALE_APPROVAL' } });
    const snapshot = await repository.getSnapshot('project-a');
    expect(snapshot.version).toBe(1);
    expect(snapshot.claims).toHaveLength(1);
    await review.kernel.shutdown();
  });
});
