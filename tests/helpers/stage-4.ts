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
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import type {
  AIProviderAdapterPort,
  AIProviderPolicy,
} from '../../modules/ai-provider/src/index.js';
import { createAIProviderModule } from '../../modules/ai-provider/src/index.js';
import { createCandidateGenerationModule } from '../../modules/candidate-generation/src/index.js';
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
  type MessageTransport,
} from '../../packages/kernel/src/index.js';
import { directTextCommand, intakeResultQuery } from './stage-3.js';

export { directTextCommand, intakeResultQuery };

type HarnessOptions = {
  readonly transport?: MessageTransport;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly aiProviderPolicy?: AIProviderPolicy;
  readonly aiProviderRepository?: InMemoryAIProviderCallRepository;
  readonly candidateRepository?: InMemoryCandidateRepository;
  readonly validationRepository?: InMemoryValidationRepository;
};

export const createStage4Harness = async (options: HarnessOptions = {}) => {
  const intakeRepository = new InMemoryIntakeRepository();
  const originalAssetRepository = new InMemoryOriginalAssetRepository();
  const storage = new InMemoryAssetStorage();
  const transformationRepository = new InMemoryTransformationRepository();
  const evidenceRepository = new InMemoryEvidenceRepository();
  const aiProviderRepository =
    options.aiProviderRepository ?? new InMemoryAIProviderCallRepository();
  const candidateRepository = options.candidateRepository ?? new InMemoryCandidateRepository();
  const validationRepository = options.validationRepository ?? new InMemoryValidationRepository();
  const adapter = new LucasAugmentedPlainTextAdapter();
  const aiProvider = options.aiProvider ?? new FakeAIProviderAdapter();
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(originalAssetRepository, storage),
    createTransformationModule(transformationRepository, adapter),
    createEvidenceModule(evidenceRepository, adapter),
    createAIProviderModule(
      aiProviderRepository,
      aiProvider,
      options.aiProviderPolicy ?? {
        allowPrivate: true,
        allowRestricted: false,
        maxAttempts: 2,
      },
    ),
    createCandidateGenerationModule(candidateRepository),
    createValidationModule(validationRepository),
  );
  await kernel.start();
  return {
    kernel,
    aiProvider,
    aiProviderRepository,
    candidateRepository,
    validationRepository,
  };
};

type IntakeCommand = ReturnType<typeof directTextCommand>;

export const candidatesQuery = (command: IntakeCommand, sourceVersionId: string) =>
  createChildQuery(command, {
    messageType: 'ListClaimCandidates',
    schemaVersion: '1.0.0',
    producerModule: 'stage4-test',
    producerVersion: '1.0.0',
    payload: { sourceVersionId },
  });

export const validationQuery = (command: IntakeCommand, candidateId: string) =>
  createChildQuery(command, {
    messageType: 'GetValidationResult',
    schemaVersion: '1.0.0',
    producerModule: 'stage4-test',
    producerVersion: '1.0.0',
    payload: { candidateId },
  });
