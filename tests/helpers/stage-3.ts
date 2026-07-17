import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../adapters/stage3-in-memory/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
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
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import type { PlainTextTransformerPort } from '../../modules/transformation/src/index.js';
import { directTextCommand, intakeResultQuery, type intakeCommand } from './stage-2.js';

export { directTextCommand, intakeResultQuery };

type HarnessOptions = {
  readonly transport?: MessageTransport;
  readonly intakeRepository?: InMemoryIntakeRepository;
  readonly originalAssetRepository?: InMemoryOriginalAssetRepository;
  readonly storage?: InMemoryAssetStorage;
  readonly transformationRepository?: InMemoryTransformationRepository;
  readonly evidenceRepository?: InMemoryEvidenceRepository;
  readonly transformer?: PlainTextTransformerPort;
};

export const createStage3Harness = async (options: HarnessOptions = {}) => {
  const intakeRepository = options.intakeRepository ?? new InMemoryIntakeRepository();
  const originalAssetRepository =
    options.originalAssetRepository ?? new InMemoryOriginalAssetRepository();
  const storage = options.storage ?? new InMemoryAssetStorage();
  const transformationRepository =
    options.transformationRepository ?? new InMemoryTransformationRepository();
  const evidenceRepository = options.evidenceRepository ?? new InMemoryEvidenceRepository();
  const adapter = new LucasAugmentedPlainTextAdapter();
  const transformer = options.transformer ?? adapter;
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(originalAssetRepository, storage),
    createTransformationModule(transformationRepository, transformer),
    createEvidenceModule(evidenceRepository, adapter),
  );
  await kernel.start();
  return {
    kernel,
    intakeRepository,
    originalAssetRepository,
    storage,
    transformationRepository,
    evidenceRepository,
    adapter,
    transformer,
  };
};

type IntakeCommand = ReturnType<typeof intakeCommand>;

export const documentRevisionQuery = (command: IntakeCommand, sourceVersionId: string) =>
  createChildQuery(command, {
    messageType: 'GetDocumentRevision',
    schemaVersion: '1.0.0',
    producerModule: 'stage3-test',
    producerVersion: '1.0.0',
    payload: { sourceVersionId },
  });

export const evidenceListQuery = (command: IntakeCommand, sourceVersionId: string) =>
  createChildQuery(command, {
    messageType: 'ListEvidenceSpans',
    schemaVersion: '1.0.0',
    producerModule: 'stage3-test',
    producerVersion: '1.0.0',
    payload: { sourceVersionId },
  });

export const evidenceQuery = (command: IntakeCommand, evidenceId: string) =>
  createChildQuery(command, {
    messageType: 'GetEvidenceSpan',
    schemaVersion: '1.0.0',
    producerModule: 'stage3-test',
    producerVersion: '1.0.0',
    payload: { evidenceId },
  });
