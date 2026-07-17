import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import { InMemoryKnowledgeModelRepository } from '../../adapters/stage9-in-memory/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createKnowledgeModelModule } from '../../modules/knowledge-model/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import {
  createChildQuery,
  createCommand,
  type EntityCandidate,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
  ShotgunKernel,
  type MessageTransport,
} from '../../packages/kernel/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import type { directTextCommand } from './stage-3.js';

type IntakeCommand = ReturnType<typeof directTextCommand>;

export const createStage9Harness = async (
  options: { readonly transport?: MessageTransport } = {},
) => {
  const intakeRepository = new InMemoryIntakeRepository();
  const originalAssetRepository = new InMemoryOriginalAssetRepository();
  const storage = new InMemoryAssetStorage();
  const transformationRepository = new InMemoryTransformationRepository();
  const evidenceRepository = new InMemoryEvidenceRepository();
  const knowledgeRepository = new InMemoryKnowledgeModelRepository();
  const adapter = new LucasAugmentedPlainTextAdapter();
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(originalAssetRepository, storage),
    createTransformationModule(transformationRepository, adapter),
    createEvidenceModule(evidenceRepository, adapter),
    createKnowledgeModelModule(knowledgeRepository, {
      now: () => '2026-07-17T09:00:00.000Z',
    }),
  );
  await kernel.start();
  return { kernel, knowledgeRepository };
};

export const modelOutput = (evidenceId: string, value: string, model = 'model-a') => ({
  provider: 'fixture',
  model,
  value,
  evidenceIds: [evidenceId],
});

export const entityCandidate = (
  candidateId: string,
  sourceVersionId: string,
  evidenceId: string,
  name: string,
  overrides: Partial<EntityCandidate> = {},
): EntityCandidate => ({
  candidateId,
  candidateType: 'ENTITY',
  revisionNumber: 1,
  sourceVersionId,
  evidenceIds: [evidenceId],
  modelOutputs: [modelOutput(evidenceId, name)],
  name,
  entityKind: 'CONCEPT',
  aliases: [],
  resolution: { status: 'NEW' },
  ...overrides,
});

export const stageGroupCommand = (
  parent: IntakeCommand,
  groupId: string,
  sourceVersionId: string,
  items: readonly KnowledgeCandidate[],
) =>
  createCommand({
    messageType: 'StageKnowledgeGroup',
    schemaVersion: '1.0.0',
    producerModule: 'stage9-test',
    producerVersion: '1.0.0',
    correlationId: parent.correlationId,
    traceId: parent.traceId,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    idempotencyKey: `stage9-group:${groupId}`,
    payload: { groupId, sourceVersionId, items },
  });

export const reviewGroupCommand = (
  parent: IntakeCommand,
  group: KnowledgeReviewGroup,
  decision: 'APPROVE' | 'HOLD' | 'REJECT' | 'EDIT',
  itemIds = group.items.map((item) => item.candidateId),
  editKind?: 'WORDING_LAYOUT' | 'FACTUAL_CORRECTION' | 'NEW_KNOWLEDGE' | 'REFERENCE_CHANGE',
) =>
  createCommand({
    messageType: 'ReviewKnowledgeGroup',
    schemaVersion: '1.0.0',
    producerModule: 'stage9-test',
    producerVersion: '1.0.0',
    correlationId: parent.correlationId,
    traceId: parent.traceId,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    idempotencyKey: `stage9-review:${group.groupId}:${decision}:${editKind ?? 'none'}`,
    payload: {
      decisionId: `decision:${group.groupId}:${decision}:${editKind ?? 'none'}`,
      groupId: group.groupId,
      expectedRevisionNumber: group.revisionNumber,
      expectedContentDigest: group.contentDigest,
      decision,
      reason: 'Stage 9 contract verification.',
      itemIds,
      ...(editKind ? { editKind } : {}),
    },
  });

export const groupQuery = (parent: IntakeCommand, groupId: string) =>
  createChildQuery(parent, {
    messageType: 'GetKnowledgeGroup',
    schemaVersion: '1.0.0',
    producerModule: 'stage9-test',
    producerVersion: '1.0.0',
    payload: { groupId },
  });

export const impactQuery = (
  parent: IntakeCommand,
  rootCandidateId: string,
  maxDepth = 5,
  maxNodes = 100,
) =>
  createChildQuery(parent, {
    messageType: 'GetKnowledgeImpact',
    schemaVersion: '1.0.0',
    producerModule: 'stage9-test',
    producerVersion: '1.0.0',
    payload: { rootCandidateId, maxDepth, maxNodes },
  });

export const graphQuery = (parent: IntakeCommand) =>
  createChildQuery(parent, {
    messageType: 'GetKnowledgeGraph',
    schemaVersion: '1.0.0',
    producerModule: 'stage9-test',
    producerVersion: '1.0.0',
    payload: {},
  });
