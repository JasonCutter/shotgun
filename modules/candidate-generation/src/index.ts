import { randomUUID } from 'node:crypto';

import candidateGeneratedSchema from '../../../packages/contracts/schemas/candidate-generated.v1.schema.json';
import candidateValidationEventSchema from '../../../packages/contracts/schemas/candidate-validation-event.v1.schema.json';
import claimCandidateSchema from '../../../packages/contracts/schemas/claim-candidate.v1.schema.json';
import evidenceIndexedSchema from '../../../packages/contracts/schemas/evidence-indexed.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import generateStructuredOutputSchema from '../../../packages/contracts/schemas/generate-structured-output.v1.schema.json';
import generateStructuredSchema from '../../../packages/contracts/schemas/generate-structured.v1.schema.json';
import getClaimCandidateSchema from '../../../packages/contracts/schemas/get-claim-candidate.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import listClaimCandidatesOutputSchema from '../../../packages/contracts/schemas/list-claim-candidates-output.v1.schema.json';
import listClaimCandidatesSchema from '../../../packages/contracts/schemas/list-claim-candidates.v1.schema.json';
import listEvidenceSpansOutputSchema from '../../../packages/contracts/schemas/list-evidence-spans-output.v1.schema.json';
import listEvidenceSpansSchema from '../../../packages/contracts/schemas/list-evidence-spans.v1.schema.json';
import {
  type AIProviderCall,
  type ClaimCandidate,
  type ClaimCandidateStatus,
  type EventEnvelope,
  type EvidenceSpan,
  type GeneratedClaim,
  type QueryEnvelope,
  sha256Text,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type CandidateBatch = {
  readonly batchId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly idempotencyKey: string;
  readonly providerCall: AIProviderCall;
  readonly candidates: readonly ClaimCandidate[];
  readonly createdAt: string;
};

export type CandidateRepositoryPort = {
  saveBatch(batch: CandidateBatch): Promise<CandidateBatch>;
  findBatchByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CandidateBatch | undefined>;
  findById(projectId: string, candidateId: string): Promise<ClaimCandidate | undefined>;
  listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly ClaimCandidate[]>;
  updateStatus(
    projectId: string,
    candidateId: string,
    status: Extract<ClaimCandidateStatus, 'READY' | 'REJECTED'>,
  ): Promise<void>;
};

type EvidenceIndexedPayload = {
  readonly sourceVersionId: string;
};

type EvidenceSummary = {
  readonly evidenceId: string;
  readonly nodeKind: string;
};

type GeneratedOutput = {
  readonly call: AIProviderCall;
  readonly candidates: readonly GeneratedClaim[];
};

const assertContext = (envelope: EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Candidate access requires complete security context.',
      module: 'stage4.candidate-generation',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    security: envelope.security,
  };
};

const assertScope = (
  candidate: ClaimCandidate,
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (candidate.accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Claim Candidate.',
      module: 'stage4.candidate-generation',
      operation: 'read-candidate',
      correlationId,
    });
  }
};

const batchKey = (projectId: string, sourceVersionId: string) =>
  `${projectId}:${sourceVersionId}:candidate-extraction:direct-claim-v1:direct-only-v1`;

const publishGenerated = async (
  context: Parameters<NonNullable<ShotgunModule['handlers']['events'][number]['handle']>>[1],
  batch: CandidateBatch,
) => {
  await context.publish({
    messageType: 'CandidateGenerated',
    schemaVersion: '1.0.0',
    idempotencyKey: `candidate-generated:${batch.projectId}:${batch.batchId}`,
    payload: {
      batchId: batch.batchId,
      sourceVersionId: batch.sourceVersionId,
      candidateIds: batch.candidates.map((candidate) => candidate.candidateId),
      providerCallId: batch.providerCall.callId,
      candidateCount: batch.candidates.length,
    },
  });
};

