import { describe, expect, it } from 'vitest';

import type {
  CompiledTruthProjection,
  CompiledTruthProjectionStatus,
  DiscoveryRunResult,
  KnowledgeCandidate,
  KnowledgeReviewGroup,
} from '../../packages/contracts/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { directTextCommand, evidenceListQuery, intakeResultQuery } from '../helpers/stage-3.js';
import {
  entityCandidate,
  modelOutput,
  reviewGroupCommand,
  stageGroupCommand,
} from '../helpers/stage-9.js';
import {
  buildCompiledTruthCommand,
  compiledTruthQuery,
  compiledTruthStatusQuery,
  runDiscoveryCommand,
} from '../helpers/stage-10.js';

const stageEvidence = async (app: Awaited<ReturnType<typeof createApplication>>, name: string) => {
  const parent = directTextCommand(name, 'Alpha is related to Beta. Isolated needs context.');
  await app.kernel.connector.sendCommand(parent);
  const sourceVersionId = (
    await app.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(parent))
  ).result.payload.sourceVersionId;
  const evidenceId = (
    await app.kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
      evidenceListQuery(parent, sourceVersionId),
    )
  ).result.payload.items[0]!.evidenceId;
  return { parent, sourceVersionId, evidenceId };
};

const approve = async (
  app: Awaited<ReturnType<typeof createApplication>>,
  parent: ReturnType<typeof directTextCommand>,
  sourceVersionId: string,
  items: readonly KnowledgeCandidate[],
) => {
  const staged = (
    await app.kernel.connector.sendCommand<KnowledgeReviewGroup>(
      stageGroupCommand(parent, `group:${sourceVersionId}`, sourceVersionId, items),
    )
  ).result;
  await app.kernel.connector.sendCommand(reviewGroupCommand(parent, staged, 'APPROVE'));
};

describe('Stage 10 Compiled Truth and Discovery contracts', () => {
  it('produces identical logical output for full and incremental builds with temporal states', async () => {
    const app = await createApplication();
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(app, 'stage10-equivalence');
    const items: KnowledgeCandidate[] = [
      entityCandidate('entity:alpha', sourceVersionId, evidenceId, 'Alpha'),
      entityCandidate('entity:beta', sourceVersionId, evidenceId, 'Beta'),
      {
        candidateId: 'relation:alpha-beta',
        candidateType: 'RELATION',
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'related')],
        fromCandidateId: 'entity:alpha',
        toCandidateId: 'entity:beta',
        relationType: 'RELATED_TO',
        direction: 'DIRECTED',
      },
      {
        candidateId: 'event:past',
        candidateType: 'EVENT',
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'past event')],
        title: 'Past event',
        participantCandidateIds: ['entity:alpha'],
        occurredAt: '2020-01-01T00:00:00.000Z',
        temporalEvidenceIds: [evidenceId],
      },
      {
        candidateId: 'action:future',
        candidateType: 'ACTION',
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'future action')],
        actionText: 'Future action',
        actorCandidateId: 'entity:alpha',
        dueAt: '2099-01-01T00:00:00.000Z',
        temporalEvidenceIds: [evidenceId],
        executionStatus: 'CANDIDATE_ONLY',
      },
      {
        candidateId: 'conflict:alpha',
        candidateType: 'CONFLICT',
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'conflict')],
        subjectCandidateIds: ['entity:alpha', 'entity:beta'],
        summary: 'Alpha conflict',
        conflictKind: 'FACTUAL',
      },
    ];
    await approve(app, parent, sourceVersionId, items);

    const full = (
      await app.kernel.connector.sendCommand<CompiledTruthProjection>(
        buildCompiledTruthCommand(parent, 'FULL_REBUILD'),
      )
    ).result;
    const incremental = (
      await app.kernel.connector.sendCommand<CompiledTruthProjection>(
        buildCompiledTruthCommand(parent, 'INCREMENTAL', 'incremental'),
      )
    ).result;
    expect(incremental.logicalDigest).toBe(full.logicalDigest);
    expect(incremental.sourceSnapshotDigest).toBe(full.sourceSnapshotDigest);
    expect(incremental.items.map(({ id, state }) => ({ id, state }))).toEqual(
      full.items.map(({ id, state }) => ({ id, state })),
    );
    expect(Object.fromEntries(full.items.map((item) => [item.id, item.state]))).toMatchObject({
      'entity:alpha': 'CURRENT',
      'event:past': 'PAST',
      'action:future': 'FUTURE',
      'conflict:alpha': 'CONFLICT',
    });
    expect(full.graph.edges).toEqual([
      expect.objectContaining({ id: 'relation:alpha-beta', source: 'APPROVED_TYPED_EDGE' }),
    ]);
    expect(full.graph.fallback).toEqual({ available: true, modes: ['LIST', 'TABLE'] });

    const queried = (
      await app.kernel.connector.query<CompiledTruthProjection>(compiledTruthQuery(parent))
    ).result.payload;
    expect(queried.logicalDigest).toBe(full.logicalDigest);
    const status = (
      await app.kernel.connector.query<CompiledTruthProjectionStatus>(
        compiledTruthStatusQuery(parent),
      )
    ).result.payload;
    expect(status).toMatchObject({ status: 'READY', lag: 0, lastBuildMode: 'INCREMENTAL' });
    await app.server.close();
  });

  it('re-enters deterministic gaps as DERIVED_INFERENCE and suppresses repeats within budgets', async () => {
    const app = await createApplication();
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(app, 'stage10-discovery');
    await approve(app, parent, sourceVersionId, [
      entityCandidate('entity:isolated', sourceVersionId, evidenceId, 'Isolated'),
      entityCandidate('entity:second', sourceVersionId, evidenceId, 'Second'),
    ]);
    const projection = (
      await app.kernel.connector.sendCommand<CompiledTruthProjection>(
        buildCompiledTruthCommand(parent, 'FULL_REBUILD'),
      )
    ).result;
    const first = (
      await app.kernel.connector.sendCommand<DiscoveryRunResult>(
        runDiscoveryCommand(parent, 'INCREMENTAL', 'first', 1, 1),
      )
    ).result;
    expect(first).toMatchObject({ scannedNodes: 1, budget: { maxNodes: 1, maxSuggestions: 1 } });
    expect(first.generated).toHaveLength(1);
    expect(first.generated[0]).toMatchObject({
      status: 'DERIVED_INFERENCE',
      candidateType: 'KNOWLEDGE_GAP',
      reentryPhase: 'VALIDATION',
      sourceProjectionDigest: projection.logicalDigest,
    });
    expect(projection.graph.edges).toEqual([]);

    const repeat = (
      await app.kernel.connector.sendCommand<DiscoveryRunResult>(
        runDiscoveryCommand(parent, 'WEEKLY', 'repeat', 1, 1),
      )
    ).result;
    expect(repeat.generated).toEqual([]);
    expect(repeat.suppressedFingerprints).toEqual([first.generated[0]!.fingerprint]);
    await app.server.close();
  });

  it('reports NOT_BUILT before the first projection', async () => {
    const app = await createApplication();
    const parent = directTextCommand('stage10-status', 'Status fixture.');
    const status = (
      await app.kernel.connector.query<CompiledTruthProjectionStatus>(
        compiledTruthStatusQuery(parent),
      )
    ).result.payload;
    expect(status).toMatchObject({ status: 'NOT_BUILT', lag: 0, projectedCanonicalVersion: 0 });
    await app.server.close();
  });
});
