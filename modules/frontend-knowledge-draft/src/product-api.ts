import { randomUUID } from 'node:crypto';

import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import {
  FrontendContractError,
  FrontendKnowledgeDraftCommandError,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES,
  frontendKnowledgeDraftAbandonDigest,
  frontendKnowledgeDraftCommitDigest,
  frontendKnowledgeDraftImpactPreviewDigest,
  frontendKnowledgeDraftMaterializeDigest,
  frontendKnowledgeDraftReadDigest,
  frontendKnowledgeDraftSaveDigest,
  frontendKnowledgeDraftStartSeedlessDigest,
  frontendKnowledgeDraftSubmitDraftForReviewDigest,
  frontendKnowledgeDraftValidateDigest,
  canonicalRelationLogicalIdentityV1,
  reviewApprovalManifestDigest,
  sha256Text,
  stableJson,
  type AbandonKnowledgeDraftRequestV1,
  type AcceptedPolicyContext,
  type AnyFrontendCommandOutcomeView,
  type AnyFrontendCommandRequest,
  type CanonicalCommitResult,
  type CanonicalSnapshot,
  type CommitKnowledgeDraftRequestV1,
  type CommitKnowledgeDraftResultV1,
  type EvidenceSpan,
  type DraftImpactArtifactRefV1,
  type DraftValidationArtifactRefV1,
  type ErrorCode,
  type FrontendCanonicalCommitWrite,
  type FrontendCanonicalAuthorityV1,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeDraftCommandOutcomeV1,
  type FrontendKnowledgeDraftCommandType,
  type FrontendKnowledgeOperationV1,
  type RelationDraftValueV2,
  type DiscoveryDraftProvenanceV1,
  frontendKnowledgeDraftRevisionDigest,
  type Actor,
  type GenerateKnowledgeDraftImpactRequestV1,
  type GenerateKnowledgeDraftImpactResultV1,
  type MaterializeDraftRequestV1,
  type MaterializeDraftResultV1,
  type ProducedResourceRef,
  type ReadKnowledgeDraftRequestV1,
  type ReadKnowledgeDraftResultV1,
  type ResolveKnowledgeDraftCommandOutcomeRequestV1,
  type ResolveKnowledgeDraftCommandOutcomeResultV1,
  type ReviewApprovalV1,
  type SaveKnowledgeDraftRequestV1,
  type SaveKnowledgeDraftResultV1,
  type StartSeedlessDraftRequestV1,
  type StartSeedlessDraftResultV1,
  type SubmitKnowledgeDraftForReviewRequestV1,
  type SubmitKnowledgeDraftForReviewResultV1,
  type TypedPrecondition,
  type ValidateKnowledgeDraftRequestV1,
  type ValidateKnowledgeDraftResultV1,
} from '../../../packages/contracts/src/index.js';
import {
  createInitialFrontendKnowledgeDraft,
  materializeFrontendKnowledgeDraftOn,
  persistFrontendKnowledgeDraftRevisionOn,
  persistFrontendKnowledgeDraftTransitionOn,
  transitionFrontendKnowledgeDraftStatus,
  assertFrontendKnowledgeDraftDiscoveryRelationBinding,
  frontendKnowledgeDraftDiscoveryRelationSemanticV1,
  frontendKnowledgeDraftOperationDigestV1,
  type DraftMaterializationRecordV1,
  type DraftMaterializationTargetV1,
  type FrontendKnowledgeDraftRepositoryBoundaryPort,
  type FrontendKnowledgeDraftTransactionRepositoriesV1,
} from './index.js';

export const FRONTEND_KNOWLEDGE_DRAFT_API_VERSION = '1.0.0' as const;

export const FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND = {
  draft: 'FRONTEND_KNOWLEDGE_DRAFT',
  materialization: 'FRONTEND_KNOWLEDGE_DRAFT_MATERIALIZATION',
} as const;

const DRAFT_COMMAND_FAMILY: readonly string[] = [
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.materialize,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.startSeedless,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.save,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.abandon,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.readDraft,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.validateDraft,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.generateImpactPreview,
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.submitDraftForReview,
];

const isDraftCommandType = (commandType: string): boolean =>
  DRAFT_COMMAND_FAMILY.includes(commandType);

export type FrontendKnowledgeDraftSensitivityClearance =
  'public' | 'internal' | 'private' | 'restricted';

/**
 * Server-derived authority for a FE-P3-S2 Draft command. Every value is
 * established by the server (session, active Project, membership access
 * revision and policy context revision). The browser never submits these as
 * authority.
 */
export type FrontendKnowledgeDraftCommandScopeV1 = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivityClearance: FrontendKnowledgeDraftSensitivityClearance;
  readonly accessScope: readonly string[];
};

export type FrontendKnowledgeDraftTargetResolutionV1 = {
  readonly target: DraftMaterializationTargetV1;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
};

/**
 * Server-side resolution of a Draft start target (Ask Seed, Knowledge
 * Resource or Knowledge Page) into a fixed Project binding and pinned
 * Canonical base. Resolution is authority: it derives the Resource/Draft/
 * Effective Project and the immutable base from server state, never from the
 * browser payload.
 */
