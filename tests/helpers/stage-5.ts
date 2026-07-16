import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../adapters/stage4-in-memory/src/index.js';
import {
  InMemoryCanonicalSnapshotAdapter,
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../adapters/stage5-in-memory/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
import { createChangeSetReviewModule } from '../../modules/change-set-review/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import { createValidationModule } from '../../modules/validation/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  createChildQuery,
  createCommand,
  ShotgunKernel,
  type Actor,
  type CanonicalSnapshotClaim,
  type DraftChangeSet,
  type MessageTransport,
} from '../../packages/kernel/src/index.js';
import { directTextCommand, intakeResultQuery } from './stage-3.js';

export { directTextCommand, intakeResultQuery };

type HarnessOptions = {
  readonly transport?: MessageTransport;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly snapshot?: InMemoryCanonicalSnapshotAdapter;
  readonly comparisonRepository?: InMemoryComparisonRepository;
  readonly reviewRepository?: InMemoryChangeSetReviewRepository;
};

export const snapshotWith = (
  claims: readonly CanonicalSnapshotClaim[],
): InMemoryCanonicalSnapshotAdapter =>
  new InMemoryCanonicalSnapshotAdapter({ 'project-a': claims }, '2026-07-17T00:00:00.000Z');

export const createStage5Harness = async (options: HarnessOptions = {}) => {
  const intakeRepository = new InMemoryIntakeRepository();
  const originalAssetRepository = new InMemoryOriginalAssetRepository();
  const storage = new InMemoryAssetStorage();
  const transformationRepository = new InMemoryTransformationRepository();
  const evidenceRepository = new InMemoryEvidenceRepository();
  const aiProviderRepository = new InMemoryAIProviderCallRepository();
  const candidateRepository = new InMemoryCandidateRepository();
  const validationRepository = new InMemoryValidationRepository();
  const comparisonRepository = options.comparisonRepository ?? new InMemoryComparisonRepository();
  const reviewRepository = options.reviewRepository ?? new InMemoryChangeSetReviewRepository();
  const snapshot = options.snapshot ?? new InMemoryCanonicalSnapshotAdapter();
  const adapter = new LucasAugmentedPlainTextAdapter();
  const aiProvider = options.aiProvider ?? new FakeAIProviderAdapter();
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(originalAssetRepository, storage),
    createTransformationModule(transformationRepository, adapter),
    createEvidenceModule(evidenceRepository, adapter),
    createAIProviderModule(aiProviderRepository, aiProvider, {
      allowPrivate: true,
      allowRestricted: false,
      maxAttempts: 2,
    }),
    createCandidateGenerationModule(candidateRepository),
    createValidationModule(validationRepository),
    createComparisonModule(comparisonRepository, snapshot, new JsDiffAdapter()),
    createChangeSetReviewModule(reviewRepository),
  );
  await kernel.start();
  return {
    kernel,
    snapshot,
    comparisonRepository,
    reviewRepository,
    candidateRepository,
  };
};

type IntakeCommand = ReturnType<typeof directTextCommand>;

export const changesQuery = (command: IntakeCommand, sourceVersionId: string) =>
  createChildQuery(command, {
    messageType: 'ListDraftChangeSets',
    schemaVersion: '1.0.0',
    producerModule: 'stage5-test',
    producerVersion: '1.0.0',
    payload: { sourceVersionId },
  });

export const reviewQuery = (command: IntakeCommand, changeSetId: string) =>
  createChildQuery(command, {
    messageType: 'GetReviewBundle',
    schemaVersion: '1.0.0',
    producerModule: 'stage5-test',
    producerVersion: '1.0.0',
    payload: { changeSetId },
  });

export const manifestQuery = (command: IntakeCommand, changeSetId: string) =>
  createChildQuery(command, {
    messageType: 'GetApprovedChangeSetManifest',
    schemaVersion: '1.0.0',
    producerModule: 'stage5-test',
    producerVersion: '1.0.0',
    payload: { changeSetId },
  });

export const decisionCommand = (
  parent: IntakeCommand,
  changeSet: DraftChangeSet,
  decision: 'APPROVE' | 'HOLD' | 'REJECT',
  decisionId: string,
  reason: string,
  actor: Actor = parent.actor!,
) =>
  createCommand({
    messageType: 'RecordReviewDecision',
    schemaVersion: '1.0.0',
    producerModule: 'stage5-test',
    producerVersion: '1.0.0',
    correlationId: parent.correlationId,
    traceId: parent.traceId,
    projectId: parent.projectId!,
    actor,
    security: parent.security!,
    idempotencyKey: `stage5-decision:${decisionId}`,
    payload: {
      decisionId,
      changeSetId: changeSet.changeSetId,
      expectedRevisionNumber: 1 as const,
      expectedContentDigest: changeSet.contentDigest,
      decision,
      reason,
    },
  });
