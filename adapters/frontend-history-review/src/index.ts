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
import type { PayloadStateStorePort } from '../../../modules/frontend-history/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';
import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';

export const REVIEW_HISTORY_ADAPTER_ID = 'history-review';

const REVIEW_DOMAIN_KIND: HistorySourceDomainKindV1 = 'REVIEW';

const reviewAvailability = async (
  payloadState: PayloadStateStorePort,
  projectId: string,
  sourceEventKind: string,
  sourceEventId: string,
): Promise<HistoryEntryV1['payloadAvailability']> => {
  const state = await payloadState.getPayloadState(projectId, sourceEventKind, sourceEventId);
  return state?.payloadAvailability ?? 'AVAILABLE';
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
          const availability = await reviewAvailability(
            this.payloadState,
            projectId,
            'DECISION',
            decision.decisionId,
          );
          entries.push({
            schemaVersion: '1.0.0',
            historyEntryId: `history:${projectId}:decision:${decision.decisionId}`,
            resourceProjectId: projectId,
            domainKind: REVIEW_DOMAIN_KIND,
            domainResourceKind: 'REVIEW_DECISION',
            domainResourceId: decision.reviewContextId,
            sourceEventKind: 'DECISION',
            sourceEventId: decision.decisionId,
            occurredAt: decision.decidedAt,
            payloadAvailability: availability,
            payloadSnapshot: {
              reviewContextId: decision.reviewContextId,
              contextRevision: decision.contextRevision,
              reviewItemId: decision.reviewItemId,
              intent: decision.intent,
              terminal: decision.terminal,
              decidedBy: decision.decidedBy.actorId,
            },
            projectedAt,
          });
        }
      }

      // Approvals (authoritative Review Approval history).
      const approvals = await repositories.approvals.listByProject(projectId);
      for (const approval of approvals) {
        const availability = await reviewAvailability(
          this.payloadState,
          projectId,
          'APPROVAL',
          approval.approvalId,
        );
        entries.push({
          schemaVersion: '1.0.0',
          historyEntryId: `history:${projectId}:approval:${approval.approvalId}`,
          resourceProjectId: projectId,
          domainKind: REVIEW_DOMAIN_KIND,
          domainResourceKind: 'REVIEW_APPROVAL',
          domainResourceId: approval.reviewContextId,
          sourceEventKind: 'APPROVAL',
          sourceEventId: approval.approvalId,
          occurredAt: approval.issuedAt,
          payloadAvailability: availability,
          payloadSnapshot: {
            reviewContextId: approval.reviewContextId,
            contextRevision: approval.contextRevision,
            targetKind: approval.targetKind,
            targetId: approval.targetId,
            targetRevision: approval.targetRevision,
            status: approval.status,
            actorId: approval.actor.actorId,
          },
          projectedAt,
        });
      }
      return entries;
    });
  }
}
