import { randomUUID } from 'node:crypto';

import approvedChangeSetManifestSchema from '../../../packages/contracts/schemas/approved-change-set-manifest.v1.schema.json';
import changeSetApprovedSchema from '../../../packages/contracts/schemas/change-set-approved.v1.schema.json';
import checkComparisonFreshnessOutputSchema from '../../../packages/contracts/schemas/check-comparison-freshness-output.v1.schema.json';
import checkComparisonFreshnessSchema from '../../../packages/contracts/schemas/check-comparison-freshness.v1.schema.json';
import claimCandidateSchema from '../../../packages/contracts/schemas/claim-candidate.v1.schema.json';
import comparisonCompletedSchema from '../../../packages/contracts/schemas/comparison-completed.v1.schema.json';
import comparisonResultSchema from '../../../packages/contracts/schemas/comparison-result.v1.schema.json';
import draftChangeSetReadySchema from '../../../packages/contracts/schemas/draft-change-set-ready.v1.schema.json';
import draftChangeSetSchema from '../../../packages/contracts/schemas/draft-change-set.v1.schema.json';
import evidenceSpanSchema from '../../../packages/contracts/schemas/evidence-span.v1.schema.json';
import getApprovedChangeSetManifestSchema from '../../../packages/contracts/schemas/get-approved-change-set-manifest.v1.schema.json';
import getClaimCandidateSchema from '../../../packages/contracts/schemas/get-claim-candidate.v1.schema.json';
import getComparisonResultSchema from '../../../packages/contracts/schemas/get-comparison-result.v1.schema.json';
import getDraftChangeSetSchema from '../../../packages/contracts/schemas/get-draft-change-set.v1.schema.json';
import getEvidenceSpanSchema from '../../../packages/contracts/schemas/get-evidence-span.v1.schema.json';
import getReviewBundleOutputSchema from '../../../packages/contracts/schemas/get-review-bundle-output.v1.schema.json';
import getReviewBundleSchema from '../../../packages/contracts/schemas/get-review-bundle.v1.schema.json';
import listDraftChangeSetsOutputSchema from '../../../packages/contracts/schemas/list-draft-change-sets-output.v1.schema.json';
import listDraftChangeSetsSchema from '../../../packages/contracts/schemas/list-draft-change-sets.v1.schema.json';
import recordReviewDecisionSchema from '../../../packages/contracts/schemas/record-review-decision.v1.schema.json';
import reviewDecisionRecordedSchema from '../../../packages/contracts/schemas/review-decision-recorded.v1.schema.json';
import {
  type ApprovedChangeSetManifest,
  approvedChangeSetManifestDigest,
  approvalTokenDigest,
  type ClaimCandidate,
  type CommandEnvelope,
  type ComparisonResult,
  type DraftChangeSet,
  type EventEnvelope,
  type EvidenceSpan,
  type QueryEnvelope,
  type ReversalDraftChangeSetV1,
  type ReviewDecisionRecord,
  type ReviewDecisionType,
  changeSetContentDigest,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type ReviewDecisionWrite = {
  readonly projectId: string;
  readonly changeSetId: string;
  readonly expectedRevisionNumber: 1;
  readonly expectedContentDigest: string;
  readonly updated: DraftChangeSet;
  readonly decision: ReviewDecisionRecord;
  readonly manifest?: ApprovedChangeSetManifest;
};

export type {
  CreateReversalDraftChangeSetInput,
  CurrentCapabilitiesResolver,
  ReversalCanonicalReader,
  ReversalEligibilityInput,
  ReversalEligibilityPort,
  ReversalFailureCode,
  ReversalSnapshotImpact,
} from './reversal.js';
export {
  REVERSAL_CURRENT_CAPABILITY,
  assessReversalEligibilityFromHistory,
  computeReversalSnapshotImpact,
  createReversalEligibilityPort,
  failureReasons,
  laterHistoryEvents,
  sortHistoryEvents,
  toTypedReversalError,
} from './reversal.js';

export type ChangeSetReviewRepositoryPort = {
  save(changeSet: DraftChangeSet): Promise<DraftChangeSet>;
  findById(projectId: string, changeSetId: string): Promise<DraftChangeSet | undefined>;
  findByComparisonId(projectId: string, comparisonId: string): Promise<DraftChangeSet | undefined>;
  listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly DraftChangeSet[]>;
  findDecision(
    projectId: string,
    decisionId: string,
  ): Promise<
    | {
        readonly changeSet: DraftChangeSet;
        readonly decision: ReviewDecisionRecord;
        readonly manifest?: ApprovedChangeSetManifest;
      }
    | undefined
  >;
  recordDecision(write: ReviewDecisionWrite): Promise<{
    readonly changeSet: DraftChangeSet;
    readonly manifest?: ApprovedChangeSetManifest;
  }>;
  markStale(
    projectId: string,
    changeSetId: string,
    expectedContentDigest: string,
    updatedAt: string,
  ): Promise<DraftChangeSet>;
  findApprovedManifest(
    projectId: string,
    changeSetId: string,
  ): Promise<ApprovedChangeSetManifest | undefined>;
  /**
   * FE-P5-S2 WP5 (Round 4 Option 1): owning-Domain Reversal durable authority.
   *
   * ADR-131 §4 fixes the Reversal owner as change-set-review AUGMENT; the
   * durable authoritative record is a `ReversalDraftChangeSetV1` persisted by
   * the owning store (Architecture Amendment
   * frontend-phase-5-section-2-reversal-durable-ownership-amendment-260809001.md,
   * additive `review.reversals` migration 033). The frozen `DraftChangeSet`
   * shape cannot represent a Reversal (FK-bound candidate/comparison), so the
   * record is a dedicated additive set storing the V1 JSON snapshot.
   */
  saveReversal(reversal: ReversalDraftChangeSetV1): Promise<ReversalDraftChangeSetV1>;
  findReversalById(
    projectId: string,
    reversalId: string,
  ): Promise<ReversalDraftChangeSetV1 | undefined>;
  listReversals(projectId: string): Promise<readonly ReversalDraftChangeSetV1[]>;
};

type ComparisonCompletedPayload = {
  readonly comparisonId: string;
};

type RecordReviewDecisionPayload = {
  readonly decisionId: string;
  readonly changeSetId: string;
  readonly expectedRevisionNumber: 1;
  readonly expectedContentDigest: string;
  readonly decision: ReviewDecisionType;
  readonly reason: string;
};

type FreshnessResult = {
  readonly fresh: boolean;
  readonly reason?: string;
  readonly currentSnapshotVersion: number;
  readonly currentSnapshotDigest: string;
};

const assertContext = (envelope: CommandEnvelope | EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Change Set review requires complete security context.',
      module: 'stage5.change-set-review',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    actor: envelope.actor,
    security: envelope.security,
  };
};

