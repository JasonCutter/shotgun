import { randomUUID } from 'node:crypto';

import candidateGeneratedSchema from '../../../packages/contracts/schemas/candidate-generated.v1.schema.json';
import candidateValidationEventSchema from '../../../packages/contracts/schemas/candidate-validation-event.v1.schema.json';
import claimCandidateSchema from '../../../packages/contracts/schemas/claim-candidate.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import getClaimCandidateSchema from '../../../packages/contracts/schemas/get-claim-candidate.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import getValidationResultSchema from '../../../packages/contracts/schemas/get-validation-result.v1.schema.json';
import validationResultSchema from '../../../packages/contracts/schemas/validation-result.v1.schema.json';
import {
  type ClaimCandidate,
  type EventEnvelope,
  type EvidenceSpan,
  type QueryEnvelope,
  type ValidationDimension,
  type ValidationResult,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type ValidationRepositoryPort = {
  save(result: ValidationResult): Promise<ValidationResult>;
  findByCandidateId(projectId: string, candidateId: string): Promise<ValidationResult | undefined>;
  findByValidationId(
    projectId: string,
    validationId: string,
  ): Promise<ValidationResult | undefined>;
};

type CandidateGeneratedPayload = {
  readonly candidateIds: readonly string[];
};

const assertContext = (envelope: EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Validation access requires complete security context.',
      module: 'stage4.validation',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return { projectId: envelope.projectId };
};

const validateCandidate = (
  candidate: ClaimCandidate,
  evidence: EvidenceSpan,
): readonly ValidationDimension[] => [
  {
    name: 'schema',
    status: candidate.providerCall.structuredOutputValid ? 'PASS' : 'FAIL',
    reason: candidate.providerCall.structuredOutputValid
      ? undefined
      : 'Provider structured output was not validated.',
  },
  {
    name: 'evidence-reference',
    status:
      candidate.evidenceIds[0] === evidence.evidenceId &&
      candidate.sourceVersionId === evidence.sourceVersionId &&
      evidence.origin === 'source'
        ? 'PASS'
        : 'FAIL',
    reason:
      candidate.evidenceIds[0] === evidence.evidenceId &&
      candidate.sourceVersionId === evidence.sourceVersionId &&
      evidence.origin === 'source'
        ? undefined
        : 'Evidence does not belong to the candidate SourceVersion.',
  },
  {
    name: 'direct-text',
    status: evidence.quote.exact.includes(candidate.claimText) ? 'PASS' : 'FAIL',
    reason: evidence.quote.exact.includes(candidate.claimText)
      ? undefined
      : 'Claim text is not an exact contiguous substring of the evidence.',
  },
  {
    name: 'policy',
    status:
      candidate.evidenceMode === 'DIRECT_EVIDENCE' && candidate.extractionProfile === 'direct-only'
        ? 'PASS'
        : 'FAIL',
    reason:
      candidate.evidenceMode === 'DIRECT_EVIDENCE' && candidate.extractionProfile === 'direct-only'
        ? undefined
        : 'The default Stage 4 profile allows direct evidence only.',
  },
  {
    name: 'semantic',
    status: 'NOT_RUN',
    reason: 'Semantic inference validation is disabled in the direct-only MVP profile.',
  },
];

export const createValidationModule = (repository: ValidationRepositoryPort): ShotgunModule => ({
  manifest: {
    id: 'stage4.validation',
    version: '1.0.0',
    owner: 'Shotgun Validation',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' },
        { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
        { name: 'GetValidationResult', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['validation.results'],
      readsViaPorts: ['GetClaimCandidate query', 'GetEvidenceSpan query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'CandidateGenerated', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [
        { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
        { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
      ],
      handoffs: [
        {
          event: { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage4.candidate-generation' },
          tags: ['REQUIRED_ACK'],
        },
        {
          event: { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage5.comparison' },
          tags: ['REQUIRED_ACK'],
        },
        {
          event: { name: 'CandidateRejected', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage4.candidate-generation' },
          tags: ['REQUIRED_ACK'],
        },
      ],
    },
    provides: {
      queries: [{ name: 'GetValidationResult', range: '>=1.0.0 <2.0.0' }],
      capabilities: [{ name: 'candidate-validation-provider', priority: 100 }],
    },
    requires: {
      capabilities: ['claim-candidate-provider', 'evidence-resolver'],
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
      name: 'CandidateGenerated',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateGeneratedSchema,
    },
    {
      name: 'GetClaimCandidate',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getClaimCandidateSchema,
      outputSchema: claimCandidateSchema,
    },
    {
      name: 'GetEvidenceSpan',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getEvidenceSpanSchema,
      outputSchema: evidenceSpanSchema,
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
      name: 'GetValidationResult',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getValidationResultSchema,
      outputSchema: validationResultSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'CandidateGenerated',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        requiredForPublisherAcknowledgement: true,
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as CandidateGeneratedPayload;
          for (const candidateId of payload.candidateIds) {
            const existing = await repository.findByCandidateId(projectId, candidateId);
            if (existing) {
              await context.publish({
                messageType:
                  existing.status === 'READY' ? 'CandidateValidated' : 'CandidateRejected',
                schemaVersion: '1.0.0',
                idempotencyKey: `candidate-validation:${projectId}:${existing.validationId}`,
                payload: {
                  candidateId,
                  validationId: existing.validationId,
                  sourceVersionId: existing.sourceVersionId,
                  status: existing.status,
                },
              });
              continue;
            }

            const candidate = (
              await context.query<{ candidateId: string }, ClaimCandidate>({
                messageType: 'GetClaimCandidate',
                schemaVersion: '1.0.0',
                payload: { candidateId },
              })
            ).payload;
            const evidence = (
              await context.query<{ evidenceId: string }, EvidenceSpan>({
                messageType: 'GetEvidenceSpan',
                schemaVersion: '1.0.0',
                payload: { evidenceId: candidate.evidenceIds[0] },
              })
            ).payload;
            const dimensions = validateCandidate(candidate, evidence);
            const status = dimensions.some((dimension) => dimension.status === 'FAIL')
              ? 'REJECTED'
              : 'READY';
            const saved = await repository.save({
              validationId: randomUUID(),
              candidateId,
              revisionNumber: 1,
              projectId,
              sourceVersionId: candidate.sourceVersionId,
              status,
              dimensions,
              createdAt: envelope.createdAt,
            });
            await context.publish({
              messageType: status === 'READY' ? 'CandidateValidated' : 'CandidateRejected',
              schemaVersion: '1.0.0',
              idempotencyKey: `candidate-validation:${projectId}:${saved.validationId}`,
              payload: {
                candidateId,
                validationId: saved.validationId,
                sourceVersionId: saved.sourceVersionId,
                status,
              },
            });
          }
        },
      },
    ],
    queries: [
      {
        messageType: 'GetValidationResult',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as { readonly candidateId: string };
          const result = await repository.findByCandidateId(projectId, payload.candidateId);
          if (!result) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Validation Result was not found.',
              module: 'stage4.validation',
              operation: 'get-validation-result',
              correlationId: envelope.correlationId,
            });
          }
          return result;
        },
      },
    ],
  },
});
