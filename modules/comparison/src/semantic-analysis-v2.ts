import { randomUUID } from 'node:crypto';

import type {
  AIProviderExecutionResolverPort,
  AIProviderAdapterPort,
  StructuredGenerationRequest,
} from '../../ai-provider/src/index.js';
import {
  COMPARISON_V2_CONTRACT_VERSION,
  analysisInputDigestV2,
  canonicalSnapshotDigest,
  deriveAuthorizedSensitivities,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  shortlistAuditDigestV2,
  stableJson,
  validateAnalysisRevisionV2,
  validateSemanticRelationshipV2,
  validateShortlistAuditV2,
  type Actor,
  type AIExecutionIdentity,
  type AnalysisRevisionV2,
  type CanonicalSnapshot,
  type CanonicalSnapshotIdentityV2,
  type ComparisonCandidateV2,
  type ComparisonDigestV2,
  type SemanticConflictKindV2,
  type SemanticRelationshipTypeV2,
  type SemanticRelationshipV2,
  type SecurityContext,
  type ShortlistAuditV2,
  type KnowledgeResourceContent,
  type KnowledgeResourceResolverPort,
  toShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { CanonicalSnapshotPort } from './index.js';

export const COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2 =
  'comparison-semantic-analysis:v1' as const;
export const COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2 =
  'comparison-semantic-analysis-prompt:v1' as const;
export const COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2 =
  'comparison-semantic-analysis-schema:v1' as const;
export const COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2 =
  'comparison-semantic-analysis-policy:v1' as const;

type ModelRelationshipTypeV2 = Exclude<SemanticRelationshipTypeV2, 'POLICY_BLOCKED'>;

const MODEL_RELATIONSHIP_TYPES = new Set<ModelRelationshipTypeV2>([
  'SEMANTIC_DUPLICATE',
  'SUPPORTS',
  'REFINES',
  'NARROWS',
  'BROADENS',
  'UPDATES',
  'SUPERSEDES',
  'CONTRADICTS',
  'TEMPORALLY_COEXISTS',
  'AMBIGUOUS',
  'UNRELATED',
]);

const CONFLICT_KINDS = new Set<SemanticConflictKindV2>([
  'DIRECT_NEGATION',
  'QUANTITATIVE_VALUE',
  'SCOPE',
  'TEMPORAL',
  'DEFINITION_TERM',
  'ENTITY_IDENTITY',
  'SOURCE_OBSERVATION',
  'POLICY',
]);

const MODEL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relationships'],
  properties: {
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['resourceId', 'resourceRevision', 'type', 'rationale'],
        properties: {
          resourceId: { type: 'string', minLength: 1 },
          resourceRevision: { type: 'integer', minimum: 1 },
          type: { enum: [...MODEL_RELATIONSHIP_TYPES] },
          conflictKind: { enum: [...CONFLICT_KINDS] },
          rationale: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;

const SYSTEM_INSTRUCTION = [
  'Classify the semantic relationship between the supplied Candidate and each supplied Canonical Claim.',
  'Return exactly one relationship for every supplied Claim and no other target.',
  'Use only the allowed relationship types. NEW is not a relationship type.',
  'CONTRADICTS requires a valid conflictKind; all other types must omit conflictKind.',
  'Keep rationale concise and grounded only in the supplied texts.',
].join(' ');

export type ComparisonSemanticAnalysisV2Request = {
  readonly projectId: string;
  readonly comparisonId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly candidateText: string;
  readonly shortlist: ShortlistAuditV2;
  readonly shortlistDigest: ComparisonDigestV2;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly attempt: number;
};

export type ComparisonSemanticAnalysisV2BlockedReason =
  | 'INVALID_REQUEST'
  | 'POLICY_BLOCKED'
  | 'SEMANTIC_UNAVAILABLE'
  | 'SHORTLIST_INTEGRITY'
  | 'SNAPSHOT_MISMATCH'
  | 'RESOURCE_SCOPE_LEAK'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_REVISION_MISMATCH'
  | 'RESOURCE_ACCESS_REVOKED';

export type ComparisonSemanticAnalysisV2Outcome =
  | {
      readonly status: 'COMPLETED';
      readonly analysis: AnalysisRevisionV2;
      readonly relationships: readonly SemanticRelationshipV2[];
    }
  | {
      readonly status: 'FAILED';
      readonly analysis: AnalysisRevisionV2;
      readonly relationships: readonly [];
    }
  | {
      readonly status: 'BLOCKED';
      readonly reason: ComparisonSemanticAnalysisV2BlockedReason;
      readonly safeFailureCode:
        | 'POLICY_DENIED'
        | 'SEMANTIC_UNAVAILABLE'
        | 'STALE_COMPARISON'
        | 'RESOURCE_SCOPE_LEAK'
        | 'CONTRACT_FAILURE';
    };

type ComparisonSemanticAnalysisV2SafeFailureCode =
  | 'POLICY_DENIED'
  | 'SEMANTIC_UNAVAILABLE'
  | 'STALE_COMPARISON'
  | 'RESOURCE_SCOPE_LEAK'
  | 'CONTRACT_FAILURE';

export type ComparisonSemanticAnalysisV2Dependencies = {
  readonly executionResolver: AIProviderExecutionResolverPort;
  readonly canonicalSnapshot: CanonicalSnapshotPort;
  readonly resourceResolver: KnowledgeResourceResolverPort;
  readonly now?: () => string;
  readonly randomId?: () => string;
};

export type ComparisonSemanticAnalysisV2Port = {
  analyze(
    request: ComparisonSemanticAnalysisV2Request,
  ): Promise<ComparisonSemanticAnalysisV2Outcome>;
};

type ResolvedTarget = {
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly text: string;
  readonly content: KnowledgeResourceContent;
};

type ModelRelationship = {
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly type: ModelRelationshipTypeV2;
  readonly conflictKind?: SemanticConflictKindV2;
  readonly rationale: string;
};

const blocked = (
  reason: ComparisonSemanticAnalysisV2BlockedReason,
  safeFailureCode: ComparisonSemanticAnalysisV2SafeFailureCode,
): ComparisonSemanticAnalysisV2Outcome => ({ status: 'BLOCKED', reason, safeFailureCode });

const isNonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isScopeAllowed = (
  resourceScope: readonly string[] | undefined,
  callerScope: readonly string[],
) =>
  resourceScope !== undefined &&
  resourceScope.length > 0 &&
  resourceScope.every((scope) => callerScope.includes(scope));

const isSensitivityAllowed = (
  sensitivity: SecurityContext['sensitivity'] | undefined,
  allowed: readonly SecurityContext['sensitivity'][],
): boolean => sensitivity !== undefined && allowed.includes(sensitivity);

const snapshotIdentity = (snapshot: CanonicalSnapshot): CanonicalSnapshotIdentityV2 => ({
  id: snapshot.snapshotId,
  version: snapshot.version,
  digest: snapshot.digest,
});

const sameSnapshot = (
  left: CanonicalSnapshotIdentityV2,
  right: CanonicalSnapshotIdentityV2,
): boolean =>
  left.id === right.id && left.version === right.version && left.digest === right.digest;

const credentialRevisionRef = (identity: AIExecutionIdentity): string =>
  `${identity.credentialId}:revision:${identity.credentialRevision}`;

const isRetryableProviderCode = (code: string): boolean =>
  code === 'RETRYABLE_DEPENDENCY' ||
  code === 'TIMEOUT' ||
  code === 'RATE_LIMITED' ||
  code === 'OUTCOME_UNKNOWN' ||
  code === 'OUTCOME_INDETERMINATE';

const parseModelOutput = (rawText: string): readonly ModelRelationship[] => {
  const parsed: unknown = JSON.parse(rawText);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !('relationships' in parsed) ||
    !Array.isArray(parsed.relationships)
  ) {
    throw new Error('Structured output must contain a relationships array.');
  }

  return parsed.relationships.map((item: unknown, index: number) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`Relationship ${index} is not an object.`);
    }
    const value = item as Record<string, unknown>;
    const keys = Object.keys(value);
    if (
      keys.some(
        (key) =>
          !['resourceId', 'resourceRevision', 'type', 'conflictKind', 'rationale'].includes(key),
      )
    ) {
      throw new Error(`Relationship ${index} contains an unknown field.`);
    }
    const resourceRevision = value.resourceRevision;
    if (
      !isNonEmpty(value.resourceId) ||
      !Number.isInteger(resourceRevision) ||
      (resourceRevision as number) < 1
    ) {
      throw new Error(`Relationship ${index} has an invalid target identity.`);
    }
    if (
      typeof value.type !== 'string' ||
      !MODEL_RELATIONSHIP_TYPES.has(value.type as ModelRelationshipTypeV2)
    ) {
      throw new Error(`Relationship ${index} has an invalid relationship type.`);
    }
    if (!isNonEmpty(value.rationale) || value.rationale.length > 4000) {
      throw new Error(`Relationship ${index} has an invalid rationale.`);
    }
    if (value.type === 'CONTRADICTS') {
      if (
        typeof value.conflictKind !== 'string' ||
        !CONFLICT_KINDS.has(value.conflictKind as SemanticConflictKindV2)
      ) {
        throw new Error(`Relationship ${index} requires a valid conflictKind.`);
      }
    } else if (value.conflictKind !== undefined) {
      throw new Error(`Relationship ${index} must omit conflictKind.`);
    }
    return {
      resourceId: value.resourceId,
      resourceRevision: value.resourceRevision as number,
      type: value.type as ModelRelationshipTypeV2,
      ...(value.conflictKind === undefined
        ? {}
        : { conflictKind: value.conflictKind as SemanticConflictKindV2 }),
      rationale: value.rationale.trim(),
    };
  });
};

