import { randomUUID } from 'node:crypto';

import candidateValidatedSchema from '../../../packages/contracts/schemas/candidate-validation-event.v1.schema.json';
import checkComparisonFreshnessOutputSchema from '../../../packages/contracts/schemas/check-comparison-freshness-output.v1.schema.json';
import checkComparisonFreshnessSchema from '../../../packages/contracts/schemas/check-comparison-freshness.v1.schema.json';
import claimCandidateSchema from '../../../packages/contracts/schemas/claim-candidate.v1.schema.json';
import comparisonCompletedSchema from '../../../packages/contracts/schemas/comparison-completed.v1.schema.json';
import comparisonResultSchema from '../../../packages/contracts/schemas/comparison-result.v1.schema.json';
import getClaimCandidateSchema from '../../../packages/contracts/schemas/get-claim-candidate.v1.schema.json';
import getComparisonResultSchema from '../../../packages/contracts/schemas/get-comparison-result.v1.schema.json';
import {
  canonicalSnapshotDigest,
  claimCandidateDigest,
  type CanonicalSnapshot,
  type CanonicalSnapshotClaim,
  type ClaimCandidate,
  type ComparisonResult,
  type EventEnvelope,
  type AIExecutionIdentity,
  type QueryEnvelope,
  type SecurityContext,
  sha256Text,
  stableJson,
  ShotgunError,
  type TextDiffSegment,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export * from './persistence-v2.js';
export * from './shortlist-v2.js';
export * from './semantic-analysis-v2.js';
export * from './orchestration-v2.js';

export type CanonicalSnapshotPort = {
  getSnapshot(projectId: string): Promise<CanonicalSnapshot>;
};

/** Minimal local ports keep Comparison decoupled from the AI provider module. */
export type StructuredGenerationRequest = {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema: Record<string, unknown>;
};

export type StructuredGenerationResponse = {
  readonly rawText: string;
  readonly providerResponseId?: string;
};

export type AIProviderAdapterPort = {
  readonly identity: {
    readonly provider: string;
    readonly model: string;
  };
  generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResponse>;
};

export type AIProviderExecutionResolverPort = {
  resolve(input: {
    readonly projectId: string;
    readonly requestId: string;
    readonly sourceVersionId: string;
    readonly dataClassification: string;
    readonly accessScope: readonly string[];
    readonly sensitivity: SecurityContext['sensitivity'];
  }): Promise<{
    readonly adapter: AIProviderAdapterPort;
    readonly executionIdentity: AIExecutionIdentity;
  }>;
};

export type TextDiffPort = {
  readonly identity: {
    readonly id: string;
    readonly version: string;
  };
  diff(previous: string, next: string): readonly TextDiffSegment[];
};

export type ComparisonRepositoryPort = {
  save(result: ComparisonResult): Promise<ComparisonResult>;
  findById(projectId: string, comparisonId: string): Promise<ComparisonResult | undefined>;
  findByCandidateAndSnapshot(
    projectId: string,
    candidateId: string,
    snapshotDigest: string,
  ): Promise<ComparisonResult | undefined>;
};

const normalizeClaim = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');

const similarity = (diff: readonly TextDiffSegment[], previous: string, next: string): number => {
  const denominator = Math.max(previous.length, next.length, 1);
  const equalLength = diff
    .filter((segment) => segment.type === 'equal')
    .reduce((sum, segment) => sum + segment.value.length, 0);
  return Math.min(1, equalLength / denominator);
};

const assertSnapshot = (snapshot: CanonicalSnapshot, projectId: string): void => {
  if (
    snapshot.projectId !== projectId ||
    snapshot.version < 0 ||
    snapshot.digest !==
      canonicalSnapshotDigest(projectId, snapshot.version, snapshot.claims, snapshot.relations)
  ) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Canonical Snapshot identity or digest is invalid.',
      module: 'stage5.comparison',
      operation: 'validate-canonical-snapshot',
    });
  }
};

