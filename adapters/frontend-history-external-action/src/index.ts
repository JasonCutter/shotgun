/**
 * FE-P5-S2 WP4 — External Action History adapter.
 *
 * Maps the authoritative External Action history (aggregate list + per-action
 * append-only Audit) into federated `HistoryEntryV1` rows. Reads run inside
 * the owning External Action boundary transaction. The adapter never mutates
 * the owning Domain and preserves the authoritative event identity exactly
 * (`sourceEventId = auditEventId`); `sourceSequence` carries the append-only
 * audit sequence (frozen ordering tuple tie-breaker).
 */

import type { ExternalActionRepositoryBoundaryPort } from '../../../modules/frontend-external-action/src/index.js';
import type { PayloadStateStorePort } from '../../../modules/frontend-history/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';
import type {
  HistoryEntryV1,
  HistorySourceDomainKindV1,
} from '../../../packages/contracts/src/index.js';

export const EXTERNAL_ACTION_HISTORY_ADAPTER_ID = 'history-external-action';

const EXTERNAL_ACTION_DOMAIN_KIND: HistorySourceDomainKindV1 = 'EXTERNAL_ACTION';

/** External Action History adapter pagination budget (per aggregate page). */
const EXTERNAL_ACTION_PAGE_SIZE = 100;
/** Per-action audit read budget. */
const EXTERNAL_ACTION_AUDIT_BUDGET = 1000;

const externalActionAvailability = async (
  payloadState: PayloadStateStorePort,
  projectId: string,
  sourceEventKind: string,
  sourceEventId: string,
): Promise<HistoryEntryV1['payloadAvailability']> => {
  const state = await payloadState.getPayloadState(projectId, sourceEventKind, sourceEventId);
  return state?.payloadAvailability ?? 'AVAILABLE';
};

export class ExternalActionHistoryAdapter implements HistoryAdapterPort {
  readonly adapterId = EXTERNAL_ACTION_HISTORY_ADAPTER_ID;
  readonly domainKind = EXTERNAL_ACTION_DOMAIN_KIND;

  constructor(
    private readonly externalAction: ExternalActionRepositoryBoundaryPort,
    private readonly payloadState: PayloadStateStorePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readHistory(projectId: string): Promise<readonly HistoryEntryV1[]> {
    return this.externalAction.transaction(async (repositories) => {
      const projectedAt = this.now().toISOString();
      const entries: HistoryEntryV1[] = [];
      for (let offset = 0; ; offset += EXTERNAL_ACTION_PAGE_SIZE) {
        const actions = await repositories.aggregates.listByProject(
          projectId,
          EXTERNAL_ACTION_PAGE_SIZE,
          offset,
        );
        for (const action of actions) {
          const auditEvents = await repositories.audit.listByAction(
            action.actionId,
            EXTERNAL_ACTION_AUDIT_BUDGET,
            0,
          );
          for (const event of auditEvents) {
            const availability = await externalActionAvailability(
              this.payloadState,
              projectId,
              'AUDIT_EVENT',
              event.auditEventId,
            );
            entries.push({
              schemaVersion: '1.0.0',
              historyEntryId: `history:${projectId}:audit:${event.auditEventId}`,
              resourceProjectId: projectId,
              domainKind: EXTERNAL_ACTION_DOMAIN_KIND,
              domainResourceKind: 'EXTERNAL_ACTION',
              domainResourceId: event.actionId,
              sourceEventKind: 'AUDIT_EVENT',
              sourceEventId: event.auditEventId,
              sourceSequence: event.sequence,
              occurredAt: event.occurredAt,
              payloadAvailability: availability,
              payloadSnapshot: {
                actionId: event.actionId,
                sequence: event.sequence,
                category: event.category,
                message: event.eventData.message,
              },
              projectedAt,
            });
          }
        }
        if (actions.length < EXTERNAL_ACTION_PAGE_SIZE) break;
      }
      return entries;
    });
  }
}
