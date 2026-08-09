import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type {
  PayloadStateOwner,
  PayloadStateRecord,
  PayloadStateStorePort,
  PurgeByPolicyInput,
  SetPayloadStateInput,
} from '../../../modules/frontend-history/src/index.js';
import { isPurgeTransitionValid } from '../../../modules/frontend-history/src/index.js';

const SIDECAR_TABLES: Record<PayloadStateOwner, string> = {
  CANONICAL: 'canonical.history_payload_state',
  REVIEW: 'frontend_review.history_payload_state',
  EXTERNAL_ACTION: 'frontend_external_action.history_payload_state',
  SETTINGS: 'settings.history_payload_state',
};

/** Owner → federated History projection domain kind (migration 030 CHECK). */
const PROJECTION_DOMAIN_KIND: Record<PayloadStateOwner, string> = {
  CANONICAL: 'CANONICAL',
  REVIEW: 'REVIEW',
  EXTERNAL_ACTION: 'EXTERNAL_ACTION',
  SETTINGS: 'POLICY',
};

/**
 * PostgreSQL PayloadState store (WP2-B). Reads/writes the owner-side
 * `history_payload_state` sidecar (migration 032). `purgeByPolicy` atomically
 * flips the sidecar to PURGED_BY_POLICY AND appends the owner Domain purge
 * AuditEvent in a single transaction (ADR-131 §3 / ADR-112 §9):
 *   - CANONICAL / REVIEW: owner-local purge audit stream (032)
 *   - EXTERNAL_ACTION: existing frontend_external_action.audit_events
 *   - SETTINGS: existing settings.settings_audit_events
 * A partial state (sidecar purged without audit event, or vice versa) is
 * FORBIDDEN.
 */
export class PostgresPayloadStateStore implements PayloadStateStorePort {
  constructor(
    private readonly pool: Pool,
    private readonly owner: PayloadStateOwner,
  ) {}

  private sidecarTable(): string {
    return SIDECAR_TABLES[this.owner];
  }