const assertContext = (envelope: EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Comparison access requires complete security context.',
      module: 'stage5.comparison',
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
  result: ComparisonResult,
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (result.accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Comparison Result.',
      module: 'stage5.comparison',
      operation: 'read-comparison',
      correlationId,
    });
  }
};

const bestMatch = (
  claims: readonly CanonicalSnapshotClaim[],
  candidate: ClaimCandidate,
  textDiff: TextDiffPort,
) => {
  const exact = claims.find(
    (claim) => normalizeClaim(claim.text) === normalizeClaim(candidate.claimText),
  );
  if (exact) {
    return {
      claim: exact,
      diff: textDiff.diff(exact.text, candidate.claimText),
      similarity: 1,
      classification: 'EXACT_DUPLICATE' as const,
    };
  }

  const ranked = claims
    .map((claim) => {
      const diff = textDiff.diff(claim.text, candidate.claimText);
      return { claim, diff, similarity: similarity(diff, claim.text, candidate.claimText) };
    })
    .sort((left, right) => right.similarity - left.similarity);
  const closest = ranked[0];
  if (closest && closest.similarity >= 0.6) {
    return {
      ...closest,
      classification: 'POSSIBLE_CONFLICT' as const,
    };
  }
  return {
    claim: undefined,
    diff: textDiff.diff('', candidate.claimText),
    similarity: 0,
    classification: 'NEW_CLAIM' as const,
  };
};

