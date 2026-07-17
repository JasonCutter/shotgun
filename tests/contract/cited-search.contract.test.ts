import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemorySearchProjectionRepository } from '../../adapters/stage7-in-memory/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  type CanonicalSearchResponse,
  type CitedAnswer,
  createChildEvent,
  type ProjectionReadiness,
} from '../../packages/contracts/src/index.js';
import { decisionCommand } from '../helpers/stage-5.js';
import { createDraft, snapshotQuery } from '../helpers/stage-6.js';
import { askQuery, createStage7Harness, readinessQuery, searchQuery } from '../helpers/stage-7.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

describe.each(transports)('%s Stage 7 cited search contract', (_name, createTransport) => {
  it('searches only approved Canonical Claims and round-trips every answer citation', async () => {
    const { kernel, projectionRepository } = await createStage7Harness({
      transport: createTransport(),
    });
    const { command, draft } = await createDraft(
      kernel,
      `stage7-approved-${randomUUID()}`,
      'Milo weighs 5 kg.',
    );

    const before = (
      await kernel.connector.query<CanonicalSearchResponse>(searchQuery(command, 'Milo'))
    ).result.payload;
    expect(before).toMatchObject({ items: [], readiness: { status: 'READY' } });
    await expect(kernel.connector.query(searchQuery(command, '   '))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Evidence checked.'),
    );
    const search = (
      await kernel.connector.query<CanonicalSearchResponse>(searchQuery(command, 'Milo'))
    ).result.payload;
    expect(search.readiness).toMatchObject({
      status: 'READY',
      projectedCanonicalVersion: 1,
      canonicalVersion: 1,
      lag: 0,
    });
    expect(search.items).toMatchObject([
      {
        claimText: 'Milo weighs 5 kg.',
        canonicalVersion: 1,
        matchType: 'SUBSTRING',
      },
    ]);
    expect(search.items[0]?.revisionId).toMatch(/^revision:/);
    expect(search.items[0]?.evidenceIds.length).toBeGreaterThan(0);

    const answer = (await kernel.connector.query<CitedAnswer>(askQuery(command, 'Milo weighs')))
      .result.payload;
    expect(answer.status).toBe('ANSWERED');
    expect(answer.statements).toHaveLength(1);
    expect(answer.statements[0]?.text).toBe('Milo weighs 5 kg.');
    expect(answer.statements[0]?.citations[0]).toMatchObject({
      claimId: search.items[0]?.claimId,
      revisionId: search.items[0]?.revisionId,
      exactQuote: 'Milo weighs 5 kg.',
    });
    expect(projectionRepository.counts()).toEqual({ documents: 1, watermarks: 1 });

    const replay = createChildEvent(command, {
      messageType: 'CanonicalCommitted',
      schemaVersion: '1.0.0',
      producerModule: 'stage7-test',
      producerVersion: '1.0.0',
      idempotencyKey: `projection-replay:${randomUUID()}`,
      payload: {
        commitId: search.items[0]!.commitId,
        manifestId: search.items[0]!.commitId,
        changeSetId: draft.changeSetId,
        operation: 'ADD_CLAIM',
        status: 'COMMITTED',
        canonicalVersion: 1,
        snapshotDigest: search.readiness.canonicalSnapshotDigest,
        claimId: search.items[0]!.claimId,
        actorId: 'owner-a',
        accessScope: ['owner'],
        sensitivity: 'private',
      },
    });
    const replayDelivery = await kernel.connector.publishEvent(replay);
    expect(replayDelivery.consumers).toMatchObject([
      { consumerId: 'stage7.projection-search', status: 'processed' },
    ]);
    expect(projectionRepository.counts()).toEqual({ documents: 1, watermarks: 1 });
  });

  it('returns explicit uncertainty instead of inventing an answer', async () => {
    const { kernel } = await createStage7Harness({ transport: createTransport() });
    const { command, draft } = await createDraft(
      kernel,
      `stage7-no-match-${randomUUID()}`,
      'Milo weighs 5 kg.',
    );
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Evidence checked.'),
    );
    const answer = (await kernel.connector.query<CitedAnswer>(askQuery(command, 'vaccination')))
      .result.payload;
    expect(answer).toMatchObject({ status: 'NO_MATCH', statements: [] });
    expect(answer.uncertainty).toContain('찾지 못했습니다');
  });

  it('keeps Canonical committed when Projection fails and blocks stale answers', async () => {
    const projectionRepository = new InMemorySearchProjectionRepository({
      failpoint: 'after-document',
    });
    const { kernel } = await createStage7Harness({
      transport: createTransport(),
      projectionRepository,
    });
    const { command, draft } = await createDraft(
      kernel,
      `stage7-failure-${randomUUID()}`,
      'Milo weighs 5 kg.',
    );
    await kernel.connector.sendCommand(
      decisionCommand(command, draft, 'APPROVE', randomUUID(), 'Commit remains authoritative.'),
    );

    const snapshot = (await kernel.connector.query(snapshotQuery(command))).result.payload as {
      version: number;
      claims: readonly unknown[];
    };
    const readiness = (await kernel.connector.query<ProjectionReadiness>(readinessQuery(command)))
      .result.payload;
    const answer = (await kernel.connector.query<CitedAnswer>(askQuery(command, 'Milo'))).result
      .payload;
    expect(snapshot).toMatchObject({ version: 1 });
    expect(snapshot.claims).toHaveLength(1);
    expect(projectionRepository.counts()).toEqual({ documents: 0, watermarks: 1 });
    expect(readiness).toMatchObject({ status: 'DEGRADED', canonicalVersion: 1, lag: 1 });
    expect(answer).toMatchObject({ status: 'STALE_PROJECTION', statements: [] });
    expect(
      kernel.connector.deadLetters
        .list()
        .some((item) => item.consumerId === 'stage7.projection-search'),
    ).toBe(true);
  });
});
