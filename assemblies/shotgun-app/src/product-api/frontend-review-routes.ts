import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import {
  FrontendContractError,
  ShotgunError,
  decodeAddReviewCommentRequestV1,
  decodeCreateReversalDraftChangeSetRequestV1,
  decodeGetReviewApprovalRequestV1,
  decodeGetReviewContextRequestV1,
  decodeGetReviewItemDetailRequestV1,
  decodeListReviewQueueRequestV1,
  decodeRecordReviewDecisionsRequestV1,
  decodeResolveReviewCommandOutcomeRequestV1,
  decodeRevalidateReviewContextRequestV1,
  sha256Text,
  stableJson,
  type ErrorCode,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeEvidenceLineageV1,
  type FrontendKnowledgeOperationV1,
  type ReversalDraftChangeSetV1,
} from '../../../../packages/contracts/src/index.js';
import type { FrontendReviewProductCoordinator } from '../../../../modules/frontend-review/src/product-api.js';
import { ReviewCommandError } from '../../../../modules/frontend-review/src/index.js';
import {
  computeReversalSnapshotImpact,
  type ChangeSetReviewRepositoryPort,
  type ReversalEligibilityPort,
} from '../../../../modules/change-set-review/src/index.js';
import type { FrontendKnowledgeDraftRepositoryBoundaryPort } from '../../../../modules/frontend-knowledge-draft/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../../../modules/canonical-knowledge/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const toReviewError = (error: unknown, operation: string): never => {
  if (error instanceof ReviewCommandError) {
    throw new ShotgunError({
      code: error.apiCode as ErrorCode,
      safeMessage: error.message,
      module: 'frontend-review-api',
      operation,
    });
  }
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-review-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'Review request failed.',
    module: 'frontend-review-api',
    operation,
    cause: error,
  });
};

