import type { Pool, QueryResultRow } from 'pg';

import {
  assertDiscoveryLifecycleTransitionV1,
  decodeDiscoveryFindingLifecycleCurrentV1,
} from '../../../modules/discovery-finding-lifecycle/src/index.js';
import type {
  CompiledTruthItem,
  DiscoveryApprovedResourceRevisionRefV1,
  DiscoveryFindingEnvelopeV1,
  DiscoveryFindingReadyV1,
  DiscoveryResourceRefV1,
  DiscoveryReentryManifestV1,
  DerivedKnowledgeCandidateV1,
  KnowledgeCandidate,
} from '../../../packages/contracts/src/index.js';
import {
  approvedKnowledgeDigest,
  approvedKnowledgeSourceIdentity,
  assertDiscoveryReentryManifestMatchesFindingV1,
  computeDiscoveryReentryLogicalIdentityV1,
  decodeDerivedKnowledgeCandidateV1,
  decodeDiscoveryFindingEnvelopeV1,
  decodeDiscoveryFindingReadyV1,
  decodeDiscoveryReentryManifestV1,
  semanticCorpusSourceSnapshotDigest,
  validateDiscoveryApprovedResourceRevisionResolutionV1,
  semanticStableJson,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  DiscoveryApprovedResourceRevisionResolutionInputV1,
  DiscoveryApprovedResourceRevisionResolutionResultV1,
  DiscoveryApprovedResourceRevisionResolverPort,
  DiscoveryFindingIdentityV1,
  DiscoveryReentryLifecycleCurrentV1,
  DiscoveryReentryPersistencePort,
  DiscoveryReentryPersistenceResultV1,
  DiscoveryReentryReviewReadyTransitionInputV1,
  DiscoveryReentryReviewReadyTransitionResultV1,
  DiscoveryReentryStoredIntakeV1,
  DiscoveryReentryConsumptionDispositionInputV1,
  DiscoveryReentryConsumptionDispositionRecordV1,
} from '../../../modules/discovery-reentry/src/index.js';
import type { KnowledgeModelRepositoryPort } from '../../../modules/knowledge-model/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';
import { ProductKnowledgeResourceResolver } from '../../../modules/hybrid-retrieval/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../../modules/canonical-knowledge/src/index.js';

