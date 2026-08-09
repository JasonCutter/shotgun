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
  HistoryEntryV1,
  HistorySourceDomainKindV1,
  ReviewApprovalV1,
  ReviewDecisionRecordV1,
} from '../../../packages/contracts/src/index.js';

export const REVIEW_HISTORY_ADAPTER_ID = 'history-review';

const REVIEW_DOMAIN_KIND: HistorySourceDomainKindV1 = 'REVIEW';

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
        return undefined;
      }
      if (sourceEventKind === 'APPROVAL') {
        const approvals = await repositories.approvals.listByProject(projectId);
        const approval = approvals.find((candidate) => candidate.approvalId === sourceEventId);
        return approval === undefined
          ? undefined
          : this.approvalEntry(projectId, approval, projectedAt);
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

      // Approvals (authoritative Review Approval history).
      const approvals = await repositories.approvals.listByProject(projectId);
      for (const approval of approvals) {
        entries.push(await this.approvalEntry(projectId, approval, projectedAt));
      }
      return entries;
    });
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
