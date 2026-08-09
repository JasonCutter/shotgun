import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  PayloadStateOwner,
  PayloadStateRecord,
  PayloadStateStorePort,
  PurgeByPolicyInput,
  SetPayloadStateInput,
} from '../../../modules/frontend-history/src/index.js';
import { isPurgeTransitionValid } from '../../../modules/frontend-history/src/index.js';

type StateKey = `${string}:${string}:${string}`;

const key = (projectId: string, kind: string, eventId: string): StateKey =>
  `${projectId}:${kind}:${eventId}`;

/**
 * In-memory PayloadState store (WP2-B). Owner-agnostic: tracks the owning
 * Domain per record and appends purge audit events atomically (in memory a
 * single synchronous flip cannot partially fail).
 */
export class InMemoryPayloadStateStore implements PayloadStateStorePort {
  private readonly states = new Map<StateKey, PayloadStateRecord>();
  private readonly purgeAudit: PurgeByPolicyInput[] = [];

  constructor(private readonly owner: PayloadStateOwner) {}

  listPurgeAudit(): readonly PurgeByPolicyInput[] {
    return Object.freeze([...this.purgeAudit]);
  }

  async getPayloadState(
    resourceProjectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<PayloadStateRecord | null> {
    return this.states.get(key(resourceProjectId, sourceEventKind, sourceEventId)) ?? null;
  }

  async setPayloadState(input: SetPayloadStateInput): Promise<PayloadStateRecord> {
    if (!input.resourceProjectId || !input.sourceEventKind || !input.sourceEventId) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'resourceProjectId, sourceEventKind and sourceEventId required',
      );
    }
    if (input.payloadAvailability === 'PURGED_BY_POLICY') {
      const existing = this.states.get(
        key(input.resourceProjectId, input.sourceEventKind, input.sourceEventId),
      );
      if (!isPurgeTransitionValid(existing?.payloadAvailability)) {
        throw new FrontendContractError(
          'CONFLICT',
          `Payload for ${input.sourceEventKind}:${input.sourceEventId} is already PURGED_BY_POLICY`,
        );
      }
    }
    const record: PayloadStateRecord = Object.freeze({
      resourceProjectId: input.resourceProjectId,
      sourceEventKind: input.sourceEventKind,
      sourceEventId: input.sourceEventId,
      payloadAvailability: input.payloadAvailability,
      tombstoneMetadata: input.tombstoneMetadata
        ? Object.freeze({ ...input.tombstoneMetadata })
        : undefined,
      changedAt: input.changedAt,
      reason: input.reason,
      policyRevision: input.policyRevision,
    });
    this.states.set(
      key(input.resourceProjectId, input.sourceEventKind, input.sourceEventId),
      record,
    );
    return record;
  }

  async purgeByPolicy(input: PurgeByPolicyInput): Promise<PayloadStateRecord> {
    const existing = await this.getPayloadState(
      input.resourceProjectId,
      input.sourceEventKind,
      input.sourceEventId,
    );
    if (!isPurgeTransitionValid(existing?.payloadAvailability)) {
      throw new FrontendContractError(
        'CONFLICT',
        `Payload for ${input.sourceEventKind}:${input.sourceEventId} cannot be purged (already PURGED_BY_POLICY or unavailable).`,
      );
    }
    // Atomic: sidecar flip + purge audit append (single in-memory operation).
    const record = await this.setPayloadState({
      resourceProjectId: input.resourceProjectId,
      sourceEventKind: input.sourceEventKind,
      sourceEventId: input.sourceEventId,
      payloadAvailability: 'PURGED_BY_POLICY',
      tombstoneMetadata: input.tombstoneMetadata,
      reason: input.reason,
      policyRevision: input.policyRevision,
      actorId: input.actorId,
      changedAt: input.occurredAt,
    });
    this.purgeAudit.push(Object.freeze({ ...input }));
    return record;
  }
}
