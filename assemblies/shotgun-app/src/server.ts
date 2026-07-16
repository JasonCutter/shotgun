import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../../adapters/stage2-in-memory/src/index.js';
import {
  InMemoryEvidenceRepository,
  InMemoryTransformationRepository,
} from '../../../adapters/stage3-in-memory/src/index.js';
import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import {
  InMemoryAIProviderCallRepository,
  InMemoryCandidateRepository,
  InMemoryValidationRepository,
} from '../../../adapters/stage4-in-memory/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import { InProcessTransport } from '../../../adapters/transport-in-process/src/index.js';
import {
  createChildQuery,
  createCommand,
  createQuery,
  ShotgunError,
  ShotgunKernel,
  type AssetReference,
  type MessageTransport,
  type SecurityContext,
} from '../../../packages/kernel/src/index.js';
import {
  createIntakeModule,
  type IntakeRepositoryPort,
  type SubmitIntakePayload,
} from '../../../modules/intake/src/index.js';
import {
  type AssetStoragePort,
  createOriginalAssetModule,
  type OriginalAssetRepositoryPort,
} from '../../../modules/original-asset/src/index.js';
import {
  createEvidenceModule,
  type EvidenceLocatorPort,
  type EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import {
  createAIProviderModule,
  type AIProviderAdapterPort,
  type AIProviderCallRepositoryPort,
  type AIProviderPolicy,
} from '../../../modules/ai-provider/src/index.js';
import {
  createCandidateGenerationModule,
  type CandidateRepositoryPort,
} from '../../../modules/candidate-generation/src/index.js';
import {
  createValidationModule,
  type ValidationRepositoryPort,
} from '../../../modules/validation/src/index.js';
import {
  createTransformationModule,
  type PlainTextTransformerPort,
  type TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';
import { createPingModule } from '../../../modules/ping/src/index.js';
import { createPongModule } from '../../../modules/pong/src/index.js';

type PingRequest = {
  readonly requestId?: string;
  readonly message?: string;
};

type ResolveAssetRequest = {
  readonly assetReference: AssetReference;
};

type SourceVersionRequest = {
  readonly sourceVersionId: string;
};

type EvidenceRequest = {
  readonly evidenceId: string;
};

type CandidateRequest = {
  readonly candidateId: string;
};

type SecurityHeaders = {
  readonly 'x-project-id'?: string;
  readonly 'x-actor-id'?: string;
  readonly 'x-access-scope'?: string;
  readonly 'x-sensitivity'?: SecurityContext['sensitivity'];
};

type ApplicationOptions = {
  readonly transport?: MessageTransport;
  readonly intakeRepository?: IntakeRepositoryPort;
  readonly originalAssetRepository?: OriginalAssetRepositoryPort;
  readonly assetStorage?: AssetStoragePort;
  readonly transformationRepository?: TransformationRepositoryPort;
  readonly evidenceRepository?: EvidenceRepositoryPort;
  readonly transformer?: PlainTextTransformerPort;
  readonly evidenceLocator?: EvidenceLocatorPort;
  readonly aiProviderRepository?: AIProviderCallRepositoryPort;
  readonly candidateRepository?: CandidateRepositoryPort;
  readonly validationRepository?: ValidationRepositoryPort;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly aiProviderPolicy?: AIProviderPolicy;
  readonly closeResources?: () => Promise<void>;
};

const requestContext = (headers: SecurityHeaders) => {
  const sensitivity = headers['x-sensitivity'] ?? 'private';
  if (!['public', 'internal', 'private', 'restricted'].includes(sensitivity)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'x-sensitivity must be public, internal, private or restricted.',
      module: 'shotgun-app',
      operation: 'parse-security-context',
    });
  }
  return {
    projectId: (headers['x-project-id'] ?? 'shotgun').trim(),
    actor: {
      type: 'user' as const,
      id: (headers['x-actor-id'] ?? 'owner').trim(),
    },
    security: {
      accessScope: (headers['x-access-scope'] ?? 'owner')
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
      sensitivity: sensitivity as SecurityContext['sensitivity'],
      dataClassification: 'personal',
    },
  };
};

const traceView = (kernel: ShotgunKernel, traceId: string) =>
  kernel.connector.traces.findByTraceId(traceId).map((record) => ({
    messageType: record.messageType,
    messageKind: record.messageKind,
    consumerModule: record.consumerModule,
    status: record.status,
    attemptNumber: record.attemptNumber,
  }));

const auditView = (kernel: ShotgunKernel, traceId: string) =>
  kernel.connector.audit.findByTraceId(traceId).map((record) => ({
    category: record.category,
    messageType: record.messageType,
    moduleId: record.moduleId,
    status: record.status,
  }));

