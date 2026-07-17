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
  InMemoryChangeSetReviewRepository,
  InMemoryComparisonRepository,
} from '../../adapters/stage5-in-memory/src/index.js';
import { InMemoryCanonicalKnowledgeRepository } from '../../adapters/stage6-in-memory/src/index.js';
import { JsDiffAdapter } from '../../adapters/text-diff-jsdiff/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';
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
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  createChildQuery,
  ShotgunKernel,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalOutboxRecord,
  type CanonicalSnapshot,
  type DraftChangeSet,
  type MessageTransport,
  type ShotgunModule,
} from '../../packages/kernel/src/index.js';
import {
  changesQuery,
  decisionCommand,
  directTextCommand,
  intakeResultQuery,
  manifestQuery,
} from './stage-5.js';

export { changesQuery, decisionCommand, directTextCommand, intakeResultQuery, manifestQuery };

export class MutableClock {
  constructor(private current: string = new Date().toISOString()) {}

  now(): string {
    return this.current;
  }

  set(value: string): void {
    this.current = value;
  }
}

type HarnessOptions = {
  readonly transport?: MessageTransport;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly canonicalRepository?: InMemoryCanonicalKnowledgeRepository;
  readonly reviewRepository?: InMemoryChangeSetReviewRepository;
  readonly clock?: MutableClock;
  readonly additionalModules?: readonly ShotgunModule[];
};

export const createStage6Harness = async (options: HarnessOptions = {}) => {
  const intakeRepository = new InMemoryIntakeRepository();
  const originalAssetRepository = new InMemoryOriginalAssetRepository();
  const storage = new InMemoryAssetStorage();
  const transformationRepository = new InMemoryTransformationRepository();
  const evidenceRepository = new InMemoryEvidenceRepository();
  const aiProviderRepository = new InMemoryAIProviderCallRepository();
  const candidateRepository = new InMemoryCandidateRepository();
  const validationRepository = new InMemoryValidationRepository();
  const comparisonRepository = new InMemoryComparisonRepository();
  const reviewRepository = options.reviewRepository ?? new InMemoryChangeSetReviewRepository();
  const canonicalRepository =
    options.canonicalRepository ?? new InMemoryCanonicalKnowledgeRepository();
  const clock = options.clock ?? new MutableClock();
  const adapter = new LucasAugmentedPlainTextAdapter();
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(originalAssetRepository, storage),
    createTransformationModule(transformationRepository, adapter),
    createEvidenceModule(evidenceRepository, adapter),
    createAIProviderModule(
      aiProviderRepository,
      options.aiProvider ?? new FakeAIProviderAdapter(),
      {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 2,
      },
    ),
    createCandidateGenerationModule(candidateRepository),
    createValidationModule(validationRepository),
    createComparisonModule(comparisonRepository, canonicalRepository, new JsDiffAdapter()),
    createChangeSetReviewModule(reviewRepository),
    createCanonicalKnowledgeModule(canonicalRepository, clock),
    ...(options.additionalModules ?? []),
  );
  await kernel.start();
  return {
    kernel,
    clock,
    canonicalRepository,
    reviewRepository,
  };
};

type IntakeCommand = ReturnType<typeof directTextCommand>;

export const createDraft = async (
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
  return { command, intake, draft };
};

export const snapshotQuery = (command: IntakeCommand) =>
  createChildQuery(command, {
    messageType: 'GetCanonicalSnapshot',
    schemaVersion: '1.0.0',
    producerModule: 'stage6-test',
    producerVersion: '1.0.0',
    payload: {},
  });

export const commitQuery = (command: IntakeCommand, commitId: string) =>
  createChildQuery(command, {
    messageType: 'GetCanonicalCommit',
    schemaVersion: '1.0.0',
    producerModule: 'stage6-test',
    producerVersion: '1.0.0',
    payload: { commitId },
  });

export const historyQuery = (command: IntakeCommand) =>
  createChildQuery(command, {
    messageType: 'ListCanonicalHistory',
    schemaVersion: '1.0.0',
    producerModule: 'stage6-test',
    producerVersion: '1.0.0',
    payload: {},
  });

export const outboxQuery = (command: IntakeCommand, outboxId: string) =>
  createChildQuery(command, {
    messageType: 'GetCanonicalOutbox',
    schemaVersion: '1.0.0',
    producerModule: 'stage6-test',
    producerVersion: '1.0.0',
    payload: { outboxId },
  });

export type Stage6Queries = {
  readonly snapshot: CanonicalSnapshot;
  readonly commit: CanonicalCommitResult;
  readonly history: { readonly items: readonly CanonicalHistoryEvent[] };
  readonly outbox: CanonicalOutboxRecord;
};