const modelOutputDigest = (rawText: string): ComparisonDigestV2 => sha256Text(rawText);

const materialDigest = (relationships: readonly ModelRelationship[]): ComparisonDigestV2 =>
  sha256Text(
    stableJson(
      [...relationships]
        .map((relationship) => ({
          resourceId: relationship.resourceId,
          resourceRevision: relationship.resourceRevision,
          type: relationship.type,
          ...(relationship.conflictKind === undefined
            ? {}
            : { conflictKind: relationship.conflictKind }),
          rationale: relationship.rationale,
        }))
        .sort((left, right) => {
          const a = `${left.resourceId}:${left.resourceRevision}`;
          const b = `${right.resourceId}:${right.resourceRevision}`;
          return a < b ? -1 : a > b ? 1 : 0;
        }),
    ),
  );

const promptFor = (input: {
  readonly candidate: ComparisonCandidateV2;
  readonly candidateText: string;
  readonly targets: readonly ResolvedTarget[];
}): string =>
  stableJson({
    candidate: {
      id: input.candidate.id,
      revision: input.candidate.revision,
      digest: input.candidate.digest,
      text: input.candidateText,
    },
    claims: input.targets.map((target) => ({
      resourceId: target.resourceId,
      resourceRevision: target.resourceRevision,
      text: target.text,
    })),
  });

