import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  type EntityVaultImport,
  type KnowledgeCandidate,
  type KnowledgeGraphView,
  type KnowledgeImpactResult,
  type KnowledgeReviewGroup,
} from '../../packages/contracts/src/index.js';
import { createChildQuery, createCommand } from '../../packages/kernel/src/index.js';
import { evidenceListQuery, directTextCommand, intakeResultQuery } from '../helpers/stage-3.js';
import {
  createStage9Harness,
  entityCandidate,
  graphQuery,
  groupQuery,
  impactQuery,
  modelOutput,
  reviewGroupCommand,
  stageGroupCommand,
} from '../helpers/stage-9.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

const stageEvidence = async (kernel: Awaited<ReturnType<typeof createStage9Harness>>['kernel']) => {
  const parent = directTextCommand(
    `stage9-${crypto.randomUUID()}`,
    'Alpha affects Beta. Beta affects Gamma. The review remains evidence bound.',
  );
  await kernel.connector.sendCommand(parent);
  const sourceVersionId = (
    await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(parent))
  ).result.payload.sourceVersionId;
  const evidence = (
    await kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
      evidenceListQuery(parent, sourceVersionId),
    )
  ).result.payload.items;
  return { parent, sourceVersionId, evidenceId: evidence[0]!.evidenceId };
};

const richCandidates = (
  sourceVersionId: string,
  evidenceId: string,
): readonly KnowledgeCandidate[] => {
  const base = [
    entityCandidate('entity:alpha', sourceVersionId, evidenceId, 'Alpha', {
      modelOutputs: [
        modelOutput(evidenceId, 'Alpha', 'model-a'),
        modelOutput(evidenceId, 'Alpha concept', 'model-b'),
      ],
    }),
    entityCandidate('entity:beta', sourceVersionId, evidenceId, 'Beta'),
    entityCandidate('entity:gamma', sourceVersionId, evidenceId, 'Gamma'),
  ] as const;
  return [
    ...base,
    {
      candidateId: 'relation:alpha-beta',
      candidateType: 'RELATION',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'affects')],
      fromCandidateId: 'entity:alpha',
      toCandidateId: 'entity:beta',
      relationType: 'AFFECTS',
      direction: 'DIRECTED',
    },
    {
      candidateId: 'relation:beta-gamma',
      candidateType: 'RELATION',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'affects')],
      fromCandidateId: 'entity:beta',
      toCandidateId: 'entity:gamma',
      relationType: 'AFFECTS',
      direction: 'DIRECTED',
    },
    {
      candidateId: 'relation:gamma-alpha',
      candidateType: 'RELATION',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'feeds back')],
      fromCandidateId: 'entity:gamma',
      toCandidateId: 'entity:alpha',
      relationType: 'FEEDS_BACK',
      direction: 'DIRECTED',
    },
    {
      candidateId: 'event:review',
      candidateType: 'EVENT',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'Review occurred')],
      title: 'Review',
      participantCandidateIds: ['entity:alpha'],
      occurredAt: '2026-07-17T09:00:00.000Z',
      temporalEvidenceIds: [evidenceId],
    },
    {
      candidateId: 'decision:review',
      candidateType: 'DECISION',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'Proceed')],
      decisionText: 'Proceed with review.',
      actorCandidateId: 'entity:alpha',
    },
    {
      candidateId: 'action:review',
      candidateType: 'ACTION',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'Review Beta')],
      actionText: 'Review Beta.',
      actorCandidateId: 'entity:alpha',
      executionStatus: 'CANDIDATE_ONLY',
    },
    {
      candidateId: 'conflict:models',
      candidateType: 'CONFLICT',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'Models disagree')],
      subjectCandidateIds: ['entity:alpha', 'entity:beta'],
      summary: 'Models disagree about Alpha.',
      conflictKind: 'MODEL_DISAGREEMENT',
    },
    {
      candidateId: 'gap:alpha',
      candidateType: 'KNOWLEDGE_GAP',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [evidenceId],
      modelOutputs: [modelOutput(evidenceId, 'Why?')],
      question: 'Why does Alpha affect Beta?',
      relatedCandidateIds: ['entity:alpha', 'entity:beta'],
    },
  ];
};

