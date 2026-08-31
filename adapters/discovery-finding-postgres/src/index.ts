import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  decodeDiscoveryFindingEnvelopeV1,
  ShotgunError,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/index.js';
import type { DiscoveryFindingEnvelopeV1 } from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryFindingLatestLookupV1,
  DiscoveryFindingLookupV1,
  DiscoveryFindingRepositoryPort,
  DiscoveryFindingPersistenceFenceV1,
  DiscoveryFindingPageCursorV1,
} from '../../../modules/discovery-finding-persistence/src/index.js';
import {
  assertDiscoveryLifecycleTransitionV1,
  decodeDiscoveryFindingLifecycleCurrentV1,
  decodeDiscoveryFindingLifecycleHistoryV1,
} from '../../../modules/discovery-finding-lifecycle/src/index.js';
import type {
  DiscoveryFindingFingerprintLookupPort,
  DiscoveryFindingIdentityV1,
  DiscoveryFindingLifecycleCurrentV1,
  DiscoveryFindingLifecycleHistoryV1,
  DiscoveryFindingLifecycleRepositoryPort,
  DiscoveryFindingLifecycleFenceV1,
  DiscoveryLifecycleTransitionInputV1,
  DiscoveryLifecycleTransitionResultV1,
} from '../../../modules/discovery-finding-lifecycle/src/index.js';
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

type DiscoveryFindingLifecycleCurrentRow = QueryResultRow & {
  readonly project_id: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly lifecycle_state: string;
  readonly lifecycle_revision: number;
  readonly updated_at: Date;
};

