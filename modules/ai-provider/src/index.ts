import { randomUUID } from 'node:crypto';

import candidateMaterializationFailedSchema from '../../../packages/contracts/schemas/candidate-materialization-failed.v1.schema.json';
import candidateMaterializedSchema from '../../../packages/contracts/schemas/candidate-materialized.v1.schema.json';
import generateStructuredOutputSchema from '../../../packages/contracts/schemas/generate-structured-output.v1.schema.json';
import generateStructuredSchema from '../../../packages/contracts/schemas/generate-structured.v1.schema.json';
import {
  type AIDurableState,
  type AIProviderAttempt,
  type AIProviderCall,
  type AIProviderOutput,
  type AIProviderOutputReference,
  type ErrorCode,
  type GeneratedClaim,
  type QueryEnvelope,
  assertJsonSchema,
  sha256Text,
  ShotgunError,
  stableJson,
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
  /**
   * Optional live transport used by interactive Answer execution. Providers
   * that do not expose a streaming API may continue to implement the durable
   * structured path above, but must not pretend that a final response is a
   * live stream.
   */
  generateStructuredStream?(
    request: StructuredGenerationRequest,
    onText: (text: string) => Promise<void>,
    signal: AbortSignal,
  ): Promise<StructuredGenerationResponse>;
};

export type AIProviderExecutionRecord = {
  readonly callId: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: AIProviderCall['promptVersion'];
  readonly policyVersion: AIProviderCall['policyVersion'];
  readonly schemaName: AIProviderCall['schemaName'];
  readonly dataClassification: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly inputEvidenceIds: readonly string[];
  readonly inputSnapshotDigest: string;
  readonly requestDigest: string;
  readonly state: AIDurableState;
  readonly status: 'succeeded' | 'failed';
  readonly maxAttempts: number;
  readonly attempts: readonly AIProviderAttempt[];
  readonly call?: AIProviderCall;
  readonly output?: AIProviderOutput;
  readonly createdAt: string;
};

export type ClaimedProviderAttempt = {
  readonly record: AIProviderExecutionRecord;
  readonly attempt: AIProviderAttempt;
};

export type AIProviderCallRepositoryPort = {
  ensure(record: AIProviderExecutionRecord): Promise<AIProviderExecutionRecord>;
  findByRequestId(
    projectId: string,
    requestId: string,
  ): Promise<AIProviderExecutionRecord | undefined>;
  claimNextAttempt(
    projectId: string,
    requestId: string,
  ): Promise<ClaimedProviderAttempt | undefined>;
  storeOutput(
    projectId: string,
    requestId: string,
    output: AIProviderOutput,
  ): Promise<AIProviderExecutionRecord>;
  acceptOutput(
    projectId: string,
    requestId: string,
    outputId: string,
    call: AIProviderCall,
  ): Promise<AIProviderExecutionRecord>;
  failAttempt(
    projectId: string,
    requestId: string,
    attemptId: string,
    errorCode: ErrorCode,
  ): Promise<AIProviderExecutionRecord>;
  markAttemptOutcomeUnknown(
    projectId: string,
    requestId: string,
    attemptId: string,
  ): Promise<AIProviderExecutionRecord>;
  completeMaterialization(projectId: string, requestId: string, outputId: string): Promise<void>;
  failMaterialization(
    projectId: string,
    requestId: string,
    outputId: string,
    errorCode: ErrorCode,
  ): Promise<void>;
  markExpiredRunningAttemptsOutcomeUnknown(): Promise<void>;
  listRecoverableMaterializations(): Promise<readonly AIProviderExecutionRecord[]>;
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
  readonly sourceVersionId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: AIProviderExecutionRecord['sensitivity'];
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly text: string;
    readonly exactHash: string;
    readonly revisionId: string;
  }[];
};

