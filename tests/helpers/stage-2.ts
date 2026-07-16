import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../adapters/stage2-in-memory/src/index.js';
import {
  createChildQuery,
  createCommand,
  ShotgunKernel,
  type AssetReference,
  type MessageTransport,
} from '../../packages/kernel/src/index.js';
import {
  createIntakeModule,
  type IntakeRepositoryPort,
  type SubmitIntakePayload,
} from '../../modules/intake/src/index.js';
import {
  type AssetStoragePort,
  createOriginalAssetModule,
  type OriginalAssetRepositoryPort,
} from '../../modules/original-asset/src/index.js';

type HarnessOptions = {
  readonly transport?: MessageTransport;
  readonly intakeRepository?: IntakeRepositoryPort;
  readonly originalAssetRepository?: OriginalAssetRepositoryPort;
  readonly storage?: AssetStoragePort;
};

export const createStage2Harness = async (options: HarnessOptions = {}) => {
  const intakeRepository = options.intakeRepository ?? new InMemoryIntakeRepository();
  const originalAssetRepository =
    options.originalAssetRepository ?? new InMemoryOriginalAssetRepository();
  const storage = options.storage ?? new InMemoryAssetStorage();
  const kernel = new ShotgunKernel(options.transport ?? new InMemoryTransport());
  kernel.register(
    createIntakeModule(intakeRepository),
    createOriginalAssetModule(originalAssetRepository, storage),
  );
  await kernel.start();
  return {
    kernel,
    intakeRepository,
    originalAssetRepository,
    storage,
  };
};

type CommandOptions = {
  readonly sourceId?: string;
  readonly projectId?: string;
  readonly actorId?: string;
  readonly accessScope?: readonly string[];
};

export const intakeCommand = (
  submissionId: string,
  input: SubmitIntakePayload['input'],
  options: CommandOptions = {},
) =>
  createCommand({
    messageType: 'SubmitIntake',
    schemaVersion: '1.0.0',
    producerModule: 'stage2-test',
    producerVersion: '1.0.0',
    idempotencyKey: `intake:${options.projectId ?? 'project-a'}:${submissionId}`,
    projectId: options.projectId ?? 'project-a',
    actor: {
      type: 'user',
      id: options.actorId ?? 'owner-a',
    },
    security: {
      accessScope: options.accessScope ?? ['owner'],
      sensitivity: 'private',
      dataClassification: 'personal',
    },
    payload: {
      submissionId,
      sourceId: options.sourceId,
      input,
    },
  });

export const directTextCommand = (
  submissionId: string,
  text: string,
  options: CommandOptions = {},
) =>
  intakeCommand(
    submissionId,
    {
      kind: 'direct_text',
      text,
    },
    options,
  );

export const fileCommand = (
  submissionId: string,
  fileName: string,
  mediaType: 'text/plain' | 'text/markdown',
  bytes: Uint8Array,
  options: CommandOptions = {},
) =>
  intakeCommand(
    submissionId,
    {
      kind: 'text_file',
      fileName,
      mediaType,
      contentBase64: Buffer.from(bytes).toString('base64'),
    },
    options,
  );

export const intakeResultQuery = (
  command: ReturnType<typeof intakeCommand>,
  accessScope: readonly string[] = command.security?.accessScope ?? [],
) => ({
  ...createChildQuery(command, {
    messageType: 'GetIntakeResult',
    schemaVersion: '1.0.0',
    producerModule: 'stage2-test',
    producerVersion: '1.0.0',
    payload: {
      submissionId: command.payload.submissionId,
    },
  }),
  security: {
    ...command.security!,
    accessScope,
  },
});

export const resolveAssetQuery = (
  command: ReturnType<typeof intakeCommand>,
  assetReference: AssetReference,
  overrides: {
    readonly projectId?: string;
    readonly accessScope?: readonly string[];
  } = {},
) => ({
  ...createChildQuery(command, {
    messageType: 'ResolveAsset',
    schemaVersion: '1.0.0',
    producerModule: 'stage2-test',
    producerVersion: '1.0.0',
    payload: { assetReference },
  }),
  projectId: overrides.projectId ?? command.projectId,
  security: {
    ...command.security!,
    accessScope: overrides.accessScope ?? command.security!.accessScope,
  },
});