const assertScope = (
  changeSet: DraftChangeSet,
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (changeSet.accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Draft Change Set.',
      module: 'stage5.change-set-review',
      operation: 'read-change-set',
      correlationId,
    });
  }
};

const terminal = new Set<DraftChangeSet['status']>(['APPROVED', 'REJECTED', 'STALE']);

export const createChangeSetReviewModule = (
  repository: ChangeSetReviewRepositoryPort,
): ShotgunModule => ({
  manifest: {
    id: 'stage5.change-set-review',
    version: '1.0.0',
    owner: 'Shotgun Change Set Review',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'ComparisonCompleted', range: '>=1.0.0 <2.0.0' },
        { name: 'GetComparisonResult', range: '>=1.0.0 <2.0.0' },
        { name: 'GetClaimCandidate', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEvidenceSpan', range: '>=1.0.0 <2.0.0' },
        { name: 'CheckComparisonFreshness', range: '>=1.0.0 <2.0.0' },
        { name: 'RecordReviewDecision', range: '>=1.0.0 <2.0.0' },
        { name: 'GetDraftChangeSet', range: '>=1.0.0 <2.0.0' },
        { name: 'ListDraftChangeSets', range: '>=1.0.0 <2.0.0' },
        { name: 'GetReviewBundle', range: '>=1.0.0 <2.0.0' },
        { name: 'GetApprovedChangeSetManifest', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['review.change_sets', 'review.decisions', 'review.approved_manifests'],
      readsViaPorts: [
        'GetComparisonResult query',
        'GetClaimCandidate query',
        'GetEvidenceSpan query',
        'CheckComparisonFreshness query',
      ],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [{ name: 'RecordReviewDecision', range: '>=1.0.0 <2.0.0' }],
      events: [{ name: 'ComparisonCompleted', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [
        { name: 'DraftChangeSetReady', range: '>=1.0.0 <2.0.0' },
        { name: 'ReviewDecisionRecorded', range: '>=1.0.0 <2.0.0' },
        { name: 'ChangeSetApproved', range: '>=1.0.0 <2.0.0' },
      ],
    },
    provides: {
      queries: [
        { name: 'GetDraftChangeSet', range: '>=1.0.0 <2.0.0' },
        { name: 'ListDraftChangeSets', range: '>=1.0.0 <2.0.0' },
        { name: 'GetReviewBundle', range: '>=1.0.0 <2.0.0' },
        { name: 'GetApprovedChangeSetManifest', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'change-set-review-provider', priority: 100 }],
    },
    requires: {
      capabilities: ['claim-comparison-provider', 'claim-candidate-provider', 'evidence-resolver'],
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
      name: 'CheckComparisonFreshness',
      version: '1.0.0',
      kind: 'query',
      inputSchema: checkComparisonFreshnessSchema,
      outputSchema: checkComparisonFreshnessOutputSchema,
    },
    {
      name: 'RecordReviewDecision',
      version: '1.0.0',
      kind: 'command',
      inputSchema: recordReviewDecisionSchema,
    },
    {
      name: 'DraftChangeSetReady',
      version: '1.0.0',
      kind: 'event',
      inputSchema: draftChangeSetReadySchema,
    },
    {
      name: 'ReviewDecisionRecorded',
      version: '1.0.0',
      kind: 'event',
      inputSchema: reviewDecisionRecordedSchema,
    },
    {
      name: 'ChangeSetApproved',
      version: '1.0.0',
      kind: 'event',
      inputSchema: changeSetApprovedSchema,
    },
    {
      name: 'GetDraftChangeSet',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getDraftChangeSetSchema,
      outputSchema: draftChangeSetSchema,
    },
    {
      name: 'ListDraftChangeSets',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listDraftChangeSetsSchema,
      outputSchema: listDraftChangeSetsOutputSchema,
    },
    {
      name: 'GetReviewBundle',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getReviewBundleSchema,
      outputSchema: getReviewBundleOutputSchema,
    },
    {
      name: 'GetApprovedChangeSetManifest',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getApprovedChangeSetManifestSchema,
      outputSchema: approvedChangeSetManifestSchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'RecordReviewDecision',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId, actor, security } = assertContext(envelope);
          if (actor.type !== 'user') {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'Only a user actor can approve, hold, or reject a Change Set.',
              module: 'stage5.change-set-review',
              operation: 'record-review-decision',
              correlationId: envelope.correlationId,
            });
          }
          const payload = envelope.payload as RecordReviewDecisionPayload;
          const current = await repository.findById(projectId, payload.changeSetId);
          if (!current) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Draft Change Set was not found.',
              module: 'stage5.change-set-review',
              operation: 'record-review-decision',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(current, security.accessScope, envelope.correlationId);
          if (
            current.revisionNumber !== payload.expectedRevisionNumber ||
            current.contentDigest !== payload.expectedContentDigest
          ) {
            throw new ShotgunError({
              code: 'STALE_VERSION',
              safeMessage: 'The reviewed Change Set content no longer matches the server.',
              module: 'stage5.change-set-review',
              operation: 'record-review-decision',
              correlationId: envelope.correlationId,
            });
          }
          const existingDecision = await repository.findDecision(projectId, payload.decisionId);
          if (existingDecision) {
            if (
              existingDecision.changeSet.changeSetId !== current.changeSetId ||
              existingDecision.decision.decision !== payload.decision ||
              existingDecision.decision.reason !== payload.reason.trim() ||
              existingDecision.decision.actor.type !== actor.type ||
              existingDecision.decision.actor.id !== actor.id ||
              existingDecision.decision.contentDigest !== current.contentDigest
            ) {
              throw new ShotgunError({
                code: 'CONFLICT',
                safeMessage: 'The review decision id was reused with different content.',
                module: 'stage5.change-set-review',
                operation: 'record-review-decision',
                correlationId: envelope.correlationId,
              });
            }
            return {
              changeSet: existingDecision.changeSet,
              manifest: existingDecision.manifest,
            };
          }
          if (terminal.has(current.status)) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The Draft Change Set already has a final status.',
              module: 'stage5.change-set-review',
              operation: 'record-review-decision',
              correlationId: envelope.correlationId,
            });
          }
          const reason = payload.reason.trim();
          if (!reason) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'A review reason is required.',
              module: 'stage5.change-set-review',
              operation: 'record-review-decision',
              correlationId: envelope.correlationId,
            });
          }
          const freshness = (
            await context.query<{ comparisonId: string }, FreshnessResult>({
              messageType: 'CheckComparisonFreshness',
              schemaVersion: '1.0.0',
              payload: { comparisonId: current.comparisonId },
            })
          ).payload;
          if (!freshness.fresh) {
            await repository.markStale(
              projectId,
              current.changeSetId,
              current.contentDigest,
              envelope.createdAt,
            );
            throw new ShotgunError({
              code: 'STALE_VERSION',
              safeMessage: freshness.reason ?? 'The reviewed comparison is stale.',
              module: 'stage5.change-set-review',
              operation: 'record-review-decision',
              correlationId: envelope.correlationId,
            });
          }

          const issuedAt = envelope.createdAt;
          const expiresAt = new Date(Date.parse(issuedAt) + 24 * 60 * 60 * 1000).toISOString();
          const approvalToken =
            payload.decision === 'APPROVE'
              ? (() => {
                  const unsigned = {
                    tokenId: randomUUID(),
                    changeSetId: current.changeSetId,
                    changeSetRevisionNumber: current.revisionNumber,
                    actorId: actor.id,
                    contentDigest: current.contentDigest,
                    expectedCanonicalVersion: current.expectedCanonicalVersion,
                    snapshotDigest: current.snapshotDigest,
                    issuedAt,
                    expiresAt,
                  } as const;
                  return { ...unsigned, tokenDigest: approvalTokenDigest(unsigned) };
                })()
              : undefined;
          const decision: ReviewDecisionRecord = {
            decisionId: payload.decisionId,
            decision: payload.decision,
            reason,
            actor,
            contentDigest: current.contentDigest,
            decidedAt: envelope.createdAt,
            approvalToken,
          };
          const updated: DraftChangeSet = {
            ...current,
            status:
              payload.decision === 'APPROVE'
                ? 'APPROVED'
                : payload.decision === 'REJECT'
                  ? 'REJECTED'
                  : 'ON_HOLD',
            decisions: [...current.decisions, decision],
            updatedAt: envelope.createdAt,
          };
          const approvedCandidate = approvalToken
            ? (
                await context.query<{ candidateId: string }, ClaimCandidate>({
                  messageType: 'GetClaimCandidate',
                  schemaVersion: '1.0.0',
                  payload: { candidateId: current.candidateId },
                })
              ).payload
            : undefined;
          const manifest: ApprovedChangeSetManifest | undefined = approvalToken
            ? (() => {
                const unsigned = {
                  manifestId: randomUUID(),
                  changeSetId: current.changeSetId,
                  changeSetRevisionNumber: current.revisionNumber,
                  projectId,
                  sourceVersionId: current.sourceVersionId,
                  candidateId: current.candidateId,
                  candidateRevisionNumber: 1 as const,
                  claimText: approvedCandidate!.claimText,
                  operation: current.operation,
                  classification: current.classification,
                  candidateDigest: current.candidateDigest,
                  evidenceIds: current.evidenceIds,
                  accessScope: current.accessScope,
                  sensitivity: current.sensitivity,
                  expectedCanonicalVersion: current.expectedCanonicalVersion,
                  snapshotDigest: current.snapshotDigest,
                  diffDigest: current.diffDigest,
                  contentDigest: current.contentDigest,
                  approvalToken,
                  reason,
                  createdAt: envelope.createdAt,
                } as const;
                return {
                  ...unsigned,
                  manifestDigest: approvedChangeSetManifestDigest(unsigned),
                };
              })()
            : undefined;
          const saved = await repository.recordDecision({
            projectId,
            changeSetId: current.changeSetId,
            expectedRevisionNumber: payload.expectedRevisionNumber,
            expectedContentDigest: payload.expectedContentDigest,
            updated,
            decision,
            manifest,
          });
          await context.publish({
            messageType: 'ReviewDecisionRecorded',
            schemaVersion: '1.0.0',
            idempotencyKey: `review-decision:${projectId}:${payload.decisionId}`,
            payload: {
              changeSetId: saved.changeSet.changeSetId,
              decisionId: decision.decisionId,
              decision: decision.decision,
              actorId: actor.id,
              contentDigest: current.contentDigest,
            },
          });
          if (saved.manifest) {
            await context.publish({
              messageType: 'ChangeSetApproved',
              schemaVersion: '1.0.0',
              idempotencyKey: `change-set-approved:${projectId}:${saved.manifest.manifestId}`,
              payload: {
                manifestId: saved.manifest.manifestId,
                changeSetId: saved.manifest.changeSetId,
                candidateId: saved.manifest.candidateId,
                operation: saved.manifest.operation,
                contentDigest: saved.manifest.contentDigest,
                expectedCanonicalVersion: saved.manifest.expectedCanonicalVersion,
                approvalTokenDigest: saved.manifest.approvalToken.tokenDigest,
                manifestDigest: saved.manifest.manifestDigest,
              },
            });
          }
          return saved;
        },
      },
    ],
    events: [
      {
        messageType: 'ComparisonCompleted',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as ComparisonCompletedPayload;
          const comparison = (
            await context.query<{ comparisonId: string }, ComparisonResult>({
              messageType: 'GetComparisonResult',
              schemaVersion: '1.0.0',
              payload: { comparisonId: payload.comparisonId },
            })
          ).payload;
          const existing = await repository.findByComparisonId(projectId, comparison.comparisonId);
          const candidate = (
            await context.query<{ candidateId: string }, ClaimCandidate>({
              messageType: 'GetClaimCandidate',
              schemaVersion: '1.0.0',
              payload: { candidateId: comparison.candidateId },
            })
          ).payload;
          const changeSet =
            existing ??
            (await repository.save({
              changeSetId: randomUUID(),
              revisionNumber: 1,
              projectId,
              sourceVersionId: comparison.sourceVersionId,
              candidateId: comparison.candidateId,
              comparisonId: comparison.comparisonId,
              operation: comparison.recommendation,
              classification: comparison.classification,
              status: 'PENDING_REVIEW',
              expectedCanonicalVersion: comparison.snapshotVersion,
              snapshotDigest: comparison.snapshotDigest,
              candidateDigest: comparison.candidateDigest,
              diffDigest: comparison.diffDigest,
              contentDigest: changeSetContentDigest({
                operation: comparison.recommendation,
                classification: comparison.classification,
                candidateId: candidate.candidateId,
                candidateRevisionNumber: candidate.revisionNumber,
                candidateDigest: comparison.candidateDigest,
                sourceVersionId: candidate.sourceVersionId,
                evidenceIds: candidate.evidenceIds,
                accessScope: security.accessScope,
                sensitivity: security.sensitivity,
                expectedCanonicalVersion: comparison.snapshotVersion,
                snapshotDigest: comparison.snapshotDigest,
                diffDigest: comparison.diffDigest,
              }),
              evidenceIds: candidate.evidenceIds,
              accessScope: [...security.accessScope],
              sensitivity: security.sensitivity,
              decisions: [],
              createdAt: envelope.createdAt,
              updatedAt: envelope.createdAt,
            }));
          await context.publish({
            messageType: 'DraftChangeSetReady',
            schemaVersion: '1.0.0',
            idempotencyKey: `draft-change-set-ready:${projectId}:${changeSet.changeSetId}`,
            payload: {
              changeSetId: changeSet.changeSetId,
              comparisonId: changeSet.comparisonId,
              candidateId: changeSet.candidateId,
              sourceVersionId: changeSet.sourceVersionId,
              contentDigest: changeSet.contentDigest,
              expectedCanonicalVersion: changeSet.expectedCanonicalVersion,
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'GetDraftChangeSet',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly changeSetId: string };
          const changeSet = await repository.findById(projectId, payload.changeSetId);
          if (!changeSet) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Draft Change Set was not found.',
              module: 'stage5.change-set-review',
              operation: 'get-draft-change-set',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(changeSet, security.accessScope, envelope.correlationId);
          return changeSet;
        },
      },
      {
        messageType: 'ListDraftChangeSets',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly sourceVersionId: string };
          const items = await repository.listBySourceVersion(projectId, payload.sourceVersionId);
          items.forEach((item) => assertScope(item, security.accessScope, envelope.correlationId));
          return { items };
        },
      },
      {
        messageType: 'GetReviewBundle',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly changeSetId: string };
          const changeSet = await repository.findById(projectId, payload.changeSetId);
          if (!changeSet) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Draft Change Set was not found.',
              module: 'stage5.change-set-review',
              operation: 'get-review-bundle',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(changeSet, security.accessScope, envelope.correlationId);
          const comparison = (
            await context.query<{ comparisonId: string }, ComparisonResult>({
              messageType: 'GetComparisonResult',
              schemaVersion: '1.0.0',
              payload: { comparisonId: changeSet.comparisonId },
            })
          ).payload;
          const candidate = (
            await context.query<{ candidateId: string }, ClaimCandidate>({
              messageType: 'GetClaimCandidate',
              schemaVersion: '1.0.0',
              payload: { candidateId: changeSet.candidateId },
            })
          ).payload;
          const evidence = await Promise.all(
            changeSet.evidenceIds.map(async (evidenceId) => {
              const result = await context.query<{ evidenceId: string }, EvidenceSpan>({
                messageType: 'GetEvidenceSpan',
                schemaVersion: '1.0.0',
                payload: { evidenceId },
              });
              return result.payload;
            }),
          );
          return { changeSet, comparison, candidate, evidence };
        },
      },
      {
        messageType: 'GetApprovedChangeSetManifest',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly changeSetId: string };
          const changeSet = await repository.findById(projectId, payload.changeSetId);
          if (!changeSet) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Draft Change Set was not found.',
              module: 'stage5.change-set-review',
              operation: 'get-approved-change-set-manifest',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(changeSet, security.accessScope, envelope.correlationId);
          const manifest = await repository.findApprovedManifest(projectId, payload.changeSetId);
          if (!manifest) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The approved Change Set manifest was not found.',
              module: 'stage5.change-set-review',
              operation: 'get-approved-change-set-manifest',
              correlationId: envelope.correlationId,
            });
          }
          return manifest;
        },
      },
    ],
  },
});