export type FrontendKnowledgeDraftTargetResolverPort = {
  resolveSeed(input: {
    readonly seedId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined>;
  resolveResource(input: {
    readonly resourceId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined>;
  resolvePage(input: {
    readonly pageId: string;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  }): Promise<FrontendKnowledgeDraftTargetResolutionV1 | undefined>;
};

/**
 * Structural subset of the Command Gateway used by the FE-P3-S2 coordinator.
 * Declared locally (not imported from another domain module) so the module
 * boundary stays intact; any real gateway implementation satisfies it.
 */
export type FrontendKnowledgeDraftCommandGatewayPort = {
  accept(input: {
    readonly commandId: string;
    readonly commandRevision: string;
    readonly principalId: string;
    readonly request: AnyFrontendCommandRequest;
    readonly commandSemanticDigest: string;
    readonly acceptedPolicyContext: AcceptedPolicyContext;
    readonly correlationId: string;
    readonly traceId: string;
    readonly receivedAt: string;
    readonly acceptedAt: string;
  }): Promise<{ readonly outcome: AnyFrontendCommandOutcomeView; readonly replayed: boolean }>;
  lockAcceptedForExecution(
    transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView>;
  completeInTransaction(
    transaction: unknown,
    input: {
      readonly commandId: string;
      readonly producedResources: readonly ProducedResourceRef[];
      readonly completedAt: string;
    },
  ): Promise<AnyFrontendCommandOutcomeView>;
  reject(input: {
    readonly commandId: string;
    readonly code: ErrorCode;
    readonly message: string;
    readonly correlationId?: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  markOutcomeUnknown(input: {
    readonly commandId: string;
    readonly message: string;
    readonly completedAt: string;
  }): Promise<AnyFrontendCommandOutcomeView>;
  findByClientRequestId(
    principalId: string,
    clientRequestId: string,
  ): Promise<AnyFrontendCommandOutcomeView | null>;
};

// Function declaration (not a const arrow) so TypeScript control-flow narrows
// the guarded value after the call, matching the project's strict settings.
function draftFailure(
  apiCode:
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'PROJECT_BINDING_CONFLICT'
    | 'ACCESS_REVOKED'
    | 'BASE_UNAVAILABLE'
    | 'DRAFT_NOT_FOUND'
    | 'DRAFT_REVISION_CONFLICT'
    | 'VALIDATION_FAILED'
    | 'STALE'
    | 'IMPACT_PARTIAL'
    | 'ANALYZER_UNAVAILABLE'
    | 'NOT_READY_FOR_REVIEW'
    | 'OUTCOME_NOT_FOUND'
    | 'DIGEST_MISMATCH'
    | 'COMMAND_SCOPE_MISMATCH'
    | 'OUTCOME_INDETERMINATE'
    | 'UNSUPPORTED_OPERATION'
    | 'STALE_APPROVAL'
    | 'REVIEW_APPROVAL_EXPIRED',
  message: string,
): never {
  throw new FrontendKnowledgeDraftCommandError(apiCode, message);
}

const generatedIdentity = (prefix: string): string => `${prefix}-${randomUUID()}`;

/**
 * FE-P5-XP Correction B: deterministic canonical commit identity. The commit id
 * is derived from the Approval + Draft so a replay or crash-recovery rebuilds
 * the EXACT same write (same commitId + authority) and commitFrontendDraft is
 * replay-idempotent instead of creating a second commit.
 */
const deterministicCanonicalCommitId = (approvalId: string, draftId: string): string => {
  const hex = sha256Text(`frontend-approval-commit:${approvalId}:${draftId}`).slice(
    'sha256:'.length,
    'sha256:'.length + 32,
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const draftPrecondition = (draftId: string, expectedRevision: number): TypedPrecondition => ({
  purpose: 'TARGET',
  subject: {
    resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
    resourceId: draftId,
  },
  expectedRevision: String(expectedRevision),
});

// Per-command semantic digests live in the shared contracts package so the
// server coordinator and the browser client compute identical values (the
// request identity fields are intentionally excluded). Re-exported here for
// coordinator consumers that import from the product API module.
export {
  frontendKnowledgeDraftAbandonDigest,
  frontendKnowledgeDraftCommitDigest,
  frontendKnowledgeDraftImpactPreviewDigest,
  frontendKnowledgeDraftMaterializeDigest,
  frontendKnowledgeDraftReadDigest,
  frontendKnowledgeDraftSaveDigest,
  frontendKnowledgeDraftStartSeedlessDigest,
  frontendKnowledgeDraftSubmitDraftForReviewDigest,
  frontendKnowledgeDraftValidateDigest,
};

type DraftApiCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PROJECT_BINDING_CONFLICT'
  | 'ACCESS_REVOKED'
  | 'BASE_UNAVAILABLE'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'STALE'
  | 'IMPACT_PARTIAL'
  | 'ANALYZER_UNAVAILABLE'
  | 'NOT_READY_FOR_REVIEW'
  | 'OUTCOME_NOT_FOUND'
  | 'DIGEST_MISMATCH'
  | 'COMMAND_SCOPE_MISMATCH'
  | 'OUTCOME_INDETERMINATE'
  | 'UNSUPPORTED_OPERATION'
  | 'STALE_APPROVAL'
  | 'REVIEW_APPROVAL_EXPIRED';

/** Maps a Ledger ErrorCode back to the FE-P3-S2 API failure code. */
const fromLedgerCode = (code: ErrorCode): DraftApiCode => {
  switch (code) {
    case 'NOT_FOUND':
    case 'SEED_NOT_FOUND':
    case 'DRAFT_NOT_FOUND':
      return 'NOT_FOUND';
    case 'FORBIDDEN':
    case 'PROJECT_ACCESS_DENIED':
    case 'RESOURCE_ACCESS_REVOKED':
      return 'FORBIDDEN';
    case 'ACCESS_REVOKED':
      return 'ACCESS_REVOKED';
    case 'DIGEST_MISMATCH':
      return 'DIGEST_MISMATCH';
    case 'REVISION_CONFLICT':
    case 'DRAFT_REVISION_CONFLICT':
    case 'SEED_ALREADY_MATERIALIZED':
      return 'DRAFT_REVISION_CONFLICT';
    case 'STALE_VERSION':
    case 'STALE_BASE':
    case 'STALE':
      return 'STALE';
    case 'VALIDATION_ERROR':
    case 'VALIDATION_FAILED':
    case 'RESOURCE_REVISION_MISSING':
      return 'VALIDATION_FAILED';
    case 'RESOURCE_PROJECT_MISMATCH':
    case 'PROJECT_BINDING_CONFLICT':
    case 'COMMAND_SCOPE_MISMATCH':
      return 'PROJECT_BINDING_CONFLICT';
    case 'OUTCOME_UNKNOWN':
    case 'OUTCOME_INDETERMINATE':
      return 'OUTCOME_INDETERMINATE';
    case 'STALE_APPROVAL':
      return 'STALE_APPROVAL';
    case 'UNSUPPORTED_OPERATION':
      return 'UNSUPPORTED_OPERATION';
    case 'REVIEW_APPROVAL_EXPIRED':
      return 'REVIEW_APPROVAL_EXPIRED';
    default:
      return 'DRAFT_REVISION_CONFLICT';
  }
};

export type FrontendKnowledgeDraftRunCommandInput<T> = {
  readonly scope: FrontendKnowledgeDraftCommandScopeV1;
  readonly commandType: FrontendKnowledgeDraftCommandType;
  readonly request: { readonly clientRequestId: string; readonly idempotencyKey: string };
  readonly commandSemanticDigest: string;
  readonly resourceProjectId: string;
  readonly preconditions?: readonly TypedPrecondition[];
  readonly actionOnRepositories: (
    repositories: FrontendKnowledgeDraftTransactionRepositoriesV1,
    transaction?: unknown,
  ) => Promise<T>;
  readonly onReplay?: () => Promise<T>;
  /**
   * FE-P5-XP Correction B: invoked when the ledger replayed an ACCEPTED or
   * OUTCOME_UNKNOWN command (e.g. a crash between the durable Canonical commit
   * and the Approval consume). Runs inside the draft transaction handle, so it
   * must read the Draft through `repositories` (never a nested transaction).
   * Must finish the side effects idempotently; the ledger completes the
   * ORIGINAL command afterwards (never a new one).
   */
  readonly onReplayRecovery?: (
    originalCommandId: string,
    repositories: FrontendKnowledgeDraftTransactionRepositoriesV1,
    transaction?: unknown,
  ) => Promise<T>;
  readonly producedResources: (result: T) => readonly ProducedResourceRef[];
};

/**
 * Cross-Phase Correction B: structural (locally-declared) dependencies for the
 * Approval→Canonical commit consumer. Declared locally so the module boundary
 * stays intact; real Review/Cannonical implementations satisfy them.
 */
export type FrontendKnowledgeDraftApprovalCommitPort = {
  /** Includes the append-only approval status revision (enforces
   *  expectedApprovalRevision; Round 2, GPT #2). */
  findByIdWithRevision(approvalId: string): Promise<
    | {
        readonly approval: ReviewApprovalV1;
        readonly approvalStatusRevision: number;
      }
    | undefined
  >;
  consumeApproval(
    approvalId: string,
    canonicalCommitId: string,
    consumedAt: string,
    consumedBy: string,
  ): Promise<void>;
  findByIdWithRevisionInTransaction?(
    transaction: unknown,
    approvalId: string,
  ): Promise<
    | {
        readonly approval: ReviewApprovalV1;
        readonly approvalStatusRevision: number;
      }
    | undefined
  >;
  consumeApprovalInTransaction?(
    transaction: unknown,
    approvalId: string,
    canonicalCommitId: string,
    consumedAt: string,
    consumedBy: string,
  ): Promise<void>;
};

export type FrontendKnowledgeDraftCanonicalCommitPort = {
  getSnapshot(projectId: string): Promise<CanonicalSnapshot>;
  commitFrontendDraft(write: FrontendCanonicalCommitWrite): Promise<CanonicalCommitResult>;
  getSnapshotInTransaction?(transaction: unknown, projectId: string): Promise<CanonicalSnapshot>;
  commitFrontendDraftInTransaction?(
    transaction: unknown,
    write: FrontendCanonicalCommitWrite,
  ): Promise<CanonicalCommitResult>;
  findCommitInTransaction?(
    transaction: unknown,
    projectId: string,
    commitId: string,
  ): Promise<CanonicalCommitResult | undefined>;
  /** Round 3 (GPT #1): recovery branches on whether the durable commit exists. */
  findCommit(projectId: string, commitId: string): Promise<CanonicalCommitResult | undefined>;
};

/**
 * Server-owned Evidence authority used by the Approval -> Canonical commit
 * boundary.  The caller's capabilities authorize the operation, but the
 * Evidence Span remains the authority for the Canonical resource's visibility
 * and sensitivity.
 */
export type FrontendKnowledgeDraftEvidenceReaderPort = {
  findById(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined>;
};

export type FrontendKnowledgeDraftCommitDependenciesV1 = {
  readonly approvals: FrontendKnowledgeDraftApprovalCommitPort;
  readonly canonical: FrontendKnowledgeDraftCanonicalCommitPort;
  readonly evidence: FrontendKnowledgeDraftEvidenceReaderPort;
  /** Server-only Discovery authority used for the final relation commit read. */
  readonly discoveryRelationAuthority?: FrontendKnowledgeDraftDiscoveryRelationAuthorityPort;
};

export type FrontendKnowledgeDraftDiscoveryRelationAuthorityPort = {
  revalidateRelation(input: {
    readonly transaction?: unknown;
    readonly scope: FrontendKnowledgeDraftCommandScopeV1;
    readonly draft: FrontendKnowledgeDraftChangeSetV1;
    readonly operation: Extract<FrontendKnowledgeOperationV1, { readonly kind: 'RELATION_ADD' }>;
  }): Promise<{
    readonly expectedOperation: Extract<
      FrontendKnowledgeOperationV1,
      { readonly kind: 'RELATION_ADD' }
    >;
    readonly provenance: DiscoveryDraftProvenanceV1;
    readonly accessScope: readonly string[];
    readonly sensitivity: FrontendKnowledgeDraftSensitivityClearance;
  }>;
};

/**
 * FE-P5-XP Correction B: resolves the review Item id (`item-<index>`) back to
 * the Draft operation it represents. The Review context materializes one Item
 * per Draft operation in declaration order (`item-1` -> operations[0]).
 */
const operationByReviewItemId = (
  operations: readonly FrontendKnowledgeOperationV1[],
  reviewItemId: string,
): FrontendKnowledgeOperationV1 | undefined => {
  const match = /^item-(\d+)$/.exec(reviewItemId);
  if (!match) return undefined;
  const index = Number(match[1]) - 1;
  return operations[index];
};

/**
 * FE-P5-XP Correction B: validates that an approved operation set maps to the
 * bounded Canonical model. Only one `CLAIM_ADD` or one typed `RELATION_ADD`
 * mutation is accepted per Approval; `NO_OP` has no Canonical mutation.
 * Everything else is rejected fail-closed with the Approval left ACTIVE.
 */
const approvedClaimableOperation = (input: {
  readonly operations: readonly FrontendKnowledgeOperationV1[];
  readonly approvedItemIds: readonly string[];
  readonly discoveryProvenance?: DiscoveryDraftProvenanceV1;
}): { readonly claimReviewItemId?: string; readonly relationReviewItemId?: string } => {
  const resolved: { reviewItemId: string; operation: FrontendKnowledgeOperationV1 }[] = [];
  for (const reviewItemId of input.approvedItemIds) {
    const operation = operationByReviewItemId(input.operations, reviewItemId);
    if (!operation) {
      throw new FrontendKnowledgeDraftCommandError(
        'UNSUPPORTED_OPERATION',
        `Approved review item '${reviewItemId}' does not map to a Draft operation.`,
      );
    }
    if (
      operation.kind !== 'CLAIM_ADD' &&
      operation.kind !== 'RELATION_ADD' &&
      operation.kind !== 'NO_OP'
    ) {
      throw new FrontendKnowledgeDraftCommandError(
        'UNSUPPORTED_OPERATION',
        `Approved operation '${operation.kind}' has no Canonical representation; the Approval stays ACTIVE.`,
      );
    }
    if (
      operation.kind === 'RELATION_ADD' &&
      (operation.after.schemaVersion !== 'relation.v2' ||
        operation.before !== undefined ||
        input.discoveryProvenance?.bridgeVersion !== 'adr-152.wp2a.v1')
    ) {
      throw new FrontendKnowledgeDraftCommandError(
        'UNSUPPORTED_OPERATION',
        'Only the server-created relation.v2 ADD operation can reach Canonical.',
      );
    }
    resolved.push({ reviewItemId, operation });
  }
  const claimItems = resolved.filter((entry) => entry.operation.kind === 'CLAIM_ADD');
  const relationItems = resolved.filter((entry) => entry.operation.kind === 'RELATION_ADD');
  if (claimItems.length + relationItems.length > 1) {
    // The frozen single-claim Canonical commit contract cannot represent
    // multiple CLAIM_ADD operations under one Approval (one Approval -> at
    // most one Canonical commit). Fail closed; the Approval stays ACTIVE.
    throw new FrontendKnowledgeDraftCommandError(
      'UNSUPPORTED_OPERATION',
      'The Approval covers multiple Canonical mutation operations, which exceed the bounded commit contract.',
    );
  }
  return {
    claimReviewItemId: claimItems[0]?.reviewItemId,
    relationReviewItemId: relationItems[0]?.reviewItemId,
  };
};

type ClaimEvidenceAuthority = {
  readonly accessScope: readonly string[];
  readonly sensitivity: FrontendKnowledgeDraftSensitivityClearance;
  readonly sourceVersionId: string;
  readonly revisionId: string;
};

const normalizedScopes = (scopes: readonly string[]): readonly string[] =>
  [...new Set(scopes)].sort((left, right) => left.localeCompare(right));

/**
 * Resolves the immutable provenance authority for a CLAIM_ADD.  Membership
 * capabilities authorize the commit, but they must never widen the
 * visibility/sensitivity carried by the Evidence resource into Canonical.
 */
const resolveClaimEvidenceAuthority = async (
  scope: FrontendKnowledgeDraftCommandScopeV1,
  operation: Extract<FrontendKnowledgeOperationV1, { readonly kind: 'CLAIM_ADD' }>,
  evidenceReader: FrontendKnowledgeDraftEvidenceReaderPort,
): Promise<ClaimEvidenceAuthority> => {
  if (operation.evidenceReferences.length === 0) {
    draftFailure(
      'VALIDATION_FAILED',
      'A CLAIM_ADD commit requires at least one evidence reference.',
    );
  }

  const references = operation.evidenceReferences;
  if (new Set(references.map((reference) => reference.sourceVersionId)).size > 1) {
    draftFailure(
      'UNSUPPORTED_OPERATION',
      'Multiple evidence source versions cannot be represented in the single-source Canonical claim model.',
    );
  }
  const spans = await Promise.all(
    references.map((reference) =>
      evidenceReader.findById(scope.activeProjectId, reference.evidenceSpanId),
    ),
  );
  if (spans.some((span) => span === undefined)) {
    draftFailure('VALIDATION_FAILED', 'A CLAIM_ADD references missing Evidence provenance.');
  }

  const resolved = spans as EvidenceSpan[];
  const first = resolved[0]!;
  const expectedScope = normalizedScopes(first.accessScope);
  if (expectedScope.length === 0) {
    draftFailure('VALIDATION_FAILED', 'Evidence provenance must carry a non-empty access scope.');
  }

  for (const [index, span] of resolved.entries()) {
    const reference = references[index]!;
    if (
      span.projectId !== scope.activeProjectId ||
      span.sourceId !== reference.sourceId ||
      span.sourceVersionId !== reference.sourceVersionId ||
      span.evidenceId !== reference.evidenceSpanId
    ) {
      draftFailure(
        'VALIDATION_FAILED',
        'A CLAIM_ADD Evidence reference does not match its active Project/source identity.',
      );
    }
    if (
      !span.accessScope.every((required) => scope.accessScope.includes(required)) ||
      !hasSensitivityClearance(scope.sensitivityClearance, span.sensitivity)
    ) {
      draftFailure('FORBIDDEN', 'The caller cannot commit the referenced Evidence provenance.');
    }
    if (
      normalizedScopes(span.accessScope).join('\u0000') !== expectedScope.join('\u0000') ||
      span.sensitivity !== first.sensitivity ||
      span.sourceVersionId !== first.sourceVersionId ||
      span.revisionId !== first.revisionId
    ) {
      draftFailure(
        'VALIDATION_FAILED',
        'A CLAIM_ADD references Evidence provenance with mixed scope, sensitivity, or revision.',
      );
    }
  }

  return {
    accessScope: expectedScope,
    sensitivity: first.sensitivity,
    sourceVersionId: first.sourceVersionId,
    revisionId: first.revisionId,
  };
};

export class FrontendKnowledgeDraftProductCoordinator {
  constructor(
    private readonly boundary: FrontendKnowledgeDraftRepositoryBoundaryPort,
    private readonly commandGateway: FrontendKnowledgeDraftCommandGatewayPort,
    private readonly targetResolver: FrontendKnowledgeDraftTargetResolverPort,
    private readonly commitDependencies?: FrontendKnowledgeDraftCommitDependenciesV1,
  ) {}

  async materializeDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: MaterializeDraftRequestV1,
  ): Promise<MaterializeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftMaterializeDigest(request);
    return this.runCommand<MaterializeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.materialize,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        // A Seed produces at most one Draft: the domain materialize replays the
        // existing Draft identity under the same Resource Project.
        const resolution = await this.targetResolver.resolveSeed({
          seedId: request.seedId,
          scope,
        });
        if (!resolution) {
          draftFailure('NOT_FOUND', `Seed '${request.seedId}' was not found.`);
        }
        if (resolution.resourceProjectId !== scope.activeProjectId) {
          draftFailure(
            'PROJECT_BINDING_CONFLICT',
            'The Seed is bound to another Resource Project.',
          );
        }
        const now = new Date().toISOString();
        const binding = {
          activeProjectId: scope.activeProjectId,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
        };
        const draft = createInitialFrontendKnowledgeDraft({
          draftId: generatedIdentity('draft'),
          seedId: request.seedId,
          startMode: 'SEED_MATERIALIZATION',
          binding,
          resourceId: resolution.target.resourceId,
          base: resolution.base,
          createdAt: now,
          updatedAt: now,
        });
        const materialization: DraftMaterializationRecordV1 = {
          materializationId: generatedIdentity('materialization'),
          draftId: draft.draftId,
          target: resolution.target,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          base: resolution.base,
          commandIdentity: {
            principalId: scope.principalId,
            clientRequestId: request.clientRequestId,
            idempotencyKey: request.idempotencyKey,
            semanticDigest: commandSemanticDigest,
          },
          createdAt: now,
        };
        const result = await materializeFrontendKnowledgeDraftOn(repositories, {
          draft,
          materialization,
        });
        return this.materializeResult(request, result.draft);
      },
      onReplay: async () => {
        const draft = await this.draftFromSeed(scope.activeProjectId, request.seedId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The materialized Draft is missing.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async startSeedlessDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: StartSeedlessDraftRequestV1,
  ): Promise<StartSeedlessDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftStartSeedlessDigest(request);
    return this.runCommand<StartSeedlessDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.startSeedless,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const resolution =
          request.resourceId !== undefined
            ? await this.targetResolver.resolveResource({ resourceId: request.resourceId, scope })
            : await this.targetResolver.resolvePage({ pageId: request.pageId, scope });
        if (!resolution) {
          draftFailure(
            'NOT_FOUND',
            `Knowledge ${request.resourceId !== undefined ? 'Resource' : 'Page'} was not found.`,
          );
        }
        if (resolution.resourceProjectId !== scope.activeProjectId) {
          draftFailure(
            'PROJECT_BINDING_CONFLICT',
            'The Knowledge target is bound to another Resource Project.',
          );
        }
        const now = new Date().toISOString();
        const binding = {
          activeProjectId: scope.activeProjectId,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
        };
        const draft = createInitialFrontendKnowledgeDraft({
          draftId: generatedIdentity('draft'),
          startMode: 'KNOWLEDGE_PAGE',
          binding,
          resourceId: resolution.target.resourceId,
          base: resolution.base,
          createdAt: now,
          updatedAt: now,
        });
        const materialization: DraftMaterializationRecordV1 = {
          materializationId: generatedIdentity('materialization'),
          draftId: draft.draftId,
          target: resolution.target,
          resourceProjectId: resolution.resourceProjectId,
          draftProjectId: resolution.draftProjectId,
          effectiveProjectId: resolution.effectiveProjectId,
          base: resolution.base,
          commandIdentity: {
            principalId: scope.principalId,
            clientRequestId: request.clientRequestId,
            idempotencyKey: request.idempotencyKey,
            semanticDigest: commandSemanticDigest,
          },
          createdAt: now,
        };
        const result = await materializeFrontendKnowledgeDraftOn(repositories, {
          draft,
          materialization,
        });
        return this.materializeResult(request, result.draft);
      },
      onReplay: async () => {
        const outcome = await this.commandGateway.findByClientRequestId(
          scope.principalId,
          request.clientRequestId,
        );
        const draft = await this.draftFromOutcome(outcome);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The materialized Draft is missing.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async saveDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: SaveKnowledgeDraftRequestV1,
  ): Promise<SaveKnowledgeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftSaveDigest(request);
    return this.runCommand<SaveKnowledgeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.save,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const draft = await persistFrontendKnowledgeDraftRevisionOn(repositories, {
          projectId: scope.activeProjectId,
          draftId: request.draftId,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          operationRevision: request.operationRevision,
          operations: request.operations,
          contentDigest: request.contentDigest,
          updatedAt: new Date().toISOString(),
        });
        return this.materializeResult(request, draft);
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async readDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: ReadKnowledgeDraftRequestV1,
  ): Promise<ReadKnowledgeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftReadDigest(request);
    return this.runCommand<ReadKnowledgeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.readDraft,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories) => {
        const draft = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        return this.materializeResult(request, draft);
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: result.draft.draftId,
          resourceRevision: String(result.draft.revision),
        },
      ],
    });
  }

  async validateDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: ValidateKnowledgeDraftRequestV1,
  ): Promise<ValidateKnowledgeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftValidateDigest(request);
    return this.runCommand<ValidateKnowledgeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.validateDraft,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        const next = transitionFrontendKnowledgeDraftStatus({
          current,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          nextStatus: 'VALID',
          updatedAt: new Date().toISOString(),
        });
        const validation: DraftValidationArtifactRefV1 = {
          artifactId: generatedIdentity('validation'),
          artifactRevision: 1,
          digest: `${current.contentDigest}:${request.expectedBaseRevision}`,
          status: 'COMPLETE',
          projectPolicyContext: {
            activeProjectId: current.activeProjectId,
            resourceProjectId: current.resourceProjectId,
            draftProjectId: current.draftProjectId,
            effectiveProjectId: current.effectiveProjectId,
            accessRevision: current.base.accessRevision,
            policyContextRevision: current.base.policyContextRevision,
          },
        };
        const validatedDraft = {
          ...next,
          validation,
        };
        await persistFrontendKnowledgeDraftTransitionOn(repositories, {
          projectId: scope.activeProjectId,
          draft: validatedDraft,
          expectedRevision: request.expectedDraftRevision,
        });
        return {
          schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          draftStatus: validatedDraft.status,
          validation: validatedDraft.validation,
        };
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        if (!draft.validation) {
          draftFailure('VALIDATION_FAILED', 'The Draft validation artifact is incomplete.');
        }
        return {
          schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          draftStatus: draft.status,
          validation: draft.validation,
        };
      },
      producedResources: () => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: request.draftId,
          resourceRevision: String(request.expectedDraftRevision),
        },
      ],
    });
  }

  async generateImpactPreview(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: GenerateKnowledgeDraftImpactRequestV1,
  ): Promise<GenerateKnowledgeDraftImpactResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftImpactPreviewDigest(request);
    return this.runCommand<GenerateKnowledgeDraftImpactResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.generateImpactPreview,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        const next = transitionFrontendKnowledgeDraftStatus({
          current,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          nextStatus: 'VALID',
          updatedAt: new Date().toISOString(),
        });
        const impactArtifact: DraftImpactArtifactRefV1 = {
          artifactId: generatedIdentity('impact-preview'),
          artifactRevision: 1,
          digest: `${current.contentDigest}:impact:${request.expectedBaseRevision}`,
          status: 'COMPLETE',
          projectPolicyContext: {
            activeProjectId: current.activeProjectId,
            resourceProjectId: current.resourceProjectId,
            draftProjectId: current.draftProjectId,
            effectiveProjectId: current.effectiveProjectId,
            accessRevision: current.base.accessRevision,
            policyContextRevision: current.base.policyContextRevision,
          },
        };
        const impactPreview = {
          ...next,
          impactPreview: impactArtifact,
        };
        await persistFrontendKnowledgeDraftTransitionOn(repositories, {
          projectId: scope.activeProjectId,
          draft: impactPreview,
          expectedRevision: request.expectedDraftRevision,
        });
        return {
          schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          draftStatus: impactPreview.status,
          impactPreview: impactPreview.impactPreview,
        };
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        if (!draft.impactPreview) {
          draftFailure('IMPACT_PARTIAL', 'The Draft impact preview is incomplete.');
        }
        return {
          schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          draftStatus: draft.status,
          impactPreview: draft.impactPreview,
        };
      },
      producedResources: () => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: request.draftId,
          resourceRevision: String(request.expectedDraftRevision),
        },
      ],
    });
  }

  async submitDraftForReview(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: SubmitKnowledgeDraftForReviewRequestV1,
  ): Promise<SubmitKnowledgeDraftForReviewResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftSubmitDraftForReviewDigest(request);
    return this.runCommand<SubmitKnowledgeDraftForReviewResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.submitDraftForReview,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        if (current.validation === undefined || current.validation.status !== 'COMPLETE') {
          draftFailure('VALIDATION_FAILED', 'The Draft validation artifact is incomplete.');
        }
        if (current.impactPreview === undefined || current.impactPreview.status !== 'COMPLETE') {
          draftFailure('IMPACT_PARTIAL', 'The Draft impact preview is incomplete.');
        }
        const next = transitionFrontendKnowledgeDraftStatus({
          current,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          nextStatus: 'READY_FOR_REVIEW',
          updatedAt: new Date().toISOString(),
        });
        const reviewResourceIdValue = generatedIdentity('review-resource');
        const submittedDraft: FrontendKnowledgeDraftChangeSetV1 = {
          ...next,
          status: 'SUBMITTED',
          reviewResource: {
            reviewResourceId: reviewResourceIdValue,
            draftId: current.draftId,
            draftRevision: current.revision,
            resourceProjectId: current.resourceProjectId,
            draftProjectId: current.draftProjectId,
            effectiveProjectId: current.effectiveProjectId,
            policyContextRevision: current.base.policyContextRevision,
            digest: current.contentDigest,
          },
          reviewSubmission: {
            reviewSubmissionId: generatedIdentity('review-submission'),
            draftId: current.draftId,
            draftRevision: current.revision,
            operationDigest: current.contentDigest,
            contentDigest: current.contentDigest,
            validationArtifact: current.validation,
            impactArtifact: current.impactPreview,
            evidenceLineage: [],
            projectPolicyContext: {
              activeProjectId: current.activeProjectId,
              resourceProjectId: current.resourceProjectId,
              draftProjectId: current.draftProjectId,
              effectiveProjectId: current.effectiveProjectId,
              accessRevision: current.base.accessRevision,
              policyContextRevision: current.base.policyContextRevision,
            },
            reviewResource: {
              reviewResourceId: reviewResourceIdValue,
              draftId: current.draftId,
              draftRevision: current.revision,
              resourceProjectId: current.resourceProjectId,
              draftProjectId: current.draftProjectId,
              effectiveProjectId: current.effectiveProjectId,
              policyContextRevision: current.base.policyContextRevision,
              digest: current.contentDigest,
            },
          },
        };
        await persistFrontendKnowledgeDraftTransitionOn(repositories, {
          projectId: scope.activeProjectId,
          draft: submittedDraft,
          expectedRevision: request.expectedDraftRevision,
        });
        return {
          schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          reviewSubmission: submittedDraft.reviewSubmission!,
        };
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        if (!draft.reviewSubmission) {
          draftFailure('NOT_READY_FOR_REVIEW', 'The Draft review submission is incomplete.');
        }
        return {
          schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
          outcome: 'COMPLETED',
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          reviewSubmission: draft.reviewSubmission,
        };
      },
      producedResources: () => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: request.draftId,
          resourceRevision: String(request.expectedDraftRevision),
        },
      ],
    });
  }

  async commitFrontendDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: CommitKnowledgeDraftRequestV1,
  ): Promise<CommitKnowledgeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftCommitDigest(request);
    const commitResult = (input: {
      readonly canonicalCommitId: string;
    }): CommitKnowledgeDraftResultV1 => ({
      schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      outcome: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      draftId: request.draftId,
      approvalId: request.approvalId,
      commitIds: [input.canonicalCommitId],
    });
    const dependencies = this.commitDependencies;
    if (!dependencies) {
      draftFailure('NOT_READY_FOR_REVIEW', 'The commit consumer is not configured.');
    }
    const revalidated = async (input: {
      readonly draft: FrontendKnowledgeDraftChangeSetV1;
      /** RESOLVE tolerates a CONSUMED approval (replay of a completed command). */
      readonly mode?: 'REVALIDATE' | 'RESOLVE';
      readonly transaction?: unknown;
    }): Promise<{
      readonly draft: FrontendKnowledgeDraftChangeSetV1;
      readonly approval: ReviewApprovalV1;
      readonly canonicalSnapshot: CanonicalSnapshot;
      readonly relationAuthority?: Awaited<
        ReturnType<FrontendKnowledgeDraftDiscoveryRelationAuthorityPort['revalidateRelation']>
      >;
      readonly claimEvidenceAuthority?: ClaimEvidenceAuthority;
    }> => {
      const now = new Date().toISOString();
      const draft = input.draft;
      if (!draft) {
        draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
      }
      if (draft.resourceProjectId !== scope.activeProjectId) {
        draftFailure('PROJECT_BINDING_CONFLICT', 'The Draft is bound to another Resource Project.');
      }
      if (draft.status !== 'SUBMITTED') {
        draftFailure(
          'NOT_READY_FOR_REVIEW',
          'Only a submitted Draft can be committed to Canonical.',
        );
      }
      assertFrontendKnowledgeDraftDiscoveryRelationBinding({
        current: draft,
        operations: draft.operations,
      });
      const submission = draft.reviewSubmission;
      if (!submission) {
        draftFailure('NOT_READY_FOR_REVIEW', 'The Draft review submission is incomplete.');
      }
      if (
        frontendKnowledgeDraftRevisionDigest({
          draftId: draft.draftId,
          revision: draft.revision,
          base: draft.base,
          operations: draft.operations,
        }) !== submission.contentDigest
      ) {
        draftFailure(
          'DIGEST_MISMATCH',
          'The Draft content digest does not match its review submission.',
        );
      }
      const approvalRead = await dependencies.approvals.findByIdWithRevision(request.approvalId);
      if (!approvalRead) {
        draftFailure('NOT_FOUND', 'The Review Approval was not found.');
      }
      const { approval, approvalStatusRevision } = approvalRead;
      if (approval.purpose !== 'KNOWLEDGE_CANONICAL_CHANGE') {
        draftFailure('UNSUPPORTED_OPERATION', 'The Approval is not a Canonical change approval.');
      }
      // Round 2, GPT #2: the request pins the append-only approval status
      // revision (the browser reads the current revision from the Review read
      // API); a mismatch means the caller raced a status transition. Replay /
      // crash recovery (RESOLVE) completes an in-flight or completed command,
      // so the revision may legitimately have advanced (e.g. CONSUMED).
      if (input.mode !== 'RESOLVE' && approvalStatusRevision !== request.expectedApprovalRevision) {
        draftFailure('STALE', 'The Approval status revision changed.');
      }
      // A replayed COMPLETED command may observe the Approval already
      // CONSUMED by this commit; the outcome is resolved, not re-executed.
      if (input.mode !== 'RESOLVE') {
        if (approval.status !== 'ACTIVE') {
          draftFailure('REVIEW_APPROVAL_EXPIRED', 'The Approval is not ACTIVE.');
        }
        if (Date.parse(approval.expiresAt) <= Date.parse(now)) {
          draftFailure('REVIEW_APPROVAL_EXPIRED', 'The Approval has expired.');
        }
      }
      if (approval.projectId !== scope.activeProjectId) {
        draftFailure('PROJECT_BINDING_CONFLICT', 'The Approval is bound to another Project.');
      }
      if (
        approval.accessRevision !== scope.accessRevision ||
        approval.policyContextRevision !== scope.policyContextRevision
      ) {
        draftFailure('STALE', 'The Approval access or policy revision is stale.');
      }
      if (approval.targetId !== draft.draftId) {
        draftFailure('PROJECT_BINDING_CONFLICT', 'The Approval does not reference this Draft.');
      }
      if (approval.targetRevision !== String(draft.revision)) {
        draftFailure(
          'DRAFT_REVISION_CONFLICT',
          'The Approval references a different Draft revision.',
        );
      }
      if (approval.targetDigest !== submission.contentDigest) {
        draftFailure('DIGEST_MISMATCH', 'The Approval references different Draft content.');
      }
      if (
        reviewApprovalManifestDigest({
          approvedItemIds: approval.approvedItemIds,
          reviewContextId: approval.reviewContextId,
          contextRevision: approval.contextRevision,
          targetRevision: approval.targetRevision,
          targetDigest: approval.targetDigest,
          purpose: approval.purpose,
        }) !== approval.approvedManifestDigest
      ) {
        draftFailure('DIGEST_MISMATCH', 'The Approval binding digest is inconsistent.');
      }
      const canonicalSnapshot =
        input.transaction !== undefined &&
        dependencies.canonical.getSnapshotInTransaction !== undefined
          ? await dependencies.canonical.getSnapshotInTransaction(
              input.transaction,
              scope.activeProjectId,
            )
          : await dependencies.canonical.getSnapshot(scope.activeProjectId);
      if (input.mode !== 'RESOLVE') {
        if (
          canonicalSnapshot.version !== draft.base.canonicalVersion ||
          canonicalSnapshot.digest !== draft.base.canonicalSnapshotDigest
        ) {
          draftFailure('STALE_APPROVAL', 'The Canonical snapshot changed after approval.');
        }
      }
      const relationOperation = draft.operations.find(
        (
          operation,
        ): operation is Extract<FrontendKnowledgeOperationV1, { readonly kind: 'RELATION_ADD' }> =>
          operation.kind === 'RELATION_ADD',
      );
      let claimEvidenceAuthority: ClaimEvidenceAuthority | undefined;
      if (input.mode !== 'RESOLVE') {
        const claimable = approvedClaimableOperation({
          operations: draft.operations,
          approvedItemIds: approval.approvedItemIds,
          discoveryProvenance: draft.discoveryProvenance,
        });
        const claimOperation =
          claimable.claimReviewItemId === undefined
            ? undefined
            : operationByReviewItemId(draft.operations, claimable.claimReviewItemId);
        if (claimOperation?.kind === 'CLAIM_ADD') {
          claimEvidenceAuthority = await resolveClaimEvidenceAuthority(
            scope,
            claimOperation,
            dependencies.evidence,
          );
        }
      }
      let relationAuthority:
        | Awaited<
            ReturnType<FrontendKnowledgeDraftDiscoveryRelationAuthorityPort['revalidateRelation']>
          >
        | undefined;
      if (relationOperation?.after.schemaVersion === 'relation.v2' && input.mode !== 'RESOLVE') {
        const provenance = draft.discoveryProvenance;
        // The provenance review identifies the Discovery candidate review. The
        // Canonical approval is issued by the later Draft review context, so
        // its context identity is bound by the Draft target/revision/digest
        // checks above rather than being required to equal the source review.
        if (provenance === undefined || provenance.bridgeVersion !== 'adr-152.wp2a.v1') {
          draftFailure(
            'UNSUPPORTED_OPERATION',
            'A relation.v2 Canonical commit requires the exact server Discovery materialization.',
          );
        }
        const authority = dependencies.discoveryRelationAuthority;
        if (authority === undefined) {
          draftFailure(
            'UNSUPPORTED_OPERATION',
            'The Discovery relation authority is unavailable for final commit validation.',
          );
        }
        relationAuthority = await authority.revalidateRelation({
          transaction: input.transaction,
          scope,
          draft,
          operation: relationOperation,
        });
        if (
          stableJson(frontendKnowledgeDraftDiscoveryRelationSemanticV1(relationOperation)) !==
            stableJson(
              frontendKnowledgeDraftDiscoveryRelationSemanticV1(
                relationAuthority.expectedOperation,
              ),
            ) ||
          stableJson(provenance) !== stableJson(relationAuthority.provenance) ||
          frontendKnowledgeDraftOperationDigestV1(relationOperation) !==
            relationOperation.contentDigest
        ) {
          draftFailure(
            'DIGEST_MISMATCH',
            'The persisted Discovery relation operation no longer matches authoritative Review.',
          );
        }
      }
      return { draft, approval, canonicalSnapshot, relationAuthority, claimEvidenceAuthority };
    };
    const commitCanonical = async (
      transaction: unknown | undefined,
      write: FrontendCanonicalCommitWrite,
    ): Promise<CanonicalCommitResult> =>
      transaction !== undefined &&
      dependencies.canonical.commitFrontendDraftInTransaction !== undefined
        ? dependencies.canonical.commitFrontendDraftInTransaction(transaction, write)
        : dependencies.canonical.commitFrontendDraft(write);
    const consumeApproval = async (
      transaction: unknown | undefined,
      approvalId: string,
      canonicalCommitId: string,
      consumedAt: string,
    ): Promise<void> =>
      transaction !== undefined && dependencies.approvals.consumeApprovalInTransaction !== undefined
        ? dependencies.approvals.consumeApprovalInTransaction(
            transaction,
            approvalId,
            canonicalCommitId,
            consumedAt,
            scope.principalId,
          )
        : dependencies.approvals.consumeApproval(
            approvalId,
            canonicalCommitId,
            consumedAt,
            scope.principalId,
          );
    const buildWrite = (input: {
      readonly draft: FrontendKnowledgeDraftChangeSetV1;
      readonly approval: ReviewApprovalV1;
      readonly canonicalSnapshot: CanonicalSnapshot;
      readonly relationAuthority?: Awaited<
        ReturnType<FrontendKnowledgeDraftDiscoveryRelationAuthorityPort['revalidateRelation']>
      >;
      readonly claimEvidenceAuthority?: ClaimEvidenceAuthority;
      readonly now: string;
    }): FrontendCanonicalCommitWrite => {
      const claimable = approvedClaimableOperation({
        operations: input.draft.operations,
        approvedItemIds: input.approval.approvedItemIds,
        discoveryProvenance: input.draft.discoveryProvenance,
      });
      const authority: FrontendCanonicalAuthorityV1 = {
        kind: 'FRONTEND_REVIEW_APPROVAL',
        approvalId: input.approval.approvalId,
        approvalBindingDigest: input.approval.approvedManifestDigest,
        reviewContextId: input.approval.reviewContextId,
        contextRevision: input.approval.contextRevision,
        draftId: input.draft.draftId,
        draftRevision: input.draft.revision,
        draftContentDigest: input.draft.reviewSubmission!.contentDigest,
        approvedItemIds: [...input.approval.approvedItemIds],
      };
      const actor: Actor = { type: 'user', id: scope.principalId };
      const base = {
        projectId: scope.activeProjectId,
        expectedCanonicalVersion: input.canonicalSnapshot.version,
        snapshotDigest: input.canonicalSnapshot.digest,
        authority,
        reason: `Knowledge Draft ${input.draft.draftId} committed via Review Approval ${input.approval.approvalId}.`,
        actor,
        committedAt: input.now,
      };
      // canonical.commits.commit_id is a uuid column; the derived revision,
      // history and outbox identities follow the legacy `prefix:<commitId>`
      // convention (text columns). The commit id is DETERMINISTIC so replay and
      // crash recovery rebuild the identical write.
      const commitId = deterministicCanonicalCommitId(
        input.approval.approvalId,
        input.draft.draftId,
      );
      const claimOperation =
        claimable.claimReviewItemId === undefined
          ? undefined
          : operationByReviewItemId(input.draft.operations, claimable.claimReviewItemId);
      const relationOperation =
        claimable.relationReviewItemId === undefined
          ? undefined
          : operationByReviewItemId(input.draft.operations, claimable.relationReviewItemId);
      if (claimOperation?.kind === 'CLAIM_ADD') {
        // FE-P5-XP Correction B (Round 2, GPT #3): never fabricate a source
        // version from the resource id. A CLAIM_ADD commit requires at least
        // one evidence reference, and the single-source Canonical claim model
        // cannot silently reduce multiple source versions to the first one.
        if (claimOperation.evidenceReferences.length === 0) {
          draftFailure(
            'VALIDATION_FAILED',
            'A CLAIM_ADD commit requires at least one evidence reference.',
          );
        }
        const sourceVersionIds = new Set(
          claimOperation.evidenceReferences.map((ref) => ref.sourceVersionId),
        );
        if (sourceVersionIds.size > 1) {
          draftFailure(
            'UNSUPPORTED_OPERATION',
            'Multiple evidence source versions cannot be represented in the single-source Canonical claim model.',
          );
        }
        if (input.claimEvidenceAuthority === undefined) {
          draftFailure(
            'VALIDATION_FAILED',
            'The authoritative Evidence provenance is unavailable for Canonical commit.',
          );
        }
        const evidence = claimOperation.evidenceReferences[0]!;
        return {
          ...base,
          commitId,
          revisionId: `revision:${commitId}`,
          historyEventId: `history:${commitId}`,
          outboxId: `outbox:${commitId}`,
          operation: 'ADD_CLAIM',
          claimId: claimOperation.target.targetId ?? `claim:${claimOperation.operationId}`,
          claimText: claimOperation.after.statement,
          sourceVersionId: evidence.sourceVersionId,
          evidenceIds: claimOperation.evidenceReferences.map((ref) => ref.evidenceSpanId),
          accessScope: [...input.claimEvidenceAuthority.accessScope],
          sensitivity: input.claimEvidenceAuthority.sensitivity,
        };
      }
      if (relationOperation?.kind === 'RELATION_ADD') {
        if (relationOperation.after.schemaVersion !== 'relation.v2') {
          draftFailure(
            'UNSUPPORTED_OPERATION',
            'Only the server-created relation.v2 Draft operation can reach Canonical.',
          );
        }
        const relation = relationOperation.after as RelationDraftValueV2;
        if (input.relationAuthority === undefined) {
          draftFailure(
            'UNSUPPORTED_OPERATION',
            'The Discovery relation authority is required before Canonical commit.',
          );
        }
        const logicalIdentityKey = canonicalRelationLogicalIdentityV1({
          projectId: input.draft.resourceProjectId,
          relationType: relation.relationType,
          fromEndpoint: relation.fromEndpoint,
          toEndpoint: relation.toEndpoint,
          direction: relation.direction,
          ...(relation.validFrom === undefined ? {} : { validFrom: relation.validFrom }),
          ...(relation.validTo === undefined ? {} : { validTo: relation.validTo }),
        });
        return {
          ...base,
          commitId,
          revisionId: `revision:${commitId}`,
          historyEventId: `history:${commitId}`,
          outboxId: `outbox:${commitId}`,
          operation: 'ADD_RELATION',
          relationId: `relation:${commitId}`,
          logicalIdentityKey,
          relationType: relation.relationType,
          fromEndpoint: relation.fromEndpoint,
          toEndpoint: relation.toEndpoint,
          direction: relation.direction,
          ...(relation.validFrom === undefined ? {} : { validFrom: relation.validFrom }),
          ...(relation.validTo === undefined ? {} : { validTo: relation.validTo }),
          evidenceIds: relationOperation.evidenceReferences.map((ref) => ref.evidenceSpanId),
          accessScope: [...input.relationAuthority.accessScope],
          sensitivity: input.relationAuthority.sensitivity,
          ...(input.draft.discoveryProvenance === undefined
            ? {}
            : {
                discoveryProvenanceRef: input.draft.discoveryProvenance.review.reviewResourceId,
                discoveryProvenanceRevision:
                  input.draft.discoveryProvenance.review.reviewResourceRevision,
              }),
        };
      }
      return {
        ...base,
        commitId,
        revisionId: `revision:${commitId}`,
        historyEventId: `history:${commitId}`,
        outboxId: `outbox:${commitId}`,
        operation: 'NO_OP',
      };
    };
    return this.runCommand<CommitKnowledgeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.commitFrontendDraft,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      actionOnRepositories: async (repositories, transaction) => {
        const now = new Date().toISOString();
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        const { draft, approval, canonicalSnapshot, relationAuthority, claimEvidenceAuthority } =
          await revalidated({
            draft: current,
            transaction,
          });
        const write = buildWrite({
          draft,
          approval,
          canonicalSnapshot,
          relationAuthority,
          claimEvidenceAuthority,
          now,
        });
        // Order per §3.2: durable Canonical commit → Approval CONSUMED → the
        // runCommand envelope completes the ledger command afterwards.
        const result = await commitCanonical(transaction, write);
        await consumeApproval(transaction, approval.approvalId, result.commitId, now);
        return commitResult({ canonicalCommitId: result.commitId });
      },
      onReplay: async () => {
        // Ledger says COMPLETED: resolve the same commit identity without
        // re-executing side effects (the Approval may already be CONSUMED).
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        const { approval } = await revalidated({ draft, mode: 'RESOLVE' });
        return commitResult({
          canonicalCommitId: deterministicCanonicalCommitId(approval.approvalId, draft.draftId),
        });
      },
      onReplayRecovery: async (originalCommandId, repositories, transaction) => {
        // Crash recovery (GPT Round 2 #1, Round 3): recovery MUST first branch
        // on whether the durable Canonical commit exists. Only a crash AFTER
        // the durable commit may skip the fail-closed revalidation; if no
        // commit exists, the full REVALIDATE chain runs (so a stale Draft is
        // NEVER silently rebased onto the current Canonical snapshot).
        const dependencies = this.commitDependencies!;
        const now = new Date().toISOString();
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        const approvalRead =
          transaction !== undefined &&
          dependencies.approvals.findByIdWithRevisionInTransaction !== undefined
            ? await dependencies.approvals.findByIdWithRevisionInTransaction(
                transaction,
                request.approvalId,
              )
            : await dependencies.approvals.findByIdWithRevision(request.approvalId);
        if (!approvalRead) {
          draftFailure('NOT_FOUND', 'The Review Approval was not found.');
        }
        const { approval } = approvalRead;
        const commitId = deterministicCanonicalCommitId(approval.approvalId, current.draftId);
        const existing =
          transaction !== undefined && dependencies.canonical.findCommitInTransaction !== undefined
            ? await dependencies.canonical.findCommitInTransaction(
                transaction,
                scope.activeProjectId,
                commitId,
              )
            : await dependencies.canonical.findCommit(scope.activeProjectId, commitId);
        if (existing) {
          // Crash after the durable commit: verify the commit's authority
          // (project + approval id + binding digest), then recover the
          // Approval (ACTIVE → CONSUMED, or already CONSUMED by the same
          // commit → idempotent) and complete the ORIGINAL ledger command.
          // No Canonical stale/base revalidation here.
          if (
            existing.projectId !== scope.activeProjectId ||
            existing.authorityId !== approval.approvalId
          ) {
            draftFailure(
              'DRAFT_REVISION_CONFLICT',
              'The existing Canonical commit does not match the Approval authority.',
            );
          }
          if (existing.authorityDigest !== approval.approvedManifestDigest) {
            draftFailure(
              'DIGEST_MISMATCH',
              'The existing Canonical commit authority digest does not match the Approval binding.',
            );
          }
          await consumeApproval(transaction, approval.approvalId, existing.commitId, now);
          return commitResult({ canonicalCommitId: existing.commitId });
        }
        // No durable commit: the crash happened before the commit. Run the full
        // REVALIDATE chain (Approval ACTIVE/expiry/revision + Draft base ==
        // current Canonical + binding digests) and only then commit normally.
        const {
          approval: revalidatedApproval,
          canonicalSnapshot,
          relationAuthority,
          claimEvidenceAuthority,
        } = await revalidated({
          draft: current,
          mode: 'REVALIDATE',
          transaction,
        });
        const write = buildWrite({
          draft: current,
          approval: revalidatedApproval,
          canonicalSnapshot,
          relationAuthority,
          claimEvidenceAuthority,
          now,
        });
        const result = await commitCanonical(transaction, write);
        await consumeApproval(transaction, revalidatedApproval.approvalId, result.commitId, now);
        return commitResult({ canonicalCommitId: result.commitId });
      },
      producedResources: (result) => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: request.draftId,
          resourceRevision: String(result.commitIds[0] ?? request.draftId),
        },
      ],
    });
  }

  async abandonDraft(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: AbandonKnowledgeDraftRequestV1,
  ): Promise<MaterializeDraftResultV1> {
    const commandSemanticDigest = frontendKnowledgeDraftAbandonDigest(request);
    return this.runCommand<MaterializeDraftResultV1>({
      scope,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.abandon,
      request,
      commandSemanticDigest,
      resourceProjectId: scope.activeProjectId,
      preconditions: [draftPrecondition(request.draftId, request.expectedDraftRevision)],
      actionOnRepositories: async (repositories) => {
        const current = await repositories.drafts.findById(scope.activeProjectId, request.draftId);
        if (!current) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        if (current.status === 'SUBMITTED') {
          draftFailure(
            'DRAFT_REVISION_CONFLICT',
            'A submitted Draft cannot be abandoned; it must be retained.',
          );
        }
        const next = transitionFrontendKnowledgeDraftStatus({
          current,
          expectedDraftRevision: request.expectedDraftRevision,
          expectedBaseRevision: request.expectedBaseRevision,
          nextStatus: 'ABANDONED',
          updatedAt: new Date().toISOString(),
        });
        await persistFrontendKnowledgeDraftTransitionOn(repositories, {
          projectId: scope.activeProjectId,
          draft: next,
          expectedRevision: request.expectedDraftRevision,
        });
        return this.materializeResult(request, next);
      },
      onReplay: async () => {
        const draft = await this.draftById(scope.activeProjectId, request.draftId);
        if (!draft) {
          draftFailure('DRAFT_NOT_FOUND', 'The Draft was not found.');
        }
        return this.materializeResult(request, draft);
      },
      producedResources: () => [
        {
          resourceKind: FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft,
          resourceId: request.draftId,
        },
      ],
    });
  }

  async resolveCommandOutcome(
    scope: FrontendKnowledgeDraftCommandScopeV1,
    request: ResolveKnowledgeDraftCommandOutcomeRequestV1,
  ): Promise<ResolveKnowledgeDraftCommandOutcomeResultV1> {
    const outcome = await this.commandGateway.findByClientRequestId(
      scope.principalId,
      request.clientRequestId,
    );
    if (!outcome) {
      draftFailure(
        'OUTCOME_NOT_FOUND',
        'No command outcome matches the original request identity.',
      );
    }
    if (!isDraftCommandType(outcome.commandType)) {
      draftFailure('OUTCOME_NOT_FOUND', 'The command outcome is not a Knowledge Draft command.');
    }
    if (outcome.idempotencyKey !== request.idempotencyKey) {
      draftFailure(
        'OUTCOME_NOT_FOUND',
        'The command outcome does not match the requested idempotency key.',
      );
    }
    if (outcome.commandSemanticDigest !== request.semanticDigest) {
      draftFailure(
        'DIGEST_MISMATCH',
        'The command semantic digest does not match the original request.',
      );
    }
    if (this.outcomeTargetProjectId(outcome) !== scope.activeProjectId) {
      draftFailure(
        'COMMAND_SCOPE_MISMATCH',
        'The command outcome belongs to another Project scope.',
      );
    }
    const draft =
      outcome.outcomeState === 'COMPLETED' ? await this.draftFromOutcome(outcome) : undefined;
    const outcomeState: FrontendKnowledgeDraftCommandOutcomeV1 =
      outcome.outcomeState === 'COMPLETED'
        ? 'COMPLETED'
        : outcome.outcomeState === 'REJECTED'
          ? 'REJECTED'
          : 'OUTCOME_UNKNOWN';
    return {
      schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      outcome: outcomeState,
      originalClientRequestId: outcome.clientRequestId,
      originalIdempotencyKey: outcome.idempotencyKey,
      ...(draft === undefined ? {} : { draft }),
    };
  }

  private async draftById(
    projectId: string,
    draftId: string,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined> {
    return this.boundary.transaction((repositories) =>
      repositories.drafts.findById(projectId, draftId),
    );
  }

  private async draftFromSeed(
    projectId: string,
    seedId: string,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined> {
    return this.boundary.transaction(async (repositories) => {
      const materialization = await repositories.materializations.findBySeed(seedId);
      if (!materialization) return undefined;
      return repositories.drafts.findById(projectId, materialization.draftId);
    });
  }

  private async draftFromOutcome(
    outcome: AnyFrontendCommandOutcomeView | null,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined> {
    if (!outcome) return undefined;
    const draft = this.producedResource(outcome, FRONTEND_KNOWLEDGE_DRAFT_RESOURCE_KIND.draft);
    if (!draft) return undefined;
    const projectId = this.outcomeTargetProjectId(outcome);
    return this.draftById(projectId, draft.resourceId);
  }

  private producedResource(
    outcome: AnyFrontendCommandOutcomeView,
    resourceKind: string,
  ): { readonly resourceId: string; readonly resourceRevision?: string } | undefined {
    return outcome.producedResources.find((resource) => resource.resourceKind === resourceKind);
  }

  private outcomeTargetProjectId(outcome: AnyFrontendCommandOutcomeView): string {
    const context = outcome.acceptedProjectContext;
    if ('targetProjectId' in context && typeof context.targetProjectId === 'string') {
      return context.targetProjectId;
    }
    draftFailure('COMMAND_SCOPE_MISMATCH', 'The command outcome is missing its Project binding.');
  }

  private materializeResult(
    request: { readonly clientRequestId: string; readonly idempotencyKey: string },
    draft: FrontendKnowledgeDraftChangeSetV1,
  ): MaterializeDraftResultV1 {
    return {
      schemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      outcome: 'COMPLETED',
      clientRequestId: request.clientRequestId,
      idempotencyKey: request.idempotencyKey,
      draft,
    };
  }

  /**
   * Runs the command lifecycle. The Draft write and the Ledger COMPLETED
   * transition happen inside ONE repository transaction (via
   * `transactionWithHandle` + `lockAcceptedForExecution` +
   * `completeInTransaction`), mirroring the Ask coordinator, so a failed
   * Ledger completion can never leave a committed Draft behind. An uncertain
   * outcome is recorded as OUTCOME_UNKNOWN, never a misleading REJECTED.
   */
  private async runCommand<T>(input: FrontendKnowledgeDraftRunCommandInput<T>): Promise<T> {
    const now = new Date().toISOString();
    const commandRequest: AnyFrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: input.commandType,
      commandSchemaVersion: FRONTEND_KNOWLEDGE_DRAFT_API_VERSION,
      clientRequestId: input.request.clientRequestId,
      idempotencyKey: input.request.idempotencyKey,
      projectContext: {
        activeProjectId: input.scope.activeProjectId,
        targetProjectId: input.resourceProjectId,
        resourceProjectId: input.resourceProjectId,
        observedProjectAccessRevision: input.scope.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: input.scope.policyContextRevision,
      },
      preconditions: input.preconditions ?? [],
      clientIssuedAt: now,
      payload: input.request,
    };
    const commandId = generatedIdentity('cmd');
    let accepted;
    try {
      accepted = await this.commandGateway.accept({
        commandId,
        commandRevision: '1',
        principalId: input.scope.principalId,
        request: commandRequest,
        commandSemanticDigest: input.commandSemanticDigest,
        acceptedPolicyContext: {
          policyContextId: 'frontend-knowledge-draft-current-policy',
          policyContextRevision: input.scope.policyContextRevision,
          acceptedAt: now,
        },
        correlationId: generatedIdentity('corr'),
        traceId: generatedIdentity('trace'),
        receivedAt: now,
        acceptedAt: now,
      });
    } catch (error) {
      if (
        error instanceof FrontendContractError &&
        (error.code === 'IDEMPOTENCY_KEY_REUSE_MISMATCH' ||
          error.code === 'CLIENT_REQUEST_MEANING_MISMATCH')
      ) {
        draftFailure(
          'DIGEST_MISMATCH',
          'The request identity is already bound to different command meaning.',
        );
      }
      throw error;
    }

    const outcome = accepted.outcome;
    if (accepted.replayed) {
      // A replayed command is never automatically re-executed.
      if (outcome.outcomeState === 'COMPLETED') {
        if (input.onReplay) return input.onReplay();
        draftFailure(
          'OUTCOME_INDETERMINATE',
          'The command completed but its outcome is unavailable.',
        );
      }
      if (outcome.outcomeState === 'REJECTED') {
        // Preserve the originally recorded failure code.
        throw new FrontendKnowledgeDraftCommandError(
          fromLedgerCode(outcome.rejection?.code ?? 'REVISION_CONFLICT'),
          outcome.rejection?.message ?? 'The Draft command was rejected.',
        );
      }
      // ACCEPTED or OUTCOME_UNKNOWN. FE-P5-XP Correction B: a commit command
      // that was interrupted after its durable side effects may recover
      // idempotently and complete the ORIGINAL command (no new command).
      if (input.onReplayRecovery) {
        try {
          return await this.boundary.transactionWithHandle(async (handle) => {
            const recovered = await input.onReplayRecovery!(
              outcome.commandId,
              handle.repositories,
              handle.raw,
            );
            await this.commandGateway.completeInTransaction(handle.raw, {
              commandId: outcome.commandId,
              producedResources: input.producedResources(recovered),
              completedAt: new Date().toISOString(),
            });
            return recovered;
          });
        } catch (error) {
          try {
            await this.commandGateway.markOutcomeUnknown({
              commandId: outcome.commandId,
              message:
                error instanceof Error ? error.message : 'Draft command recovery is unresolved.',
              completedAt: new Date().toISOString(),
            });
          } catch {
            // Preserve the original recovery error.
          }
          throw error;
        }
      }
      // ACCEPTED or OUTCOME_UNKNOWN: resolve through the original identity.
      draftFailure(
        'OUTCOME_INDETERMINATE',
        'The previous command outcome is unresolved; resolve it through the original command identity before retrying.',
      );
    }

    try {
      return await this.boundary.transactionWithHandle(async (handle) => {
        const locked = await this.commandGateway.lockAcceptedForExecution(
          handle.raw,
          outcome.commandId,
        );
        if (locked.outcomeState === 'COMPLETED') {
          // Completed concurrently by another executor: return the replay result.
          if (input.onReplay) return input.onReplay();
          draftFailure(
            'OUTCOME_INDETERMINATE',
            'The command completed concurrently but its outcome is unavailable.',
          );
        }
        const written = await input.actionOnRepositories(handle.repositories, handle.raw);
        await this.commandGateway.completeInTransaction(handle.raw, {
          commandId: outcome.commandId,
          producedResources: input.producedResources(written),
          completedAt: new Date().toISOString(),
        });
        return written;
      });
    } catch (error) {
      try {
        if (error instanceof FrontendKnowledgeDraftCommandError) {
          // Deterministic domain failure: the transaction rolled back cleanly.
          await this.commandGateway.reject({
            commandId: outcome.commandId,
            code: this.errorCode(error),
            message: error.message,
            completedAt: new Date().toISOString(),
          });
        } else {
          // Uncertain outcome: never claim REJECTED.
          await this.commandGateway.markOutcomeUnknown({
            commandId: outcome.commandId,
            message:
              error instanceof Error ? error.message : 'Draft command outcome is unresolved.',
            completedAt: new Date().toISOString(),
          });
        }
      } catch {
        // Preserve the original error when the ledger write is unavailable.
      }
      throw error;
    }
  }

  private errorCode(error: unknown): ErrorCode {
    if (error instanceof FrontendKnowledgeDraftCommandError) {
      // FE-P3-S2 API failure codes are first-class ErrorCodes.
      return error.apiCode as ErrorCode;
    }
    if (error instanceof FrontendContractError) {
      return error.code as ErrorCode;
    }
    return 'INTERNAL_UNCLASSIFIED';
  }
}
