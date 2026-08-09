/**
 * FE-P5-S2 WP4 — External Action History adapter.
 *
 * Maps the authoritative External Action history — the mandatory RESULT and
 * AUDIT_EVENT families (IR r1 / Contract Snapshot §6) — into federated
 * `HistoryEntryV1` rows. Reads run inside the owning External Action boundary
 * transaction. The adapter never mutates the owning Domain and preserves the
 * authoritative event identity exactly (`sourceEventId = resultId |
 * auditEventId`); `sourceSequence` carries the append-only audit sequence
 * (frozen ordering tuple tie-breaker). Audit is paginated until exhausted
 * (NO arbitrary total cap: a >1000-event action is fully projected) and every
 * Result row is enumerated (GPT Round 1 B).
 */

import type { ExternalActionRepositoryBoundaryPort } from '../../../modules/frontend-external-action/src/index.js';
import type { PayloadStateStorePort } from '../../../modules/frontend-history/src/index.js';
import type { HistoryAdapterPort } from '../../../modules/frontend-history/src/index.js';
import type {
  ActionAuditEventV1,
  HistoryEntryV1,
  HistorySourceDomainKindV1,
  ResultV1,
} from '../../../packages/contracts/src/index.js';

export const EXTERNAL_ACTION_HISTORY_ADAPTER_ID = 'history-external-action';

const EXTERNAL_ACTION_DOMAIN_KIND: HistorySourceDomainKindV1 = 'EXTERNAL_ACTION';

/** External Action History adapter pagination budget (per aggregate page). */
const EXTERNAL_ACTION_PAGE_SIZE = 100;
/** Per-action audit/result read budget (not a cap: pagination exhausts). */
const EXTERNAL_ACTION_ROW_BUDGET = 500;

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
          entries.push(
            ...(await this.auditEntries(repositories, projectId, action.actionId, projectedAt)),
            ...(await this.resultEntries(repositories, projectId, action.actionId, projectedAt)),
          );
        }
        if (actions.length < EXTERNAL_ACTION_PAGE_SIZE) break;
      }
      return entries;
    });
  }

  async resolveHistoryEntry(
    projectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<HistoryEntryV1 | undefined> {
    return this.externalAction.transaction(async (repositories) => {
      const projectedAt = this.now().toISOString();
      if (sourceEventKind === 'AUDIT_EVENT') {
        // Locate the owning action via the audit identity, then re-resolve.
        const found = await this.findActionForAudit(repositories, projectId, sourceEventId);
        if (found === undefined) return undefined;
        const audit = await repositories.audit.listByAction(found, EXTERNAL_ACTION_ROW_BUDGET, 0);
        const event = audit.find((candidate) => candidate.auditEventId === sourceEventId);
        return event === undefined ? undefined : this.auditEntry(projectId, event, projectedAt);
      }
      if (sourceEventKind === 'RESULT') {
        const result = await repositories.results.findById(sourceEventId);
        if (result === undefined || result.resourceProjectId !== projectId) return undefined;
        return this.resultEntry(projectId, result, projectedAt);
      }
      return undefined;
    });
  }

  /** Find the owning action id for an audit event identity (deterministic). */
  private async findActionForAudit(
    repositories: Parameters<Parameters<ExternalActionRepositoryBoundaryPort['transaction']>[0]>[0],
    projectId: string,
    auditEventId: string,
  ): Promise<string | undefined> {
    for (let offset = 0; ; offset += EXTERNAL_ACTION_PAGE_SIZE) {
      const actions = await repositories.aggregates.listByProject(
        projectId,
        EXTERNAL_ACTION_PAGE_SIZE,
        offset,
      );
      for (const action of actions) {
        const audit = await repositories.audit.listByAction(
          action.actionId,
          EXTERNAL_ACTION_ROW_BUDGET,
          0,
        );
        if (audit.some((candidate) => candidate.auditEventId === auditEventId)) {
          return action.actionId;
        }
      }
      if (actions.length < EXTERNAL_ACTION_PAGE_SIZE) break;
    }
    return undefined;
  }

  /** Full audit pagination for one action (no total cap). */
  private async auditEntries(
    repositories: Parameters<Parameters<ExternalActionRepositoryBoundaryPort['transaction']>[0]>[0],
    projectId: string,
    actionId: string,
    projectedAt: string,
  ): Promise<readonly HistoryEntryV1[]> {
    const entries: HistoryEntryV1[] = [];
    for (let offset = 0; ; offset += EXTERNAL_ACTION_ROW_BUDGET) {
      const events = await repositories.audit.listByAction(
        actionId,
        EXTERNAL_ACTION_ROW_BUDGET,
        offset,
      );
      for (const event of events) {
        entries.push(await this.auditEntry(projectId, event, projectedAt));
      }
      if (events.length < EXTERNAL_ACTION_ROW_BUDGET) break;
    }
    return entries;
  }

  private async auditEntry(
    projectId: string,
    event: ActionAuditEventV1,
    projectedAt: string,
  ): Promise<HistoryEntryV1> {
    const availability = await externalActionAvailability(
      this.payloadState,
      projectId,
      'AUDIT_EVENT',
      event.auditEventId,
    );
    return {
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
    };
  }

  /** Full Result enumeration for one action (mandatory RESULT family). */
  private async resultEntries(
    repositories: Parameters<Parameters<ExternalActionRepositoryBoundaryPort['transaction']>[0]>[0],
    projectId: string,
    actionId: string,
    projectedAt: string,
  ): Promise<readonly HistoryEntryV1[]> {
    const entries: HistoryEntryV1[] = [];
    for (let offset = 0; ; offset += EXTERNAL_ACTION_ROW_BUDGET) {
      const results = await repositories.results.listByAction(
        actionId,
        EXTERNAL_ACTION_ROW_BUDGET,
        offset,
      );
      for (const result of results) {
        entries.push(await this.resultEntry(projectId, result, projectedAt));
      }
      if (results.length < EXTERNAL_ACTION_ROW_BUDGET) break;
    }
    return entries;
  }

  private async resultEntry(
    projectId: string,
    result: ResultV1,
    projectedAt: string,
  ): Promise<HistoryEntryV1> {
    const availability = await externalActionAvailability(
      this.payloadState,
      projectId,
      'RESULT',
      result.resultId,
    );
    return {
      schemaVersion: '1.0.0',
      historyEntryId: `history:${projectId}:result:${result.resultId}`,
      resourceProjectId: projectId,
      domainKind: EXTERNAL_ACTION_DOMAIN_KIND,
      domainResourceKind: 'EXTERNAL_ACTION',
      domainResourceId: result.actionId,
      sourceEventKind: 'RESULT',
      sourceEventId: result.resultId,
      occurredAt: result.completedAt,
      payloadAvailability: availability,
      payloadSnapshot: {
        actionId: result.actionId,
        executionId: result.executionId,
        externalId: result.externalId,
        observedDigest: result.observedDigest,
      },
      projectedAt,
    };
  }
}
