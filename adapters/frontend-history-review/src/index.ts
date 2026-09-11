/**
 * FE-P5-S2 WP4 — Review History adapter.
 *
 * Maps the authoritative Review history (contexts + decisions + approvals)
 * into federated `HistoryEntryV1` rows. Reads run inside the owning Review
 * boundary transaction so in-memory and PostgreSQL behavior are identical.
 * Decisions are the primary Review history; Approvals are included as their
 * own source events. The adapter never mutates the owning Domain and preserves
 * the authoritative event identity exactly
 * (`sourceEventId = decisionId | approvalId`).
 */

import type { ReviewRepositoryBoundaryPort } from '../../../modules/frontend-review/src/index.js';
import type {
  PayloadStateRecord,
  PayloadStateStorePort,
} from '../../../modules/frontend-history/src/index.js';
import { redactHistoryPayload } from '../../../modules/frontend-history/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';
import type {
  ComparisonV2DecisionHistoryRecord,
  ComparisonV2PersistedDecision,
  ReviewV2RepositoryPort,
} from '../../../modules/change-set-review/src/index.js';
import type { DraftChangeSetV2 } from '../../../packages/contracts/src/index.js';
import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
  ReviewApprovalV1,
  ReviewDecisionRecordV1,
} from '../../../packages/contracts/src/index.js';

export const REVIEW_HISTORY_ADAPTER_ID = 'history-review';

const REVIEW_DOMAIN_KIND: HistorySourceDomainKindV1 = 'REVIEW';

/**
 * Read-only access to the existing Stage 5 V2 Review authority.  This is a
 * deliberately narrow structural view: the History projection cannot write
 * drafts, decisions, manifests, or Canonical state.
 */
export type ReviewV2HistoryReader = Pick<
  ReviewV2RepositoryPort,
  'listDrafts' | 'listDecisions' | 'findDecisionById'
>;

type V2HistoryBinding = {
  readonly draft: DraftChangeSetV2;
  readonly record: ComparisonV2DecisionHistoryRecord;
};

const reviewState = async (
  payloadState: PayloadStateStorePort,
  projectId: string,
  sourceEventKind: string,
  sourceEventId: string,
): Promise<PayloadStateRecord | null> =>
  payloadState.getPayloadState(projectId, sourceEventKind, sourceEventId);

/** Read-time redaction for a projection row (GPT Round 2 F). */
const redactForRead = async (
  payloadState: PayloadStateStorePort,
  entry: HistoryEntryV1,
): Promise<HistoryEntryV1> => {
  const state = await payloadState.getPayloadState(
    entry.resourceProjectId,
    entry.sourceEventKind,
    entry.sourceEventId,
  );
  const availability = state?.payloadAvailability ?? entry.payloadAvailability;
  const redacted = redactHistoryPayload(availability, state, entry.payloadSnapshot);
  return { ...entry, ...redacted };
};

export class ReviewHistoryAdapter implements HistoryAdapterPort {
  readonly adapterId = REVIEW_HISTORY_ADAPTER_ID;
  readonly domainKind = REVIEW_DOMAIN_KIND;

  constructor(
    private readonly review: ReviewRepositoryBoundaryPort,
    private readonly payloadState: PayloadStateStorePort,
    private readonly now: () => Date = () => new Date(),
    private readonly reviewV2?: ReviewV2HistoryReader,
  ) {}

  async readHistory(projectId: string): Promise<readonly HistoryEntryV1[]> {
    return this.mapAll(projectId);
  }