describe.each(transports)('%s Stage 9 knowledge model contract', (_name, createTransport) => {
  it('preserves all seven typed candidates, Evidence and model disagreement', async () => {
    const { kernel } = await createStage9Harness({ transport: createTransport() });
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(kernel);
    const items = richCandidates(sourceVersionId, evidenceId);
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(parent, 'group:rich', sourceVersionId, items),
      )
    ).result;
    expect(new Set(group.items.map((item) => item.candidateType))).toEqual(
      new Set(['ENTITY', 'RELATION', 'EVENT', 'DECISION', 'ACTION', 'CONFLICT', 'KNOWLEDGE_GAP']),
    );

    const view = (
      await kernel.connector.query<{
        group: KnowledgeReviewGroup;
        modelDisagreements: readonly {
          candidateId: string;
          present: boolean;
          outputs: unknown[];
        }[];
      }>(groupQuery(parent, group.groupId))
    ).result.payload;
    expect(
      view.modelDisagreements.find((item) => item.candidateId === 'entity:alpha'),
    ).toMatchObject({
      present: true,
    });
    expect(
      view.modelDisagreements.find((item) => item.candidateId === 'entity:alpha')?.outputs,
    ).toHaveLength(2);
    expect(view.group.items.every((item) => item.evidenceIds.includes(evidenceId))).toBe(true);
  });

  it('rejects temporal guessing, dangling references and partial Atomic Group approval', async () => {
    const { kernel } = await createStage9Harness({ transport: createTransport() });
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(kernel);
    const withoutTemporalEvidence = richCandidates(sourceVersionId, evidenceId).map((item) =>
      item.candidateId === 'event:review' ? { ...item, temporalEvidenceIds: undefined } : item,
    );
    await expect(
      kernel.connector.sendCommand(
        stageGroupCommand(parent, 'group:bad-time', sourceVersionId, withoutTemporalEvidence),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const dangling = [
      entityCandidate('entity:one', sourceVersionId, evidenceId, 'One'),
      {
        candidateId: 'relation:dangling',
        candidateType: 'RELATION' as const,
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'link')],
        fromCandidateId: 'entity:one',
        toCandidateId: 'entity:missing',
        relationType: 'LINKS',
        direction: 'DIRECTED' as const,
      },
    ];
    await expect(
      kernel.connector.sendCommand(
        stageGroupCommand(parent, 'group:dangling', sourceVersionId, dangling),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(
          parent,
          'group:atomic',
          sourceVersionId,
          richCandidates(sourceVersionId, evidenceId),
        ),
      )
    ).result;
    await expect(
      kernel.connector.sendCommand(
        reviewGroupCommand(parent, group, 'APPROVE', [group.items[0]!.candidateId]),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const serviceReview = reviewGroupCommand(parent, group, 'APPROVE');
    await expect(
      kernel.connector.sendCommand({
        ...serviceReview,
        messageId: crypto.randomUUID(),
        idempotencyKey: `service-review:${crypto.randomUUID()}`,
        actor: { type: 'service', id: 'automation' },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('traverses approved Typed Edges deterministically and matches NetworkX', async () => {
    const { kernel } = await createStage9Harness({ transport: createTransport() });
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(kernel);
    const items = richCandidates(sourceVersionId, evidenceId);
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(parent, 'group:impact', sourceVersionId, items),
      )
    ).result;
    await kernel.connector.sendCommand(reviewGroupCommand(parent, group, 'APPROVE'));
    const impact = (
      await kernel.connector.query<KnowledgeImpactResult>(impactQuery(parent, 'entity:alpha'))
    ).result.payload;
    expect(impact).toMatchObject({
      visitedNodeIds: ['entity:alpha', 'entity:beta', 'entity:gamma'],
      traversedEdgeIds: ['relation:alpha-beta', 'relation:beta-gamma'],
      cycleSafe: true,
      source: 'APPROVED_TYPED_EDGES',
    });

    const edges = items
      .filter((item) => item.candidateType === 'RELATION')
      .map((item) => ({
        id: item.candidateId,
        from: item.fromCandidateId,
        to: item.toCandidateId,
        direction: item.direction,
      }));
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const oracle = spawnSync(python, [path.resolve('adapters/networkx-impact-oracle/oracle.py')], {
      input: JSON.stringify({
        root: 'entity:alpha',
        max_depth: 5,
        max_nodes: 100,
        edges,
      }),
      encoding: 'utf8',
    });
    expect(oracle.status, oracle.stderr).toBe(0);
    expect(JSON.parse(oracle.stdout)).toEqual({
      visitedNodeIds: impact.visitedNodeIds,
      traversedEdgeIds: impact.traversedEdgeIds,
    });
  });

  it('routes User Edit by meaning and exposes a list/table Graph fallback', async () => {
    const { kernel } = await createStage9Harness({ transport: createTransport() });
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(kernel);
    const expected = {
      WORDING_LAYOUT: 'PROJECTION_ONLY',
      FACTUAL_CORRECTION: 'VALIDATION',
      NEW_KNOWLEDGE: 'EVIDENCE',
      REFERENCE_CHANGE: 'COMPARISON_IMPACT',
    } as const;
    for (const [editKind, phase] of Object.entries(expected)) {
      const group = (
        await kernel.connector.sendCommand<KnowledgeReviewGroup>(
          stageGroupCommand(parent, `group:edit:${editKind}`, sourceVersionId, [
            entityCandidate(`entity:${editKind}`, sourceVersionId, evidenceId, editKind),
          ]),
        )
      ).result;
      const edited = (
        await kernel.connector.sendCommand<KnowledgeReviewGroup>(
          reviewGroupCommand(parent, group, 'EDIT', undefined, editKind as keyof typeof expected),
        )
      ).result;
      expect(edited.decisions.at(-1)?.reentryPhase).toBe(phase);
    }

    const approved = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(
          parent,
          'group:graph',
          sourceVersionId,
          richCandidates(sourceVersionId, evidenceId),
        ),
      )
    ).result;
    await kernel.connector.sendCommand(reviewGroupCommand(parent, approved, 'APPROVE'));
    const graph = (await kernel.connector.query<KnowledgeGraphView>(graphQuery(parent))).result
      .payload;
    expect(graph.fallback).toEqual({ available: true, modes: ['LIST', 'TABLE'] });
    expect(graph.tableRows.length).toBe(approved.items.length);
    expect(graph.nodes.some((node) => node.modelDisagreement)).toBe(true);
  });

  it('filters approved Graph data by the caller access scope', async () => {
    const { kernel } = await createStage9Harness({ transport: createTransport() });
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(kernel);
    const wideParent = {
      ...parent,
      security: { ...parent.security!, accessScope: ['owner', 'team-private'] },
    };
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(wideParent, 'group:private', sourceVersionId, [
          entityCandidate('entity:private', sourceVersionId, evidenceId, 'Private Entity'),
        ]),
      )
    ).result;
    await kernel.connector.sendCommand(reviewGroupCommand(wideParent, group, 'APPROVE'));

    const narrower = (await kernel.connector.query<KnowledgeGraphView>(graphQuery(parent))).result
      .payload;
    const wider = (await kernel.connector.query<KnowledgeGraphView>(graphQuery(wideParent))).result
      .payload;
    expect(narrower.tableRows).toEqual([]);
    expect(wider.tableRows.map((row) => row.id)).toEqual(['entity:private']);
  });

  it('keeps POSSIBLY_SAME unresolved and gates Entity Vault imports without Canonical sync', async () => {
    const { kernel } = await createStage9Harness({ transport: createTransport() });
    const { parent, sourceVersionId, evidenceId } = await stageEvidence(kernel);
    const ambiguous = entityCandidate('entity:ambiguous', sourceVersionId, evidenceId, 'Alex', {
      resolution: {
        status: 'POSSIBLY_SAME',
        possibleCanonicalEntityIds: ['canonical:alex-1', 'canonical:alex-2'],
      },
    });
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(parent, 'group:ambiguous', sourceVersionId, [ambiguous]),
      )
    ).result;
    const approved = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        reviewGroupCommand(parent, group, 'APPROVE'),
      )
    ).result;
    expect(approved.items[0]).toMatchObject({
      resolution: {
        status: 'POSSIBLY_SAME',
        possibleCanonicalEntityIds: ['canonical:alex-1', 'canonical:alex-2'],
      },
    });
    expect((approved.items[0] as { resolution: object }).resolution).not.toHaveProperty(
      'canonicalEntityId',
    );

    const stageVault = createCommand({
      messageType: 'StageEntityVaultImport',
      schemaVersion: '1.0.0',
      producerModule: 'stage9-test',
      producerVersion: '1.0.0',
      correlationId: parent.correlationId,
      traceId: parent.traceId,
      projectId: parent.projectId!,
      actor: parent.actor!,
      security: parent.security!,
      idempotencyKey: 'entity-vault:import:1',
      payload: { importId: 'import:1', sourceVersionId, entities: [ambiguous] },
    });
    const staged = (await kernel.connector.sendCommand<EntityVaultImport>(stageVault)).result;
    expect(staged).toMatchObject({ status: 'PENDING_APPROVAL', canonicalWrite: false });
    expect(staged.entities).toEqual([ambiguous]);
    const reviewed = (
      await kernel.connector.sendCommand<EntityVaultImport>(
        createCommand({
          messageType: 'ReviewEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'stage9-test',
          producerVersion: '1.0.0',
          correlationId: parent.correlationId,
          traceId: parent.traceId,
          projectId: parent.projectId!,
          actor: parent.actor!,
          security: parent.security!,
          idempotencyKey: 'entity-vault:review:1',
          payload: {
            importId: staged.importId,
            expectedContentDigest: staged.contentDigest,
            decision: 'APPROVE',
          },
        }),
      )
    ).result;
    expect(reviewed).toMatchObject({
      status: 'APPROVED_FOR_REVIEW',
      canonicalWrite: false,
      nextAction: 'REVIEW_AND_STAGE_KNOWLEDGE_GROUP',
    });
    const resolved = (
      await kernel.connector.query<EntityVaultImport>(
        createChildQuery(parent, {
          messageType: 'GetEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'stage9-test',
          producerVersion: '1.0.0',
          payload: { importId: staged.importId },
        }),
      )
    ).result.payload;
    expect(resolved.entities).toEqual([ambiguous]);
  });
});