export const createApplication = async (options: ApplicationOptions = {}) => {
  const intakeRepository = options.intakeRepository ?? new InMemoryIntakeRepository();
  const originalAssetRepository =
    options.originalAssetRepository ?? new InMemoryOriginalAssetRepository();
  const assetStorage = options.assetStorage ?? new InMemoryAssetStorage();
  const transformationRepository =
    options.transformationRepository ?? new InMemoryTransformationRepository();
  const evidenceRepository = options.evidenceRepository ?? new InMemoryEvidenceRepository();
  const aiProviderRepository =
    options.aiProviderRepository ?? new InMemoryAIProviderCallRepository();
  const candidateRepository = options.candidateRepository ?? new InMemoryCandidateRepository();
  const validationRepository = options.validationRepository ?? new InMemoryValidationRepository();
  const aiProvider = options.aiProvider ?? new FakeAIProviderAdapter();
  const plainTextAdapter = new LucasAugmentedPlainTextAdapter();
  const transformer = options.transformer ?? plainTextAdapter;
  const evidenceLocator = options.evidenceLocator ?? plainTextAdapter;
  const ping = createPingModule();
  const pong = createPongModule();
  const intake = createIntakeModule(intakeRepository);
  const originalAsset = createOriginalAssetModule(originalAssetRepository, assetStorage);
  const transformation = createTransformationModule(transformationRepository, transformer);
  const evidence = createEvidenceModule(evidenceRepository, evidenceLocator);
  const ai = createAIProviderModule(
    aiProviderRepository,
    aiProvider,
    options.aiProviderPolicy ?? {
      allowPrivate: aiProvider.identity.provider === 'fake',
      allowRestricted: false,
      maxAttempts: 2,
    },
  );
  const candidateGeneration = createCandidateGenerationModule(candidateRepository);
  const validation = createValidationModule(validationRepository);
  const kernel = new ShotgunKernel(options.transport ?? new InProcessTransport());
  kernel.register(
    ping.module,
    pong.module,
    intake,
    originalAsset,
    transformation,
    evidence,
    ai,
    candidateGeneration,
    validation,
  );
  await kernel.start();

  const server = Fastify({ logger: false });

  server.setErrorHandler((error, _request, reply) => {
    if (!(error instanceof ShotgunError)) {
      return reply.status(500).send({ code: 'TERMINAL_FAILURE', message: 'Request failed.' });
    }
    const status =
      error.code === 'POLICY_DENIED'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : ['CONFLICT', 'STALE_VERSION'].includes(error.code)
            ? 409
            : error.code === 'VALIDATION_ERROR'
              ? 400
              : 500;
    return reply.status(status).send({
      code: error.code,
      message: error.safeMessage,
      correlationId: error.correlationId,
    });
  });

  server.get('/health', async () => kernel.health());

  server.post<{ Body: PingRequest }>('/demo/ping', async (request) => {
    const requestId = request.body?.requestId ?? randomUUID();
    const context = requestContext({});
    const command = createCommand({
      messageType: 'PingCommand',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      idempotencyKey: `ping:${requestId}`,
      ...context,
      payload: {
        requestId,
        message: request.body?.message ?? 'hello',
        sequence: 1,
      },
    });

    const commandDelivery = await kernel.connector.sendCommand(command);
    const query = createChildQuery(command, {
      messageType: 'GetPongResult',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      payload: { requestId },
    });
    const queryDelivery = await kernel.connector.query(query);

    return {
      commandStatus: commandDelivery.status,
      pong: queryDelivery.result.payload,
      trace: traceView(kernel, command.traceId),
    };
  });

  server.post<{ Body: SubmitIntakePayload; Headers: SecurityHeaders }>(
    '/intake',
    async (request) => {
      const context = requestContext(request.headers);
      const command = createCommand({
        messageType: 'SubmitIntake',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        idempotencyKey: `intake:${context.projectId}:${request.body.submissionId}`,
        ...context,
        payload: request.body,
      });
      const commandDelivery = await kernel.connector.sendCommand(command);
      const resultQuery = createChildQuery(command, {
        messageType: 'GetIntakeResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        payload: { submissionId: request.body.submissionId },
      });
      const stored = await kernel.connector.query(resultQuery);
      const storedPayload = stored.result.payload as { readonly sourceVersionId: string };
      const document = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'GetDocumentRevision',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const evidence = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListEvidenceSpans',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      const candidates = await kernel.connector.query(
        createChildQuery(command, {
          messageType: 'ListClaimCandidates',
          schemaVersion: '1.0.0',
          producerModule: 'shotgun-app',
          producerVersion: '1.0.0',
          payload: { sourceVersionId: storedPayload.sourceVersionId },
        }),
      );
      return {
        commandStatus: commandDelivery.status,
        intake: commandDelivery.result,
        stored: stored.result.payload,
        document: document.result.payload,
        evidence: evidence.result.payload,
        candidates: candidates.result.payload,
        trace: traceView(kernel, command.traceId),
        audit: auditView(kernel, command.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/candidates/list',
    async (request) => {
      const query = createQuery({
        messageType: 'ListClaimCandidates',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        candidates: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: CandidateRequest; Headers: SecurityHeaders }>(
    '/validation/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetValidationResult',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        validation: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/documents/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetDocumentRevision',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        document: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: SourceVersionRequest; Headers: SecurityHeaders }>(
    '/evidence/list',
    async (request) => {
      const query = createQuery({
        messageType: 'ListEvidenceSpans',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        evidence: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: EvidenceRequest; Headers: SecurityHeaders }>(
    '/evidence/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'GetEvidenceSpan',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        evidence: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.post<{ Body: ResolveAssetRequest; Headers: SecurityHeaders }>(
    '/assets/resolve',
    async (request) => {
      const query = createQuery({
        messageType: 'ResolveAsset',
        schemaVersion: '1.0.0',
        producerModule: 'shotgun-app',
        producerVersion: '1.0.0',
        ...requestContext(request.headers),
        payload: request.body,
      });
      const delivery = await kernel.connector.query(query);
      return {
        resolved: delivery.result.payload,
        trace: traceView(kernel, query.traceId),
        audit: auditView(kernel, query.traceId),
      };
    },
  );

  server.addHook('onClose', async () => {
    await kernel.shutdown();
    await options.closeResources?.();
  });

  return {
    server,
    kernel,
    repositories: {
      intake: intakeRepository,
      originalAsset: originalAssetRepository,
      transformation: transformationRepository,
      evidence: evidenceRepository,
      aiProvider: aiProviderRepository,
      candidates: candidateRepository,
      validation: validationRepository,
    },
    storage: assetStorage,
    state: {
      ping: ping.state,
      pong: pong.state,
    },
  };
};