const validateRequest = (request: ComparisonSemanticAnalysisV2Request): boolean =>
  isNonEmpty(request.projectId) &&
  isNonEmpty(request.comparisonId) &&
  isNonEmpty(request.candidate.id) &&
  request.candidate.revision >= 1 &&
  isNonEmpty(request.candidate.digest) &&
  isNonEmpty(request.candidate.sourceVersionId) &&
  request.candidate.evidenceIds.length > 0 &&
  isNonEmpty(request.candidateText) &&
  request.attempt >= 1 &&
  request.security.accessScope.length > 0 &&
  isNonEmpty(request.shortlistDigest) &&
  request.shortlist.selectedTargetIdentities.length > 0;

const executionErrorOutcome = (error: unknown): ComparisonSemanticAnalysisV2Outcome => {
  const normalized = toShotgunError(error, {
    code: 'AI_CAPABILITY_UNAVAILABLE',
    safeMessage: 'Comparison semantic analysis execution is unavailable.',
    module: 'stage5.comparison-semantic-analysis',
    operation: 'resolve-execution',
  });
  if (normalized.code === 'POLICY_DENIED' || normalized.code === 'CAPABILITY_DENIED') {
    return blocked('POLICY_BLOCKED', 'POLICY_DENIED');
  }
  return blocked('SEMANTIC_UNAVAILABLE', 'SEMANTIC_UNAVAILABLE');
};

