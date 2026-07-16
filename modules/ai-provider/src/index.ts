import { randomUUID } from 'node:crypto';

import candidateBatchEventSchema from '../../../packages/contracts/schemas/candidate-generated.v1.schema.json';
import generateStructuredOutputSchema from '../../../packages/contracts/schemas/generate-structured-output.v1.schema.json';
import generateStructuredSchema from '../../../packages/contracts/schemas/generate-structured.v1.schema.json';
import {
  type AIProviderAttempt,
  type AIProviderCall,
  type ErrorCode,
  type GeneratedClaim,
  type QueryEnvelope,
  assertJsonSchema,
  ShotgunError,
  toShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type StructuredGenerationRequest = {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema: Record<string, unknown>;
};

export type StructuredGenerationResponse = {
  readonly rawText: string;
  readonly providerResponseId?: string;
  readonly modelVersion?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
};

export type AIProviderAdapterPort = {
  readonly identity: {
    readonly provider: string;
    readonly adapterVersion: string;
    readonly model: string;
    readonly dataPolicyVersion: AIProviderCall['dataPolicyVersion'];
  };
  generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResponse>;
};

export type AIProviderExecutionRecord = {
  readonly callId: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: AIProviderCall['promptVersion'];
  readonly policyVersion: AIProviderCall['policyVersion'];
  readonly schemaName: AIProviderCall['schemaName'];
  readonly dataClassification: string;
  readonly inputEvidenceIds: readonly string[];
  readonly status: 'succeeded' | 'failed';
  readonly attempts: readonly AIProviderAttempt[];
  readonly call?: AIProviderCall;
  readonly createdAt: string;
};

export type AIProviderCallRepositoryPort = {
  save(record: AIProviderExecutionRecord): Promise<void>;
  findByRequestId(
    projectId: string,
    requestId: string,
  ): Promise<AIProviderExecutionRecord | undefined>;
};

export type AIProviderPolicy = {
  readonly allowPrivate: boolean;
  readonly allowRestricted: false;
  readonly maxAttempts: number;
};

type GenerateStructuredPayload = {
  readonly requestId: string;
  readonly taskProfile: 'candidate-extraction';
  readonly schemaName: 'ClaimCandidateBatch.v1';
  readonly policyVersion: 'direct-only-v1';
  readonly dataClassification: string;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly text: string;
  }[];
};

type CandidateBatch = {
  readonly candidates: readonly GeneratedClaim[];
};

const candidateBatchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimText', 'evidenceId'],
        properties: {
          claimText: { type: 'string', minLength: 1 },
          evidenceId: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

const systemInstruction = [
  'You extract only claims that are explicitly written in the supplied evidence.',
  'Never infer, summarize, translate, combine evidence items, or add outside knowledge.',
  'claimText must be an exact contiguous substring of the matching evidence text.',
  'Return no candidate when an explicit claim is absent.',
].join(' ');

const promptFor = (payload: GenerateStructuredPayload): string =>
  JSON.stringify({
    task: 'Copy direct factual claim text and its evidenceId.',
    evidence: payload.evidence,
  });

const assertContext = (envelope: QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'AI generation requires complete security context.',
      module: 'stage4.ai-provider',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    security: envelope.security,
  };
};

const errorCode = (error: unknown): ErrorCode =>
  error instanceof ShotgunError ? error.code : 'TERMINAL_FAILURE';

