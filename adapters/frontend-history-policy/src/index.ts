/**
 * FE-P5-S2 WP4 — Policy History adapter.
 *
 * Maps the authoritative settings-policy change history
 * (`PolicyHistoryReadPort.listPolicyHistory`, owned by settings-policy) into
 * federated `HistoryEntryV1` rows. The adapter never mutates the owning Domain
 * and preserves the authoritative source identity exactly
 * (`sourceEventId = sourceId`, `sourceEventKind = sourceKind`).
 */

import type { PolicyHistoryReadPort } from '../../../modules/settings-policy/src/index.js';
import type {
  PayloadStateRecord,
  PayloadStateStorePort,
} from '../../../modules/frontend-history/src/index.js';
import { redactHistoryPayload } from '../../../modules/frontend-history/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';
import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';

export const POLICY_HISTORY_ADAPTER_ID = 'history-policy';

const POLICY_DOMAIN_KIND: HistorySourceDomainKindV1 = 'POLICY';

/** Policy History adapter pagination budget. */
const POLICY_PAGE_SIZE = 200;

const policyState = async (
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

export class PolicyHistoryAdapter implements HistoryAdapterPort {
  readonly adapterId = POLICY_HISTORY_ADAPTER_ID;
  readonly domainKind = POLICY_DOMAIN_KIND;

  constructor(
    private readonly policyHistory: PolicyHistoryReadPort,
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
    // Fail-closed: match the authoritative source identity; the projection
    // payload is never trusted when the source is unresolved.
    const all = await this.mapAll(projectId);
    return all.find(
      (entry) => entry.sourceEventKind === sourceEventKind && entry.sourceEventId === sourceEventId,
    );
  }

  async redactEntry(entry: HistoryEntryV1): Promise<HistoryEntryV1> {
    return redactForRead(this.payloadState, entry);
  }

  private async mapAll(projectId: string): Promise<readonly HistoryEntryV1[]> {
    const projectedAt = this.now().toISOString();
    const entries: HistoryEntryV1[] = [];
    let cursor: Parameters<PolicyHistoryReadPort['listPolicyHistory']>[0]['cursor'];
    for (;;) {
      const page = await this.policyHistory.listPolicyHistory({
        projectId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: POLICY_PAGE_SIZE,
      });
      for (const entry of page.entries) {
        const state = await policyState(
          this.payloadState,
          projectId,
          entry.sourceKind,
          entry.sourceId,
        );
        const availability = state?.payloadAvailability ?? 'AVAILABLE';
        const redacted = redactHistoryPayload(availability, state, {
          sourceKind: entry.sourceKind,
          actorId: entry.actorId,
          actionName: entry.actionName,
          riskLevel: entry.riskLevel,
          details: entry.details,
        });
        entries.push({
          schemaVersion: '1.0.0',
          historyEntryId: `history:${projectId}:policy:${entry.sourceId}`,
          resourceProjectId: projectId,
          domainKind: POLICY_DOMAIN_KIND,
          domainResourceKind: 'POLICY_CHANGE',
          domainResourceId: entry.sourceId,
          sourceEventKind: entry.sourceKind,
          sourceEventId: entry.sourceId,
          occurredAt: entry.timestamp,
          ...redacted,
          projectedAt,
        });
      }
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    return entries;
  }
}