type CandidateBatch = { readonly candidates: readonly GeneratedClaim[] };

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
  stableJson({
    task: 'Copy direct factual claim text and its evidenceId.',
    evidence: payload.evidence.map(({ evidenceId, text }) => ({ evidenceId, text })),
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
  return { projectId: envelope.projectId, security: envelope.security };
};

const errorCode = (error: unknown): ErrorCode =>
  error instanceof ShotgunError ? error.code : 'TERMINAL_FAILURE';
const isRetryable = (error: ShotgunError) =>
  error.retryable ||
  ['VALIDATION_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'RETRYABLE_DEPENDENCY'].includes(error.code);

const snapshotDigest = (projectId: string, payload: GenerateStructuredPayload) =>
  sha256Text(
    stableJson({
      version: 'ai-generation-input-v1',
      projectId,
      sourceVersionId: payload.sourceVersionId,
      transformationRevisionIds: [
        ...new Set(payload.evidence.map((item) => item.revisionId)),
      ].sort(),
      evidence: [...payload.evidence]
        .map(({ evidenceId, exactHash }) => ({ evidenceId, exactHash }))
        .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
      accessScope: [...payload.accessScope].sort(),
      sensitivity: payload.sensitivity,
      dataClassification: payload.dataClassification,
      taskProfile: payload.taskProfile,
      schema: { name: payload.schemaName, version: '1.0.0' },
      promptVersion: 'direct-claim-v1',
      policyVersion: payload.policyVersion,
    }),
  );

const requestDigest = (payload: GenerateStructuredPayload, inputSnapshotDigest: string) =>
  sha256Text(
    stableJson({
      version: 'ai-generation-request-v1',
      taskProfile: payload.taskProfile,
      schemaName: payload.schemaName,
      schemaVersion: '1.0.0',
      promptVersion: 'direct-claim-v1',
      policyVersion: payload.policyVersion,
      inputSnapshotDigest,
    }),
  );

const outputDigest = (output: Omit<AIProviderOutput, 'contentDigest'>) =>
  sha256Text(
    stableJson({
      version: output.envelopeVersion,
      outputId: output.outputId,
      projectId: output.projectId,
      callId: output.callId,
      attemptId: output.attemptId,
      provider: output.provider,
      adapterVersion: output.adapterVersion,
      model: output.model,
      schemaName: output.schemaName,
      schemaVersion: output.schemaVersion,
      promptVersion: output.promptVersion,
      policyVersion: output.policyVersion,
      dataPolicyVersion: output.dataPolicyVersion,
      rawText: output.rawText,
      requestDigest: output.requestDigest,
      inputSnapshotDigest: output.inputSnapshotDigest,
      providerResponseId: output.providerResponseId,
      modelVersion: output.modelVersion,
      finishReason: output.finishReason,
      usage: output.usage,
      cost: output.cost,
    }),
  );

const parseStoredOutput = (record: AIProviderExecutionRecord): CandidateBatch => {
  const output = record.output;
  if (
    !output ||
    !record.call ||
    output.envelopeVersion !== 'ai-provider-output-v1' ||
    output.projectId !== record.projectId ||
    output.callId !== record.callId ||
    output.provider !== record.call.provider ||
    output.adapterVersion !== record.call.adapterVersion ||
    output.model !== record.call.model ||
    output.schemaName !== record.call.schemaName ||
    output.schemaVersion !== '1.0.0' ||
    output.promptVersion !== record.call.promptVersion ||
    output.policyVersion !== record.call.policyVersion ||
    output.dataPolicyVersion !== record.call.dataPolicyVersion ||
    output.requestDigest !== record.requestDigest ||
    output.inputSnapshotDigest !== record.inputSnapshotDigest ||
    output.contentDigest !== outputDigest(output)
  ) {
    throw new ShotgunError({
      code: 'FORMAT_CORRUPT',
      safeMessage: 'The persisted AI output is missing or failed integrity verification.',
      module: 'stage4.ai-provider',
      operation: 'replay-stored-output',
      retryable: false,
    });
  }
  try {
    const parsed = JSON.parse(output.rawText) as CandidateBatch;
    assertJsonSchema(candidateBatchSchema, parsed, 'persisted AI structured output');
    return parsed;
  } catch (error) {
    throw new ShotgunError({
      code: 'FORMAT_CORRUPT',
      safeMessage: 'The persisted AI output is not valid structured data.',
      module: 'stage4.ai-provider',
      operation: 'parse-stored-output',
      retryable: false,
      cause: error,
    });
  }
};

const outputReference = (output: AIProviderOutput): AIProviderOutputReference => {
  const { rawText, ...reference } = output;
  void rawText;
  return reference;
};

export const createAIProviderModule = (
  repository: AIProviderCallRepositoryPort,
  adapter: AIProviderAdapterPort,
  policy: AIProviderPolicy = { allowPrivate: false, allowRestricted: false, maxAttempts: 2 },
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
      owns: ['ai.provider_calls', 'ai.provider_attempts', 'ai.provider_outputs'],
      readsViaPorts: ['AIProviderAdapterPort'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [
        { name: 'CandidateMaterialized', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateMaterializationFailed', range: '>=1.0.0 <2.0.0' },
      ],
    },
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
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
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
      name: 'CandidateMaterialized',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateMaterializedSchema,
    },
    {
      name: 'CandidateMaterializationFailed',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateMaterializationFailedSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'CandidateMaterialized',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const payload = envelope.payload as { requestId: string; outputId: string };
          if (envelope.projectId)
            await repository.completeMaterialization(
              envelope.projectId,
              payload.requestId,
              payload.outputId,
            );
        },
      },
      {
        messageType: 'CandidateMaterializationFailed',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const payload = envelope.payload as {
            requestId: string;
            outputId: string;
            errorCode: ErrorCode;
          };
          if (envelope.projectId)
            await repository.failMaterialization(
              envelope.projectId,
              payload.requestId,
              payload.outputId,
              payload.errorCode,
            );
        },
      },
    ],
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
            security.sensitivity !== payload.sensitivity ||
            security.dataClassification !== payload.dataClassification ||
            security.accessScope.length !== payload.accessScope.length ||
            !security.accessScope.every((scope) => payload.accessScope.includes(scope)) ||
            security.sensitivity === 'restricted' ||
            (security.sensitivity === 'private' && !policy.allowPrivate)
          ) {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'This AI data policy does not allow this evidence context.',
              module: 'stage4.ai-provider',
              operation: 'enforce-data-policy',
              correlationId: envelope.correlationId,
            });
          }
          const inputSnapshotDigest = snapshotDigest(projectId, payload);
          const durableRequestDigest = requestDigest(payload, inputSnapshotDigest);
          let record = await repository.ensure({
            callId: randomUUID(),
            requestId: payload.requestId,
            projectId,
            sourceVersionId: payload.sourceVersionId,
            provider: adapter.identity.provider,
            model: adapter.identity.model,
            promptVersion: 'direct-claim-v1',
            policyVersion: payload.policyVersion,
            schemaName: payload.schemaName,
            dataClassification: payload.dataClassification,
            accessScope: [...payload.accessScope].sort(),
            sensitivity: payload.sensitivity,
            inputEvidenceIds: payload.evidence.map((item) => item.evidenceId),
            inputSnapshotDigest,
            requestDigest: durableRequestDigest,
            state: 'REQUESTED',
            status: 'failed',
            maxAttempts: Math.max(1, Math.min(policy.maxAttempts, 2)),
            attempts: [],
            createdAt: envelope.createdAt,
          });
          if (
            record.inputSnapshotDigest !== inputSnapshotDigest ||
            record.requestDigest !== durableRequestDigest
          ) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The AI request identity does not match its durable input snapshot.',
              module: 'stage4.ai-provider',
              operation: 'verify-request-identity',
              correlationId: envelope.correlationId,
            });
          }
          if (
            record.state === 'OUTPUT_MATERIALIZED' ||
            record.state === 'MATERIALIZATION_FAILED' ||
            record.state === 'COMPLETED'
          ) {
            const parsed = parseStoredOutput(record);
            return {
              call: record.call!,
              candidates: parsed.candidates,
              output: outputReference(record.output!),
            };
          }
          if (record.state === 'PROVIDER_RUNNING' || record.state === 'OUTCOME_UNKNOWN') {
            throw new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage:
                'The prior provider attempt has an unknown outcome and will not be called again automatically.',
              module: 'stage4.ai-provider',
              operation: 'claim-provider-attempt',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          let lastError: ShotgunError | undefined;
          for (;;) {
            const claimed = await repository.claimNextAttempt(projectId, payload.requestId);
            if (!claimed) break;
            record = claimed.record;
            const startedAt = Date.now();
            let response: StructuredGenerationResponse;
            try {
              response = await adapter.generateStructured({
                systemInstruction,
                prompt: promptFor(payload),
                responseSchema: candidateBatchSchema,
              });
            } catch (error) {
              lastError = toShotgunError(error, {
                code: 'TERMINAL_FAILURE',
                safeMessage: 'The AI provider call failed.',
                module: 'stage4.ai-provider',
                operation: 'invoke-provider',
                correlationId: envelope.correlationId,
                retryable: false,
              });
              record = await repository.failAttempt(
                projectId,
                payload.requestId,
                claimed.attempt.attemptId,
                errorCode(lastError),
              );
              if (!isRetryable(lastError)) break;
              continue;
            }

            const inputTokens = response.inputTokens ?? 0;
            const outputTokens = response.outputTokens ?? 0;
            const draft = {
              outputId: randomUUID(),
              projectId,
              callId: record.callId,
              attemptId: claimed.attempt.attemptId,
              envelopeVersion: 'ai-provider-output-v1' as const,
              provider: adapter.identity.provider,
              adapterVersion: adapter.identity.adapterVersion,
              model: adapter.identity.model,
              schemaName: payload.schemaName,
              schemaVersion: '1.0.0' as const,
              promptVersion: 'direct-claim-v1' as const,
              policyVersion: payload.policyVersion,
              dataPolicyVersion: adapter.identity.dataPolicyVersion,
              rawText: response.rawText,
              requestDigest: durableRequestDigest,
              inputSnapshotDigest,
              providerResponseId: response.providerResponseId,
              modelVersion: response.modelVersion ?? adapter.identity.model,
              usage: {
                inputTokens,
                outputTokens,
                totalTokens: response.totalTokens ?? inputTokens + outputTokens,
              },
              cost: { currency: 'USD' as const, status: 'unavailable' as const },
              receivedAt: new Date().toISOString(),
            };

            let stored: AIProviderExecutionRecord;
            try {
              stored = await repository.storeOutput(projectId, payload.requestId, {
                ...draft,
                contentDigest: outputDigest(draft),
              });
            } catch (error) {
              try {
                await repository.markAttemptOutcomeUnknown(
                  projectId,
                  payload.requestId,
                  claimed.attempt.attemptId,
                );
              } catch {
                // The durable running claim still blocks an automatic Provider recall.
              }
              throw new ShotgunError({
                code: 'OUTCOME_UNKNOWN',
                safeMessage:
                  'The Provider response was received but could not be durably persisted.',
                module: 'stage4.ai-provider',
                operation: 'persist-provider-output',
                correlationId: envelope.correlationId,
                retryable: false,
                cause: error,
              });
            }

            let parsed: CandidateBatch;
            try {
              parsed = JSON.parse(stored.output!.rawText) as CandidateBatch;
              assertJsonSchema(candidateBatchSchema, parsed, 'AI structured output');
            } catch (error) {
              lastError = new ShotgunError({
                code: 'VALIDATION_ERROR',
                safeMessage: 'AI structured output could not be validated.',
                module: 'stage4.ai-provider',
                operation: 'validate-structured-output',
                correlationId: envelope.correlationId,
                retryable: true,
                cause: error,
              });
              record = await repository.failAttempt(
                projectId,
                payload.requestId,
                claimed.attempt.attemptId,
                lastError.code,
              );
              continue;
            }

            const succeeded = record.attempts.map((attempt) =>
              attempt.attemptId === claimed.attempt.attemptId
                ? {
                    ...attempt,
                    status: 'succeeded' as const,
                    providerResponseId: response.providerResponseId,
                    latencyMs: Date.now() - startedAt,
                  }
                : attempt,
            );
            const call: AIProviderCall = {
              callId: record.callId,
              requestId: payload.requestId,
              taskProfile: payload.taskProfile,
              schemaName: payload.schemaName,
              provider: adapter.identity.provider,
              adapterVersion: adapter.identity.adapterVersion,
              model: adapter.identity.model,
              modelVersion: draft.modelVersion,
              promptVersion: 'direct-claim-v1',
              policyVersion: payload.policyVersion,
              dataPolicyVersion: adapter.identity.dataPolicyVersion,
              dataClassification: payload.dataClassification,
              inputEvidenceIds: record.inputEvidenceIds,
              usage: draft.usage,
              cost: draft.cost,
              attempts: succeeded,
              structuredOutputValid: true,
              createdAt: record.createdAt,
            };

            let accepted: AIProviderExecutionRecord;
            try {
              accepted = await repository.acceptOutput(
                projectId,
                payload.requestId,
                stored.output!.outputId,
                call,
              );
            } catch (error) {
              try {
                await repository.markAttemptOutcomeUnknown(
                  projectId,
                  payload.requestId,
                  claimed.attempt.attemptId,
                );
              } catch {
                // A stored Output or existing accepted pointer remains the recovery authority.
              }
              throw toShotgunError(error, {
                code: 'OUTCOME_UNKNOWN',
                safeMessage: 'The stored Provider output could not be accepted.',
                module: 'stage4.ai-provider',
                operation: 'accept-provider-output',
                correlationId: envelope.correlationId,
                retryable: false,
              });
            }
            const acceptedParsed = parseStoredOutput(accepted);
            return {
              call: accepted.call!,
              candidates: acceptedParsed.candidates,
              output: outputReference(accepted.output!),
            };
          }
          throw (
            lastError ??
            new ShotgunError({
              code: 'TERMINAL_FAILURE',
              safeMessage: 'AI generation exhausted its durable attempt budget.',
              module: 'stage4.ai-provider',
              operation: 'generate-structured',
              correlationId: envelope.correlationId,
              retryable: false,
            })
          );
        },
      },
    ],
  },
});
