import { randomUUID } from 'node:crypto';

import candidateMaterializationFailedSchema from '../../../packages/contracts/schemas/candidate-materialization-failed.v1.schema.json';
import candidateMaterializedSchema from '../../../packages/contracts/schemas/candidate-materialized.v1.schema.json';
import generateStructuredOutputSchema from '../../../packages/contracts/schemas/generate-structured-output.v1.schema.json';
import generateStructuredSchema from '../../../packages/contracts/schemas/generate-structured.v1.schema.json';
import {
  type AIDurableState,
  type AIExecutionIdentity,
  type AIProviderAttempt,
  type AIProviderCall,
  type AIProviderOutput,
  type AIProviderOutputReference,
  type ErrorCode,
  isRetryableAIProviderErrorCode,
  type GeneratedClaim,
  type QueryEnvelope,
  assertJsonSchema,
  sha256Text,
  ShotgunError,
  stableJson,
  toShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { HandlerContext, ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type StructuredGenerationRequest = {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema: Record<string, unknown>;
  /** Server-owned bounded Discovery output cap when supplied. */
  readonly maxOutputTokens?: number;
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
    readonly dataPolicyVersion: string;
    /** True only when the adapter forwards maxOutputTokens to its provider. */
    readonly supportsOutputTokenLimit?: boolean;
    /** True only when the adapter forwards the caller AbortSignal. */
    readonly supportsCancellation?: boolean;
  };
  generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResponse>;
  /** Optional signal-aware non-streaming path used by request-scoped routing. */
  generateStructuredWithSignal?(
    request: StructuredGenerationRequest,
    signal?: AbortSignal,
  ): Promise<StructuredGenerationResponse>;
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

export type AIProviderExecutionResolution = {
  readonly adapter: AIProviderAdapterPort;
  /** The exact Project configuration, credential and policy identity used by
   * the adapter. This is persisted with the durable provider call. */
  readonly executionIdentity: AIExecutionIdentity;
};

export type AIProviderExecutionResolverPort = {
  resolve(input: {
    readonly projectId: string;
    readonly requestId: string;
    readonly sourceVersionId: string;
    readonly dataClassification: string;
    readonly accessScope: readonly string[];
    readonly sensitivity: AIProviderExecutionRecord['sensitivity'];
    readonly existingIdentity?: AIExecutionIdentity;
  }): Promise<AIProviderExecutionResolution>;
};

export type AIProviderExecutionRecord = {
  readonly callId: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  /** Exact Stage 3 transformation revision used by Candidate extraction. */
  readonly revisionId?: string;
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
  readonly executionIdentity?: AIExecutionIdentity;
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

export type AIProviderModuleOptions = {
  /** Optional request-time Project authority. When supplied, the static
   * adapter is only the compatibility fallback for existing harnesses. */
  readonly executionResolver?: AIProviderExecutionResolverPort;
  /** Version of direct-claim extraction semantics, used in durable request identity. */
  readonly candidatePromptVersion?: string;
  /** Optional cap for one source-claim response; included in durable input identity. */
  readonly candidateMaxOutputTokens?: number;
};

export const DEFAULT_DEEPSEEK_CANDIDATE_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_CANDIDATE_PROMPT_VERSION = 'direct-claim-v7';

type GenerateStructuredPayload = {
  readonly requestId: string;
  readonly generationEpochId?: string;
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

const candidatePromptInstructions: Readonly<Record<string, string>> = {
  'direct-claim-v2': [
    'You extract only claims that are explicitly written in the supplied evidence. Explicit numerical examples and equations are claims too; copy their stated values without calculating or correcting them.',
    'Never infer, summarize, translate, combine evidence items, or add outside knowledge.',
    'claimText must be an exact contiguous substring of the matching evidence text.',
    'Return no candidate when an explicit claim is absent.',
  ].join(' '),
  'direct-claim-v3': [
    'You extract only claims that are explicitly written in the supplied evidence. Explicit numerical examples and equations are claims too; copy their stated values without calculating or correcting them.',
    'Never infer, summarize, translate, combine evidence items, or add outside knowledge.',
    'For each candidate, claimText must be the entire matching source sentence copied verbatim, never a shortened fragment.',
    'This policy stores one sentence-level claim per evidence sentence so its dates, time ranges, units, and conditions remain attached to the stated value.',
    'Return no candidate when an explicit claim is absent.',
  ].join(' '),
  'direct-claim-v4': [
    'Extract only claims explicitly stated in the supplied evidence. Explicit numerical examples and equations are claims too; copy their stated values without calculating or correcting them.',
    'Return one atomic claim per candidate. Split separate facts, formulas, examples, and conclusions into separate candidates when each can stand on its own, including when a document converter joined them into one Evidence item.',
    'Copy each claim as an exact contiguous substring of its matching evidence. Never infer, summarize, translate, combine separate claims, or add outside knowledge.',
    'Keep every number, unit, date, time range, condition, exception, negation, and uncertainty that qualifies that claim. For an equation or worked example, include its operands and stated result together.',
    'Do not copy an entire paragraph or evidence block when a shorter complete source statement expresses the claim. Do not add a combined duplicate when separate atomic claims are already returned.',
    'Return no candidate when an explicit claim is absent.',
  ].join(' '),
  'direct-claim-v5': [
    'Extract only claims explicitly stated in the supplied evidence. Explicit numerical examples and equations are claims too; copy their stated values without calculating or correcting them.',
    'Extract every distinct explicit claim from each evidence item; do not stop after its first claim. Return one atomic claim per candidate. Split separate facts, formulas, examples, and conclusions into separate candidates when each can stand on its own, including when a document converter joined them into one Evidence item.',
    'Copy each claim as an exact contiguous substring of its matching evidence. Never infer, summarize, translate, combine separate claims, or add outside knowledge.',
    'Keep every number, unit, date, time range, condition, exception, negation, and uncertainty that qualifies that claim. For an equation or worked example, include its operands and stated result together.',
    'Do not copy an entire paragraph or evidence block when a shorter complete source statement expresses the claim. Do not add a combined duplicate when separate atomic claims are already returned.',
    'Return no candidate when an explicit claim is absent.',
  ].join(' '),
  'direct-claim-v6': [
    'Extract only claims explicitly stated in the supplied evidence. Explicit numerical examples and equations are claims too; copy their stated values without calculating or correcting them.',
    'Extract every distinct explicit claim from each evidence item; do not stop after its first claim. Return one atomic claim per candidate. Split separate facts, formulas, examples, and conclusions into separate candidates when each can stand on its own, including when a document converter joined them into one Evidence item.',
    'Copy each claim as an exact contiguous substring of its matching evidence. Never infer, summarize, translate, combine separate claims, or add outside knowledge.',
    'Keep every number, unit, date, time range, condition, exception, negation, and uncertainty that qualifies that claim. For an equation or worked example, include its operands and stated result together.',
    'Do not copy an entire paragraph or evidence block when a shorter complete source statement expresses the claim. Do not add a combined duplicate when separate atomic claims are already returned.',
    'Evidence may contain visual PDF line breaks. Split a line only when it completes an atomic claim; keep wrapped sentence fragments and stacked equation rows together. Return each standalone list item as its own candidate and never turn a heading into a claim.',
    'Return no candidate when an explicit claim is absent.',
  ].join(' '),
  'direct-claim-v7': [
    'Extract only claims explicitly stated in the supplied evidence. Explicit numerical examples and equations are claims too; copy their stated values without calculating or correcting them.',
    'Extract every distinct explicit claim from each evidence item; do not stop after its first claim. Return one atomic claim per candidate. Split separate facts, formulas, examples, and conclusions into separate candidates when each can stand on its own, including when a document converter joined them into one Evidence item.',
    'Copy each claim as an exact contiguous substring of its matching evidence. Never infer, summarize, translate, combine evidence items, or add outside knowledge.',
    'Keep every number, unit, date, time range, condition, exception, negation, and uncertainty that qualifies the claim. For an equation or worked example, include its operands and stated result together.',
    'Each candidate must be a complete standalone proposition, definition, relationship, condition, or complete equation. Do not return headings, category labels, isolated nouns, isolated values, bare variables, or partial equation fragments. A list item is a claim only when its text states a complete relationship, action, or condition; words such as 토지, 건물, or 기계장치 alone are labels, not claims.',
    'Evidence may contain visual PDF line breaks. Keep wrapped sentence fragments and stacked equation rows together. Return a standalone list item only when it contains a complete claim; include its qualifier and linked label when both occur in the same evidence. For formulas, return the full expression with an operator and operands, never isolated symbols or variable fragments.',
    'Never turn a heading or an incomplete fragment into a claim. Return no candidate when the evidence does not contain a complete standalone claim.',
  ].join(' '),
};

const resolveCandidatePromptPolicy = (promptVersion: string) => {
  if (
    !promptVersion.trim() ||
    promptVersion.length > 128 ||
    promptVersion.trim() !== promptVersion
  ) {
    throw new Error('Candidate extraction prompt version must be a bounded, trimmed value.');
  }
  const systemInstruction = candidatePromptInstructions[promptVersion];
  if (!systemInstruction) {
    throw new Error(`Unsupported candidate extraction prompt version: ${promptVersion}`);
  }
  return { promptVersion, systemInstruction };
};

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
  error.retryable || isRetryableAIProviderErrorCode(error.code);

const snapshotDigest = (
  projectId: string,
  payload: GenerateStructuredPayload,
  promptVersion: string,
  maxOutputTokens: number | undefined,
) =>
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
      promptVersion,
      policyVersion: payload.policyVersion,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    }),
  );

const requestDigest = (
  payload: GenerateStructuredPayload,
  inputSnapshotDigest: string,
  promptVersion: string,
  maxOutputTokens: number | undefined,
) =>
  sha256Text(
    stableJson({
      version: 'ai-generation-request-v1',
      taskProfile: payload.taskProfile,
      schemaName: payload.schemaName,
      schemaVersion: '1.0.0',
      promptVersion,
      policyVersion: payload.policyVersion,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      inputSnapshotDigest,
      ...(payload.generationEpochId === undefined
        ? {}
        : { generationEpochId: payload.generationEpochId }),
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
  options: AIProviderModuleOptions = {},
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
    produces: { events: [], handoffs: [] },
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
        async handle(envelope, context: HandlerContext) {
          const payload = envelope.payload as GenerateStructuredPayload;
          const { promptVersion, systemInstruction } = resolveCandidatePromptPolicy(
            options.candidatePromptVersion ?? DEFAULT_CANDIDATE_PROMPT_VERSION,
          );
          const { projectId, security } = assertContext(envelope);
          const cancellationError = () =>
            new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage: 'The AI provider request was cancelled before durable acceptance.',
              module: 'stage4.ai-provider',
              operation: 'invoke-provider',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          const markCancellationAndThrow = async (attemptId: string): Promise<never> => {
            try {
              await repository.markAttemptOutcomeUnknown(projectId, payload.requestId, attemptId);
            } catch {
              // The running provider claim remains the recovery authority.
            }
            throw cancellationError();
          };
          if (context.signal.aborted) {
            throw cancellationError();
          }
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
          const existing = await repository.findByRequestId(projectId, payload.requestId);
          const requestedRevisionIds = [
            ...new Set(payload.evidence.map((item) => item.revisionId)),
          ];
          if (requestedRevisionIds.length !== 1 || !requestedRevisionIds[0]) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Candidate AI execution requires one exact Evidence revision.',
              module: 'stage4.ai-provider',
              operation: 'validate-input-revision',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          if (existing && existing.revisionId === undefined) {
            throw new ShotgunError({
              code: 'REVISION_CONFLICT',
              safeMessage: 'The legacy AI request has no exact Evidence revision pin.',
              module: 'stage4.ai-provider',
              operation: 'verify-legacy-input-revision',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          if (existing && existing.revisionId !== requestedRevisionIds[0]) {
            throw new ShotgunError({
              code: 'REVISION_CONFLICT',
              safeMessage: 'The durable AI request is pinned to a different Evidence revision.',
              module: 'stage4.ai-provider',
              operation: 'verify-input-revision',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          // A completed output is already the durable authority. Replaying
          // materialization must never re-resolve current configuration or
          // recall an external provider.
          if (
            existing &&
            (existing.state === 'OUTPUT_MATERIALIZED' ||
              existing.state === 'MATERIALIZATION_FAILED' ||
              existing.state === 'COMPLETED')
          ) {
            const parsed = parseStoredOutput(existing);
            return {
              call: existing.call!,
              candidates: parsed.candidates,
              output: outputReference(existing.output!),
            };
          }
          if (existing?.state === 'OUTCOME_UNKNOWN') {
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
          // A repeated GenerateStructured request must honor the durable
          // failure class before resolving a provider route.  The repository
          // also enforces this at claim time, but this module-level guard
          // keeps terminal replays fail-closed and avoids reporting a
          // misleading "attempt budget exhausted" error when budget remains.
          if (
            existing?.state === 'PROVIDER_FAILED' &&
            !isRetryableAIProviderErrorCode(
              existing.attempts.at(-1)?.errorCode ?? 'TERMINAL_FAILURE',
            )
          ) {
            throw new ShotgunError({
              code: existing.attempts.at(-1)?.errorCode ?? 'TERMINAL_FAILURE',
              safeMessage:
                'The prior provider attempt failed terminally and will not be called again automatically.',
              module: 'stage4.ai-provider',
              operation: 'claim-provider-attempt',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          const resolution = options.executionResolver
            ? await options.executionResolver.resolve({
                projectId,
                requestId: payload.requestId,
                sourceVersionId: payload.sourceVersionId,
                dataClassification: payload.dataClassification,
                accessScope: payload.accessScope,
                sensitivity: payload.sensitivity,
                ...(existing?.executionIdentity === undefined
                  ? {}
                  : { existingIdentity: existing.executionIdentity }),
              })
            : undefined;
          const activeAdapter = resolution?.adapter ?? adapter;
          const executionIdentity = resolution?.executionIdentity;
          if (
            executionIdentity &&
            (executionIdentity.providerId !== activeAdapter.identity.provider ||
              executionIdentity.modelId !== activeAdapter.identity.model)
          ) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The routed AI adapter does not match its execution identity.',
              module: 'stage4.ai-provider',
              operation: 'verify-execution-identity',
              correlationId: envelope.correlationId,
            });
          }
          const candidateMaxOutputTokens =
            options.candidateMaxOutputTokens ??
            (activeAdapter.identity.provider === 'deepseek'
              ? DEFAULT_DEEPSEEK_CANDIDATE_MAX_OUTPUT_TOKENS
              : undefined);
          if (
            candidateMaxOutputTokens !== undefined &&
            (!Number.isSafeInteger(candidateMaxOutputTokens) || candidateMaxOutputTokens < 1)
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'The candidate output token limit must be a positive integer.',
              module: 'stage4.ai-provider',
              operation: 'validate-candidate-output-token-limit',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          const inputSnapshotDigest = snapshotDigest(
            projectId,
            payload,
            promptVersion,
            candidateMaxOutputTokens,
          );
          const durableRequestDigest = requestDigest(
            payload,
            inputSnapshotDigest,
            promptVersion,
            candidateMaxOutputTokens,
          );
          const revisionIds = [...new Set(payload.evidence.map((item) => item.revisionId))];
          if (revisionIds.length !== 1 || !revisionIds[0]) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Candidate AI execution requires one exact Evidence revision.',
              module: 'stage4.ai-provider',
              operation: 'pin-input-revision',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          const revisionId = revisionIds[0];
          if (existing?.revisionId !== undefined && existing.revisionId !== revisionId) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The durable AI request is pinned to a different Evidence revision.',
              module: 'stage4.ai-provider',
              operation: 'verify-input-revision',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          let record = await repository.ensure({
            callId: randomUUID(),
            requestId: payload.requestId,
            projectId,
            sourceVersionId: payload.sourceVersionId,
            revisionId,
            provider: activeAdapter.identity.provider,
            model: activeAdapter.identity.model,
            promptVersion,
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
            ...(executionIdentity === undefined ? {} : { executionIdentity }),
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
          if (record.revisionId !== revisionId) {
            throw new ShotgunError({
              code: 'REVISION_CONFLICT',
              safeMessage: 'The durable AI Provider record is pinned to a different revision.',
              module: 'stage4.ai-provider',
              operation: 'verify-durable-input-revision',
              correlationId: envelope.correlationId,
              retryable: false,
            });
          }
          if (
            executionIdentity &&
            (!record.executionIdentity ||
              stableJson(record.executionIdentity) !== stableJson(executionIdentity))
          ) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The durable AI execution identity does not match the routed identity.',
              module: 'stage4.ai-provider',
              operation: 'verify-durable-execution-identity',
              correlationId: envelope.correlationId,
            });
          }
          if (
            record.provider !== activeAdapter.identity.provider ||
            record.model !== activeAdapter.identity.model
          ) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The durable AI provider route does not match the current route.',
              module: 'stage4.ai-provider',
              operation: 'verify-durable-provider-route',
              correlationId: envelope.correlationId,
            });
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
            if (context.signal.aborted) {
              await markCancellationAndThrow(claimed.attempt.attemptId);
            }
            try {
              const request = {
                systemInstruction,
                prompt: promptFor(payload),
                responseSchema: candidateBatchSchema,
                ...(candidateMaxOutputTokens === undefined
                  ? {}
                  : { maxOutputTokens: candidateMaxOutputTokens }),
              };
              response = await (activeAdapter.generateStructuredWithSignal
                ? activeAdapter.generateStructuredWithSignal(request, context.signal)
                : activeAdapter.generateStructured(request));
            } catch (error) {
              if (context.signal.aborted) {
                await markCancellationAndThrow(claimed.attempt.attemptId);
              }
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

            if (context.signal.aborted) {
              await markCancellationAndThrow(claimed.attempt.attemptId);
            }

            const inputTokens = response.inputTokens ?? 0;
            const outputTokens = response.outputTokens ?? 0;
            const draft = {
              outputId: randomUUID(),
              projectId,
              callId: record.callId,
              attemptId: claimed.attempt.attemptId,
              envelopeVersion: 'ai-provider-output-v1' as const,
              provider: activeAdapter.identity.provider,
              adapterVersion: activeAdapter.identity.adapterVersion,
              model: activeAdapter.identity.model,
              schemaName: payload.schemaName,
              schemaVersion: '1.0.0' as const,
              promptVersion,
              policyVersion: payload.policyVersion,
              dataPolicyVersion: activeAdapter.identity
                .dataPolicyVersion as AIProviderCall['dataPolicyVersion'],
              rawText: response.rawText,
              requestDigest: durableRequestDigest,
              inputSnapshotDigest,
              providerResponseId: response.providerResponseId,
              modelVersion: response.modelVersion ?? activeAdapter.identity.model,
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
              if (context.signal.aborted) {
                await markCancellationAndThrow(claimed.attempt.attemptId);
              }
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

            if (context.signal.aborted) {
              await markCancellationAndThrow(claimed.attempt.attemptId);
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
              provider: activeAdapter.identity.provider,
              adapterVersion: activeAdapter.identity.adapterVersion,
              model: activeAdapter.identity.model,
              modelVersion: draft.modelVersion,
              promptVersion,
              policyVersion: payload.policyVersion,
              dataPolicyVersion: activeAdapter.identity
                .dataPolicyVersion as AIProviderCall['dataPolicyVersion'],
              dataClassification: payload.dataClassification,
              inputEvidenceIds: record.inputEvidenceIds,
              usage: draft.usage,
              cost: draft.cost,
              attempts: succeeded,
              structuredOutputValid: true,
              ...(executionIdentity === undefined ? {} : { executionIdentity }),
              createdAt: record.createdAt,
            };

            let accepted: AIProviderExecutionRecord;
            try {
              if (context.signal.aborted) {
                await markCancellationAndThrow(claimed.attempt.attemptId);
              }
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