type ReversalDraftScope = {
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

/**
 * FE-P5-S2 WP5 (Round 3 Blocker 2): materialize a Reversal candidate as a
 * SUBMITTED Knowledge DraftChangeSet in the approved frontend-knowledge-draft
 * store (migration 025), so the EXISTING single `KNOWLEDGE_DRAFT_CHANGE_SET`
 * Review adapter resolves it for Queue / Get Context / Record Decisions /
 * Approval — no new ReviewTargetKind, no adapter collision, no new migration.
 * The browser never authors any of these values; all authority is server-derived.
 */
const materializeReversalAsKnowledgeDraft = async (input: {
  readonly scope: ReversalDraftScope;
  readonly reversal: ReversalDraftChangeSetV1;
  readonly canonical: CanonicalKnowledgeRepositoryPort;
}): Promise<FrontendKnowledgeDraftChangeSetV1> => {
  const { scope, reversal, canonical } = input;
  const revision = await canonical.findRevision(
    reversal.resourceProjectId,
    reversal.sourceRevisionId,
  );
  const snapshot = await canonical.getSnapshot(reversal.resourceProjectId);
  const history = await canonical.listHistory(reversal.resourceProjectId);
  const impact = revision ? computeReversalSnapshotImpact(revision, snapshot, history) : undefined;
  const removedClaimIds = impact?.removedClaimIds ?? [];
  const claimText = (claimId: string): string =>
    snapshot.claims.find((claim) => claim.claimId === claimId)?.text ?? '';
  const projectPolicyContext = {
    activeProjectId: scope.activeProjectId,
    resourceProjectId: reversal.resourceProjectId,
    draftProjectId: reversal.resourceProjectId,
    effectiveProjectId: reversal.resourceProjectId,
    accessRevision: scope.accessRevision,
    policyContextRevision: scope.policyContextRevision,
  };
  // Round 4 Option 1: the derived carrier preserves the authoritative Reversal
  // evidence (sourceCommitId + historicalApprovalRef) as EVIDENCE/REFERENCE
  // ONLY (never authority) so the durable change-set-review record and the
  // Review carrier stay linked. historicalApprovalRef is preserved per ADR-131
  // §4 / WP3 (evidence/reference only).
  const reversalEvidence: FrontendKnowledgeEvidenceLineageV1[] = [
    {
      sourceId: reversal.sourceRevisionId,
      sourceVersionId: reversal.sourceCommitId,
      evidenceSpanId: reversal.historicalApprovalRef ?? `reversal:${reversal.reversalId}`,
    },
  ];
  const operations: FrontendKnowledgeOperationV1[] =
    removedClaimIds.length > 0
      ? removedClaimIds.map((claimId) => ({
          operationId: `reversal-remove:${claimId}`,
          baseRevision: snapshot.version,
          rationale: `Reversal of ${reversal.sourceRevisionId}`,
          evidenceReferences: reversalEvidence,
          expectedImpact: { summary: `Removes claim ${claimId}` },
          operationRevision: 1,
          contentDigest: sha256Text(
            stableJson({ claimId, kind: 'CLAIM_REMOVE', sourceCommitId: reversal.sourceCommitId }),
          ),
          kind: 'CLAIM_REMOVE' as const,
          target: { targetType: 'CLAIM' as const, targetId: claimId, resourceId: claimId },
          before: { schemaVersion: 'claim.v1' as const, statement: claimText(claimId) },
        }))
      : [
          {
            operationId: `reversal:${reversal.reversalId}`,
            baseRevision: snapshot.version,
            rationale: `Reversal of ${reversal.sourceRevisionId}`,
            evidenceReferences: reversalEvidence,
            expectedImpact: { summary: 'Reversal candidate (no claim removal)' },
            operationRevision: 1,
            contentDigest: sha256Text(
              stableJson({
                reversalId: reversal.reversalId,
                sourceCommitId: reversal.sourceCommitId,
              }),
            ),
            kind: 'NO_OP' as const,
            target: { targetType: 'REVIEW_RESULT' as const, resourceId: 'reversal' },
            after: {
              schemaVersion: 'no-op-review-result.v1' as const,
              result: 'NO_CHANGE_REQUIRED' as const,
              reason: 'Reversal with no claim removal',
            },
          },
        ];
  const base = {
    resourceProjectId: reversal.resourceProjectId,
    canonicalSnapshotId: snapshot.snapshotId,
    canonicalVersion: snapshot.version,
    canonicalSnapshotDigest: snapshot.digest,
    accessRevision: scope.accessRevision,
    policyContextRevision: scope.policyContextRevision,
    sourceLineage: [],
    revisionIdentityKind: 'RESOURCE_REVISION' as const,
    canonicalResourceId: reversal.sourceRevisionId,
    canonicalRevisionId: reversal.sourceRevisionId,
  };
  const contentDigest = sha256Text(
    stableJson({ draftId: reversal.reversalId, revision: 1, base, operations }),
  );
  const validationArtifact = {
    artifactId: `reversal-validation:${reversal.reversalId}`,
    artifactRevision: 1,
    digest: sha256Text(stableJson({ reversalId: reversal.reversalId, kind: 'validation' })),
    status: 'COMPLETE' as const,
    projectPolicyContext,
  };
  const impactArtifact = {
    artifactId: `reversal-impact:${reversal.reversalId}`,
    artifactRevision: 1,
    digest: impact?.impactedDigest ?? contentDigest,
    status: 'COMPLETE' as const,
    projectPolicyContext,
  };
  const reviewResource = {
    reviewResourceId: reversal.reversalId,
    draftId: reversal.reversalId,
    draftRevision: 1,
    resourceProjectId: reversal.resourceProjectId,
    draftProjectId: reversal.resourceProjectId,
    effectiveProjectId: reversal.resourceProjectId,
    policyContextRevision: scope.policyContextRevision,
    digest: contentDigest,
  };
  return {
    schemaVersion: '1.0.0',
    draftId: reversal.reversalId,
    startMode: 'KNOWLEDGE_PAGE',
    status: 'SUBMITTED',
    revision: 1,
    activeProjectId: scope.activeProjectId,
    resourceProjectId: reversal.resourceProjectId,
    draftProjectId: reversal.resourceProjectId,
    effectiveProjectId: reversal.resourceProjectId,
    resourceId: reversal.sourceRevisionId,
    base,
    operations,
    validation: validationArtifact,
    impactPreview: impactArtifact,
    reviewResource,
    reviewSubmission: {
      reviewSubmissionId: `review-submission:${reversal.reversalId}`,
      draftId: reversal.reversalId,
      draftRevision: 1,
      operationDigest: contentDigest,
      contentDigest,
      validationArtifact,
      impactArtifact,
      evidenceLineage: reversalEvidence,
      projectPolicyContext,
      reviewResource,
    },
    contentDigest,
    createdAt: reversal.createdAt,
    updatedAt: reversal.createdAt,
  };
};

/**
 * FE-P5-S2 WP6 (Round 1 Blocker B): reconcile the derived Review carrier from
 * the authoritative change-set-review Reversal records.
 *
 * The authoritative Reversal (review.reversals) and the derived SUBMITTED
 * Knowledge Draft carrier (migration 025) are separate persistence
 * boundaries. If a carrier write fails after the authoritative save succeeds,
 * the Reversal is durable but missing from the Review Queue. This helper
 * deterministically regenerates the carrier for the SAME reversalId (never a
 * new Reversal) from the authoritative record, so the Review Queue is
 * recovered. Returns the number of carriers regenerated.
 */
const reconcileReversalCarriers = async (input: {
  readonly scope: ReversalDraftScope;
  readonly canonical: CanonicalKnowledgeRepositoryPort;
  readonly draftRepository: FrontendKnowledgeDraftRepositoryBoundaryPort;
  readonly reversalStore: ChangeSetReviewRepositoryPort;
}): Promise<number> => {
  const { scope, canonical, draftRepository, reversalStore } = input;
  const reversals = await reversalStore.listReversals(scope.activeProjectId);
  let reconciled = 0;
  for (const reversal of reversals) {
    const existing = await draftRepository.transaction(({ drafts }) =>
      drafts.findById(scope.activeProjectId, reversal.reversalId),
    );
    if (existing) continue;
    const draft = await materializeReversalAsKnowledgeDraft({ scope, reversal, canonical });
    await draftRepository.transaction(async ({ drafts }) => {
      await drafts.insert(draft);
    });
    reconciled += 1;
  }
  return reconciled;
};

export function registerFrontendReviewRoutes(
  server: FastifyInstance,
  coordinator: FrontendReviewProductCoordinator,
  reversalEligibilityPort: ReversalEligibilityPort,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
  options?: {
    /**
     * FE-P5-S2 WP5 (Round 3 Blocker 2): when a Reversal is created it is
     * materialized as a SUBMITTED Knowledge DraftChangeSet and persisted to the
     * approved frontend-knowledge-draft store (migration 025), so the EXISTING
     * single KNOWLEDGE_DRAFT_CHANGE_SET adapter resolves it for Queue / Get
     * Context / Record Decisions / Approval without an adapter collision.
     */
    readonly frontendKnowledgeDraftRepository?: FrontendKnowledgeDraftRepositoryBoundaryPort;
    readonly canonicalKnowledgeRepository?: CanonicalKnowledgeRepositoryPort;
    /**
     * FE-P5-S2 WP6 (Round 1 Blocker B): the owning change-set-review store
     * holding the authoritative Reversal records, used to reconcile a missing
     * derived carrier (same reversalId → deterministic carrier regeneration)
     * so the Review Queue is recovered after a carrier-write failure.
     */
    readonly changeSetReviewRepository?: ChangeSetReviewRepositoryPort;
  },
): void {
  const buildReviewScope = async (headers: SecurityHeaders) => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Review requires an active Project.',
        module: 'frontend-review-api',
        operation: 'build-review-scope',
      });
    }
    const membership = await authRepository.findMembership(
      current.principalContext.principalId,
      activeProjectId,
    );
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${activeProjectId}'.`,
        module: 'frontend-review-api',
        operation: 'build-review-scope',
      });
    }
    const settings = await settingsRepository.getSettingsSnapshot(activeProjectId);
    return {
      principalId: current.principalContext.principalId,
      sessionId: current.session.sessionId,
      activeProjectId,
      accessRevision: `${activeProjectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(settings.policyContextRevision),
      sensitivityClearance: membership.sensitivityClearance,
      accessScope: [...membership.scopes].sort(),
    };
  };

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/queue',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        // FE-P5-S2 WP6 (Round 1 Blocker B): reconcile any authoritative Reversal
        // that lost its derived carrier (carrier-write failure after the
        // authoritative save) — the SAME reversalId carrier is regenerated
        // deterministically, so the Review Queue is recovered before serving it.
        if (
          options?.frontendKnowledgeDraftRepository &&
          options?.canonicalKnowledgeRepository &&
          options?.changeSetReviewRepository
        ) {
          await reconcileReversalCarriers({
            scope,
            canonical: options.canonicalKnowledgeRepository,
            draftRepository: options.frontendKnowledgeDraftRepository,
            reversalStore: options.changeSetReviewRepository,
          });
        }
        const decoded = decodeListReviewQueueRequestV1(request.body);
        return await coordinator.listReviewQueue(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'list-review-queue');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/contexts/read',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeGetReviewContextRequestV1(request.body);
        return await coordinator.getReviewContext(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'get-review-context');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/items/read',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeGetReviewItemDetailRequestV1(request.body);
        return await coordinator.getReviewItemDetail(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'get-review-item-detail');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/contexts/revalidate',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeRevalidateReviewContextRequestV1(request.body);
        return await coordinator.revalidateReviewContext(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'revalidate-review-context');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/decisions',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeRecordReviewDecisionsRequestV1(request.body);
        return await coordinator.recordReviewDecisions(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'record-review-decisions');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/comments',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeAddReviewCommentRequestV1(request.body);
        return await coordinator.addReviewComment(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'add-review-comment');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/approvals/read',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeGetReviewApprovalRequestV1(request.body);
        return await coordinator.getReviewApproval(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'get-review-approval');
      }
    },
  );

  server.get<{
    Params: { clientRequestId: string };
    Querystring: { idempotencyKey?: string; semanticDigest?: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/review/command-outcomes/by-client-request/:clientRequestId',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeResolveReviewCommandOutcomeRequestV1({
          schemaVersion: '1.0.0',
          clientRequestId: request.params.clientRequestId,
          idempotencyKey: request.query.idempotencyKey,
          semanticDigest: request.query.semanticDigest,
        });
        return await coordinator.resolveCommandOutcome(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'resolve-review-command-outcome');
      }
    },
  );

  // FE-P5-S2 WP3/WP5 — Reversal initiation (change-set-review owning route).
  // The browser only names the historical source revision; the server derives
  // the current capability (REVERSAL_CURRENT_CAPABILITY) and the principal, and
  // creates a CANDIDATE Reversal draft for the current Review flow.
  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/reversal-draft',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeCreateReversalDraftChangeSetRequestV1(
          request.body,
          'createReversalDraftChangeSet',
        );
        if (decoded.resourceProjectId !== scope.activeProjectId) {
          throw new ShotgunError({
            code: 'PROJECT_ACCESS_DENIED',
            safeMessage: 'Reversal requires the active Project.',
            module: 'frontend-review-api',
            operation: 'create-reversal-draft',
          });
        }
        const result = await reversalEligibilityPort.createReversalDraftChangeSet({
          resourceProjectId: decoded.resourceProjectId,
          sourceRevisionId: decoded.sourceRevisionId,
          reason: decoded.reason,
          createdBy: scope.principalId,
          createdAt: new Date().toISOString(),
        });
        // FE-P5-S2 WP5 (Round 3 Blocker 2): persist the Reversal candidate as a
        // SUBMITTED Knowledge DraftChangeSet in the approved
        // frontend-knowledge-draft store (migration 025). The existing single
        // KNOWLEDGE_DRAFT_CHANGE_SET Review adapter then resolves it for
        // Queue / Get Context / Record Decisions / Approval — no adapter
        // collision, no new ReviewTargetKind, no new migration.
        const draftRepository = options?.frontendKnowledgeDraftRepository;
        const canonical = options?.canonicalKnowledgeRepository;
        if (draftRepository && canonical) {
          try {
            const draft = await materializeReversalAsKnowledgeDraft({
              scope,
              reversal: result.reversal,
              canonical,
            });
            await draftRepository.transaction(async ({ drafts }) => {
              await drafts.insert(draft);
            });
          } catch (error) {
            // FE-P5-S2 WP6 (Round 1 Blocker B): the authoritative Reversal is
            // ALREADY durable in change-set-review (createReversalDraftChangeSet
            // persisted it before returning). Report the derived-carrier write
            // failure safely; the queue reconciliation regenerates the carrier
            // for the SAME reversalId deterministically (never a new Reversal).
            throw new ShotgunError({
              code: 'INTERNAL_UNCLASSIFIED',
              safeMessage: 'Reversal created but the Review carrier could not be written.',
              module: 'frontend-review-api',
              operation: 'create-reversal-draft',
              cause: error,
            });
          }
        }
        return {
          schemaVersion: '1.0.0',
          reversal: result.reversal,
          eligibility: result.eligibility,
        };
      } catch (error) {
        throw toReviewError(error, 'create-reversal-draft');
      }
    },
  );
}