type DiscoveryFindingLifecycleHistoryRow = QueryResultRow & {
  readonly project_id: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly lifecycle_revision: number;
  readonly from_state: string | null;
  readonly to_state: string;
  readonly cause: string;
  readonly reason_code: string;
  readonly canonical_base_version: number | null;
  readonly canonical_snapshot_digest: string | null;
  readonly discovery_projection_revision: string | null;
  readonly discovery_projection_digest: string | null;
  readonly occurred_at: Date;
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
const qualifiedSelectColumns = selectColumns
  .split(',')
  .map((column) => `f.${column.trim()}`)
  .join(', ');

const lifecycleCurrentColumns = `
  project_id, finding_id, finding_revision, lifecycle_state,
  lifecycle_revision, updated_at`;

const lifecycleHistoryColumns = `
  project_id, finding_id, finding_revision, lifecycle_revision,
  from_state, to_state, cause, reason_code, canonical_base_version,
  canonical_snapshot_digest, discovery_projection_revision,
  discovery_projection_digest, occurred_at`;

const lifecycleCorrupt = (operation: string, message: string): never => {
  throw new ShotgunError({
    code: 'FORMAT_CORRUPT',
    safeMessage: message,
    module: 'discovery-finding-persistence',
    operation,
  });
};

const lifecycleNotFound = (operation: string): never => {
  throw new ShotgunError({
    code: 'NOT_FOUND',
    safeMessage: 'The requested Discovery finding was not found.',
    module: 'discovery-finding-persistence',
    operation,
  });
};

const mapLifecycleCurrent = (
  row: DiscoveryFindingLifecycleCurrentRow,
): DiscoveryFindingLifecycleCurrentV1 =>
  decodeDiscoveryFindingLifecycleCurrentV1({
    projectId: row.project_id,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    lifecycleState: row.lifecycle_state,
    lifecycleRevision: row.lifecycle_revision,
    updatedAt: row.updated_at.toISOString(),
  });

const mapLifecycleHistory = (
  row: DiscoveryFindingLifecycleHistoryRow,
): DiscoveryFindingLifecycleHistoryV1 => {
  if (
    (row.canonical_base_version === null) !== (row.canonical_snapshot_digest === null) ||
    (row.discovery_projection_revision === null) !== (row.discovery_projection_digest === null)
  ) {
    return lifecycleCorrupt(
      'lifecycle-history-read',
      'Discovery finding lifecycle history contains incomplete base context.',
    );
  }
  return decodeDiscoveryFindingLifecycleHistoryV1({
    projectId: row.project_id,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    lifecycleRevision: row.lifecycle_revision,
    ...(row.from_state === null ? {} : { fromState: row.from_state }),
    toState: row.to_state,
    cause: row.cause,
    reasonCode: row.reason_code,
    ...(row.canonical_base_version === null
      ? {}
      : {
          canonicalBase: {
            schemaVersion: '1.0.0',
            canonicalVersion: row.canonical_base_version,
            snapshotDigest: row.canonical_snapshot_digest!,
          },
        }),
    ...(row.discovery_projection_revision === null
      ? {}
      : {
          discoveryBase: {
            schemaVersion: '1.0.0',
            projectionRevision: row.discovery_projection_revision,
            projectionDigest: row.discovery_projection_digest!,
          },
        }),
    occurredAt: row.occurred_at.toISOString(),
  });
};

const identityParams = (identity: DiscoveryFindingIdentityV1): [string, string, number] => [
  identity.projectId,
  identity.findingId,
  identity.findingRevision,
];

const lifecycleContextValues = (input: {
  readonly context?: DiscoveryLifecycleTransitionInputV1['context'];
}): [number | null, string | null, string | null, string | null] => [
  input.context?.canonicalBase?.canonicalVersion ?? null,
  input.context?.canonicalBase?.snapshotDigest ?? null,
  input.context?.discoveryBase?.projectionRevision ?? null,
  input.context?.discoveryBase?.projectionDigest ?? null,
];

const insertDecodedFinding = async (
  client: PoolClient,
  decoded: DiscoveryFindingEnvelopeV1,
): Promise<void> => {
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
  await client.query(
    `INSERT INTO discovery.finding_lifecycle_current (
      project_id, finding_id, finding_revision, lifecycle_state,
      lifecycle_revision, updated_at
    ) VALUES ($1, $2, $3, $4, 1, $5)`,
    [
      decoded.projectId,
      decoded.findingId,
      decoded.findingRevision,
      decoded.lifecycleState,
      decoded.createdAt,
    ],
  );
  await client.query(
    `INSERT INTO discovery.finding_lifecycle_history (
      project_id, finding_id, finding_revision, lifecycle_revision,
      from_state, to_state, cause, reason_code,
      canonical_base_version, canonical_snapshot_digest,
      discovery_projection_revision, discovery_projection_digest, occurred_at
    ) VALUES ($1, $2, $3, 1, NULL, $4, 'MATERIALIZATION',
      'FINDING_MATERIALIZED', $5, $6, $7, $8, $9)`,
    [
      decoded.projectId,
      decoded.findingId,
      decoded.findingRevision,
      decoded.lifecycleState,
      decoded.canonicalBase.canonicalVersion,
      decoded.canonicalBase.snapshotDigest,
      decoded.discoveryBase.projectionRevision,
      decoded.discoveryBase.projectionDigest,
      decoded.createdAt,
    ],
  );
};

export class PostgresDiscoveryFindingRepository
  implements
    DiscoveryFindingRepositoryPort,
    DiscoveryFindingLifecycleRepositoryPort,
    DiscoveryFindingFingerprintLookupPort
{
  constructor(private readonly pool: Pool) {}

  async save(finding: DiscoveryFindingEnvelopeV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryFindingEnvelopeV1(finding);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await insertDecodedFinding(client, decoded);
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

  async saveFenced(
    finding: DiscoveryFindingEnvelopeV1,
    fence: DiscoveryFindingPersistenceFenceV1,
  ): Promise<'CREATED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'> {
    const decoded = decodeDiscoveryFindingEnvelopeV1(finding);
    if (decoded.projectId !== fence.projectId || decoded.runId !== fence.runId) {
      throw new TypeError('Discovery finding identity must match its leased run');
    }
    try {
      return await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const active = await client.query(
            `SELECT 1 FROM discovery.attempts
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
               AND lease_owner = $5 AND fencing_token = $6 AND lease_expires_at > $7
             FOR UPDATE`,
            [
              fence.projectId,
              fence.jobId,
              fence.runId,
              fence.attemptId,
              fence.workerId,
              fence.fencingToken,
              fence.now,
            ],
          );
          if (active.rowCount !== 1) {
            const exists = await client.query(
              `SELECT 1 FROM discovery.attempts
               WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4`,
              [fence.projectId, fence.jobId, fence.runId, fence.attemptId],
            );
            return exists.rowCount === 1 ? 'STALE' : 'NOT_FOUND';
          }
          await insertDecodedFinding(client, decoded);
          return 'CREATED';
        },
        { module: 'discovery-finding-persistence', operation: 'save-fenced' },
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'CONFLICT';
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

  async listByProjectPage(
    projectIdInput: string,
    after?: DiscoveryFindingPageCursorV1,
    limit = 50,
  ): Promise<readonly DiscoveryFindingEnvelopeV1[]> {
    const projectId = requiredIdentifier(projectIdInput, 'projectId');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError('reconciliation page limit must be an integer between 1 and 1000');
    }
    const result = await this.pool.query<DiscoveryFindingRow>(
      `SELECT ${selectColumns}
       FROM discovery.findings
       WHERE project_id = $1
         AND (
           $2::text IS NULL OR finding_id > $2
           OR (finding_id = $2 AND finding_revision > $3)
         )
       ORDER BY finding_id ASC, finding_revision ASC
       LIMIT $4`,
      [projectId, after?.findingId ?? null, after?.findingRevision ?? 0, limit],
    );
    return result.rows.map(mapRow);
  }

  /** Bounded, exact FindingReady lineage read for Activity backlinks. */
  async listByJobAndRun(
    projectIdInput: string,
    jobIdInput: string,
    runIdInput: string,
    limit = 21,
  ): Promise<readonly DiscoveryFindingEnvelopeV1[]> {
    const projectId = requiredIdentifier(projectIdInput, 'projectId');
    const jobId = requiredIdentifier(jobIdInput, 'jobId');
    const runId = requiredIdentifier(runIdInput, 'runId');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError('activity finding limit must be an integer between 1 and 1000');
    }
    const result = await this.pool.query<DiscoveryFindingRow>(
      `SELECT ${qualifiedSelectColumns}
       FROM discovery.findings f
       JOIN discovery.finding_ready ready
         ON ready.project_id = f.project_id
        AND ready.finding_id = f.finding_id
        AND ready.finding_revision = f.finding_revision
        AND ready.run_id = f.run_id
       WHERE f.project_id = $1 AND ready.job_id = $2 AND f.run_id = $3
       ORDER BY f.finding_id ASC, f.finding_revision ASC
       LIMIT $4`,
      [projectId, jobId, runId, limit],
    );
    return result.rows.map(mapRow);
  }

  async findByFingerprint(
    projectIdInput: string,
    fingerprintVersionInput: string,
    fingerprintInput: string,
  ): Promise<readonly DiscoveryFindingIdentityV1[]> {
    const projectId = requiredIdentifier(projectIdInput, 'projectId');
    const fingerprintVersion = requiredIdentifier(fingerprintVersionInput, 'fingerprintVersion');
    const fingerprint = requiredIdentifier(fingerprintInput, 'fingerprint');
    const result = await this.pool.query<{
      project_id: string;
      finding_id: string;
      finding_revision: number;
    }>(
      `SELECT project_id, finding_id, finding_revision
       FROM discovery.findings
       WHERE project_id = $1 AND fingerprint_version = $2 AND fingerprint = $3`,
      [projectId, fingerprintVersion, fingerprint],
    );
    return result.rows
      .map((row) => ({
        projectId: row.project_id,
        findingId: row.finding_id,
        findingRevision: row.finding_revision,
      }))
      .sort(
        (left, right) =>
          utf16OrdinalCompare(left.findingId, right.findingId) ||
          left.findingRevision - right.findingRevision,
      );
  }

  async findLifecycle(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryFindingLifecycleCurrentV1 | undefined> {
    const result = await this.pool.query<DiscoveryFindingLifecycleCurrentRow>(
      `SELECT ${lifecycleCurrentColumns}
       FROM discovery.finding_lifecycle_current
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      identityParams(identity),
    );
    const row = result.rows[0];
    if (row) return mapLifecycleCurrent(row);
    const finding = await this.pool.query(
      `SELECT 1
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      identityParams(identity),
    );
    if (finding.rowCount === 0) return undefined;
    return lifecycleCorrupt(
      'lifecycle-read',
      'Discovery finding lifecycle authority is not initialized.',
    );
  }

  async listLifecycleHistory(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<readonly DiscoveryFindingLifecycleHistoryV1[]> {
    const result = await this.pool.query<DiscoveryFindingLifecycleHistoryRow>(
      `SELECT ${lifecycleHistoryColumns}
       FROM discovery.finding_lifecycle_history
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
       ORDER BY lifecycle_revision ASC`,
      identityParams(identity),
    );
    if (result.rows.length > 0) return result.rows.map(mapLifecycleHistory);
    const finding = await this.pool.query(
      `SELECT 1
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      identityParams(identity),
    );
    if (finding.rowCount === 0) return lifecycleNotFound('lifecycle-history-read');
    return lifecycleCorrupt(
      'lifecycle-history-read',
      'Discovery finding lifecycle history is not initialized.',
    );
  }

  async transitionLifecycle(
    input: DiscoveryLifecycleTransitionInputV1,
    fence?: DiscoveryFindingLifecycleFenceV1,
  ): Promise<DiscoveryLifecycleTransitionResultV1> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        if (fence) {
          const lease = await client.query(
            `SELECT 1 FROM discovery.attempts
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
               AND lease_owner = $5 AND fencing_token = $6 AND lease_expires_at > $7
             FOR UPDATE`,
            [
              fence.projectId,
              fence.jobId,
              fence.runId,
              fence.attemptId,
              fence.workerId,
              fence.fencingToken,
              fence.now,
            ],
          );
          if (lease.rowCount !== 1) {
            const fencedCurrent = await client.query<DiscoveryFindingLifecycleCurrentRow>(
              `SELECT ${lifecycleCurrentColumns}
               FROM discovery.finding_lifecycle_current
               WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
               FOR SHARE`,
              identityParams(input),
            );
            const fencedRow = fencedCurrent.rows[0];
            if (fencedRow) {
              return { status: 'CONFLICT', current: mapLifecycleCurrent(fencedRow) };
            }
          }
        }
        const currentResult = await client.query<DiscoveryFindingLifecycleCurrentRow>(
          `SELECT ${lifecycleCurrentColumns}
           FROM discovery.finding_lifecycle_current
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           FOR UPDATE`,
          identityParams(input),
        );
        const currentRow = currentResult.rows[0];
        if (!currentRow) {
          const finding = await client.query(
            `SELECT 1
             FROM discovery.findings
             WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
            identityParams(input),
          );
          if (finding.rowCount === 0) return lifecycleNotFound('lifecycle-transition');
          return lifecycleCorrupt(
            'lifecycle-transition',
            'Discovery finding lifecycle authority is not initialized.',
          );
        }
        const current = mapLifecycleCurrent(currentRow);
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) {
          return { status: 'CONFLICT', current };
        }
        assertDiscoveryLifecycleTransitionV1(
          current.lifecycleState,
          input.targetState,
          input.cause,
          input.reasonCode,
        );
        const nextRevision = current.lifecycleRevision + 1;
        const [canonicalVersion, canonicalDigest, discoveryRevision, discoveryDigest] =
          lifecycleContextValues(input);
        await client.query(
          `INSERT INTO discovery.finding_lifecycle_history (
            project_id, finding_id, finding_revision, lifecycle_revision,
            from_state, to_state, cause, reason_code,
            canonical_base_version, canonical_snapshot_digest,
            discovery_projection_revision, discovery_projection_digest, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            input.projectId,
            input.findingId,
            input.findingRevision,
            nextRevision,
            current.lifecycleState,
            input.targetState,
            input.cause,
            input.reasonCode,
            canonicalVersion,
            canonicalDigest,
            discoveryRevision,
            discoveryDigest,
            input.occurredAt,
          ],
        );
        const updated = await client.query<DiscoveryFindingLifecycleCurrentRow>(
          `UPDATE discovery.finding_lifecycle_current
           SET lifecycle_state = $4, lifecycle_revision = $5, updated_at = $6
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
             AND lifecycle_revision = $7
           RETURNING ${lifecycleCurrentColumns}`,
          [
            input.projectId,
            input.findingId,
            input.findingRevision,
            input.targetState,
            nextRevision,
            input.occurredAt,
            input.expectedLifecycleRevision,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) {
          throw new ShotgunError({
            code: 'REVISION_CONFLICT',
            safeMessage: 'Discovery finding lifecycle revision became stale.',
            module: 'discovery-finding-persistence',
            operation: 'lifecycle-transition',
            retryable: true,
          });
        }
        const history = await client.query<DiscoveryFindingLifecycleHistoryRow>(
          `SELECT ${lifecycleHistoryColumns}
           FROM discovery.finding_lifecycle_history
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
             AND lifecycle_revision = $4`,
          [input.projectId, input.findingId, input.findingRevision, nextRevision],
        );
        const historyRow = history.rows[0];
        if (!historyRow) {
          return lifecycleCorrupt(
            'lifecycle-transition',
            'Applied lifecycle transition history could not be read.',
          );
        }
        return {
          status: 'APPLIED',
          lifecycle: mapLifecycleCurrent(updatedRow),
          history: mapLifecycleHistory(historyRow),
        };
      },
      { module: 'discovery-finding-persistence', operation: 'lifecycle-transition' },
    );
  }
}