  async resolveHistoryEntry(
    projectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<HistoryEntryV1 | undefined> {
    // Fail-closed: the source identity is matched authoritatively inside the
    // Review boundary; the projection payload is never trusted when unresolved.
    return this.review.transaction(async (repositories) => {
      const projectedAt = this.now().toISOString();
      if (sourceEventKind === 'DECISION') {
        const contextRecords = await repositories.contexts.listContexts(projectId);
        for (const contextRecord of contextRecords) {
          const decisions = await repositories.decisions.findDecisions(
            contextRecord.reviewResourceId,
          );
          const decision = decisions.find((candidate) => candidate.decisionId === sourceEventId);
          if (decision !== undefined) {
            return this.decisionEntry(projectId, decision, projectedAt);
          }
        }
        if (this.reviewV2) {
          const binding = await this.findV2Binding(projectId, sourceEventId);
          return binding === undefined
            ? undefined
            : this.v2DecisionEntry(projectId, binding, projectedAt);
        }
        return undefined;
      }
      if (sourceEventKind === 'APPROVAL') {
        const approvals = await repositories.approvals.listByProject(projectId);
        const approval = approvals.find((candidate) => candidate.approvalId === sourceEventId);
        return approval === undefined
          ? undefined
          : this.approvalEntry(projectId, approval, projectedAt);
      }
      if (sourceEventKind === 'DECISION' && this.reviewV2) {
        const binding = await this.findV2Binding(projectId, sourceEventId);
        return binding === undefined
          ? undefined
          : this.v2DecisionEntry(projectId, binding, projectedAt);
      }
      return undefined;
    });
  }

  async redactEntry(entry: HistoryEntryV1): Promise<HistoryEntryV1> {
    return redactForRead(this.payloadState, entry);
  }

  private async mapAll(projectId: string): Promise<readonly HistoryEntryV1[]> {
    return this.review.transaction(async (repositories) => {
      const projectedAt = this.now().toISOString();
      const entries: HistoryEntryV1[] = [];
      const contextRecords = await repositories.contexts.listContexts(projectId);

      // Decisions per context (authoritative Review Decision history).
      for (const contextRecord of contextRecords) {
        const decisions = await repositories.decisions.findDecisions(
          contextRecord.reviewResourceId,
        );
        for (const decision of decisions) {
          entries.push(await this.decisionEntry(projectId, decision, projectedAt));
        }
      }

      // Stage 5 V2 decisions are read from their owning Review authority and
      // projected additively. They never enter the V1 Review store.
      if (this.reviewV2) {
        const v2Bindings = await this.listV2Bindings(projectId);
        for (const binding of v2Bindings) {
          entries.push(await this.v2DecisionEntry(projectId, binding, projectedAt));
        }
      }

      // Approvals (authoritative Review Approval history).
      const approvals = await repositories.approvals.listByProject(projectId);
      for (const approval of approvals) {
        entries.push(await this.approvalEntry(projectId, approval, projectedAt));
      }
      return entries;
    });
  }

  /**
   * Reuses the Issue #251 authoritative binding rule: a V2 decision is
   * visible only when its project/change-set and expected revision/digest
   * exactly match the owning current authoritative Draft context.  A draft
   * revision advance therefore fails closed instead of silently attaching a
   * decision to the wrong target.
   */
  private validV2Binding(
    projectId: string,
    draft: DraftChangeSetV2,
    record: ComparisonV2DecisionHistoryRecord,
  ): boolean {
    return (
      draft.projectId === projectId &&
      record.projectId === projectId &&
      record.changeSetId === draft.changeSetId &&
      record.decision.decisionId.trim().length > 0 &&
      record.expectedRevisionNumber === draft.revisionNumber &&
      record.expectedContentDigest === draft.contentDigest
    );
  }

  private async listV2Bindings(projectId: string): Promise<readonly V2HistoryBinding[]> {
    const reader = this.reviewV2;
    if (!reader?.listDrafts || !reader.listDecisions) return [];
    const drafts = await reader.listDrafts(projectId);
    const bindings: V2HistoryBinding[] = [];
    const byDecisionId = new Map<string, V2HistoryBinding>();
    for (const draft of drafts) {
      if (draft.projectId !== projectId) continue;
      const decisions = await reader.listDecisions(projectId, draft.changeSetId);
      for (const record of decisions) {
        if (!this.validV2Binding(projectId, draft, record)) continue;
        const existing = byDecisionId.get(record.decision.decisionId);
        if (existing) {
          // A globally unique V2 decision id must not be projected twice. If
          // two paths disagree about its owning identity, fail closed rather
          // than choosing an ambiguous projection.
          if (
            existing.draft.changeSetId !== draft.changeSetId ||
            existing.record.expectedRevisionNumber !== record.expectedRevisionNumber ||
            existing.record.expectedContentDigest !== record.expectedContentDigest ||
            existing.record.decision.decision !== record.decision.decision ||
            existing.record.decision.actor.type !== record.decision.actor.type ||
            existing.record.decision.actor.id !== record.decision.actor.id ||
            existing.record.decision.reason !== record.decision.reason ||
            existing.record.decision.decidedAt !== record.decision.decidedAt
          ) {
            throw new Error('HISTORY_V2_DECISION_AMBIGUOUS');
          }
          continue;
        }
        const binding = { draft, record } satisfies V2HistoryBinding;
        byDecisionId.set(record.decision.decisionId, binding);
        bindings.push(binding);
      }
    }
    return [...bindings].sort((left, right) =>
      `${left.record.decision.decidedAt}\u0000${left.record.decision.decisionId}`.localeCompare(
        `${right.record.decision.decidedAt}\u0000${right.record.decision.decisionId}`,
      ),
    );
  }

  private async findV2Binding(
    projectId: string,
    decisionId: string,
  ): Promise<V2HistoryBinding | undefined> {
    if (!this.reviewV2) return undefined;
    if (this.reviewV2.findDecisionById) {
      const persisted = await this.reviewV2.findDecisionById(projectId, decisionId);
      if (!persisted || !this.validPersistedV2Binding(projectId, decisionId, persisted)) {
        return undefined;
      }
      return {
        draft: persisted.draft,
        record: {
          projectId: persisted.projectId,
          changeSetId: persisted.changeSetId,
          expectedRevisionNumber: persisted.expectedRevisionNumber,
          expectedContentDigest: persisted.expectedContentDigest,
          decision: persisted.decision,
        },
      };
    }
    const matches = (await this.listV2Bindings(projectId)).filter(
      (binding) => binding.record.decision.decisionId === decisionId,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private validPersistedV2Binding(
    projectId: string,
    decisionId: string,
    persisted: ComparisonV2PersistedDecision,
  ): boolean {
    const record: ComparisonV2DecisionHistoryRecord = {
      projectId: persisted.projectId,
      changeSetId: persisted.changeSetId,
      expectedRevisionNumber: persisted.expectedRevisionNumber,
      expectedContentDigest: persisted.expectedContentDigest,
      decision: persisted.decision,
    };
    return (
      persisted.decision.decisionId === decisionId &&
      persisted.draft.changeSetId === persisted.changeSetId &&
      this.validV2Binding(projectId, persisted.draft, record)
    );
  }

  private async v2DecisionEntry(
    projectId: string,
    binding: V2HistoryBinding,
    projectedAt: string,
  ): Promise<HistoryEntryV1> {
    const { draft, record } = binding;
    const state = await reviewState(
      this.payloadState,
      projectId,
      'DECISION',
      record.decision.decisionId,
    );
    const availability = state?.payloadAvailability ?? 'AVAILABLE';
    const redacted = redactHistoryPayload(availability, state, {
      decisionId: record.decision.decisionId,
      changeSetId: record.changeSetId,
      expectedRevisionNumber: record.expectedRevisionNumber,
      expectedContentDigest: record.expectedContentDigest,
      intent: record.decision.decision,
      actor: record.decision.actor,
      reason: record.decision.reason,
      decidedAt: record.decision.decidedAt,
      owningV2Target: {
        projectId: draft.projectId,
        changeSetId: draft.changeSetId,
        comparisonId: draft.comparisonId,
        candidateId: draft.candidate.id,
        revisionNumber: draft.revisionNumber,
        contentDigest: draft.contentDigest,
      },
    });
    return {
      schemaVersion: '1.0.0',
      historyEntryId: `history:${projectId}:v2-decision:${record.decision.decisionId}`,
      resourceProjectId: projectId,
      domainKind: REVIEW_DOMAIN_KIND,
      domainResourceKind: 'REVIEW_DECISION',
      domainResourceId: draft.changeSetId,
      sourceEventKind: 'DECISION',
      sourceEventId: record.decision.decisionId,
      occurredAt: record.decision.decidedAt,
      ...redacted,
      projectedAt,
    };
  }

  private async decisionEntry(
    projectId: string,
    decision: ReviewDecisionRecordV1,
    projectedAt: string,
  ): Promise<HistoryEntryV1> {
    const state = await reviewState(this.payloadState, projectId, 'DECISION', decision.decisionId);
    const availability = state?.payloadAvailability ?? 'AVAILABLE';
    const redacted = redactHistoryPayload(availability, state, {
      reviewContextId: decision.reviewContextId,
      contextRevision: decision.contextRevision,
      reviewItemId: decision.reviewItemId,
      intent: decision.intent,
      terminal: decision.terminal,
      decidedBy: decision.decidedBy.actorId,
    });
    return {
      schemaVersion: '1.0.0',
      historyEntryId: `history:${projectId}:decision:${decision.decisionId}`,
      resourceProjectId: projectId,
      domainKind: REVIEW_DOMAIN_KIND,
      domainResourceKind: 'REVIEW_DECISION',
      domainResourceId: decision.reviewContextId,
      sourceEventKind: 'DECISION',
      sourceEventId: decision.decisionId,
      occurredAt: decision.decidedAt,
      ...redacted,
      projectedAt,
    };
  }

  private async approvalEntry(
    projectId: string,
    approval: ReviewApprovalV1,
    projectedAt: string,
  ): Promise<HistoryEntryV1> {
    const state = await reviewState(this.payloadState, projectId, 'APPROVAL', approval.approvalId);
    const availability = state?.payloadAvailability ?? 'AVAILABLE';
    const redacted = redactHistoryPayload(availability, state, {
      reviewContextId: approval.reviewContextId,
      contextRevision: approval.contextRevision,
      targetKind: approval.targetKind,
      targetId: approval.targetId,
      targetRevision: approval.targetRevision,
      status: approval.status,
      actorId: approval.actor.actorId,
    });
    return {
      schemaVersion: '1.0.0',
      historyEntryId: `history:${projectId}:approval:${approval.approvalId}`,
      resourceProjectId: projectId,
      domainKind: REVIEW_DOMAIN_KIND,
      domainResourceKind: 'REVIEW_APPROVAL',
      domainResourceId: approval.reviewContextId,
      sourceEventKind: 'APPROVAL',
      sourceEventId: approval.approvalId,
      occurredAt: approval.issuedAt,
      ...redacted,
      projectedAt,
    };
  }
}
