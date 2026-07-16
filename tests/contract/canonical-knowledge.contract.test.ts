import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  type ApprovedChangeSetManifest,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalOutboxRecord,
  type CanonicalSnapshot,
  createChildEvent,
} from '../../packages/contracts/src/index.js';
import {
  commitQuery,
  createDraft,
  createStage6Harness,
  decisionCommand,
  historyQuery,
  manifestQuery,
  outboxQuery,
  snapshotQuery,
} from '../helpers/stage-6.js';
import { createStage5Harness } from '../helpers/stage-5.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

describe.each(transports)('%s Stage 6 contract', (_name, createTransport) => {
  it('blocks unapproved candidates from Canonical storage', async () => {
    const { kernel, canonicalRepository } = await createStage6Harness({
      transport: createTransport(),
    });
    const { command } = await createDraft(kernel, `stage6-unapproved-${randomUUID()}`);
    const snapshot = (await kernel.connector.query<CanonicalSnapshot>(snapshotQuery(command)))
      .result.payload;

    expect(snapshot).toMatchObject({ version: 0, claims: [] });
    expect(canonicalRepository.counts()).toEqual({
      claims: 0,
      commits: 0,
      revisions: 0,
      history: 0,
      outbox: 0,
      facts: 0,
    });
  });

  it('atomically commits an approved Claim with Revision, History and published Outbox', async () => {
    const { kernel, canonicalRepository } = await createStage6Harness({
      transport: createTransport(),
    });
    const { command, draft } = await createDraft(kernel, `stage6-commit-${randomUUID()}`);
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Evidence verified by owner.'),
    );
    const manifest = (
      await kernel.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(command, draft.changeSetId),
      )
    ).result.payload;
    const commit = (
      await kernel.connector.query<CanonicalCommitResult>(commitQuery(command, manifest.manifestId))
    ).result.payload;
    const snapshot = (await kernel.connector.query<CanonicalSnapshot>(snapshotQuery(command)))
      .result.payload;
    const history = (
      await kernel.connector.query<{ items: readonly CanonicalHistoryEvent[] }>(
        historyQuery(command),
      )
    ).result.payload.items;
    const outbox = (
      await kernel.connector.query<CanonicalOutboxRecord>(outboxQuery(command, commit.outboxId))
    ).result.payload;

    expect(commit).toMatchObject({
      status: 'COMMITTED',
      beforeVersion: 0,
      afterVersion: 1,
      manifestDigest: manifest.manifestDigest,
    });
    expect(snapshot).toMatchObject({
      version: 1,
      claims: [{ text: 'Milo weighs 5 kg.', revisionNumber: 1 }],
    });
    expect(history).toMatchObject([
      {
        eventType: 'CANONICAL_CLAIM_ADDED',
        reason: 'Evidence verified by owner.',
        actor: { type: 'user', id: 'owner-a' },
      },
    ]);
    expect(outbox).toMatchObject({ status: 'published', attempts: 1 });
    expect(canonicalRepository.counts()).toEqual({
      claims: 1,
      commits: 1,
      revisions: 1,
      history: 1,
      outbox: 1,
      facts: 0,
    });
  });

  it('keeps Claim and Fact separate and records an exact duplicate as NO_OP', async () => {
    const { kernel, canonicalRepository } = await createStage6Harness({
      transport: createTransport(),
    });
    const first = await createDraft(kernel, `stage6-first-${randomUUID()}`);
    await kernel.connector.sendCommand(
      decisionCommand(first.command, first.draft, 'APPROVE', randomUUID(), 'Add first Claim.'),
    );
    const second = await createDraft(kernel, `stage6-duplicate-${randomUUID()}`);
    expect(second.draft.operation).toBe('NO_OP');
    await kernel.connector.sendCommand(
      decisionCommand(
        second.command,
        second.draft,
        'APPROVE',
        randomUUID(),
        'Duplicate confirmed.',
      ),
    );

    const snapshot = (
      await kernel.connector.query<CanonicalSnapshot>(snapshotQuery(second.command))
    ).result.payload;
    expect(snapshot.version).toBe(1);
    expect(snapshot.claims).toHaveLength(1);
    expect(canonicalRepository.counts()).toMatchObject({
      claims: 1,
      facts: 0,
      commits: 2,
      revisions: 2,
      history: 2,
      outbox: 2,
    });
  });

  it('replays the same approved Manifest without duplicating Canonical records', async () => {
    const { kernel, canonicalRepository } = await createStage6Harness({
      transport: createTransport(),
    });
    const { command, draft } = await createDraft(kernel, `stage6-replay-${randomUUID()}`);
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Replay-safe approval.'),
    );
    const manifest = (
      await kernel.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(command, draft.changeSetId),
      )
    ).result.payload;
    const before = canonicalRepository.fingerprint();
    const replay = createChildEvent(command, {
      messageType: 'ChangeSetApproved',
      schemaVersion: '1.0.0',
      producerModule: 'stage6-test',
      producerVersion: '1.0.0',
      idempotencyKey: `manual-replay:${randomUUID()}`,
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
    const delivery = await kernel.connector.publishEvent(replay);

    expect(delivery.consumers).toMatchObject([
      { consumerId: 'stage6.canonical-knowledge', status: 'processed' },
    ]);
    expect(canonicalRepository.fingerprint()).toBe(before);
  });

  it('dead-letters a second approval when the Canonical Snapshot changed', async () => {
    const reviewOnly = await createStage5Harness({ transport: createTransport() });
    const delayed = await createDraft(
      reviewOnly.kernel,
      `stage6-delayed-${randomUUID()}`,
      'Milo weighs 6 kg.',
    );
    await reviewOnly.kernel.connector.sendCommand(
      decisionCommand(
        delayed.command,
        delayed.draft,
        'APPROVE',
        randomUUID(),
        'Approved before delivery.',
      ),
    );
    const delayedManifest = (
      await reviewOnly.kernel.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(delayed.command, delayed.draft.changeSetId),
      )
    ).result.payload;

    const { kernel } = await createStage6Harness({
      transport: createTransport(),
      reviewRepository: reviewOnly.reviewRepository,
    });
    const first = await createDraft(
      kernel,
      `stage6-stale-first-${randomUUID()}`,
      'Milo weighs 5 kg.',
    );
    await kernel.connector.sendCommand(
      decisionCommand(first.command, first.draft, 'APPROVE', randomUUID(), 'Commit first.'),
    );
    const delayedEvent = createChildEvent(delayed.command, {
      messageType: 'ChangeSetApproved',
      schemaVersion: '1.0.0',
      producerModule: 'stage6-test',
      producerVersion: '1.0.0',
      idempotencyKey: `delayed:${randomUUID()}`,
      payload: {
        manifestId: delayedManifest.manifestId,
        changeSetId: delayedManifest.changeSetId,
        candidateId: delayedManifest.candidateId,
        operation: delayedManifest.operation,
        contentDigest: delayedManifest.contentDigest,
        expectedCanonicalVersion: delayedManifest.expectedCanonicalVersion,
        approvalTokenDigest: delayedManifest.approvalToken.tokenDigest,
        manifestDigest: delayedManifest.manifestDigest,
      },
    });
    await kernel.connector.publishEvent(delayedEvent);

    const stale = kernel.connector.deadLetters
      .list()
      .find(
        (entry) =>
          entry.consumerId === 'stage6.canonical-knowledge' &&
          entry.envelope.correlationId === delayed.command.correlationId,
      );
    const snapshot = (await kernel.connector.query<CanonicalSnapshot>(snapshotQuery(first.command)))
      .result.payload;
    expect(stale?.error.code).toBe('STALE_APPROVAL');
    expect(snapshot).toMatchObject({ version: 1, claims: [{ text: 'Milo weighs 5 kg.' }] });
  });

  it('rejects expired approval and a payload that does not match the stored Manifest', async () => {
    const { kernel, clock } = await createStage6Harness({ transport: createTransport() });
    const expired = await createDraft(kernel, `stage6-expired-${randomUUID()}`);
    const oldDecision = {
      ...decisionCommand(expired.command, expired.draft, 'APPROVE', randomUUID(), 'Old approval.'),
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    clock.set('2026-07-17T00:00:00.000Z');
    await kernel.connector.sendCommand(oldDecision);
    expect(
      kernel.connector.deadLetters
        .list()
        .find((entry) => entry.envelope.correlationId === expired.command.correlationId)?.error
        .code,
    ).toBe('STALE_APPROVAL');

    const current = await createDraft(kernel, `stage6-forged-${randomUUID()}`, 'Milo is healthy.');
    clock.set(new Date().toISOString());
    await kernel.connector.sendCommand(
      decisionCommand(current.command, current.draft, 'APPROVE', randomUUID(), 'Current approval.'),
    );
    const manifest = (
      await kernel.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(current.command, current.draft.changeSetId),
      )
    ).result.payload;
    const forged = createChildEvent(current.command, {
      messageType: 'ChangeSetApproved',
      schemaVersion: '1.0.0',
      producerModule: 'stage6-test',
      producerVersion: '1.0.0',
      idempotencyKey: `forged:${randomUUID()}`,
      payload: {
        manifestId: manifest.manifestId,
        changeSetId: manifest.changeSetId,
        candidateId: manifest.candidateId,
        operation: manifest.operation,
        contentDigest: `sha256:${'0'.repeat(64)}`,
        expectedCanonicalVersion: manifest.expectedCanonicalVersion,
        approvalTokenDigest: manifest.approvalToken.tokenDigest,
        manifestDigest: manifest.manifestDigest,
      },
    });
    const delivery = await kernel.connector.publishEvent(forged);
    expect(delivery.consumers).toMatchObject([
      { consumerId: 'stage6.canonical-knowledge', status: 'dead-letter' },
    ]);
  });
});
