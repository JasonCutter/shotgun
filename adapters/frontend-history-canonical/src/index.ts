/**
 * FE-P5-S2 WP4 — Canonical History adapter.
 *
 * Maps the authoritative Canonical history (`CanonicalKnowledgeRepositoryPort`
 * `listHistory`) into federated `HistoryEntryV1` rows. The adapter never
 * mutates the owning Domain and preserves the authoritative event identity
 * exactly (`sourceEventId = historyEventId`); `historyEntryId` is projection
 * identity only (ADR-131 §2). Payload availability is resolved through the
 * owner-side PayloadState sidecar (migration 032).
 */

import type { CanonicalKnowledgeRepositoryPort } from '../../../modules/canonical-knowledge/src/index.js';
import type { PayloadStateStorePort } from '../../../modules/frontend-history/src/index.js';
import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';

export const CANONICAL_HISTORY_ADAPTER_ID = 'history-canonical';

const CANONICAL_DOMAIN_KIND: HistorySourceDomainKindV1 = 'CANONICAL';

const canonicalPayloadAvailability = async (
  payloadState: PayloadStateStorePort,
  projectId: string,
  event: { eventType: string; historyEventId: string },
): Promise<HistoryEntryV1['payloadAvailability']> => {
  const state = await payloadState.getPayloadState(
    projectId,
    event.eventType,
    event.historyEventId,
  );
  return state?.payloadAvailability ?? 'AVAILABLE';
};

export class CanonicalHistoryAdapter implements HistoryAdapterPort {
  readonly adapterId = CANONICAL_HISTORY_ADAPTER_ID;
  readonly domainKind = CANONICAL_DOMAIN_KIND;

  constructor(
    private readonly canonical: CanonicalKnowledgeRepositoryPort,
    private readonly payloadState: PayloadStateStorePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readHistory(projectId: string): Promise<readonly HistoryEntryV1[]> {
    const events = await this.canonical.listHistory(projectId);
    const projectedAt = this.now().toISOString();
    const entries: HistoryEntryV1[] = [];
    for (const event of events) {
      const availability = await canonicalPayloadAvailability(this.payloadState, projectId, event);
      const domainResourceKind =
        event.eventType === 'CANONICAL_CLAIM_ADDED' ? 'CANONICAL_CLAIM' : 'CANONICAL_CHANGESET';
      entries.push({
        schemaVersion: '1.0.0',
        historyEntryId: `history:${projectId}:${event.historyEventId}`,
        resourceProjectId: projectId,
        domainKind: CANONICAL_DOMAIN_KIND,
        domainResourceKind,
        domainResourceId: event.claimId ?? event.changeSetId,
        sourceEventKind: event.eventType,
        sourceEventId: event.historyEventId,
        occurredAt: event.createdAt,
        payloadAvailability: availability,
        payloadSnapshot: {
          eventType: event.eventType,
          beforeVersion: event.beforeVersion,
          afterVersion: event.afterVersion,
          claimId: event.claimId,
          reason: event.reason,
          actor: { type: event.actor.type, id: event.actor.id },
        },
        projectedAt,
      });
    }
    return entries;
  }
}