type FindingRow = QueryResultRow & {
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

type FindingReadyRow = QueryResultRow & {
  readonly publication_id: string;
  readonly project_id: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly fingerprint: string;
  readonly fingerprint_version: string;
  readonly job_id: string;
  readonly run_id: string;
  readonly attempt_id: string;
  readonly canonical_base_version: number;
  readonly canonical_snapshot_digest: string;
  readonly required_projection_revision: string | null;
  readonly required_projection_digest: string | null;
  readonly occurred_at: Date;
};

type LifecycleRow = QueryResultRow & {
  readonly project_id: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly lifecycle_state: string;
  readonly lifecycle_revision: number;
  readonly updated_at: Date;
};

type ManifestRow = QueryResultRow & {
  readonly logical_identity_key: string;
  readonly manifest: unknown;
};

type CandidateRow = QueryResultRow & {
  readonly candidate: unknown;
};

type ConsumptionRow = QueryResultRow & {
  readonly project_id: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly requested_reentry_purpose: string;
  readonly publication_id: string;
  readonly disposition: 'PROCESSED' | 'INELIGIBLE' | 'BLOCKED_NON_RETRYABLE' | 'RETRYABLE';
  readonly reason_code: DiscoveryReentryConsumptionDispositionRecordV1['reasonCode'];
  readonly reason_detail: string;
  readonly next_eligible_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
};

const findingColumns = `
  schema_version, finding_id, finding_revision, project_id, finding_type,
  status, generation_method, lifecycle_state, payload, related_resource_refs,
  evidence_ids, source_projection_digest, canonical_base_version,
  canonical_snapshot_digest, discovery_projection_revision,
  discovery_projection_digest, run_id, signal_summary, rationale,
  derivation_summary, provenance, access_scope, sensitivity, fingerprint,
  fingerprint_version, retention_class, created_at, supersedes_finding_id`;

const findingReadyColumns = `
  publication_id, project_id, finding_id, finding_revision, fingerprint,
  fingerprint_version, job_id, run_id, attempt_id, canonical_base_version,
  canonical_snapshot_digest, required_projection_revision,
  required_projection_digest, occurred_at`;

const lifecycleColumns = `
  project_id, finding_id, finding_revision, lifecycle_state,
  lifecycle_revision, updated_at`;

const consumptionColumns = `
  project_id, finding_id, finding_revision, requested_reentry_purpose,
  publication_id, disposition, reason_code, reason_detail,
  next_eligible_at, created_at, updated_at`;

const dateIso = (value: Date | string): string => new Date(value).toISOString();

const sameCanonicalBase = (
  left: {
    readonly schemaVersion: string;
    readonly canonicalVersion: number;
    readonly snapshotDigest: string;
  },
  right: {
    readonly schemaVersion: string;
    readonly canonicalVersion: number;
    readonly snapshotDigest: string;
  },
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.canonicalVersion === right.canonicalVersion &&
  left.snapshotDigest === right.snapshotDigest;

const sameDiscoveryBase = (
  left: {
    readonly schemaVersion: string;
    readonly projectionRevision: string;
    readonly projectionDigest: string;
  },
  right: {
    readonly schemaVersion: string;
    readonly projectionRevision: string;
    readonly projectionDigest: string;
  },
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.projectionRevision === right.projectionRevision &&
  left.projectionDigest === right.projectionDigest;

const mapFinding = (row: FindingRow): DiscoveryFindingEnvelopeV1 =>
  decodeDiscoveryFindingEnvelopeV1({
    schemaVersion: row.schema_version,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    projectId: row.project_id,
    findingType: row.finding_type,
    status: row.status,
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
    createdAt: dateIso(row.created_at),
    ...(row.supersedes_finding_id === null
      ? {}
      : { supersedesFindingId: row.supersedes_finding_id }),
  });

const mapFindingReady = (row: FindingReadyRow): DiscoveryFindingReadyV1 =>
  decodeDiscoveryFindingReadyV1({
    schemaVersion: '1.0.0',
    publicationId: row.publication_id,
    projectId: row.project_id,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    fingerprint: row.fingerprint,
    fingerprintVersion: row.fingerprint_version,
    jobId: row.job_id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: row.canonical_base_version,
      snapshotDigest: row.canonical_snapshot_digest,
    },
    ...(row.required_projection_revision === null
      ? {}
      : {
          requiredDiscoveryBase: {
            schemaVersion: '1.0.0' as const,
            projectionRevision: row.required_projection_revision,
            projectionDigest: row.required_projection_digest!,
          },
        }),
    occurredAt: dateIso(row.occurred_at),
  });

const mapLifecycle = (row: LifecycleRow): DiscoveryReentryLifecycleCurrentV1 =>
  decodeDiscoveryFindingLifecycleCurrentV1({
    projectId: row.project_id,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    lifecycleState: row.lifecycle_state,
    lifecycleRevision: row.lifecycle_revision,
    updatedAt: dateIso(row.updated_at),
  });

const mapConsumption = (row: ConsumptionRow): DiscoveryReentryConsumptionDispositionRecordV1 => ({
  projectId: row.project_id,
  findingId: row.finding_id,
  findingRevision: row.finding_revision,
  requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
  publicationId: row.publication_id,
  disposition: row.disposition,
  reasonCode: row.reason_code,
  reasonDetail: row.reason_detail,
  ...(row.next_eligible_at === null ? {} : { nextEligibleAt: dateIso(row.next_eligible_at) }),
  createdAt: dateIso(row.created_at),
  updatedAt: dateIso(row.updated_at),
});

const writeConsumptionOn = async (
  client: Pick<Pool, 'query'>,
  input: DiscoveryReentryConsumptionDispositionInputV1,
): Promise<DiscoveryReentryConsumptionDispositionRecordV1> => {
  await client.query(
    `INSERT INTO discovery.reentry_consumption (
       project_id, finding_id, finding_revision, requested_reentry_purpose,
       publication_id, disposition, reason_code, reason_detail,
       next_eligible_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (project_id, finding_id, finding_revision, requested_reentry_purpose)
     DO UPDATE SET
       publication_id = EXCLUDED.publication_id,
       disposition = EXCLUDED.disposition,
       reason_code = EXCLUDED.reason_code,
       reason_detail = EXCLUDED.reason_detail,
       next_eligible_at = EXCLUDED.next_eligible_at,
       updated_at = EXCLUDED.updated_at
     WHERE discovery.reentry_consumption.disposition = 'RETRYABLE'`,
    [
      input.projectId,
      input.findingId,
      input.findingRevision,
      input.requestedReentryPurpose,
      input.publicationId,
      input.disposition,
      input.reasonCode,
      input.reasonDetail,
      input.nextEligibleAt ?? null,
      input.occurredAt,
    ],
  );
  const result = await client.query<ConsumptionRow>(
    `SELECT ${consumptionColumns}
     FROM discovery.reentry_consumption
     WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
       AND requested_reentry_purpose = $4
     FOR UPDATE`,
    [input.projectId, input.findingId, input.findingRevision, input.requestedReentryPurpose],
  );
  if (!result.rows[0]) throw new TypeError('Re-entry consumption disposition was not persisted.');
  return mapConsumption(result.rows[0]);
};

const identityParams = (identity: DiscoveryFindingIdentityV1): [string, string, number] => [
  identity.projectId,
  identity.findingId,
  identity.findingRevision,
];

const assertManifestCandidateMatch = (
  stored: DiscoveryReentryStoredIntakeV1,
  expected: {
    readonly manifest: DiscoveryReentryManifestV1;
    readonly candidate: DerivedKnowledgeCandidateV1;
  },
): void => {
  if (
    semanticStableJson(stored.manifest) !== semanticStableJson(expected.manifest) ||
    semanticStableJson(stored.candidate) !== semanticStableJson(expected.candidate)
  ) {
    throw new TypeError('Durable re-entry identity was reused with different content.');
  }
};

export type PostgresDiscoveryReentryRepositoryOptions = {
  readonly failpoint?: 'AFTER_MANIFEST';
};

export class PostgresDiscoveryReentryRepository implements DiscoveryReentryPersistencePort {
  public constructor(
    private readonly pool: Pick<Pool, 'connect' | 'query'>,
    private readonly options: PostgresDiscoveryReentryRepositoryOptions = {},
  ) {}

  public async listPendingFindingReady(limit: number): Promise<readonly DiscoveryFindingReadyV1[]> {
    const result = await this.pool.query<FindingReadyRow>(
      `SELECT ${findingReadyColumns}
       FROM discovery.finding_ready ready
       WHERE NOT EXISTS (
         SELECT 1 FROM discovery.reentry_manifests manifest
         WHERE manifest.project_id = ready.project_id
           AND manifest.finding_id = ready.finding_id
           AND manifest.finding_revision = ready.finding_revision
           AND manifest.requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'
       )
       AND NOT EXISTS (
         SELECT 1 FROM discovery.reentry_consumption disposition
         WHERE disposition.project_id = ready.project_id
           AND disposition.finding_id = ready.finding_id
           AND disposition.finding_revision = ready.finding_revision
           AND disposition.requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'
           AND (
             disposition.disposition IN ('PROCESSED', 'INELIGIBLE', 'BLOCKED_NON_RETRYABLE')
             OR (disposition.disposition = 'RETRYABLE'
                 AND disposition.next_eligible_at > now())
           )
       )
       ORDER BY ready.occurred_at, ready.publication_id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapFindingReady);
  }

  public async findFinding(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryFindingEnvelopeV1 | undefined> {
    const result = await this.pool.query<FindingRow>(
      `SELECT ${findingColumns} FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      identityParams(identity),
    );
    return result.rows[0] ? mapFinding(result.rows[0]) : undefined;
  }

  public async findLifecycle(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryReentryLifecycleCurrentV1 | undefined> {
    const result = await this.pool.query<LifecycleRow>(
      `SELECT ${lifecycleColumns} FROM discovery.finding_lifecycle_current
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      identityParams(identity),
    );
    return result.rows[0] ? mapLifecycle(result.rows[0]) : undefined;
  }

  public async transitionFindingToReviewReady(
    input: DiscoveryReentryReviewReadyTransitionInputV1,
  ): Promise<DiscoveryReentryReviewReadyTransitionResultV1> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const currentResult = await client.query<LifecycleRow>(
          `SELECT ${lifecycleColumns}
           FROM discovery.finding_lifecycle_current
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           FOR UPDATE`,
          identityParams(input),
        );
        const currentRow = currentResult.rows[0];
        if (!currentRow) throw new TypeError('Discovery Finding lifecycle was not found.');
        const current = mapLifecycle(currentRow);
        if (current.lifecycleState === 'REVIEW_READY') {
          return { status: 'IDEMPOTENT', current };
        }
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) {
          return { status: 'CONFLICT', current };
        }
        assertDiscoveryLifecycleTransitionV1(
          current.lifecycleState,
          'REVIEW_READY',
          'GOVERNED_WORKFLOW',
          'REVIEW_READY',
        );
        const nextRevision = current.lifecycleRevision + 1;
        await client.query(
          `INSERT INTO discovery.finding_lifecycle_history (
             project_id, finding_id, finding_revision, lifecycle_revision,
             from_state, to_state, cause, reason_code,
             canonical_base_version, canonical_snapshot_digest,
             discovery_projection_revision, discovery_projection_digest,
             occurred_at
           ) VALUES ($1, $2, $3, $4, $5, 'REVIEW_READY',
                     'GOVERNED_WORKFLOW', 'REVIEW_READY', $6, $7, $8, $9, $10)`,
          [
            input.projectId,
            input.findingId,
            input.findingRevision,
            nextRevision,
            current.lifecycleState,
            input.canonicalBase.canonicalVersion,
            input.canonicalBase.snapshotDigest,
            input.discoveryBase.projectionRevision,
            input.discoveryBase.projectionDigest,
            input.occurredAt,
          ],
        );
        const updatedResult = await client.query<LifecycleRow>(
          `UPDATE discovery.finding_lifecycle_current
           SET lifecycle_state = 'REVIEW_READY', lifecycle_revision = $4, updated_at = $5
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
             AND lifecycle_revision = $6
           RETURNING ${lifecycleColumns}`,
          [
            input.projectId,
            input.findingId,
            input.findingRevision,
            nextRevision,
            input.occurredAt,
            input.expectedLifecycleRevision,
          ],
        );
        const updatedRow = updatedResult.rows[0];
        if (!updatedRow) {
          throw new TypeError('Discovery Finding lifecycle update was not persisted.');
        }
        return { status: 'APPLIED', current: mapLifecycle(updatedRow) };
      },
      { module: 'discovery-reentry-postgres', operation: 'transition-review-ready' },
    );
  }

  public async findConsumptionDisposition(
    identity: DiscoveryFindingIdentityV1,
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1 | undefined> {
    const result = await this.pool.query<ConsumptionRow>(
      `SELECT ${consumptionColumns}
       FROM discovery.reentry_consumption
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
         AND requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'`,
      identityParams(identity),
    );
    return result.rows[0] ? mapConsumption(result.rows[0]) : undefined;
  }

  public async recordConsumptionDisposition(
    input: DiscoveryReentryConsumptionDispositionInputV1,
  ): Promise<DiscoveryReentryConsumptionDispositionRecordV1> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await client.query(
          `SELECT 1 FROM discovery.finding_lifecycle_current
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           FOR UPDATE`,
          identityParams(input),
        );
        return writeConsumptionOn(client, input);
      },
      { module: 'discovery-reentry-postgres', operation: 'record-consumption-disposition' },
    );
  }

  public async findExisting(
    logicalIdentityKey: string,
  ): Promise<DiscoveryReentryStoredIntakeV1 | undefined> {
    const manifestResult = await this.pool.query<ManifestRow>(
      `SELECT logical_identity_key, manifest
       FROM discovery.reentry_manifests
       WHERE logical_identity_key = $1`,
      [logicalIdentityKey],
    );
    const manifestRow = manifestResult.rows[0];
    if (!manifestRow) return undefined;
    const manifest = decodeDiscoveryReentryManifestV1(manifestRow.manifest);
    const candidateResult = await this.pool.query<CandidateRow>(
      `SELECT candidate FROM discovery.reentry_candidates
       WHERE project_id = $1 AND manifest_id = $2`,
      [manifest.projectId, manifest.manifestId],
    );
    const candidateRow = candidateResult.rows[0];
    if (!candidateRow) throw new TypeError('Durable re-entry manifest has no candidate.');
    const candidate = decodeDerivedKnowledgeCandidateV1(candidateRow.candidate);
    const finding = await this.findFinding({
      projectId: manifest.projectId,
      findingId: manifest.findingId,
      findingRevision: manifest.findingRevision,
    });
    if (!finding) throw new TypeError('Durable re-entry manifest has no Finding.');
    const logicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      findingType: finding.findingType,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: finding.canonicalBase,
      requestedReentryPurpose: manifest.requestedReentryPurpose,
    });
    if (
      logicalIdentity.logicalIdentityKey !== manifestRow.logical_identity_key ||
      candidate.candidateId !==
        `discovery-reentry-candidate:${logicalIdentity.logicalIdentityKey}` ||
      candidate.manifestId !== manifest.manifestId ||
      candidate.projectId !== manifest.projectId ||
      candidate.findingId !== manifest.findingId ||
      candidate.findingRevision !== manifest.findingRevision ||
      candidate.findingType !== manifest.findingType ||
      candidate.sourceProjectionDigest !== manifest.sourceProjectionDigest ||
      !sameCanonicalBase(candidate.canonicalBase, manifest.canonicalBase) ||
      !sameDiscoveryBase(candidate.discoveryBase, finding.discoveryBase)
    ) {
      throw new TypeError('Durable re-entry candidate identity does not match its manifest.');
    }
    assertDiscoveryReentryManifestMatchesFindingV1(manifest, finding);
    validateDiscoveryApprovedResourceRevisionResolutionV1(
      finding.relatedResourceRefs,
      candidate.relatedResourceRefs,
    );
    const lifecycle = await this.findLifecycle({
      projectId: manifest.projectId,
      findingId: manifest.findingId,
      findingRevision: manifest.findingRevision,
    });
    if (!lifecycle) throw new TypeError('Durable re-entry manifest has no Finding lifecycle.');
    return { logicalIdentityKey: manifestRow.logical_identity_key, manifest, candidate, lifecycle };
  }

  public async listPendingReviewMaterialization(
    limit: number,
  ): Promise<readonly DiscoveryReentryStoredIntakeV1[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be between 1 and 100');
    }
    const result = await this.pool.query<{ readonly logical_identity_key: string }>(
      `SELECT manifest.logical_identity_key
       FROM discovery.reentry_manifests manifest
       JOIN discovery.reentry_candidates candidate
         ON candidate.project_id = manifest.project_id
        AND candidate.manifest_id = manifest.manifest_id
       JOIN discovery.finding_lifecycle_current lifecycle
         ON lifecycle.project_id = candidate.project_id
        AND lifecycle.finding_id = candidate.finding_id
        AND lifecycle.finding_revision = candidate.finding_revision
       WHERE manifest.requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'
         AND lifecycle.lifecycle_state IN ('VALIDATING', 'REVIEW_READY')
         AND NOT EXISTS (
           SELECT 1
           FROM discovery.reentry_review_resources resource
           WHERE resource.project_id = candidate.project_id
             AND resource.candidate_id = candidate.candidate_id
             AND resource.candidate_revision = candidate.candidate_revision
         )
       ORDER BY manifest.created_at, manifest.logical_identity_key
       LIMIT $1`,
      [limit],
    );
    const intakes: DiscoveryReentryStoredIntakeV1[] = [];
    for (const row of result.rows) {
      const intake = await this.findExisting(row.logical_identity_key);
      if (intake !== undefined) intakes.push(intake);
    }
    return intakes;
  }

  public async persistIntake(input: {
    readonly logicalIdentity: {
      readonly identityVersion: string;
      readonly logicalIdentityKey: string;
      readonly idempotencyKey: string;
    };
    readonly finding: DiscoveryFindingEnvelopeV1;
    readonly manifest: DiscoveryReentryManifestV1;
    readonly candidate: DerivedKnowledgeCandidateV1;
    readonly expectedLifecycleRevision: number;
    readonly publicationId: string;
    readonly occurredAt: string;
  }): Promise<DiscoveryReentryPersistenceResultV1> {
    const finding = decodeDiscoveryFindingEnvelopeV1(input.finding);
    const manifest = decodeDiscoveryReentryManifestV1(input.manifest);
    const candidate = decodeDerivedKnowledgeCandidateV1(input.candidate);
    const expectedLogicalIdentity = computeDiscoveryReentryLogicalIdentityV1({
      projectId: finding.projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      findingType: finding.findingType,
      sourceProjectionDigest: finding.sourceProjectionDigest,
      canonicalBase: finding.canonicalBase,
      requestedReentryPurpose: manifest.requestedReentryPurpose,
    });
    if (
      input.logicalIdentity.identityVersion !== expectedLogicalIdentity.identityVersion ||
      input.logicalIdentity.logicalIdentityKey !== expectedLogicalIdentity.logicalIdentityKey ||
      input.logicalIdentity.idempotencyKey !== expectedLogicalIdentity.idempotencyKey
    ) {
      throw new TypeError('Re-entry logical identity is not server-derived from the Finding.');
    }
    assertDiscoveryReentryManifestMatchesFindingV1(manifest, finding);
    if (
      candidate.candidateId !==
        `discovery-reentry-candidate:${expectedLogicalIdentity.logicalIdentityKey}` ||
      candidate.manifestId !== manifest.manifestId ||
      candidate.projectId !== finding.projectId ||
      candidate.findingId !== finding.findingId ||
      candidate.findingRevision !== finding.findingRevision ||
      candidate.findingType !== finding.findingType ||
      candidate.sourceProjectionDigest !== finding.sourceProjectionDigest ||
      !sameCanonicalBase(candidate.canonicalBase, finding.canonicalBase) ||
      !sameDiscoveryBase(candidate.discoveryBase, finding.discoveryBase)
    ) {
      throw new TypeError('Derived candidate does not match the server-owned Finding or manifest.');
    }
    validateDiscoveryApprovedResourceRevisionResolutionV1(
      finding.relatedResourceRefs,
      candidate.relatedResourceRefs,
    );
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const authoritativeFindingResult = await client.query<FindingRow>(
          `SELECT ${findingColumns} FROM discovery.findings
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           FOR SHARE`,
          identityParams(finding),
        );
        const authoritativeFindingRow = authoritativeFindingResult.rows[0];
        if (!authoritativeFindingRow) {
          throw new TypeError('Discovery Finding was not found during re-entry persistence.');
        }
        const authoritativeFinding = mapFinding(authoritativeFindingRow);
        if (semanticStableJson(authoritativeFinding) !== semanticStableJson(finding)) {
          throw new TypeError('Re-entry persistence input does not match the durable Finding.');
        }
        const lifecycleResult = await client.query<LifecycleRow>(
          `SELECT ${lifecycleColumns}
           FROM discovery.finding_lifecycle_current
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           FOR UPDATE`,
          identityParams(finding),
        );
        const lifecycleRow = lifecycleResult.rows[0];
        if (!lifecycleRow) throw new TypeError('Discovery Finding lifecycle was not found.');
        const lifecycle = mapLifecycle(lifecycleRow);

        const consumptionResult = await client.query<ConsumptionRow>(
          `SELECT ${consumptionColumns}
           FROM discovery.reentry_consumption
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
             AND requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'
           FOR UPDATE`,
          identityParams(finding),
        );
        const consumption = consumptionResult.rows[0]
          ? mapConsumption(consumptionResult.rows[0])
          : undefined;

        const existingResult = await client.query<ManifestRow>(
          `SELECT logical_identity_key, manifest
           FROM discovery.reentry_manifests
           WHERE logical_identity_key = $1
           FOR UPDATE`,
          [input.logicalIdentity.logicalIdentityKey],
        );
        const existingManifestRow = existingResult.rows[0];
        if (existingManifestRow) {
          const existingManifest = decodeDiscoveryReentryManifestV1(existingManifestRow.manifest);
          const existingCandidateResult = await client.query<CandidateRow>(
            `SELECT candidate FROM discovery.reentry_candidates
             WHERE project_id = $1 AND manifest_id = $2`,
            [existingManifest.projectId, existingManifest.manifestId],
          );
          const existingCandidateRow = existingCandidateResult.rows[0];
          if (!existingCandidateRow)
            throw new TypeError('Durable re-entry manifest has no candidate.');
          const existingCandidate = decodeDerivedKnowledgeCandidateV1(
            existingCandidateRow.candidate,
          );
          assertManifestCandidateMatch(
            {
              logicalIdentityKey: existingManifestRow.logical_identity_key,
              manifest: existingManifest,
              candidate: existingCandidate,
              lifecycle,
            },
            { manifest, candidate },
          );
          return {
            status: 'IDEMPOTENT',
            logicalIdentityKey: existingManifestRow.logical_identity_key,
            manifest: existingManifest,
            candidate: existingCandidate,
            lifecycle,
          };
        }

        if (
          consumption?.disposition === 'INELIGIBLE' ||
          consumption?.disposition === 'BLOCKED_NON_RETRYABLE'
        ) {
          return {
            status: 'DISPOSITIONED',
            disposition: consumption.disposition,
            reasonCode: consumption.reasonCode,
            lifecycle,
          };
        }

        if (lifecycle.lifecycleState !== 'NEW') {
          await writeConsumptionOn(client, {
            projectId: finding.projectId,
            findingId: finding.findingId,
            findingRevision: finding.findingRevision,
            requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
            publicationId: input.publicationId,
            disposition: 'INELIGIBLE',
            reasonCode: 'LIFECYCLE_INELIGIBLE',
            reasonDetail: `Finding lifecycle is ${lifecycle.lifecycleState}.`,
            occurredAt: input.occurredAt,
          });
          return { status: 'INELIGIBLE', lifecycle };
        }
        if (lifecycle.lifecycleRevision !== input.expectedLifecycleRevision) {
          await writeConsumptionOn(client, {
            projectId: finding.projectId,
            findingId: finding.findingId,
            findingRevision: finding.findingRevision,
            requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
            publicationId: input.publicationId,
            disposition: 'INELIGIBLE',
            reasonCode: 'LIFECYCLE_INELIGIBLE',
            reasonDetail: 'Finding lifecycle revision changed before persistence.',
            occurredAt: input.occurredAt,
          });
          return { status: 'INELIGIBLE', lifecycle };
        }
        assertDiscoveryLifecycleTransitionV1(
          lifecycle.lifecycleState,
          'VALIDATING',
          'GOVERNED_WORKFLOW',
          'VALIDATION_STARTED',
        );

        await client.query(
          `INSERT INTO discovery.reentry_manifests (
             logical_identity_version, logical_identity_key, manifest_id,
             project_id, finding_id, finding_revision, finding_type,
             source_projection_digest, canonical_base_version,
             canonical_snapshot_digest, requested_reentry_purpose,
             manifest, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
          [
            input.logicalIdentity.identityVersion,
            input.logicalIdentity.logicalIdentityKey,
            manifest.manifestId,
            manifest.projectId,
            manifest.findingId,
            manifest.findingRevision,
            manifest.findingType,
            manifest.sourceProjectionDigest,
            manifest.canonicalBase.canonicalVersion,
            manifest.canonicalBase.snapshotDigest,
            manifest.requestedReentryPurpose,
            JSON.stringify(manifest),
            manifest.createdAt,
          ],
        );
        if (this.options.failpoint === 'AFTER_MANIFEST') {
          throw new Error('Discovery re-entry failpoint after manifest insert.');
        }
        await client.query(
          `INSERT INTO discovery.reentry_candidates (
             candidate_id, candidate_revision, logical_identity_key,
             project_id, manifest_id, finding_id, finding_revision,
             finding_type, origin, source_projection_digest,
             canonical_base_version, canonical_snapshot_digest,
             discovery_projection_revision, discovery_projection_digest,
             related_resource_refs, evidence_ids, derivation_provenance,
             access_scope, sensitivity, validation_profile,
             reentry_eligibility, review_eligibility, candidate, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, $15::jsonb, $16, $17::jsonb, $18, $19,
                     $20::jsonb, $21, $22, $23::jsonb, $24)`,
          [
            candidate.candidateId,
            candidate.candidateRevision,
            input.logicalIdentity.logicalIdentityKey,
            candidate.projectId,
            candidate.manifestId,
            candidate.findingId,
            candidate.findingRevision,
            candidate.findingType,
            candidate.origin,
            candidate.sourceProjectionDigest,
            candidate.canonicalBase.canonicalVersion,
            candidate.canonicalBase.snapshotDigest,
            candidate.discoveryBase.projectionRevision,
            candidate.discoveryBase.projectionDigest,
            JSON.stringify(candidate.relatedResourceRefs),
            candidate.evidenceIds,
            JSON.stringify(candidate.derivationProvenance),
            candidate.accessScope,
            candidate.sensitivity,
            JSON.stringify(candidate.validationProfile),
            candidate.reentryEligibility,
            candidate.reviewEligibility,
            JSON.stringify(candidate),
            candidate.createdAt,
          ],
        );
        const nextRevision = lifecycle.lifecycleRevision + 1;
        await client.query(
          `INSERT INTO discovery.finding_lifecycle_history (
             project_id, finding_id, finding_revision, lifecycle_revision,
             from_state, to_state, cause, reason_code,
             canonical_base_version, canonical_snapshot_digest,
             discovery_projection_revision, discovery_projection_digest,
             occurred_at
           ) VALUES ($1, $2, $3, $4, $5, 'VALIDATING',
                     'GOVERNED_WORKFLOW', 'VALIDATION_STARTED', $6, $7, $8, $9, $10)`,
          [
            lifecycle.projectId,
            lifecycle.findingId,
            lifecycle.findingRevision,
            nextRevision,
            lifecycle.lifecycleState,
            finding.canonicalBase.canonicalVersion,
            finding.canonicalBase.snapshotDigest,
            finding.discoveryBase.projectionRevision,
            finding.discoveryBase.projectionDigest,
            input.occurredAt,
          ],
        );
        const updatedResult = await client.query<LifecycleRow>(
          `UPDATE discovery.finding_lifecycle_current
           SET lifecycle_state = 'VALIDATING', lifecycle_revision = $4, updated_at = $5
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           RETURNING ${lifecycleColumns}`,
          [
            lifecycle.projectId,
            lifecycle.findingId,
            lifecycle.findingRevision,
            nextRevision,
            input.occurredAt,
          ],
        );
        const updated = updatedResult.rows[0];
        if (!updated) throw new TypeError('Discovery Finding lifecycle update was not persisted.');
        await writeConsumptionOn(client, {
          projectId: finding.projectId,
          findingId: finding.findingId,
          findingRevision: finding.findingRevision,
          requestedReentryPurpose: 'DERIVED_PROVENANCE_VALIDATION',
          publicationId: input.publicationId,
          disposition: 'PROCESSED',
          reasonCode: 'SUCCESS',
          reasonDetail: 'FindingReady was processed into durable re-entry intake.',
          occurredAt: input.occurredAt,
        });
        return {
          status: 'CREATED',
          logicalIdentityKey: input.logicalIdentity.logicalIdentityKey,
          manifest,
          candidate,
          lifecycle: mapLifecycle(updated),
        };
      },
      { module: 'discovery-reentry-postgres', operation: 'persist-reentry-intake' },
    );
  }
}

type RevisionRow = QueryResultRow & {
  readonly revision_id: string;
};

type DiscoveryReentryResolverOptions = {
  readonly canonicalKnowledgeRepository?: Pick<CanonicalKnowledgeRepositoryPort, 'findClaim'>;
  readonly knowledgeModelRepository?: Pick<KnowledgeModelRepositoryPort, 'listGroups'>;
  readonly compiledTruthRepository?: Pick<CompiledTruthRepositoryPort, 'findProjection'>;
};

const candidateTypeForResourceKind = (
  resourceKind: string,
): KnowledgeCandidate['candidateType'] | undefined => {
  switch (resourceKind) {
    case 'CANONICAL_ENTITY':
      return 'ENTITY';
    case 'CANONICAL_RELATION':
      return 'RELATION';
    case 'CANONICAL_EVENT':
      return 'EVENT';
    case 'CANONICAL_DECISION':
      return 'DECISION';
    case 'CANONICAL_CONFLICT':
      return 'CONFLICT';
    default:
      return undefined;
  }
};

const frozenAuthorityFailure = (
  reason: string,
  reasonCode:
    | 'NO_APPROVED_REENTRY_AUTHORITY'
    | 'NO_APPROVED_REVISION_AT_FROZEN_BASE' = 'NO_APPROVED_REVISION_AT_FROZEN_BASE',
): DiscoveryApprovedResourceRevisionResolutionResultV1 => ({
  status: 'UNRESOLVED',
  reason,
  reasonCode,
});

export class PostgresDiscoveryApprovedResourceRevisionResolver implements DiscoveryApprovedResourceRevisionResolverPort {
  private readonly productResourceResolver: ProductKnowledgeResourceResolver | undefined;

  public constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly options: DiscoveryReentryResolverOptions = {},
  ) {
    this.productResourceResolver = this.options.canonicalKnowledgeRepository
      ? new ProductKnowledgeResourceResolver(
          this.options.canonicalKnowledgeRepository,
          this.options.knowledgeModelRepository,
          this.options.compiledTruthRepository,
        )
      : undefined;
  }

  public async resolve(
    input: DiscoveryApprovedResourceRevisionResolutionInputV1,
  ): Promise<DiscoveryApprovedResourceRevisionResolutionResultV1> {
    if (input.projectId !== input.finding.projectId) {
      return frozenAuthorityFailure(
        'Resolver project does not match the Finding.',
        'NO_APPROVED_REENTRY_AUTHORITY',
      );
    }
    if (input.relatedResourceRefs.some((ref) => ref.projectId !== input.projectId)) {
      return frozenAuthorityFailure(
        'A related resource crosses the Finding project boundary.',
        'NO_APPROVED_REENTRY_AUTHORITY',
      );
    }
    if (input.relatedResourceRefs.length === 0) return { status: 'RESOLVED', refs: [] };

    const baseResult = await this.pool.query(
      `SELECT 1
       FROM canonical.commits
       WHERE project_id = $1
         AND (result_json->>'afterVersion')::integer = $2
         AND result_json->>'snapshotDigest' = $3
       LIMIT 1`,
      [input.projectId, input.canonicalBase.canonicalVersion, input.canonicalBase.snapshotDigest],
    );
    if (baseResult.rowCount !== 1) {
      return frozenAuthorityFailure('The Finding canonical base is not authoritative.');
    }

    const approvedGroups = this.options.knowledgeModelRepository
      ? (await this.options.knowledgeModelRepository.listGroups(input.projectId)).filter(
          (group) => group.projectId === input.projectId && group.status === 'APPROVED',
        )
      : undefined;
    if (approvedGroups !== undefined) {
      const approvedDigest = approvedKnowledgeDigest(
        approvedGroups.map(approvedKnowledgeSourceIdentity),
      );
      const sourceDigest = semanticCorpusSourceSnapshotDigest({
        projectId: input.projectId,
        canonicalVersion: input.canonicalBase.canonicalVersion,
        canonicalSnapshotDigest: input.canonicalBase.snapshotDigest,
        approvedKnowledgeDigest: approvedDigest,
      });
      if (
        sourceDigest !== input.finding.sourceProjectionDigest ||
        sourceDigest !== input.discoveryBase.projectionDigest
      ) {
        return frozenAuthorityFailure(
          'Current approved Knowledge authority does not match the Finding frozen source projection.',
        );
      }
    }

    const compiledProjection = this.options.compiledTruthRepository
      ? await this.options.compiledTruthRepository.findProjection(input.projectId)
      : undefined;
    if (this.options.compiledTruthRepository) {
      const expectedProjectionRevision = compiledProjection
        ? `compiled-truth:${compiledProjection.projectorVersion}:${compiledProjection.canonicalVersion}`
        : undefined;
      if (
        !compiledProjection ||
        compiledProjection.projectId !== input.projectId ||
        compiledProjection.canonicalVersion !== input.canonicalBase.canonicalVersion ||
        compiledProjection.sourceSnapshotDigest !== input.finding.sourceProjectionDigest ||
        compiledProjection.sourceSnapshotDigest !== input.discoveryBase.projectionDigest ||
        expectedProjectionRevision !== input.discoveryBase.projectionRevision
      ) {
        return frozenAuthorityFailure(
          'The current Compiled Truth projection does not match the Finding frozen discovery base.',
        );
      }
    }

    const findApprovedCandidate = (
      resourceId: string,
      candidateType: KnowledgeCandidate['candidateType'],
      resourceRevision: string | undefined,
    ): KnowledgeCandidate | undefined =>
      approvedGroups
        ?.flatMap((group) => group.items)
        .find(
          (candidate) =>
            candidate.candidateId === resourceId &&
            candidate.candidateType === candidateType &&
            (resourceRevision === undefined ||
              String(candidate.revisionNumber) === resourceRevision),
        );

    const semanticResourceTypeFor = (
      resourceKind: string,
    ): 'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION' | undefined => {
      switch (resourceKind) {
        case 'CANONICAL_ENTITY':
          return 'ENTITY';
        case 'CANONICAL_RELATION':
          return 'RELATION';
        case 'CANONICAL_EVENT':
          return 'EVENT';
        case 'CANONICAL_DECISION':
          return 'DECISION';
        default:
          return undefined;
      }
    };

    const resolveApprovedKnowledge = async (
      ref: Pick<DiscoveryResourceRefV1, 'resourceId' | 'resourceKind' | 'resourceRevision'>,
    ): Promise<DiscoveryApprovedResourceRevisionRefV1 | undefined> => {
      const semanticType = semanticResourceTypeFor(ref.resourceKind);
      const productResource =
        semanticType && this.productResourceResolver
          ? await this.productResourceResolver.resolveResource(
              input.projectId,
              semanticType,
              ref.resourceId,
              'APPROVED_KNOWLEDGE',
            )
          : undefined;
      const productRevision = productResource?.resourceRevision;
      if (
        productResource?.authority === 'APPROVED_KNOWLEDGE' &&
        productRevision !== undefined &&
        (ref.resourceRevision === undefined || String(productRevision) === ref.resourceRevision)
      ) {
        return {
          schemaVersion: '1.0.0',
          resourceKind: ref.resourceKind,
          resourceId: ref.resourceId,
          projectId: input.projectId,
          resourceState: 'APPROVED',
          resourceRevision: String(productRevision),
        };
      }
      const candidateType = candidateTypeForResourceKind(ref.resourceKind);
      const candidate = candidateType
        ? findApprovedCandidate(ref.resourceId, candidateType, ref.resourceRevision)
        : undefined;
      return candidate
        ? {
            schemaVersion: '1.0.0',
            resourceKind: ref.resourceKind,
            resourceId: ref.resourceId,
            projectId: input.projectId,
            resourceState: 'APPROVED',
            resourceRevision: String(candidate.revisionNumber),
          }
        : undefined;
    };

    const resolveCompiledApprovedKnowledge = async (
      ref: Pick<DiscoveryResourceRefV1, 'resourceId' | 'resourceKind' | 'resourceRevision'>,
      item: CompiledTruthItem,
    ): Promise<DiscoveryApprovedResourceRevisionRefV1 | undefined> => {
      if (item.type === 'CLAIM') return undefined;
      if (item.type === 'ACTION' || item.type === 'CONFLICT' || item.type === 'KNOWLEDGE_GAP') {
        const candidate = findApprovedCandidate(ref.resourceId, item.type, ref.resourceRevision);
        return candidate
          ? {
              schemaVersion: '1.0.0',
              resourceKind: ref.resourceKind,
              resourceId: ref.resourceId,
              projectId: input.projectId,
              resourceState: 'APPROVED',
              resourceRevision: String(candidate.revisionNumber),
            }
          : undefined;
      }
      const productResource = this.productResourceResolver
        ? await this.productResourceResolver.resolveResource(
            input.projectId,
            item.type,
            ref.resourceId,
            'COMPILED_TRUTH',
          )
        : undefined;
      if (
        productResource?.authority === 'COMPILED_TRUTH' &&
        productResource.resourceRevision !== undefined &&
        (ref.resourceRevision === undefined ||
          String(productResource.resourceRevision) === ref.resourceRevision)
      ) {
        return {
          schemaVersion: '1.0.0',
          resourceKind: ref.resourceKind,
          resourceId: ref.resourceId,
          projectId: input.projectId,
          resourceState: 'APPROVED',
          resourceRevision: String(productResource.resourceRevision),
        };
      }
      const candidate = findApprovedCandidate(ref.resourceId, item.type, ref.resourceRevision);
      return candidate
        ? {
            schemaVersion: '1.0.0',
            resourceKind: ref.resourceKind,
            resourceId: ref.resourceId,
            projectId: input.projectId,
            resourceState: 'APPROVED',
            resourceRevision: String(candidate.revisionNumber),
          }
        : undefined;
    };

    const resolveCanonicalClaim = async (
      ref: Pick<DiscoveryResourceRefV1, 'resourceId' | 'resourceKind' | 'resourceRevision'>,
    ): Promise<DiscoveryApprovedResourceRevisionRefV1 | undefined> => {
      const revisionResult = await this.pool.query<RevisionRow>(
        `SELECT revisions.revision_id
         FROM canonical.claims claims
         JOIN canonical.revisions revisions
           ON revisions.project_id = claims.project_id
          AND revisions.revision_json->>'claimId' = claims.claim_id
         JOIN canonical.commits commits
           ON commits.project_id = revisions.project_id
          AND commits.commit_id = revisions.commit_id
         WHERE claims.project_id = $1
           AND claims.claim_id = $2
           AND (revisions.revision_json->>'afterVersion')::integer <= $3
           AND commits.result_json->>'snapshotDigest' IS NOT NULL
           AND ($4::text IS NULL OR revisions.revision_id = $4)
         ORDER BY (revisions.revision_json->>'afterVersion')::integer DESC,
                  revisions.created_at DESC, revisions.revision_id DESC
         LIMIT 1`,
        [
          input.projectId,
          ref.resourceId,
          input.canonicalBase.canonicalVersion,
          ref.resourceRevision ?? null,
        ],
      );
      const revision = revisionResult.rows[0];
      return revision
        ? {
            schemaVersion: '1.0.0',
            resourceKind: ref.resourceKind,
            resourceId: ref.resourceId,
            projectId: input.projectId,
            resourceState: 'APPROVED',
            resourceRevision: revision.revision_id,
          }
        : undefined;
    };

    const resolved: DiscoveryApprovedResourceRevisionRefV1[] = [];
    for (const ref of input.relatedResourceRefs) {
      let resolvedRef: DiscoveryApprovedResourceRevisionRefV1 | undefined;
      if (ref.resourceKind === 'CANONICAL_CLAIM') {
        resolvedRef = await resolveCanonicalClaim(ref);
      } else if (ref.resourceKind === 'COMPILED_TRUTH_ITEM') {
        const item = compiledProjection?.items.find((candidate) => candidate.id === ref.resourceId);
        if (item?.source === 'CANONICAL_CLAIM' && item.type === 'CLAIM') {
          resolvedRef = await resolveCanonicalClaim(ref);
        } else if (item?.source === 'APPROVED_KNOWLEDGE') {
          resolvedRef = await resolveCompiledApprovedKnowledge(ref, item);
        }
      } else {
        resolvedRef = await resolveApprovedKnowledge(ref);
      }
      if (!resolvedRef) {
        const terminalAuthorityUnavailable =
          ref.resourceKind !== 'CANONICAL_CLAIM' &&
          candidateTypeForResourceKind(ref.resourceKind) === undefined;
        return frozenAuthorityFailure(
          terminalAuthorityUnavailable
            ? `No authoritative approved revision resolver exists for ${ref.resourceKind}.`
            : `No approved revision for ${ref.resourceKind}:${ref.resourceId} at the frozen base.`,
          terminalAuthorityUnavailable
            ? 'NO_APPROVED_REENTRY_AUTHORITY'
            : 'NO_APPROVED_REVISION_AT_FROZEN_BASE',
        );
      }
      resolved.push(resolvedRef);
    }
    return { status: 'RESOLVED', refs: resolved };
  }
}
