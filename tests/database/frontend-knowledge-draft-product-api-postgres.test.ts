import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { InMemoryFrontendKnowledgeDraftTargetResolver } from '../../adapters/frontend-knowledge-draft-api-in-memory/src/index.js';
import { PostgresFrontendKnowledgeDraftTargetResolver } from '../../adapters/frontend-knowledge-draft-api-postgres/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  createFrontendKnowledgeDraftClient,
  frontendKnowledgeDraftRevisionDigest,
} from '../../packages/shotgun-api-client/src/index.js';
import {
  FrontendKnowledgeDraftProductCoordinator,
  frontendKnowledgeDraftMaterializeDigest,
  frontendKnowledgeDraftSaveDigest,
} from '../../modules/frontend-knowledge-draft/src/product-api.js';
import type { FrontendKnowledgeOperationV1 } from '../../packages/contracts/src/index.js';
import { pBase, pOperation } from '../helpers/frontend-knowledge-draft-parity.js';

const PROJECT_ID = 'project-1';
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('FE-P3-S2 Product API coordinator on PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(
      `TRUNCATE frontend_knowledge_draft.drafts,
                frontend_knowledge_draft.revisions,
                frontend_knowledge_draft.operations,
                frontend_knowledge_draft.materializations,
                frontend_knowledge_draft.artifact_refs,
                frontend_command.command_ledger,
                canonical.outbox,
                canonical.history_events,
                canonical.revisions,
                canonical.commits,
                canonical.claims,
                canonical.project_state,
                asset.source_versions,
                asset.sources,
                asset.original_assets
       CASCADE`,
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  const buildCoordinator = () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: pBase,
    });
    return {
      resolver,
      coordinator: new FrontendKnowledgeDraftProductCoordinator(
        new PostgresFrontendKnowledgeDraftRepository(pool!),
        new PostgresFrontendCommandGateway(pool!),
        resolver,
      ),
    };
  };

  const scope = {
    principalId: 'principal-1',
    sessionId: 'session-1',
    activeProjectId: PROJECT_ID,
    accessRevision: 'access-7',
    policyContextRevision: '7',
    sensitivityClearance: 'private' as const,
    accessScope: ['owner'],
  };

  it('materializes a Seed, persists the Draft + Materialization and records a durable COMPLETED outcome', async () => {
    const { coordinator } = buildCoordinator();
    const request = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      seedId: 'seed-1',
    };
    const result = await coordinator.materializeDraft(scope, request);
    expect(result.outcome).toBe('COMPLETED');
    expect(result.draft.seedId).toBe('seed-1');
    expect(result.draft.revision).toBe(1);

    const drafts = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_knowledge_draft.drafts',
    );
    const materializations = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_knowledge_draft.materializations',
    );
    expect(drafts.rows[0]?.count).toBe('1');
    expect(materializations.rows[0]?.count).toBe('1');

    const outcome = await coordinator.resolveCommandOutcome(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      semanticDigest: frontendKnowledgeDraftMaterializeDigest(request),
    });
    expect(outcome.outcome).toBe('COMPLETED');
    expect(outcome.draft?.draftId).toBe(result.draft.draftId);

    // Idempotent replay with the same meaning returns the same Draft.
    const replay = await coordinator.materializeDraft(scope, request);
    expect(replay.draft.draftId).toBe(result.draft.draftId);
  });

  it('persists a REJECTED command outcome and rolls back a stale save transactionally', async () => {
    const { coordinator } = buildCoordinator();
    const materialized = await coordinator.materializeDraft(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      seedId: 'seed-1',
    });
    const draft = materialized.draft;
    const operations: readonly FrontendKnowledgeOperationV1[] = [pOperation(2)];
    const savePayload = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'request-2',
      idempotencyKey: 'key-request-2',
      expectedDraftRevision: 5,
      draftId: draft.draftId,
      expectedBaseRevision: draft.base.canonicalVersion,
      operationRevision: 2,
      operations,
      contentDigest: frontendKnowledgeDraftRevisionDigest({
        draftId: draft.draftId,
        revision: 2,
        base: draft.base,
        operations,
      }),
    };
    await expect(coordinator.saveDraft(scope, savePayload)).rejects.toMatchObject({
      apiCode: 'DRAFT_REVISION_CONFLICT',
    });

    // The failed save did not mutate the Draft (revision stays 1) and the
    // command outcome is durably recorded as REJECTED.
    const drafts = await pool!.query<{ revision: number }>(
      'SELECT revision FROM frontend_knowledge_draft.drafts WHERE draft_id = $1',
      [draft.draftId],
    );
    expect(drafts.rows[0]?.revision).toBe(1);
    const resolved = await coordinator.resolveCommandOutcome(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-2',
      idempotencyKey: 'key-request-2',
      semanticDigest: frontendKnowledgeDraftSaveDigest(savePayload),
    });
    expect(resolved.outcome).toBe('REJECTED');
  });

  it('resolves a Knowledge Resource through the production assembly with the real Postgres resolver', async () => {
    // Seed real canonical + asset rows exactly as the Stage 2/6 runtime writes
    // them, then resolve the Resource through the Postgres resolver wired into
    // the production application assembly (mirroring main.ts).
    const now = new Date().toISOString();
    const snapshotDigest = `sha256:${'a'.repeat(64)}`;
    const claimId = 'claim-resource-1';
    const sourceVersionId = '11111111-1111-4111-8111-111111111111';
    const sourceId = '22222222-2222-4222-8222-222222222222';
    const assetId = '33333333-3333-4333-8333-333333333333';
    const commitId = '44444444-4444-4444-8444-444444444444';
    const manifestId = '55555555-5555-4555-8555-555555555555';
    const changeSetId = '66666666-6666-4666-8666-666666666666';
    const revisionId = 'revision-resource-1';
    await pool!.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 1024, 'storage-key-1', $3)`,
      [assetId, snapshotDigest, now],
    );
    await pool!.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [sourceId, PROJECT_ID, now],
    );
    await pool!.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner'], 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await pool!.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 1, $2, $3)`,
      [PROJECT_ID, snapshotDigest, now],
    );
    await pool!.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        claimId,
        PROJECT_ID,
        sourceVersionId,
        manifestId,
        JSON.stringify({
          claimId,
          projectId: PROJECT_ID,
          revisionNumber: 1,
          claimText: 'Shotgun preserves visual knowledge.',
          sourceVersionId,
          evidenceIds: ['evidence-1'],
          createdFromManifestId: manifestId,
          accessScope: ['owner'],
          sensitivity: 'private',
          createdAt: now,
        }),
        now,
      ],
    );
    await pool!.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [commitId, PROJECT_ID, manifestId, snapshotDigest, changeSetId, JSON.stringify({}), now],
    );
    await pool!.query(
      `INSERT INTO canonical.revisions (
         revision_id, project_id, commit_id, revision_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        revisionId,
        PROJECT_ID,
        commitId,
        JSON.stringify({ revisionId, projectId: PROJECT_ID, claimId }),
        now,
      ],
    );

    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'draft-api-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('draft-api-owner');
    if (!principal) throw new Error('Draft API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;

    const resolver = new PostgresFrontendKnowledgeDraftTargetResolver(pool!);
    const application = await createApplication({
      authRepository: auth,
      frontendCommandGateway: new PostgresFrontendCommandGateway(pool!),
      frontendKnowledgeDraftRepository: new PostgresFrontendKnowledgeDraftRepository(pool!),
      frontendKnowledgeDraftTargetResolver: resolver,
    });
    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const started = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/drafts/start-seedless',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-request-1',
        resourceId: claimId,
      },
    });
    expect(started.statusCode).toBe(200);
    const body = started.json<{
      draft: {
        resourceId: string;
        base: { revisionIdentityKind: string; canonicalResourceId: string };
      };
    }>();
    expect(body.draft.resourceId).toBe(claimId);
    expect(body.draft.base.revisionIdentityKind).toBe('RESOURCE_REVISION');
    expect(body.draft.base.canonicalResourceId).toBe(claimId);
    await application.server.close();
  });

  it('validates the typed client Save digest through the real route and PostgreSQL coordinator', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'draft-api-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('draft-api-owner');
    if (!principal) throw new Error('Draft API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;

    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: pBase,
    });
    const application = await createApplication({
      authRepository: auth,
      frontendCommandGateway: new PostgresFrontendCommandGateway(pool!),
      frontendKnowledgeDraftRepository: new PostgresFrontendKnowledgeDraftRepository(pool!),
      frontendKnowledgeDraftTargetResolver: resolver,
    });

    // The typed Draft client talks to the real Product routes through the
    // Fastify inject server, carrying the session cookie on every request.
    const injectFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const href = String(url);
      const headers = { ...((init?.headers as Record<string, string>) ?? {}), cookie };
      const response = await application.server.inject({
        method: (init?.method as 'GET' | 'POST' | undefined) ?? 'GET',
        url: href,
        headers,
        ...(init?.body === undefined ? {} : { payload: JSON.parse(String(init.body)) }),
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createFrontendKnowledgeDraftClient({ fetch: injectFetch });

    // Materialize through the client -> route -> PostgreSQL coordinator.
    const materialized = await client.materializeDraft({
      schemaVersion: '1.0.0',
      clientRequestId: 'materialize-req-1',
      idempotencyKey: 'materialize-idem-1',
      seedId: 'seed-1',
    });
    expect(materialized.outcome).toBe('COMPLETED');
    expect(materialized.draft.revision).toBe(1);
    const draft = materialized.draft;

    // Build the Save exactly like the browser controller does: real typed
    // operations and the real contracts revision digest (no fake digests).
    const operations: readonly FrontendKnowledgeOperationV1[] = [pOperation(2)];
    const contentDigest = frontendKnowledgeDraftRevisionDigest({
      draftId: draft.draftId,
      revision: 2,
      base: draft.base,
      operations,
    });
    const saved = await client.saveDraft({
      schemaVersion: '1.0.0',
      clientRequestId: 'save-req-1',
      idempotencyKey: 'save-idem-1',
      draftId: draft.draftId,
      expectedDraftRevision: 1,
      expectedBaseRevision: draft.base.canonicalVersion,
      operationRevision: 2,
      operations,
      contentDigest,
    });

    // The PostgreSQL coordinator recomputed the digest with the same contracts
    // implementation and accepted the revision.
    expect(saved.outcome).toBe('COMPLETED');
    expect(saved.draft.revision).toBe(2);
    expect(saved.draft.contentDigest).toBe(contentDigest);
    const ledger = await pool!.query<{ outcome_state: string }>(
      `SELECT outcome_state FROM frontend_command.command_ledger WHERE client_request_id = $1`,
      ['save-req-1'],
    );
    expect(ledger.rows[0]?.outcome_state).toBe('COMPLETED');
    await application.server.close();
  });
});