export const createAIProviderModule = (
  repository: AIProviderCallRepositoryPort,
  adapter: AIProviderAdapterPort,
  policy: AIProviderPolicy = {
    allowPrivate: false,
    allowRestricted: false,
    maxAttempts: 2,
  },
): ShotgunModule => ({
  manifest: {
    id: 'stage4.ai-provider',
    version: '1.0.0',
    owner: 'Shotgun AI Provider',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [{ name: 'GenerateStructured', range: '>=1.0.0 <2.0.0' }],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['ai.provider_calls', 'ai.provider_attempts'],
      readsViaPorts: ['AIProviderAdapterPort'],
      directSchemaAccess: false,
    },
    consumes: { commands: [], events: [] },
    produces: { events: [] },
    provides: {
      queries: [{ name: 'GenerateStructured', range: '>=1.0.0 <2.0.0' }],
      capabilities: [{ name: 'structured-ai-provider', priority: 100 }],
    },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: {
      canWriteCanonical: false,
      canExecuteExternalAction: false,
    },
  },
  contracts: [
    {
      name: 'GenerateStructured',
      version: '1.0.0',
      kind: 'query',
      inputSchema: generateStructuredSchema,
      outputSchema: generateStructuredOutputSchema,
    },
    {
      name: 'CandidateGenerated',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateBatchEventSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [],
    queries: [
      {
        messageType: 'GenerateStructured',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        timeoutMs: 60_000,
        async handle(envelope) {
          const payload = envelope.payload as GenerateStructuredPayload;
          const { projectId, security } = assertContext(envelope);
          if (
            security.sensitivity === 'restricted' ||
            (security.sensitivity === 'private' && !policy.allowPrivate)
          ) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'This Gemini data policy does not allow private or restricted evidence.',
              module: 'stage4.ai-provider',
              operation: 'enforce-data-policy',
              correlationId: envelope.correlationId,
            });
          }

          const existing = await repository.findByRequestId(projectId, payload.requestId);
          if (existing?.call) {
            return {
              call: existing.call,
              candidates: [],
            };
          }

          const callId = randomUUID();
          const attempts: AIProviderAttempt[] = [];
          let lastError: ShotgunError | undefined;
          for (let attemptNumber = 1; attemptNumber <= policy.maxAttempts; attemptNumber += 1) {
            const attemptId = randomUUID();
            const startedAt = Date.now();
            try {
              const response = await adapter.generateStructured({
                systemInstruction,
                prompt: promptFor(payload),
                responseSchema: candidateBatchSchema,
              });
              const parsed = JSON.parse(response.rawText) as CandidateBatch;
              assertJsonSchema(candidateBatchSchema, parsed, 'AI structured output');
              const latencyMs = Date.now() - startedAt;
              attempts.push({
                attemptId,
                attemptNumber,
                status: 'succeeded',
                providerResponseId: response.providerResponseId,
                latencyMs,
              });
              const inputTokens = response.inputTokens ?? 0;
              const outputTokens = response.outputTokens ?? 0;
              const call: AIProviderCall = {
                callId,
                requestId: payload.requestId,
                taskProfile: payload.taskProfile,
                schemaName: payload.schemaName,
                provider: adapter.identity.provider,
                adapterVersion: adapter.identity.adapterVersion,
                model: adapter.identity.model,
                modelVersion: response.modelVersion ?? adapter.identity.model,
                promptVersion: 'direct-claim-v1',
                policyVersion: payload.policyVersion,
                dataPolicyVersion: adapter.identity.dataPolicyVersion,
                dataClassification: payload.dataClassification,
                inputEvidenceIds: payload.evidence.map((item) => item.evidenceId),
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: response.totalTokens ?? inputTokens + outputTokens,
                },
                cost: { currency: 'USD', status: 'unavailable' },
                attempts,
                structuredOutputValid: true,
                createdAt: envelope.createdAt,
              };
              await repository.save({
                callId,
                requestId: payload.requestId,
                projectId,
                provider: adapter.identity.provider,
                model: adapter.identity.model,
                promptVersion: 'direct-claim-v1',
                policyVersion: payload.policyVersion,
                schemaName: payload.schemaName,
                dataClassification: payload.dataClassification,
                inputEvidenceIds: call.inputEvidenceIds,
                status: 'succeeded',
                attempts,
                call,
                createdAt: envelope.createdAt,
              });
              return { call, candidates: parsed.candidates };
            } catch (error) {
              lastError = toShotgunError(error, {
                code: 'VALIDATION_ERROR',
                safeMessage: 'AI structured output could not be validated.',
                module: 'stage4.ai-provider',
                operation: 'generate-structured',
                correlationId: envelope.correlationId,
                retryable: true,
              });
              attempts.push({
                attemptId,
                attemptNumber,
                status: 'failed',
                errorCode: errorCode(lastError),
                latencyMs: Date.now() - startedAt,
              });
              if (
                !lastError.retryable &&
                !['VALIDATION_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'RETRYABLE_DEPENDENCY'].includes(
                  lastError.code,
                )
              ) {
                break;
              }
            }
          }

          await repository.save({
            callId,
            requestId: payload.requestId,
            projectId,
            provider: adapter.identity.provider,
            model: adapter.identity.model,
            promptVersion: 'direct-claim-v1',
            policyVersion: payload.policyVersion,
            schemaName: payload.schemaName,
            dataClassification: payload.dataClassification,
            inputEvidenceIds: payload.evidence.map((item) => item.evidenceId),
            status: 'failed',
            attempts,
            createdAt: envelope.createdAt,
          });
          throw (
            lastError ??
            new ShotgunError({
              code: 'TERMINAL_FAILURE',
              safeMessage: 'AI generation failed.',
              module: 'stage4.ai-provider',
              operation: 'generate-structured',
              correlationId: envelope.correlationId,
            })
          );
        },
      },
    ],
  },
});
