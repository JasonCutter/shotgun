/**
 * FE-P5-S2 WP2-B — Payload Availability / Retention / Tombstone capability.
 *
 * Owner: each authoritative Domain (Canonical, Review, External Action,
 * Settings); retention policy authority: settings-policy (ADR-131 §3/§7a,
 * IR r1 §5 WP2-B).
 *
 * Existing authoritative Event rows are NEVER ALTERED for availability state.
 * Mutable PayloadAvailability lives in owner-side sidecar tables
 * (`history_payload_state`, migration 032). Purge keeps the source event
 * identity and appends a purge AuditEvent (ADR-112 §9) — both transitions are
 * committed atomically.
 */

import type { PayloadAvailabilityV1 } from '../../../packages/contracts/src/index.js';

/**
 * Owner-side payload availability state for one source event identity.
 * Mirrors canonical/frontend_review/frontend_external_action/settings
 * `history_payload_state` rows.
 */
export type PayloadStateRecord = {
  readonly resourceProjectId: string;
  readonly sourceEventKind: string;
  readonly sourceEventId: string;
  readonly payloadAvailability: PayloadAvailabilityV1;
  readonly tombstoneMetadata?: Record<string, unknown>;
  readonly changedAt: string;
  readonly reason: string;
  readonly policyRevision?: string;
};

/**
 * Non-sensitive purge audit metadata. The purged payload itself is NEVER
 * copied into an AuditEvent — only source identity, policy revision, reason
 * and tombstone/digest metadata (ADR-131 §3).
 */
export type PurgeAuditEventInput = {
  readonly resourceProjectId: string;
  readonly sourceEventKind: string;
  readonly sourceEventId: string;
  readonly previousAvailability: PayloadAvailabilityV1;
  readonly policyRevision?: string;
  readonly reason: string;
  readonly tombstoneMetadata?: Record<string, unknown>;
  readonly actorId: string;
  readonly occurredAt: string;
};

export type SetPayloadStateInput = {
  readonly resourceProjectId: string;
  readonly sourceEventKind: string;
  readonly sourceEventId: string;
  readonly payloadAvailability: PayloadAvailabilityV1;
  readonly tombstoneMetadata?: Record<string, unknown>;
  readonly reason: string;
  readonly policyRevision?: string;
  readonly actorId: string;
  readonly changedAt: string;
};

export type PurgeByPolicyInput = {
  readonly resourceProjectId: string;
  readonly sourceEventKind: string;
  readonly sourceEventId: string;
  readonly policyRevision?: string;
  readonly reason: string;
  readonly tombstoneMetadata?: Record<string, unknown>;
  readonly actorId: string;
  readonly occurredAt: string;
};

/**
 * Authoritative Payload Availability / Retention / Tombstone capability owned
 * by each authoritative Domain.
 *
 * `purgeByPolicy` MUST atomically:
 *   1. flip the owner-side `history_payload_state` sidecar to PURGED_BY_POLICY
 *   2. append the owner Domain purge AuditEvent
 * A partial state (sidecar PURGED_BY_POLICY but purge AuditEvent missing, or
 * vice versa) is FORBIDDEN.
 */
export type PayloadStateStorePort = {
  getPayloadState(
    resourceProjectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<PayloadStateRecord | null>;
  setPayloadState(input: SetPayloadStateInput): Promise<PayloadStateRecord>;
  purgeByPolicy(input: PurgeByPolicyInput): Promise<PayloadStateRecord>;
};

export type PayloadStateOwner = 'CANONICAL' | 'REVIEW' | 'EXTERNAL_ACTION' | 'SETTINGS';

/**
 * The transition target of a purge is always PURGED_BY_POLICY; the previous
 * availability must not already be PURGED_BY_POLICY (migration 032 CHECK).
 */
export const isPurgeTransitionValid = (
  previousAvailability: PayloadAvailabilityV1 | undefined,
): boolean => previousAvailability !== 'PURGED_BY_POLICY';

/**
 * FE-P5-S2 WP4 Round 2 F — payload redaction invariant.
 *
 * Raw payload is ONLY permitted when the authoritative availability is
 * AVAILABLE. REDACTED / PURGED_BY_POLICY / UNAVAILABLE NEVER carry the raw
 * payload; the only data permitted on those rows is the non-sensitive
 * tombstone metadata stored in the owner-side sidecar. This is applied at
 * projection build time (so the projection cache never stores raw payload for
 * non-AVAILABLE rows) AND at read time (so a purge that happened after a
 * cached projection cannot leak the raw payload through List/Detail).
 */
export const redactHistoryPayload = (
  availability: PayloadAvailabilityV1,
  state: PayloadStateRecord | null,
  rawPayload: unknown,
): { payloadAvailability: PayloadAvailabilityV1; payloadSnapshot?: unknown } => {
  if (availability === 'AVAILABLE') {
    return {
      payloadAvailability: availability,
      ...(rawPayload === undefined ? {} : { payloadSnapshot: rawPayload }),
    };
  }
  // REDACTED / PURGED_BY_POLICY / UNAVAILABLE: raw payload FORBIDDEN. The
  // returned object ALWAYS carries a payloadSnapshot key (tombstone metadata,
  // or undefined) so that a caller doing `{ ...entry, ...redacted }`
  // explicitly OVERWRITES any prior raw snapshot instead of leaving it in
  // place (GPT Round 3 F — tombstoneMetadata may be absent).
  return {
    payloadAvailability: availability,
    payloadSnapshot: state?.tombstoneMetadata,
  };
};
