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
import type {
  PayloadStateRecord,
  PayloadStateStorePort,
} from '../../../modules/frontend-history/src/index.js';
import { redactHistoryPayload } from '../../../modules/frontend-history/src/index.js';
import type {
  CanonicalHistoryEvent,
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';

export const CANONICAL_HISTORY_ADAPTER_ID = 'history-canonical';

const CANONICAL_DOMAIN_KIND: HistorySourceDomainKindV1 = 'CANONICAL';

const canonicalState = async (
  payloadState: PayloadStateStorePort,
  projectId: string,
  event: { eventType: string; historyEventId: string },
): Promise<PayloadStateRecord | null> =>
  payloadState.getPayloadState(projectId, event.eventType, event.historyEventId);

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
    return this.mapEvents(projectId, events);
  }

  async resolveHistoryEntry(
    projectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<HistoryEntryV1 | undefined> {
    // Fail-closed: the source identity is matched authoritatively; the
    // projection payload is never trusted when the source is unresolved.
    const events = await this.canonical.listHistory(projectId);
    const event = events.find(
      (candidate) =>
        candidate.eventType === sourceEventKind && candidate.historyEventId === sourceEventId,
    );
    if (event === undefined) return undefined;
    const entries = await this.mapEvents(projectId, [event]);
    return entries[0];
  }

  async redactEntry(entry: HistoryEntryV1): Promise<HistoryEntryV1> {
    return redactForRead(this.payloadState, entry);
  }

  private async mapEvents(
    projectId: string,
    events: readonly CanonicalHistoryEvent[],
  ): Promise<readonly HistoryEntryV1[]> {
    const projectedAt = this.now().toISOString();
    const entries: HistoryEntryV1[] = [];
    for (const event of events) {
      const state = await canonicalState(this.payloadState, projectId, event);
      const availability = state?.payloadAvailability ?? 'AVAILABLE';
      const domainResourceKind =
        event.eventType === 'CANONICAL_CLAIM_ADDED' ? 'CANONICAL_CLAIM' : 'CANONICAL_CHANGESET';
      // FE-P5-S2 WP5 (Round 2 B1): the authoritative Canonical revision
      // identity is resolved server-side (HistoryEvent → commitId →
      // CanonicalCommitResult.revisionId) and carried in the bounded payload.
      // The browser NEVER infers a revision identity from the numeric
      // beforeVersion/afterVersion; Reversal initiation uses this
      // authoritative `revisionId` as `sourceRevisionId`.
      const commit = await this.canonical.findCommit(projectId, event.commitId);
      const redacted = redactHistoryPayload(availability, state, {
        eventType: event.eventType,
        beforeVersion: event.beforeVersion,
        afterVersion: event.afterVersion,
        ...(commit === undefined
          ? {}
          : {
              commitId: event.commitId,
              revisionId: commit.revisionId,
            }),
        claimId: event.claimId,
        reason: event.reason,
        actor: { type: event.actor.type, id: event.actor.id },
      });
      entries.push({
        schemaVersion: '1.0.0',
        historyEntryId: `history:${projectId}:${event.historyEventId}`,
        resourceProjectId: projectId,
        domainKind: CANONICAL_DOMAIN_KIND,
        domainResourceKind,
        domainResourceId: event.claimId ?? event.changeSetId ?? event.commitId,
        sourceEventKind: event.eventType,
        sourceEventId: event.historyEventId,
        occurredAt: event.createdAt,
        ...redacted,
        projectedAt,
      });
    }
    return entries;
  }
}