  /**
   * FE-P5-S2 WP4 Round 3 F — persistent projection cache sanitize. When an
   * authoritative payload transitions away from AVAILABLE, the cached
   * projection row in `frontend_history.history_projection_index` is updated
   * in the SAME transaction/statement: payload_availability reflects the new
   * availability and payload_snapshot is replaced by the (nullable) tombstone
   * metadata. The previous raw payload is never left in persistent storage
   * after a purge/redaction (AC-05).
   */
  private async sanitizeProjectionCache(
    client: Pool | PoolClient,
    input: {
      resourceProjectId: string;
      sourceEventKind: string;
      sourceEventId: string;
      payloadAvailability: PayloadStateRecord['payloadAvailability'];
      tombstoneMetadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE frontend_history.history_projection_index
       SET payload_availability = $5, payload_snapshot = $6
       WHERE resource_project_id = $1
         AND domain_kind = $2
         AND source_event_kind = $3
         AND source_event_id = $4`,
      [
        input.resourceProjectId,
        PROJECTION_DOMAIN_KIND[this.owner],
        input.sourceEventKind,
        input.sourceEventId,
        input.payloadAvailability,
        input.tombstoneMetadata ? JSON.stringify(input.tombstoneMetadata) : null,
      ],
    );
  }

  async getPayloadState(
    resourceProjectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): Promise<PayloadStateRecord | null> {
    const table = this.sidecarTable();
    const res = await this.pool.query<{
      resource_project_id: string;
      source_event_kind: string;
      source_event_id: string;
      payload_availability: string;
      tombstone_metadata: Record<string, unknown> | null;
      changed_at: Date;
      reason: string;
      policy_revision: string | null;
    }>(
      `SELECT resource_project_id, source_event_kind, source_event_id, payload_availability,
              tombstone_metadata, changed_at, reason, policy_revision
       FROM ${table}
       WHERE resource_project_id = $1 AND source_event_kind = $2 AND source_event_id = $3`,
      [resourceProjectId, sourceEventKind, sourceEventId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return Object.freeze({
      resourceProjectId: row.resource_project_id,
      sourceEventKind: row.source_event_kind,
      sourceEventId: row.source_event_id,
      payloadAvailability: row.payload_availability as PayloadStateRecord['payloadAvailability'],
      tombstoneMetadata: row.tombstone_metadata ?? undefined,
      changedAt: row.changed_at.toISOString(),
      reason: row.reason,
      policyRevision: row.policy_revision ?? undefined,
    });
  }

  async setPayloadState(input: SetPayloadStateInput): Promise<PayloadStateRecord> {
    this.validateInput(input.resourceProjectId, input.sourceEventKind, input.sourceEventId);
    const table = this.sidecarTable();
    const existing = await this.getPayloadState(
      input.resourceProjectId,
      input.sourceEventKind,
      input.sourceEventId,
    );
    // PURGED_BY_POLICY is only ever produced by purgeByPolicy() (the unique
    // purge transition authority). Direct set is REJECTED.
    if (input.payloadAvailability === 'PURGED_BY_POLICY') {
      throw new FrontendContractError(
        'CONFLICT',
        `PURGED_BY_POLICY can only be set through purgeByPolicy().`,
      );
    }
    // Resurrection is FORBIDDEN: a purged payload cannot be flipped back to
    // AVAILABLE/REDACTED/UNAVAILABLE through setPayloadState.
    if (existing?.payloadAvailability === 'PURGED_BY_POLICY') {
      throw new FrontendContractError(
        'CONFLICT',
        `Payload for ${input.sourceEventKind}:${input.sourceEventId} is PURGED_BY_POLICY and cannot be resurrected.`,
      );
    }
    await this.pool.query(
      `INSERT INTO ${table}
         (resource_project_id, source_event_kind, source_event_id, payload_availability,
          tombstone_metadata, changed_at, reason, policy_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (resource_project_id, source_event_kind, source_event_id) DO UPDATE SET
         payload_availability = EXCLUDED.payload_availability,
         tombstone_metadata = EXCLUDED.tombstone_metadata,
         changed_at = EXCLUDED.changed_at,
         reason = EXCLUDED.reason,
         policy_revision = EXCLUDED.policy_revision`,
      [
        input.resourceProjectId,
        input.sourceEventKind,
        input.sourceEventId,
        input.payloadAvailability,
        input.tombstoneMetadata ? JSON.stringify(input.tombstoneMetadata) : null,
        input.changedAt,
        input.reason,
        input.policyRevision ?? null,
      ],
    );
    // A transition away from AVAILABLE must also sanitize the persistent
    // History projection cache (Round 3 F): no raw payload may remain in
    // frontend_history.history_projection_index after redaction.
    if (input.payloadAvailability !== 'AVAILABLE') {
      await this.sanitizeProjectionCache(this.pool, {
        resourceProjectId: input.resourceProjectId,
        sourceEventKind: input.sourceEventKind,
        sourceEventId: input.sourceEventId,
        payloadAvailability: input.payloadAvailability,
        tombstoneMetadata: input.tombstoneMetadata,
      });
    }
    const record = await this.getPayloadState(
      input.resourceProjectId,
      input.sourceEventKind,
      input.sourceEventId,
    );
    return record as PayloadStateRecord;
  }

  async purgeByPolicy(input: PurgeByPolicyInput): Promise<PayloadStateRecord> {
    this.validateInput(input.resourceProjectId, input.sourceEventKind, input.sourceEventId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const table = this.sidecarTable();
      const existing = await client.query<{ payload_availability: string }>(
        `SELECT payload_availability FROM ${table}
         WHERE resource_project_id = $1 AND source_event_kind = $2 AND source_event_id = $3
         FOR UPDATE`,
        [input.resourceProjectId, input.sourceEventKind, input.sourceEventId],
      );
      const previous = existing.rows[0]?.payload_availability as
        PayloadStateRecord['payloadAvailability'] | undefined;
      if (!isPurgeTransitionValid(previous)) {
        throw new FrontendContractError(
          'CONFLICT',
          `Payload for ${input.sourceEventKind}:${input.sourceEventId} cannot be purged (already PURGED_BY_POLICY).`,
        );
      }

      // 1. flip sidecar to PURGED_BY_POLICY (identity preserved)
      await client.query(
        `INSERT INTO ${table}
           (resource_project_id, source_event_kind, source_event_id, payload_availability,
            tombstone_metadata, changed_at, reason, policy_revision)
         VALUES ($1, $2, $3, 'PURGED_BY_POLICY', $4, $5, $6, $7)
         ON CONFLICT (resource_project_id, source_event_kind, source_event_id) DO UPDATE SET
           payload_availability = 'PURGED_BY_POLICY',
           tombstone_metadata = EXCLUDED.tombstone_metadata,
           changed_at = EXCLUDED.changed_at,
           reason = EXCLUDED.reason,
           policy_revision = EXCLUDED.policy_revision`,
        [
          input.resourceProjectId,
          input.sourceEventKind,
          input.sourceEventId,
          input.tombstoneMetadata ? JSON.stringify(input.tombstoneMetadata) : null,
          input.occurredAt,
          input.reason,
          input.policyRevision ?? null,
        ],
      );

      // 2. append owner Domain purge AuditEvent (non-sensitive metadata only)
      await this.appendPurgeAuditEvent(client, input, previous ?? 'AVAILABLE');

      // 3. sanitize the persistent History projection cache in the SAME
      // transaction (Round 3 F / AC-05): the previous raw payload must not
      // remain in frontend_history.history_projection_index after the purge.
      await this.sanitizeProjectionCache(client, {
        resourceProjectId: input.resourceProjectId,
        sourceEventKind: input.sourceEventKind,
        sourceEventId: input.sourceEventId,
        payloadAvailability: 'PURGED_BY_POLICY',
        tombstoneMetadata: input.tombstoneMetadata,
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const record = await this.getPayloadState(
      input.resourceProjectId,
      input.sourceEventKind,
      input.sourceEventId,
    );
    return record as PayloadStateRecord;
  }

  private async appendPurgeAuditEvent(
    client: PoolClient,
    input: PurgeByPolicyInput,
    previousAvailability: PayloadStateRecord['payloadAvailability'],
  ): Promise<void> {
    const occurredAt = input.occurredAt;
    if (this.owner === 'CANONICAL' || this.owner === 'REVIEW') {
      const table =
        this.owner === 'CANONICAL'
          ? 'canonical.history_payload_audit_events'
          : 'frontend_review.history_payload_audit_events';
      await client.query(
        `INSERT INTO ${table}
           (audit_event_id, resource_project_id, source_event_kind, source_event_id,
            previous_availability, new_availability, tombstone_metadata, policy_revision,
            reason, actor_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, 'PURGED_BY_POLICY', $6, $7, $8, $9, $10)`,
        [
          `purge:${randomUUID()}`,
          input.resourceProjectId,
          input.sourceEventKind,
          input.sourceEventId,
          previousAvailability,
          input.tombstoneMetadata ? JSON.stringify(input.tombstoneMetadata) : null,
          input.policyRevision ?? null,
          input.reason,
          input.actorId,
          occurredAt,
        ],
      );
      return;
    }
    if (this.owner === 'EXTERNAL_ACTION') {
      // sourceEventId == action_id is an IMPLICIT ASSUMPTION and is NOT
      // allowed: resolve the authoritative source row to its action_id
      // server-side, then verify the project identity (Frozen mandatory
      // History family = External Action Result / Audit).
      let resolvedActionId: string | null = null;
      if (input.sourceEventKind === 'RESULT') {
        const res = await client.query<{ action_id: string; resource_project_id: string }>(
          `SELECT action_id, resource_project_id FROM frontend_external_action.results
           WHERE result_id = $1`,
          [input.sourceEventId],
        );
        const row = res.rows[0];
        if (row) {
          if (row.resource_project_id !== input.resourceProjectId) {
            throw new FrontendContractError(
              'RESOURCE_PROJECT_MISMATCH',
              `Result ${input.sourceEventId} belongs to project ${row.resource_project_id}, not ${input.resourceProjectId}.`,
            );
          }
          resolvedActionId = row.action_id;
        }
      } else if (input.sourceEventKind === 'AUDIT_EVENT') {
        const res = await client.query<{ action_id: string; resource_project_id: string }>(
          `SELECT action_id, resource_project_id FROM frontend_external_action.audit_events
           WHERE audit_event_id = $1`,
          [input.sourceEventId],
        );
        const row = res.rows[0];
        if (row) {
          if (row.resource_project_id !== input.resourceProjectId) {
            throw new FrontendContractError(
              'RESOURCE_PROJECT_MISMATCH',
              `Audit event ${input.sourceEventId} belongs to project ${row.resource_project_id}, not ${input.resourceProjectId}.`,
            );
          }
          resolvedActionId = row.action_id;
        }
      }
      if (!resolvedActionId) {
        throw new FrontendContractError(
          'NOT_FOUND',
          `External Action source ${input.sourceEventKind}:${input.sourceEventId} not found; cannot resolve action_id.`,
        );
      }
      const actionId = resolvedActionId;
      // Existing generic audit stream: category + snapshot + per-action sequence.
      const seqRes = await client.query<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
         FROM frontend_external_action.audit_events WHERE action_id = $1`,
        [actionId],
      );
      await client.query(
        `INSERT INTO frontend_external_action.audit_events
           (audit_event_id, action_id, resource_project_id, effective_project_id, sequence,
            category, snapshot, occurred_at)
         VALUES ($1, $2, $3, $3, $4, 'HISTORY_PAYLOAD_PURGED', $5, $6)`,
        [
          `purge:${randomUUID()}`,
          actionId,
          input.resourceProjectId,
          seqRes.rows[0]?.sequence ?? 1,
          JSON.stringify({
            sourceEventKind: input.sourceEventKind,
            sourceEventId: input.sourceEventId,
            previousAvailability,
            newAvailability: 'PURGED_BY_POLICY',
            policyRevision: input.policyRevision,
            reason: input.reason,
            tombstone: input.tombstoneMetadata,
          }),
          occurredAt,
        ],
      );
      return;
    }
    // SETTINGS: existing settings_audit_events
    await client.query(
      `INSERT INTO settings.settings_audit_events
         (event_id, project_id, actor_id, action_name, risk_level, details, timestamp)
       VALUES ($1, $2, $3, 'HISTORY_PAYLOAD_PURGED', 'LOW', $4, $5)`,
      [
        `purge:${randomUUID()}`,
        input.resourceProjectId,
        input.actorId,
        JSON.stringify({
          sourceEventKind: input.sourceEventKind,
          sourceEventId: input.sourceEventId,
          previousAvailability,
          newAvailability: 'PURGED_BY_POLICY',
          policyRevision: input.policyRevision,
          reason: input.reason,
          tombstone: input.tombstoneMetadata,
        }),
        occurredAt,
      ],
    );
  }

  private validateInput(
    resourceProjectId: string,
    sourceEventKind: string,
    sourceEventId: string,
  ): void {
    if (!resourceProjectId || !sourceEventKind || !sourceEventId) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'resourceProjectId, sourceEventKind and sourceEventId required',
      );
    }
  }
}

// FE-P5-S2 WP4 ? Federated History projection stores.
export {
  PostgresHistoryIndexStore,
  PostgresHistoryWatermarkStore,
  createPostgresHistoryReadModelStore,
} from './history-projection-store.js';
export type { HistoryIndexRecordV1, HistoryWatermarkRecordV1 } from './history-projection-store.js';
