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
      // Existing generic audit stream: category + snapshot + per-action sequence.
      const seqRes = await client.query<{ sequence: number }>(
        `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
         FROM frontend_external_action.audit_events WHERE action_id = $1`,
        [input.sourceEventId],
      );
      await client.query(
        `INSERT INTO frontend_external_action.audit_events
           (audit_event_id, action_id, resource_project_id, effective_project_id, sequence,
            category, snapshot, occurred_at)
         VALUES ($1, $2, $3, $3, $4, 'HISTORY_PAYLOAD_PURGED', $5, $6)`,
        [
          `purge:${randomUUID()}`,
          input.sourceEventId,
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
