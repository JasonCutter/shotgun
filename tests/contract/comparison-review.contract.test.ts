import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  type ApprovedChangeSetManifest,
  type DraftChangeSet,
  ShotgunError,
} from '../../packages/contracts/src/index.js';
import {
  changesQuery,
  createStage5Harness,
  decisionCommand,
  directTextCommand,
  intakeResultQuery,
  manifestQuery,
  reviewQuery,
  snapshotWith,
} from '../helpers/stage-5.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

const createDraft = async (
  createTransport: () => InMemoryTransport | InProcessTransport,
  text = 'Milo weighs 5 kg.',
  snapshot = snapshotWith([]),
) => {
  const harness = await createStage5Harness({ transport: createTransport(), snapshot });
  const command = directTextCommand(`stage5-${randomUUID()}`, text);
  await harness.kernel.connector.sendCommand(command);
  const intake = (
    await harness.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
  ).result.payload;
  const changes = (
    await harness.kernel.connector.query<{ items: readonly DraftChangeSet[] }>(
      changesQuery(command, intake.sourceVersionId),
    )
  ).result.payload.items;
  return { ...harness, command, intake, changes };
};

describe.each(transports)('%s Stage 5 contract', (_name, createTransport) => {
  it('classifies new, exact duplicate, and possible conflict candidates', async () => {
    const fresh = await createDraft(createTransport);
    expect(fresh.changes[0]).toMatchObject({
      classification: 'NEW_CLAIM',
      operation: 'ADD_CLAIM',
      status: 'PENDING_REVIEW',
    });

    const duplicate = await createDraft(
      createTransport,
      'Milo weighs 5 kg.',
      snapshotWith([
        { claimId: 'claim-1', text: 'Milo weighs 5 kg.', revisionNumber: 1, evidenceIds: [] },
      ]),
    );
    expect(duplicate.changes[0]).toMatchObject({
      classification: 'EXACT_DUPLICATE',
      operation: 'NO_OP',
    });

    const conflict = await createDraft(
      createTransport,
      'Milo weighs 5 kg.',
      snapshotWith([
        { claimId: 'claim-2', text: 'Milo weighs 4 kg.', revisionNumber: 1, evidenceIds: [] },
      ]),
    );
    expect(conflict.changes[0]).toMatchObject({
      classification: 'POSSIBLE_CONFLICT',
      operation: 'ADD_CLAIM',
    });
  });

  it('returns Candidate, fixed Snapshot diff, and Evidence in one review bundle', async () => {
    const { kernel, command, changes } = await createDraft(createTransport);
    const bundle = (
      await kernel.connector.query<{
        changeSet: DraftChangeSet;
        evidence: readonly { quote: { exact: string } }[];
        comparison: { diffDigest: string; snapshotVersion: number };
      }>(reviewQuery(command, changes[0]!.changeSetId))
    ).result.payload;

    expect(bundle.changeSet.status).toBe('PENDING_REVIEW');
    expect(bundle.evidence[0]?.quote.exact).toContain('Milo weighs 5 kg.');
    expect(bundle.comparison.diffDigest).toBe(bundle.changeSet.diffDigest);
    expect(bundle.comparison.snapshotVersion).toBe(bundle.changeSet.expectedCanonicalVersion);
  });

  it('creates a server-bound approval token and manifest only after user approval', async () => {
    const { kernel, command, changes } = await createDraft(createTransport);
    const draft = changes[0]!;

    await expect(
      kernel.connector.query<ApprovedChangeSetManifest>(manifestQuery(command, draft.changeSetId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Evidence and diff reviewed.'),
    );
    const manifest = (
      await kernel.connector.query<ApprovedChangeSetManifest>(
        manifestQuery(command, draft.changeSetId),
      )
    ).result.payload;

    expect(manifest).toMatchObject({
      contentDigest: draft.contentDigest,
      expectedCanonicalVersion: draft.expectedCanonicalVersion,
      snapshotDigest: draft.snapshotDigest,
      reason: 'Evidence and diff reviewed.',
      approvalToken: {
        actorId: 'owner-a',
        contentDigest: draft.contentDigest,
        expectedCanonicalVersion: draft.expectedCanonicalVersion,
      },
    });
    expect(manifest.approvalToken.tokenDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('marks the Draft Change Set stale when the Canonical Snapshot changes', async () => {
    const { kernel, command, changes, snapshot } = await createDraft(createTransport);
    const draft = changes[0]!;
    snapshot.replaceClaims('project-a', [
      { claimId: 'changed', text: 'Milo weighs 6 kg.', revisionNumber: 1, evidenceIds: [] },
    ]);

    await expect(
      kernel.connector.sendCommand(
        decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Approve old view.'),
      ),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    const current = (
      await kernel.connector.query<{ changeSet: DraftChangeSet }>(
        reviewQuery(command, draft.changeSetId),
      )
    ).result.payload.changeSet;
    expect(current.status).toBe('STALE');
  });

  it('records hold and reject reasons with the user actor', async () => {
    const { kernel, command, changes } = await createDraft(createTransport);
    const draft = changes[0]!;
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'HOLD', randomUUID(), 'Need another source.'),
    );
    const held = (
      await kernel.connector.query<{ changeSet: DraftChangeSet }>(
        reviewQuery(command, draft.changeSetId),
      )
    ).result.payload.changeSet;
    await kernel.connector.sendCommand(
      decisionCommand(command, held, 'REJECT', randomUUID(), 'Source did not arrive.'),
    );
    const rejected = (
      await kernel.connector.query<{ changeSet: DraftChangeSet }>(
        reviewQuery(command, draft.changeSetId),
      )
    ).result.payload.changeSet;

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decisions).toMatchObject([
      { decision: 'HOLD', reason: 'Need another source.', actor: { type: 'user', id: 'owner-a' } },
      {
        decision: 'REJECT',
        reason: 'Source did not arrive.',
        actor: { type: 'user', id: 'owner-a' },
      },
    ]);
  });

  it('rejects stale digests and non-user approval actors', async () => {
    const { kernel, command, changes } = await createDraft(createTransport);
    const draft = changes[0]!;
    const stale = decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Wrong digest.');
    const stalePayload = {
      ...stale,
      payload: {
        ...stale.payload,
        expectedContentDigest: `sha256:${'0'.repeat(64)}`,
      },
    };
    await expect(kernel.connector.sendCommand(stalePayload)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    await expect(
      kernel.connector.sendCommand(
        decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Service attempted approval.', {
          type: 'service',
          id: 'automation',
        }),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('deduplicates an identical review command without duplicating history', async () => {
    const { kernel, command, changes, reviewRepository } = await createDraft(createTransport);
    const reviewCommand = decisionCommand(command, changes[0]!, 'HOLD', randomUUID(), 'Wait once.');
    const first = await kernel.connector.sendCommand(reviewCommand);
    const second = await kernel.connector.sendCommand(reviewCommand);

    expect(first.status).toBe('processed');
    expect(second.status).toBe('duplicate');
    expect(reviewRepository.counts().decisions).toBe(1);
  });

  it('denies review reads without the owner scope', async () => {
    const { kernel, command, changes } = await createDraft(createTransport);
    const query = reviewQuery(command, changes[0]!.changeSetId);
    const viewer = {
      ...query,
      security: { ...query.security!, accessScope: ['viewer'] },
    };
    await expect(kernel.connector.query(viewer)).rejects.toBeInstanceOf(ShotgunError);
    await expect(kernel.connector.query(viewer)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});