export const createComparisonSemanticAnalysisV2 = (
  dependencies: ComparisonSemanticAnalysisV2Dependencies,
): ComparisonSemanticAnalysisV2Port => {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const nextId = dependencies.randomId ?? randomUUID;

  return {
    async analyze(request) {
      if (!validateRequest(request)) return blocked('INVALID_REQUEST', 'CONTRACT_FAILURE');

      try {
        validateShortlistAuditV2(request.shortlist);
      } catch {
        return blocked('SHORTLIST_INTEGRITY', 'STALE_COMPARISON');
      }
      if (
        request.shortlist.querySemanticReadiness !== 'READY' ||
        request.shortlist.coverageStatus !== 'COMPLETE' ||
        request.shortlist.truncated ||
        shortlistAuditDigestV2(request.shortlist) !== request.shortlistDigest
      ) {
        return blocked('SHORTLIST_INTEGRITY', 'STALE_COMPARISON');
      }

      const expectedSnapshot = request.shortlist.canonicalSnapshot;
      let snapshot: CanonicalSnapshot;
      try {
        snapshot = await dependencies.canonicalSnapshot.getSnapshot(request.projectId);
      } catch {
        return blocked('SNAPSHOT_MISMATCH', 'STALE_COMPARISON');
      }
      if (
        snapshot.projectId !== request.projectId ||
        snapshot.digest !==
          canonicalSnapshotDigest(
            snapshot.projectId,
            snapshot.version,
            snapshot.claims,
            snapshot.relations,
          ) ||
        !sameSnapshot(snapshotIdentity(snapshot), expectedSnapshot)
      ) {
        return blocked('SNAPSHOT_MISMATCH', 'STALE_COMPARISON');
      }

      const allowedSensitivities = deriveAuthorizedSensitivities(request.security.sensitivity);
      const targets: ResolvedTarget[] = [];
      for (const target of request.shortlist.selectedTargetIdentities) {
        if (target.resourceType !== 'CLAIM')
          return blocked('RESOURCE_SCOPE_LEAK', 'RESOURCE_SCOPE_LEAK');
        const snapshotClaim = snapshot.claims.find((claim) => claim.claimId === target.resourceId);
        if (!snapshotClaim) return blocked('RESOURCE_NOT_FOUND', 'STALE_COMPARISON');
        if (snapshotClaim.revisionNumber !== target.resourceRevision) {
          return blocked('RESOURCE_REVISION_MISMATCH', 'STALE_COMPARISON');
        }
        let resolved: KnowledgeResourceContent | undefined;
        try {
          resolved = await dependencies.resourceResolver.resolveResource(
            request.projectId,
            'CLAIM',
            target.resourceId,
            'CANONICAL',
          );
        } catch {
          return blocked('RESOURCE_NOT_FOUND', 'STALE_COMPARISON');
        }
        if (!resolved || resolved.text !== snapshotClaim.text) {
          return blocked('RESOURCE_NOT_FOUND', 'STALE_COMPARISON');
        }
        if (
          (resolved.authority !== undefined && resolved.authority !== 'CANONICAL') ||
          (resolved.authorityRevision !== undefined &&
            resolved.authorityRevision !== target.resourceRevision) ||
          (resolved.resourceRevision !== undefined &&
            resolved.resourceRevision !== target.resourceRevision) ||
          (resolved.canonicalVersion !== undefined &&
            resolved.canonicalVersion !== snapshot.version) ||
          (resolved.baseCanonicalVersion !== undefined &&
            resolved.baseCanonicalVersion !== snapshot.version) ||
          (resolved.sourceSnapshotDigest !== undefined &&
            resolved.sourceSnapshotDigest !== snapshot.digest)
        ) {
          return blocked('SNAPSHOT_MISMATCH', 'STALE_COMPARISON');
        }
        if (
          !isScopeAllowed(resolved.accessScope, request.security.accessScope) ||
          !isSensitivityAllowed(resolved.sensitivity, allowedSensitivities)
        ) {
          return blocked('RESOURCE_ACCESS_REVOKED', 'RESOURCE_SCOPE_LEAK');
        }
        targets.push({
          resourceId: target.resourceId,
          resourceRevision: target.resourceRevision,
          text: resolved.text,
          content: resolved,
        });
      }

      let resolution;
      try {
        resolution = await dependencies.executionResolver.resolve({
          projectId: request.projectId,
          requestId: request.comparisonId,
          sourceVersionId: request.candidate.sourceVersionId,
          dataClassification: request.security.dataClassification,
          accessScope: request.security.accessScope,
          sensitivity: request.security.sensitivity,
        });
      } catch (error) {
        return executionErrorOutcome(error);
      }

      const executionIdentity = resolution.executionIdentity;
      if (
        !isNonEmpty(executionIdentity.providerId) ||
        !isNonEmpty(executionIdentity.modelId) ||
        !isNonEmpty(executionIdentity.credentialId) ||
        executionIdentity.credentialRevision < 1 ||
        executionIdentity.providerId !== resolution.adapter.identity.provider ||
        executionIdentity.modelId !== resolution.adapter.identity.model
      ) {
        return blocked('SEMANTIC_UNAVAILABLE', 'SEMANTIC_UNAVAILABLE');
      }
      const providerIdentity = {
        providerId: executionIdentity.providerId,
        modelId: executionIdentity.modelId,
        capabilityId: COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2,
      };
      const comparedResourceIdentities = targets.map((target) => ({
        resourceType: 'CLAIM' as const,
        resourceId: target.resourceId,
        resourceRevision: target.resourceRevision,
      }));
      const inputDigest = analysisInputDigestV2({
        candidate: request.candidate,
        canonicalSnapshot: expectedSnapshot,
        shortlistDigest: request.shortlistDigest,
        comparedResourceIdentities,
        providerIdentity,
        credentialRevisionRef: credentialRevisionRef(executionIdentity),
        promptTemplateRevision: COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
        outputSchemaRevision: COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
        semanticPolicyRevision: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
      });
      const analysisRevisionId = nextId();
      const startedAt = now();
      const startedMillis = Date.now();
      const requestForProvider: StructuredGenerationRequest = {
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: promptFor({
          candidate: request.candidate,
          candidateText: request.candidateText,
          targets,
        }),
        responseSchema: MODEL_OUTPUT_SCHEMA,
      };

      let response: Awaited<ReturnType<AIProviderAdapterPort['generateStructured']>>;
      try {
        response = await resolution.adapter.generateStructured(requestForProvider);
      } catch (error) {
        const normalized = toShotgunError(error, {
          code: 'TERMINAL_FAILURE',
          safeMessage: 'Comparison semantic analysis provider execution failed.',
          module: 'stage5.comparison-semantic-analysis',
          operation: 'invoke-provider',
        });
        const retryable = isRetryableProviderCode(normalized.code);
        const state: AnalysisRevisionV2['state'] =
          normalized.code === 'POLICY_DENIED' || normalized.code === 'CAPABILITY_DENIED'
            ? 'POLICY_BLOCKED'
            : retryable
              ? 'FAILED_RETRYABLE'
              : normalized.code === 'AI_CAPABILITY_UNAVAILABLE'
                ? 'SEMANTIC_UNAVAILABLE'
                : 'FAILED_TERMINAL';
        const safeFailureCode: AnalysisRevisionV2['safeFailureCode'] =
          state === 'POLICY_BLOCKED'
            ? 'POLICY_DENIED'
            : state === 'FAILED_RETRYABLE'
              ? normalized.code === 'OUTCOME_UNKNOWN' || normalized.code === 'OUTCOME_INDETERMINATE'
                ? 'OUTCOME_UNKNOWN'
                : normalized.code === 'TIMEOUT'
                  ? 'ANALYSIS_TIMEOUT'
                  : 'RETRYABLE_DEPENDENCY'
              : state === 'SEMANTIC_UNAVAILABLE'
                ? 'SEMANTIC_UNAVAILABLE'
                : 'TERMINAL_FAILURE';
        const completedAt = now();
        const analysis: AnalysisRevisionV2 = {
          analysisRevisionId,
          contractVersion: COMPARISON_V2_CONTRACT_VERSION,
          comparisonId: request.comparisonId,
          candidate: request.candidate,
          canonicalSnapshot: expectedSnapshot,
          inputDigest,
          shortlistDigest: request.shortlistDigest,
          comparedResourceIdentities,
          providerIdentity,
          credentialRevisionRef: credentialRevisionRef(executionIdentity),
          promptTemplateRevision: COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
          outputSchemaRevision: COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
          semanticPolicyRevision: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
          attempt: request.attempt,
          state,
          outcome: state,
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedMillis),
          safeFailureCode,
          createdAt: completedAt,
        };
        validateAnalysisRevisionV2(analysis);
        return { status: 'FAILED', analysis, relationships: [] };
      }

      let decisions: readonly ModelRelationship[];
      try {
        decisions = parseModelOutput(response.rawText);
        const targetKeys = new Set(
          targets.map((target) => `${target.resourceId}:${target.resourceRevision}`),
        );
        const decisionKeys = decisions.map(
          (decision) => `${decision.resourceId}:${decision.resourceRevision}`,
        );
        if (
          decisions.length !== targets.length ||
          new Set(decisionKeys).size !== decisionKeys.length ||
          decisionKeys.some((key) => !targetKeys.has(key)) ||
          [...targetKeys].some((key) => !decisionKeys.includes(key))
        ) {
          throw new Error(
            'Structured output must contain exactly one decision for every selected Claim.',
          );
        }
      } catch {
        const completedAt = now();
        const analysis: AnalysisRevisionV2 = {
          analysisRevisionId,
          contractVersion: COMPARISON_V2_CONTRACT_VERSION,
          comparisonId: request.comparisonId,
          candidate: request.candidate,
          canonicalSnapshot: expectedSnapshot,
          inputDigest,
          shortlistDigest: request.shortlistDigest,
          comparedResourceIdentities,
          providerIdentity,
          credentialRevisionRef: credentialRevisionRef(executionIdentity),
          promptTemplateRevision: COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
          outputSchemaRevision: COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
          semanticPolicyRevision: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
          attempt: request.attempt,
          state: 'FAILED_TERMINAL',
          outcome: 'FAILED_TERMINAL',
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedMillis),
          safeFailureCode: 'CONTRACT_FAILURE',
          createdAt: completedAt,
        };
        validateAnalysisRevisionV2(analysis);
        return { status: 'FAILED', analysis, relationships: [] };
      }

      const completedAt = now();
      const material = materialDigest(decisions);
      let relationships: readonly SemanticRelationshipV2[];
      try {
        relationships = decisions.map((decision) => {
          const target = targets.find(
            (candidate) =>
              candidate.resourceId === decision.resourceId &&
              candidate.resourceRevision === decision.resourceRevision,
          );
          if (!target) throw new Error('Validated target disappeared while constructing material.');
          const base: Omit<SemanticRelationshipV2, 'materialDigest'> = {
            relationshipId: nextId(),
            contractVersion: COMPARISON_V2_CONTRACT_VERSION,
            comparisonId: request.comparisonId,
            candidateId: request.candidate.id,
            candidateRevision: request.candidate.revision,
            candidateDigest: request.candidate.digest,
            candidateEvidenceIds: [...request.candidate.evidenceIds],
            comparedResource: {
              resourceType: 'CLAIM',
              resourceId: target.resourceId,
              resourceRevision: target.resourceRevision,
            },
            canonicalSnapshot: {
              snapshotId: expectedSnapshot.id,
              version: expectedSnapshot.version,
              digest: expectedSnapshot.digest,
            },
            type: decision.type,
            ...(decision.conflictKind === undefined ? {} : { conflictKind: decision.conflictKind }),
            analysisRevisionId,
            ruleIdentity: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
            rationale: decision.rationale,
            accessScope: [...request.security.accessScope].sort(),
            sensitivity: request.security.sensitivity,
            revision: 1,
            createdAt: completedAt,
          };
          const relationship: SemanticRelationshipV2 = {
            ...base,
            materialDigest: semanticRelationshipMaterialDigestV2(base),
          };
          validateSemanticRelationshipV2(relationship);
          return relationship;
        });
      } catch {
        const analysis: AnalysisRevisionV2 = {
          analysisRevisionId,
          contractVersion: COMPARISON_V2_CONTRACT_VERSION,
          comparisonId: request.comparisonId,
          candidate: request.candidate,
          canonicalSnapshot: expectedSnapshot,
          inputDigest,
          shortlistDigest: request.shortlistDigest,
          comparedResourceIdentities,
          providerIdentity,
          credentialRevisionRef: credentialRevisionRef(executionIdentity),
          promptTemplateRevision: COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
          outputSchemaRevision: COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
          semanticPolicyRevision: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
          attempt: request.attempt,
          state: 'FAILED_TERMINAL',
          outcome: 'FAILED_TERMINAL',
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedMillis),
          safeFailureCode: 'CONTRACT_FAILURE',
          createdAt: completedAt,
        };
        validateAnalysisRevisionV2(analysis);
        return { status: 'FAILED', analysis, relationships: [] };
      }
      const analysis: AnalysisRevisionV2 = {
        analysisRevisionId,
        contractVersion: COMPARISON_V2_CONTRACT_VERSION,
        comparisonId: request.comparisonId,
        candidate: request.candidate,
        canonicalSnapshot: expectedSnapshot,
        inputDigest,
        shortlistDigest: request.shortlistDigest,
        comparedResourceIdentities,
        providerIdentity,
        credentialRevisionRef: credentialRevisionRef(executionIdentity),
        promptTemplateRevision: COMPARISON_SEMANTIC_ANALYSIS_PROMPT_REVISION_V2,
        outputSchemaRevision: COMPARISON_SEMANTIC_ANALYSIS_SCHEMA_REVISION_V2,
        semanticPolicyRevision: COMPARISON_SEMANTIC_ANALYSIS_POLICY_REVISION_V2,
        attempt: request.attempt,
        state: 'COMPLETED',
        outcome: 'COMPLETED',
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedMillis),
        outputDigest: modelOutputDigest(response.rawText),
        materialDigest: material,
        createdAt: completedAt,
      };
      validateAnalysisRevisionV2(analysis);
      return { status: 'COMPLETED', analysis, relationships };
    },
  };
};
