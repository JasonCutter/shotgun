import type { Pool, QueryResultRow } from 'pg';

import {
  decodeDiscoveryFindingEnvelopeV1,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';
import type { DiscoveryFindingEnvelopeV1 } from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryFindingLatestLookupV1,
  DiscoveryFindingLookupV1,
  DiscoveryFindingRepositoryPort,
} from '../../../modules/discovery-finding-persistence/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type DiscoveryFindingRow = QueryResultRow & {
  readonly schema_version: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly project_id: string;
  readonly finding_type: string;
  readonly status: string;
  readonly generation_method: string;
  readonly lifecycle_state: string;
  readonly payload: unknown;
  readonly related_resource_refs: unknown;
  readonly evidence_ids: string[];
  readonly source_projection_digest: string;
  readonly canonical_base_version: number;
  readonly canonical_snapshot_digest: string;
  readonly discovery_projection_revision: string;
  readonly discovery_projection_digest: string;
  readonly run_id: string;
  readonly signal_summary: unknown;
  readonly rationale: string;
  readonly derivation_summary: string;
  readonly provenance: unknown;
  readonly access_scope: string[];
  readonly sensitivity: string;
  readonly fingerprint: string;
  readonly fingerprint_version: string;
  readonly retention_class: string;
  readonly created_at: Date;
  readonly supersedes_finding_id: string | null;
};

const requiredIdentifier = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${field}: must be a non-empty string`);
  }
  return normalized;
};

const mapRow = (row: DiscoveryFindingRow): DiscoveryFindingEnvelopeV1 =>
  decodeDiscoveryFindingEnvelopeV1({
    schemaVersion: row.schema_version,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    projectId: row.project_id,
    status: row.status,
    findingType: row.finding_type,
    generationMethod: row.generation_method,
    lifecycleState: row.lifecycle_state,
    payload: row.payload,
    relatedResourceRefs: row.related_resource_refs,
    evidenceIds: row.evidence_ids,
    sourceProjectionDigest: row.source_projection_digest,
    canonicalBase: {
      schemaVersion: row.schema_version,
      canonicalVersion: row.canonical_base_version,
      snapshotDigest: row.canonical_snapshot_digest,
    },
    discoveryBase: {
      schemaVersion: row.schema_version,
      projectionRevision: row.discovery_projection_revision,
      projectionDigest: row.discovery_projection_digest,
    },
    runId: row.run_id,
    signalSummary: row.signal_summary,
    rationale: row.rationale,
    derivationSummary: row.derivation_summary,
    provenance: row.provenance,
    accessScope: row.access_scope,
    sensitivity: row.sensitivity,
    fingerprint: row.fingerprint,
    fingerprintVersion: row.fingerprint_version,
    retentionClass: row.retention_class,
    createdAt: row.created_at.toISOString(),
    ...(row.supersedes_finding_id === null
      ? {}
      : { supersedesFindingId: row.supersedes_finding_id }),
  });

const selectColumns = `
  schema_version, finding_id, finding_revision, project_id, finding_type,
  status, generation_method, lifecycle_state, payload, related_resource_refs,
  evidence_ids, source_projection_digest, canonical_base_version,
  canonical_snapshot_digest, discovery_projection_revision,
  discovery_projection_digest, run_id, signal_summary, rationale,
  derivation_summary, provenance, access_scope, sensitivity, fingerprint,
  fingerprint_version, retention_class, created_at, supersedes_finding_id`;

export class PostgresDiscoveryFindingRepository implements DiscoveryFindingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(finding: DiscoveryFindingEnvelopeV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryFindingEnvelopeV1(finding);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query(
            `INSERT INTO discovery.findings (
              schema_version, finding_id, finding_revision, project_id,
              finding_type, status, generation_method, lifecycle_state,
              payload, related_resource_refs, evidence_ids,
              source_projection_digest, canonical_base_version,
              canonical_snapshot_digest, discovery_projection_revision,
              discovery_projection_digest, run_id, signal_summary, rationale,
              derivation_summary, provenance, access_scope, sensitivity,
              fingerprint, fingerprint_version, retention_class, created_at,
              supersedes_finding_id
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
              $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20,
              $21::jsonb, $22, $23, $24, $25, $26, $27, $28
            )`,
            [
              decoded.schemaVersion,
              decoded.findingId,
              decoded.findingRevision,
              decoded.projectId,
              decoded.findingType,
              decoded.status,
              decoded.generationMethod,
              decoded.lifecycleState,
              JSON.stringify(decoded.payload),
              JSON.stringify(decoded.relatedResourceRefs),
              [...decoded.evidenceIds],
              decoded.sourceProjectionDigest,
              decoded.canonicalBase.canonicalVersion,
              decoded.canonicalBase.snapshotDigest,
              decoded.discoveryBase.projectionRevision,
              decoded.discoveryBase.projectionDigest,
              decoded.runId,
              JSON.stringify(decoded.signalSummary),
              decoded.rationale,
              decoded.derivationSummary,
              JSON.stringify(decoded.provenance),
              [...decoded.accessScope],
              decoded.sensitivity,
              decoded.fingerprint,
              decoded.fingerprintVersion,
              decoded.retentionClass,
              decoded.createdAt,
              decoded.supersedesFindingId ?? null,
            ],
          );
        },
        { module: 'discovery-finding-persistence', operation: 'save' },
      );
      return 'CREATED';
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return 'CONFLICT';
      }
      throw error;
    }
  }

  async findRevision(
    lookup: DiscoveryFindingLookupV1,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined> {
    const projectId = requiredIdentifier(lookup.projectId, 'projectId');
    const findingId = requiredIdentifier(lookup.findingId, 'findingId');
    const result = await this.pool.query<DiscoveryFindingRow>(
      `SELECT ${selectColumns}
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [projectId, findingId, lookup.findingRevision],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async findLatest(
    lookup: DiscoveryFindingLatestLookupV1,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined> {
    const projectId = requiredIdentifier(lookup.projectId, 'projectId');
    const findingId = requiredIdentifier(lookup.findingId, 'findingId');
    const result = await this.pool.query<DiscoveryFindingRow>(
      `SELECT ${selectColumns}
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2
       ORDER BY finding_revision DESC
       LIMIT 1`,
      [projectId, findingId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async listByProject(projectIdInput: string): Promise<readonly DiscoveryFindingEnvelopeV1[]> {
    const projectId = requiredIdentifier(projectIdInput, 'projectId');
    const result = await this.pool.query<DiscoveryFindingRow>(
      `SELECT ${selectColumns}
       FROM discovery.findings
       WHERE project_id = $1`,
      [projectId],
    );
    return result.rows
      .map(mapRow)
      .sort(
        (left, right) =>
          utf16OrdinalCompare(left.findingId, right.findingId) ||
          left.findingRevision - right.findingRevision,
      );
  }
}