export const createComparisonModule = (
  repository: ComparisonRepositoryPort,
  snapshotProvider: CanonicalSnapshotPort,
  textDiff: TextDiffPort,
): ShotgunModule => ({
  manifest: {
    id: 'stage5.comparison',
    version: '1.0.0',
    owner: 'Shotgun Comparison',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' },
        { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
        { name: 'ComparisonCompleted', range: '>=1.0.0 <2.0.0' },
        { name: 'GetComparisonResult', range: '>=1.0.0 <2.0.0' },
        { name: 'CheckComparisonFreshness', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [
        'comparison.results',
        'comparison.results_v2',
        'comparison.analysis_revisions_v2',
        'comparison.relationships_v2',
      ],
      readsViaPorts: [
        'CanonicalSnapshotPort',
        'TextDiffPort',
        'LexicalRetrieverPort',
        'HybridRetrievalCoordinatorPort',
        'SemanticActiveGenerationReaderPort',
        'KnowledgeResourceResolverPort',
        'AIProviderExecutionResolverPort',
        'AIProviderAdapterPort',
        'GetClaimCandidate query',
      ],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'CandidateValidated', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [{ name: 'ComparisonCompleted', range: '>=1.0.0 <2.0.0' }],
      handoffs: [
        {
          event: { name: 'ComparisonCompleted', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage5.change-set-review' },
          tags: ['REQUIRED_ACK'],
        },
      ],
    },
    provides: {
      queries: [
        { name: 'GetComparisonResult', range: '>=1.0.0 <2.0.0' },
        { name: 'CheckComparisonFreshness', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'claim-comparison-provider', priority: 100 }],
    },
    requires: { capabilities: ['claim-candidate-provider'] },
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
      name: 'CandidateValidated',
      version: '1.0.0',
      kind: 'event',
      inputSchema: candidateValidatedSchema,
    },
    {
      name: 'GetClaimCandidate',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getClaimCandidateSchema,
      outputSchema: claimCandidateSchema,
    },
    {
      name: 'ComparisonCompleted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: comparisonCompletedSchema,
    },
    {
      name: 'GetComparisonResult',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getComparisonResultSchema,
      outputSchema: comparisonResultSchema,
    },
    {
      name: 'CheckComparisonFreshness',
      version: '1.0.0',
      kind: 'query',
      inputSchema: checkComparisonFreshnessSchema,
      outputSchema: checkComparisonFreshnessOutputSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'CandidateValidated',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        requiredForPublisherAcknowledgement: true,
        async handle(envelope, context) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly candidateId: string };
          const candidate = (
            await context.query<{ candidateId: string }, ClaimCandidate>({
              messageType: 'GetClaimCandidate',
              schemaVersion: '1.0.0',
              payload: { candidateId: payload.candidateId },
            })
          ).payload;
          if (candidate.status !== 'READY') {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Only READY Claim Candidates can be compared.',
              module: 'stage5.comparison',
              operation: 'compare-candidate',
              correlationId: envelope.correlationId,
            });
          }
          const snapshot = await snapshotProvider.getSnapshot(projectId);
          assertSnapshot(snapshot, projectId);
          const existing = await repository.findByCandidateAndSnapshot(
            projectId,
            candidate.candidateId,
            snapshot.digest,
          );
          const result =
            existing ??
            (await (async () => {
              const match = bestMatch(snapshot.claims, candidate, textDiff);
              const diffDigest = sha256Text(stableJson(match.diff));
              return repository.save({
                comparisonId: randomUUID(),
                projectId,
                sourceVersionId: candidate.sourceVersionId,
                candidateId: candidate.candidateId,
                candidateRevisionNumber: candidate.revisionNumber,
                candidateDigest: claimCandidateDigest(candidate),
                snapshotId: snapshot.snapshotId,
                snapshotVersion: snapshot.version,
                snapshotDigest: snapshot.digest,
                classification: match.classification,
                matchedClaim: match.claim,
                similarity: match.similarity,
                diff: match.diff,
                diffDigest,
                recommendation: match.classification === 'EXACT_DUPLICATE' ? 'NO_OP' : 'ADD_CLAIM',
                accessScope: [...security.accessScope],
                sensitivity: security.sensitivity,
                createdAt: envelope.createdAt,
              });
            })());
          await context.publish({
            messageType: 'ComparisonCompleted',
            schemaVersion: '1.0.0',
            idempotencyKey: `comparison-completed:${projectId}:${result.comparisonId}`,
            payload: {
              comparisonId: result.comparisonId,
              candidateId: result.candidateId,
              sourceVersionId: result.sourceVersionId,
              classification: result.classification,
              snapshotVersion: result.snapshotVersion,
              snapshotDigest: result.snapshotDigest,
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'GetComparisonResult',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly comparisonId: string };
          const result = await repository.findById(projectId, payload.comparisonId);
          if (!result) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Comparison Result was not found.',
              module: 'stage5.comparison',
              operation: 'get-comparison-result',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(result, security.accessScope, envelope.correlationId);
          return result;
        },
      },
      {
        messageType: 'CheckComparisonFreshness',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly comparisonId: string };
          const result = await repository.findById(projectId, payload.comparisonId);
          if (!result) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Comparison Result was not found.',
              module: 'stage5.comparison',
              operation: 'check-comparison-freshness',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(result, security.accessScope, envelope.correlationId);
          const candidate = (
            await context.query<{ candidateId: string }, ClaimCandidate>({
              messageType: 'GetClaimCandidate',
              schemaVersion: '1.0.0',
              payload: { candidateId: result.candidateId },
            })
          ).payload;
          const snapshot = await snapshotProvider.getSnapshot(projectId);
          assertSnapshot(snapshot, projectId);
          const candidateChanged = claimCandidateDigest(candidate) !== result.candidateDigest;
          const snapshotChanged =
            snapshot.version !== result.snapshotVersion ||
            snapshot.digest !== result.snapshotDigest;
          return {
            fresh: !candidateChanged && !snapshotChanged,
            reason: candidateChanged
              ? 'The Claim Candidate changed after comparison.'
              : snapshotChanged
                ? 'The Canonical Snapshot changed after comparison.'
                : undefined,
            currentSnapshotVersion: snapshot.version,
            currentSnapshotDigest: snapshot.digest,
          };
        },
      },
    ],
  },
});
