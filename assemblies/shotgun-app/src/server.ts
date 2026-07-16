import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import {
  InMemoryAssetStorage,
  InMemoryIntakeRepository,
  InMemoryOriginalAssetRepository,
} from '../../../adapters/stage2-in-memory/src/index.js';
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
import { createPingModule } from '../../../modules/ping/src/index.js';
import { createPongModule } from '../../../modules/pong/src/index.js';

type PingRequest = {
  readonly requestId?: string;
  readonly message?: string;
};

type ResolveAssetRequest = {
  readonly assetReference: AssetReference;
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
  const ping = createPingModule();
  const pong = createPongModule();
  const intake = createIntakeModule(intakeRepository);
  const originalAsset = createOriginalAssetModule(originalAssetRepository, assetStorage);
  const kernel = new ShotgunKernel(options.transport ?? new InProcessTransport());
  kernel.register(ping.module, pong.module, intake, originalAsset);
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
      return {
        commandStatus: commandDelivery.status,
        intake: commandDelivery.result,
        stored: stored.result.payload,
        trace: traceView(kernel, command.traceId),
        audit: auditView(kernel, command.traceId),
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
    },
    storage: assetStorage,
    state: {
      ping: ping.state,
      pong: pong.state,
    },
  };
};