export const createCandidateGenerationModule = (
  repository: CandidateRepositoryPort,
): ShotgunModule => ({
  manifest: {
    id: 'stage4.candidate-generation',
    version: '1.0.0',
    owner: 'Shotgun Candidate Generation',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' },
        { name: 'ListEvidenceSpans', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
        { name: 'GenerateStructured', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
        { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
        { name: 'ListClaimCandidates', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['candidate.batches', 'candidate.claim_candidates'],
      readsViaPorts: ['Evidence queries', 'GenerateStructured query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [
        { name: 'EvidenceIndexed', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
      ],
    },
    produces: {
      events: [{ name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' }],
    },
    provides: {
      queries: [
        { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
        { name: 'ListClaimCandidates', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'claim-candidate-provider', priority: 100 }],
    },
    requires: {
      capabilities: ['evidence-resolver', 'structured-ai-provider'],
    },
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
      name: 'EvidenceIndexed',
      version: '1.0.0',
      kind: 'event',
      inputSchema: evidenceIndexedSchema,
    },
    {
      name: 'ListEvidenceSpans',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listEvidenceSpansSchema,
      outputSchema: listEvidenceSpansOutputSchema,
    },
    {
      name: 'GetEvidenceSpan',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getEvidenceSpanSchema,
      outputSchema: evidenceSpanSchema,
    },
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
      inputSchema: candidateGeneratedSchema,
    },
    {
      name: 'CandidateValidated',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateValidationEventSchema,
    },
    {
      name: 'CandidateRejected',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateValidationEventSchema,
    },
    {
      name: 'GetClaimCandidate',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getClaimCandidateSchema,
      outputSchema: claimCandidateSchema,
    },
    {
      name: 'ListClaimCandidates',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listClaimCandidatesSchema,
      outputSchema: listClaimCandidatesOutputSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'EvidenceIndexed',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const payload = envelope.payload as EvidenceIndexedPayload;
          const { projectId, security } = assertContext(envelope);
          const idempotencyKey = batchKey(projectId, payload.sourceVersionId);
          const existing = await repository.findBatchByIdempotencyKey(projectId, idempotencyKey);
          if (existing) {
            await publishGenerated(context, existing);
            return;
          }

          const summaries = (
            await context.query<{ sourceVersionId: string }, { items: readonly EvidenceSummary[] }>(
              {
                messageType: 'ListEvidenceSpans',
                schemaVersion: '1.0.0',
                payload: { sourceVersionId: payload.sourceVersionId },
              },
            )
          ).payload.items.filter((item) => item.nodeKind === 'sentence');
          const evidence = await Promise.all(
            summaries.map(
              async (summary) =>
                (
                  await context.query<{ evidenceId: string }, EvidenceSpan>({
                    messageType: 'GetEvidenceSpan',
                    schemaVersion: '1.0.0',
                    payload: { evidenceId: summary.evidenceId },
                  })
                ).payload,
            ),
          );
          if (evidence.length === 0) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Direct claim extraction requires sentence Evidence Spans.',
              module: 'stage4.candidate-generation',
              operation: 'load-evidence',
              correlationId: envelope.correlationId,
            });
          }

          const generated = (
            await context.query<
              {
                requestId: string;
                taskProfile: 'candidate-extraction';
                schemaName: 'ClaimCandidateBatch.v1';
                policyVersion: 'direct-only-v1';
                dataClassification: string;
                evidence: readonly { evidenceId: string; text: string }[];
              },
              GeneratedOutput
            >({
              messageType: 'GenerateStructured',
              schemaVersion: '1.0.0',
              payload: {
                requestId: idempotencyKey,
                taskProfile: 'candidate-extraction',
                schemaName: 'ClaimCandidateBatch.v1',
                policyVersion: 'direct-only-v1',
                dataClassification: security.dataClassification,
                evidence: evidence.map((item) => ({
                  evidenceId: item.evidenceId,
                  text: item.quote.exact,
                })),
              },
            })
          ).payload;

          const allowedEvidence = new Set(evidence.map((item) => item.evidenceId));
          const seen = new Set<string>();
          const candidates = generated.candidates.flatMap((item): ClaimCandidate[] => {
            if (!allowedEvidence.has(item.evidenceId)) {
              throw new ShotgunError({
                code: 'VALIDATION_ERROR',
                safeMessage: 'AI output referred to evidence outside the request.',
                module: 'stage4.candidate-generation',
                operation: 'create-candidate',
                correlationId: envelope.correlationId,
              });
            }
            const claimText = item.claimText.trim();
            const fingerprint = sha256Text(stableJson({ claimText, evidenceId: item.evidenceId }));
            if (!claimText || seen.has(fingerprint)) {
              return [];
            }
            seen.add(fingerprint);
            return [
              {
                candidateId: randomUUID(),
                batchId: '',
                revisionNumber: 1,
                projectId,
                sourceVersionId: payload.sourceVersionId,
                claimText,
                evidenceIds: [item.evidenceId],
                evidenceMode: 'DIRECT_EVIDENCE',
                extractionProfile: 'direct-only',
                status: 'PENDING_VALIDATION',
                providerCall: generated.call,
                accessScope: [...security.accessScope],
                sensitivity: security.sensitivity,
                createdAt: envelope.createdAt,
              },
            ];
          });
          const batchId = randomUUID();
          const batch = await repository.saveBatch({
            batchId,
            projectId,
            sourceVersionId: payload.sourceVersionId,
            idempotencyKey,
            providerCall: generated.call,
            candidates: candidates.map((candidate) => ({ ...candidate, batchId })),
            createdAt: envelope.createdAt,
          });
          await publishGenerated(context, batch);
        },
      },
      {
        messageType: 'CandidateValidated',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as { readonly candidateId: string };
          await repository.updateStatus(projectId, payload.candidateId, 'READY');
        },
      },
      {
        messageType: 'CandidateRejected',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as { readonly candidateId: string };
          await repository.updateStatus(projectId, payload.candidateId, 'REJECTED');
        },
      },
    ],
    queries: [
      {
        messageType: 'GetClaimCandidate',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly candidateId: string };
          const candidate = await repository.findById(projectId, payload.candidateId);
          if (!candidate) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Claim Candidate was not found.',
              module: 'stage4.candidate-generation',
              operation: 'get-candidate',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(candidate, security.accessScope, envelope.correlationId);
          return candidate;
        },
      },
      {
        messageType: 'ListClaimCandidates',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly sourceVersionId: string };
          const items = await repository.listBySourceVersion(projectId, payload.sourceVersionId);
          items.forEach((candidate) =>
            assertScope(candidate, security.accessScope, envelope.correlationId),
          );
          return { items };
        },
      },
    ],
  },
});
