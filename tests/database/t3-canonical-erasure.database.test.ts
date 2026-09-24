import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresCanonicalKnowledgeResetOwner } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import type { KnowledgeResetOwnerContext } from '../../modules/source-knowledge-reset/src/index.js';
import { canonicalSnapshotDigest } from '../../packages/contracts/src/comparison-review.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const hash = (character: string): string => `sha256:${character.repeat(64)}`;

describe('ADR-171 Canonical erasure owner', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let executorPool: Pool;
  let owner: PostgresCanonicalKnowledgeResetOwner;

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    const password = randomUUID();
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(password)}`,
    );
    const connection = new URL(database.databaseUrl);
    connection.username = 'shotgun_erasure_executor';
    connection.password = password;
    executorPool = new Pool({ connectionString: connection.toString(), max: 1 });
    await executorPool.query('SELECT 1');
    owner = new PostgresCanonicalKnowledgeResetOwner(executorPool);
  });

  afterAll(async () => {
    await executorPool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await database?.dispose();
  });

  const createProject = async (projectId: string, version = 7) => {
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 Canonical fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, $2, $3, now())`,
      [projectId, version, hash('a')],
    );
  };

  const addSourceEvidence = async (projectId: string) => {
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const evidenceId = randomUUID();
    const now = new Date().toISOString();
    const originalContentHash = `sha256:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;
    await adminPool.query(
      `INSERT INTO asset.original_assets (
         asset_id, content_hash, size_bytes, storage_key, created_at
       ) VALUES ($1, $2, 32, $3, $4)`,
      [assetId, originalContentHash, `t3-canonical/${assetId}`, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 't3-canonical-test', $3)`,
      [sourceId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['project:owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await adminPool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 't3-fixture', '1', '{}'::jsonb,
                 '{}'::jsonb, $5, $5, ARRAY['project:owner'], 'private', $6)`,
      [revisionId, projectId, sourceId, sourceVersionId, hash('c'), now],
    );
    await adminPool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id,
         pointer, node_kind, origin, position, quote, exact_hash,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/0', 'sentence', 'source',
                 '{}'::jsonb, $6::jsonb, $7, ARRAY['project:owner'], 'private', $8)`,
      [
        evidenceId,
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        JSON.stringify({ exact: 'T3 CANONICAL SOURCE EVIDENCE CANARY' }),
        hash('d'),
        now,
      ],
    );
    return { sourceId, sourceVersionId, evidenceId, now };
  };

  const addCanonicalClaim = async (
    projectId: string,
    sourceVersionId: string,
    evidenceId: string,
    options: { readonly outboxStatus?: 'published' | 'pending' } = {},
  ) => {
    const commitId = randomUUID();
    const manifestId = randomUUID();
    const changeSetId = randomUUID();
    const revisionId = `revision-${randomUUID()}`;
    const historyEventId = `history-${randomUUID()}`;
    const outboxId = `outbox-${randomUUID()}`;
    const claimId = `claim-${randomUUID()}`;
    const now = new Date().toISOString();
    const claim = {
      claimId,
      projectId,
      revisionNumber: 1,
      claimText: 'T3 CANONICAL CLAIM CONTENT CANARY',
      sourceVersionId,
      evidenceIds: [evidenceId],
      createdFromManifestId: manifestId,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['project:owner'],
      sensitivity: 'private',
      createdAt: now,
    };
    await adminPool.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        commitId,
        projectId,
        manifestId,
        hash('e'),
        changeSetId,
        JSON.stringify({
          commitId,
          projectId,
          manifestId,
          manifestDigest: hash('e'),
          changeSetId,
          operation: 'ADD_CLAIM',
          status: 'COMMITTED',
          beforeVersion: 6,
          afterVersion: 7,
          snapshotDigest: hash('f'),
          claimId,
          revisionId,
          historyEventId,
          outboxId,
          committedAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id,
         claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [claimId, projectId, sourceVersionId, manifestId, JSON.stringify(claim), now],
    );
    await adminPool.query(
      `INSERT INTO canonical.revisions (revision_id, project_id, commit_id, revision_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        revisionId,
        projectId,
        commitId,
        JSON.stringify({
          revisionId,
          projectId,
          commitId,
          manifestId,
          operation: 'ADD_CLAIM',
          beforeVersion: 6,
          afterVersion: 7,
          claimId,
          reason: 'T3 CANONICAL REVISION REASON CANARY',
          actor: { type: 'user', id: 't3-user' },
          createdAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.history_events (
         history_event_id, project_id, commit_id, event_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        historyEventId,
        projectId,
        commitId,
        JSON.stringify({
          historyEventId,
          projectId,
          commitId,
          manifestId,
          changeSetId,
          eventType: 'CANONICAL_CLAIM_ADDED',
          beforeVersion: 6,
          afterVersion: 7,
          claimId,
          reason: 'T3 CANONICAL HISTORY REASON CANARY',
          actor: { type: 'user', id: 't3-user' },
          createdAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.history_payload_state (
         resource_project_id, source_event_kind, source_event_id, payload_availability,
         tombstone_metadata, changed_at, reason, policy_revision
       ) VALUES ($1, 'CANONICAL_CLAIM_ADDED', $2, 'REDACTED',
                 $3::jsonb, $4, 'T3 CANONICAL SIDECAR REASON CANARY', 'old-policy')`,
      [
        projectId,
        historyEventId,
        JSON.stringify({ note: 'T3 CANONICAL SIDECAR METADATA CANARY' }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.history_payload_audit_events (
         audit_event_id, resource_project_id, source_event_kind, source_event_id,
         previous_availability, new_availability, tombstone_metadata,
         policy_revision, reason, actor_id, occurred_at
       ) VALUES ($1, $2, 'CANONICAL_CLAIM_ADDED', $3, 'AVAILABLE', 'PURGED_BY_POLICY',
                 $4::jsonb, 'old-policy', 'T3 CANONICAL AUDIT REASON CANARY',
                 't3-user', $5)`,
      [
        `old-audit-${randomUUID()}`,
        projectId,
        historyEventId,
        JSON.stringify({ note: 'T3 CANONICAL AUDIT METADATA CANARY' }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.outbox (
         outbox_id, project_id, aggregate_id, event_type, payload_json,
         status, attempts, available_at, published_at, last_error
       ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb,
                 $5, 1, $6, $6, 'T3 CANONICAL OUTBOX ERROR CANARY')`,
      [
        outboxId,
        projectId,
        commitId,
        JSON.stringify({
          commitId,
          manifestId,
          changeSetId,
          operation: 'ADD_CLAIM',
          status: 'COMMITTED',
          canonicalVersion: 7,
          snapshotDigest: hash('f'),
          claimId,
          actorId: 't3-user',
          accessScope: ['project:owner'],
          sensitivity: 'private',
          sourceText: 'T3 CANONICAL OUTBOX PAYLOAD CANARY',
        }),
        options.outboxStatus ?? 'published',
        now,
      ],
    );
    return { commitId, claimId, revisionId, historyEventId, outboxId, manifestId };
  };

  const addCanonicalRelation = async (
    projectId: string,
    evidenceId: string,
    approvalId = randomUUID(),
  ) => {
    const commitId = randomUUID();
    const revisionId = `relation-revision-${randomUUID()}`;
    const historyEventId = `relation-history-${randomUUID()}`;
    const outboxId = `relation-outbox-${randomUUID()}`;
    const relationId = `relation-${randomUUID()}`;
    const logicalIdentityKey = `canonical-relation:v1:${randomUUID().replaceAll('-', '')}`;
    const now = new Date().toISOString();
    const fromEndpoint = {
      projectId,
      authority: 'APPROVED_KNOWLEDGE',
      resourceType: 'ENTITY',
      resourceId: `entity-from-${randomUUID()}`,
      resourceRevision: 1,
    };
    const toEndpoint = {
      projectId,
      authority: 'APPROVED_KNOWLEDGE',
      resourceType: 'ENTITY',
      resourceId: `entity-to-${randomUUID()}`,
      resourceRevision: 1,
    };
    const authority = {
      kind: 'FRONTEND_REVIEW_APPROVAL',
      approvalId,
      approvalBindingDigest: hash('7'),
      reviewContextId: `context-${randomUUID()}`,
      contextRevision: 1,
      draftId: `draft-${randomUUID()}`,
      draftRevision: 1,
      draftContentDigest: hash('8'),
      approvedItemIds: [`item-${randomUUID()}`],
    };
    const relation = {
      relationId,
      logicalIdentityKey,
      projectId,
      revisionNumber: 1,
      relationType: 'RELATED_TO',
      fromEndpoint,
      toEndpoint,
      direction: 'DIRECTED',
      evidenceIds: [evidenceId],
      accessScope: ['project:owner'],
      sensitivity: 'private',
      authority,
      createdAt: now,
    };
    await adminPool.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at, authority_kind, authority_id, authority_digest
       ) VALUES ($1, $2, NULL, NULL, NULL, $3::jsonb, $4,
                 'FRONTEND_REVIEW_APPROVAL', $5, $6)`,
      [
        commitId,
        projectId,
        JSON.stringify({
          commitId,
          projectId,
          manifestId: null,
          manifestDigest: null,
          changeSetId: null,
          authorityId: approvalId,
          authorityDigest: hash('6'),
          operation: 'ADD_RELATION',
          status: 'COMMITTED',
          beforeVersion: 6,
          afterVersion: 7,
          snapshotDigest: hash('9'),
          relationId,
          logicalIdentityKey,
          revisionId,
          historyEventId,
          outboxId,
          committedAt: now,
        }),
        now,
        approvalId,
        hash('6'),
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.relations (
         relation_id, project_id, revision_number, logical_identity_key,
         relation_type, direction, from_endpoint, to_endpoint, evidence_ids,
         access_scope, sensitivity, authority_json, relation_json, created_at
       ) VALUES ($1, $2, 1, $3, 'RELATED_TO', 'DIRECTED', $4::jsonb, $5::jsonb,
                 ARRAY[$6]::text[], ARRAY['project:owner'], 'private', $7::jsonb,
                 $8::jsonb, $9)`,
      [
        relationId,
        projectId,
        logicalIdentityKey,
        JSON.stringify(fromEndpoint),
        JSON.stringify(toEndpoint),
        evidenceId,
        JSON.stringify(authority),
        JSON.stringify(relation),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.revisions (revision_id, project_id, commit_id, revision_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        revisionId,
        projectId,
        commitId,
        JSON.stringify({
          revisionId,
          projectId,
          commitId,
          manifestId: null,
          operation: 'ADD_RELATION',
          beforeVersion: 6,
          afterVersion: 7,
          relationId,
          reason: 'T3 CANONICAL RELATION REVISION CANARY',
          actor: { type: 'user', id: 't3-user' },
          createdAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.history_events (
         history_event_id, project_id, commit_id, event_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        historyEventId,
        projectId,
        commitId,
        JSON.stringify({
          historyEventId,
          projectId,
          commitId,
          manifestId: null,
          changeSetId: null,
          eventType: 'CANONICAL_RELATION_ADDED',
          beforeVersion: 6,
          afterVersion: 7,
          relationId,
          reason: 'T3 CANONICAL RELATION HISTORY CANARY',
          actor: { type: 'user', id: 't3-user' },
          createdAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.outbox (
         outbox_id, project_id, aggregate_id, event_type, payload_json,
         status, attempts, available_at, published_at
       ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, 'published', 1, $5, $5)`,
      [
        outboxId,
        projectId,
        commitId,
        JSON.stringify({
          commitId,
          operation: 'ADD_RELATION',
          status: 'COMMITTED',
          canonicalVersion: 7,
          snapshotDigest: hash('9'),
          relationId,
          logicalIdentityKey,
          sourceText: 'T3 CANONICAL RELATION OUTBOX CANARY',
        }),
        now,
      ],
    );
    return { commitId, relationId };
  };

  const addCanonicalNoOp = async (projectId: string) => {
    const commitId = randomUUID();
    const manifestId = randomUUID();
    const changeSetId = randomUUID();
    const revisionId = `noop-revision-${randomUUID()}`;
    const historyEventId = `noop-history-${randomUUID()}`;
    const outboxId = `noop-outbox-${randomUUID()}`;
    const now = new Date().toISOString();
    await adminPool.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        commitId,
        projectId,
        manifestId,
        hash('a'),
        changeSetId,
        JSON.stringify({
          commitId,
          projectId,
          manifestId,
          manifestDigest: hash('a'),
          changeSetId,
          operation: 'NO_OP',
          status: 'NO_OP',
          beforeVersion: 7,
          afterVersion: 7,
          snapshotDigest: hash('b'),
          revisionId,
          historyEventId,
          outboxId,
          committedAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.revisions (revision_id, project_id, commit_id, revision_json, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        revisionId,
        projectId,
        commitId,
        JSON.stringify({
          revisionId,
          projectId,
          commitId,
          manifestId,
          operation: 'NO_OP',
          beforeVersion: 7,
          afterVersion: 7,
          reason: 'T3 CANONICAL NO OP REVISION CANARY',
          actor: { type: 'user', id: 't3-user' },
          createdAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.history_events (
         history_event_id, project_id, commit_id, event_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        historyEventId,
        projectId,
        commitId,
        JSON.stringify({
          historyEventId,
          projectId,
          commitId,
          manifestId,
          changeSetId,
          eventType: 'CHANGESET_NO_OP',
          beforeVersion: 7,
          afterVersion: 7,
          reason: 'T3 CANONICAL NO OP HISTORY CANARY',
          actor: { type: 'user', id: 't3-user' },
          createdAt: now,
        }),
        now,
      ],
    );
    await adminPool.query(
      `INSERT INTO canonical.outbox (
         outbox_id, project_id, aggregate_id, event_type, payload_json,
         status, attempts, available_at, published_at
       ) VALUES ($1, $2, $3, 'CanonicalCommitted', $4::jsonb, 'published', 1, $5, $5)`,
      [
        outboxId,
        projectId,
        commitId,
        JSON.stringify({
          commitId,
          manifestId,
          changeSetId,
          operation: 'NO_OP',
          status: 'NO_OP',
          canonicalVersion: 7,
          snapshotDigest: hash('b'),
          sourceText: 'T3 CANONICAL NO OP OUTBOX CANARY',
        }),
        now,
      ],
    );
    return { commitId };
  };

  const createReset = async (projectId: string): Promise<KnowledgeResetOwnerContext> => {
    const requestId = randomUUID();
    const manifestDigest = hash('1') as `sha256:${string}`;
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_epoch (project_id, epoch, state)
       VALUES ($1, 1, 'RESET_PENDING')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO project_admin.project_knowledge_reset_requests (
         request_id, preview_id, project_id, actor_principal_id, project_revision,
         expected_knowledge_epoch, resulting_knowledge_epoch, manifest_digest,
         owner_manifest_digest, preserved_configuration_digest, idempotency_key,
         state, impact_counts
       ) VALUES ($1, $2, $3, 't3-canonical-test', 1, 0, 1, $4, $5, $6, $7,
                 'FENCING', '{}'::jsonb)`,
      [requestId, randomUUID(), projectId, manifestDigest, hash('2'), hash('3'), randomUUID()],
    );
    return {
      projectId,
      requestId,
      knowledgeEpoch: 1,
      manifestDigest,
    };
  };

  const beginPurge = async (context: KnowledgeResetOwnerContext) => {
    await executorPool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [context.projectId, context.requestId, 'PURGING', []],
    );
  };

  it('scrubs source-derived canonical payloads and advances the empty snapshot once', async () => {
    const projectId = `t3-canonical-${randomUUID()}`;
    const otherProjectId = `t3-canonical-other-${randomUUID()}`;
    await createProject(projectId);
    await createProject(otherProjectId, 2);
    const source = await addSourceEvidence(projectId);
    const sourceRows = await addCanonicalClaim(
      projectId,
      source.sourceVersionId,
      source.evidenceId,
    );
    const relationRows = await addCanonicalRelation(projectId, source.evidenceId);
    const noOpRows = await addCanonicalNoOp(projectId);
    const otherSource = await addSourceEvidence(otherProjectId);
    const otherRows = await addCanonicalClaim(
      otherProjectId,
      otherSource.sourceVersionId,
      otherSource.evidenceId,
    );
    const context = await createReset(projectId);

    const before = await adminPool.query<{ impact: Record<string, unknown> }>(
      'SELECT canonical.t3_project_canonical_impact($1) AS impact',
      [projectId],
    );
    expect(Number(before.rows[0]?.impact.sourceDerivedRecordCount)).toBeGreaterThan(0);
    expect(Number(before.rows[0]?.impact.unclassifiedRecordCount)).toBe(0);
    expect(Number(before.rows[0]?.impact.activeOutboxCount)).toBe(0);
    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.counts.sourceDerivedRecordCount).toBeGreaterThan(0);
    expect(preview.blockers).not.toContain('UNCLASSIFIED_CONTENT');

    await owner.fence(context);
    const captured = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM canonical.t3_reset_owner_snapshot_rows
       WHERE project_id = $1 AND request_id = $2::uuid`,
      [projectId, context.requestId],
    );
    expect(Number(captured.rows[0]?.count)).toBeGreaterThan(0);

    await expect(
      adminPool.query('DELETE FROM canonical.claims WHERE project_id = $1', [projectId]),
    ).rejects.toThrow('append-only');

    await beginPurge(context);
    await owner.purge(context);
    const verification = await owner.verify(context);
    expect(verification).toEqual({ verified: true, blockerCodes: [] });

    const canonicalRows = await adminPool.query<{
      claims: string;
      relations: string;
      commits: string;
      revisions: string;
      histories: string;
      outbox: string;
      canary_payloads: string;
      snapshot_rows: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM canonical.claims WHERE project_id = $1) AS claims,
         (SELECT count(*)::text FROM canonical.relations WHERE project_id = $1) AS relations,
         (SELECT count(*)::text FROM canonical.commits WHERE project_id = $1) AS commits,
         (SELECT count(*)::text FROM canonical.revisions WHERE project_id = $1) AS revisions,
         (SELECT count(*)::text FROM canonical.history_events WHERE project_id = $1) AS histories,
         (SELECT count(*)::text FROM canonical.outbox WHERE project_id = $1) AS outbox,
         (SELECT count(*)::text FROM (
           SELECT result_json::text AS payload FROM canonical.commits WHERE project_id = $1
           UNION ALL SELECT revision_json::text FROM canonical.revisions WHERE project_id = $1
           UNION ALL SELECT event_json::text FROM canonical.history_events WHERE project_id = $1
           UNION ALL SELECT payload_json::text FROM canonical.outbox WHERE project_id = $1
           UNION ALL SELECT tombstone_metadata::text FROM canonical.history_payload_state
             WHERE resource_project_id = $1
           UNION ALL SELECT tombstone_metadata::text FROM canonical.history_payload_audit_events
             WHERE resource_project_id = $1
         ) AS payloads WHERE payload ILIKE '%CANARY%') AS canary_payloads,
         (SELECT count(*)::text FROM canonical.t3_reset_owner_snapshot_rows
           WHERE project_id = $1 AND request_id = $2::uuid) AS snapshot_rows`,
      [projectId, context.requestId],
    );
    expect(canonicalRows.rows[0]).toEqual({
      claims: '0',
      relations: '0',
      commits: '3',
      revisions: '3',
      histories: '3',
      outbox: '3',
      canary_payloads: '0',
      snapshot_rows: '0',
    });

    const state = await adminPool.query<{
      version: number;
      snapshot_digest: string;
      event_count: string;
      event_version: string;
      event_digest: string;
      manifest_digest: string;
      published_at: Date | null;
    }>(
      `SELECT state.version, state.snapshot_digest,
              count(event.event_id)::text AS event_count,
              max(event.state_version)::text AS event_version,
              max(event.empty_knowledge_digest) AS event_digest,
              max(event.manifest_digest) AS manifest_digest,
              max(event.published_at) AS published_at
       FROM canonical.project_state AS state
       LEFT JOIN canonical.knowledge_reset_events AS event
         ON event.project_id = state.project_id AND event.request_id = $2::uuid
       WHERE state.project_id = $1
       GROUP BY state.version, state.snapshot_digest`,
      [projectId, context.requestId],
    );
    expect(state.rows[0]).toEqual({
      version: 8,
      snapshot_digest: canonicalSnapshotDigest(projectId, 8, []),
      event_count: '1',
      event_version: '8',
      event_digest: canonicalSnapshotDigest(projectId, 8, []),
      manifest_digest: context.manifestDigest,
      published_at: null,
    });

    await owner.purge(context);
    const retry = await adminPool.query<{ version: number; count: string }>(
      `SELECT state.version,
              (SELECT count(*)::text FROM canonical.knowledge_reset_events
               WHERE project_id = $1 AND request_id = $2::uuid) AS count
       FROM canonical.project_state AS state WHERE state.project_id = $1`,
      [projectId, context.requestId],
    );
    expect(retry.rows[0]).toEqual({ version: 8, count: '1' });

    const otherRowsRemain = await adminPool.query<{ claim: string; commit: string }>(
      `SELECT
         (SELECT count(*)::text FROM canonical.claims
           WHERE project_id = $1 AND claim_id = $2) AS claim,
         (SELECT count(*)::text FROM canonical.commits
           WHERE project_id = $1 AND commit_id = $3::uuid) AS commit`,
      [otherProjectId, otherRows.claimId, otherRows.commitId],
    );
    expect(otherRowsRemain.rows[0]).toEqual({ claim: '1', commit: '1' });
    expect(sourceRows.claimId).toBeTruthy();
    expect(relationRows.relationId).toBeTruthy();
    expect(noOpRows.commitId).toBeTruthy();
  });

  it('blocks unresolved SourceVersion lineage before capturing a reset manifest', async () => {
    const projectId = `t3-canonical-unknown-${randomUUID()}`;
    await createProject(projectId);
    const claimId = `claim-${randomUUID()}`;
    await adminPool.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
      [
        claimId,
        projectId,
        randomUUID(),
        randomUUID(),
        JSON.stringify({
          claimId,
          projectId,
          sourceVersionId: randomUUID(),
          claimText: 'unresolved claim',
          evidenceIds: ['missing-evidence'],
        }),
      ],
    );
    const context = await createReset(projectId);

    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toContain('UNCLASSIFIED_CONTENT');
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'UNCLASSIFIED_CONTENT',
    });
    const remaining = await adminPool.query<{ claim: string; snapshot: string }>(
      `SELECT
         (SELECT count(*)::text FROM canonical.claims WHERE claim_id = $2) AS claim,
         (SELECT count(*)::text FROM canonical.t3_reset_owner_snapshots
           WHERE project_id = $1 AND request_id = $3::uuid) AS snapshot`,
      [projectId, claimId, context.requestId],
    );
    expect(remaining.rows[0]).toEqual({ claim: '1', snapshot: '0' });
  });

  it('blocks a pending Canonical outbox event until delivery outcome is known', async () => {
    const projectId = `t3-canonical-active-${randomUUID()}`;
    await createProject(projectId);
    const source = await addSourceEvidence(projectId);
    await addCanonicalClaim(projectId, source.sourceVersionId, source.evidenceId, {
      outboxStatus: 'pending',
    });
    const context = await createReset(projectId);

    const preview = await new PostgresKnowledgeResetImpactInspector(
      adminPool,
      true,
    ).inspectProjectSourceKnowledge(projectId);
    expect(preview.blockers).toContain('ACTIVE_JOB_OUTCOME_UNKNOWN');
    await expect(owner.fence(context)).rejects.toMatchObject({
      blockerCode: 'ACTIVE_JOB_OUTCOME_UNKNOWN',
    });
    const eventCount = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM canonical.knowledge_reset_events
       WHERE project_id = $1 AND request_id = $2::uuid`,
      [projectId, context.requestId],
    );
    expect(eventCount.rows[0]?.count).toBe('0');
  });
});
