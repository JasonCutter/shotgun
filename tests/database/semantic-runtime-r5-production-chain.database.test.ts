import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import {
  PostgresOriginalAssetRepository,
  createPostgresPool,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import { PostgresSemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-postgres/src/index.js';
import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import {
  EnvironmentCredentialMasterKeyAuthority,
  CredentialVaultService,
} from '../../modules/credential-vault/src/index.js';
import { ProviderExternalTransferApprovalService } from '../../modules/provider-privacy-policy/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  SemanticEmbeddingProfileService,
  initialSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';
import {
  canonicalSnapshotDigest,
  knowledgeCandidateDigest,
  sha256Text,
  type CanonicalClaim,
  type HybridSearchResponse,
  type KnowledgeCandidate,
} from '../../packages/contracts/src/index.js';
import {
  startShotgunApplication,
  type ShotgunApplicationHandle,
} from '../../assemblies/shotgun-app/src/application.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

let databaseUrl: string | undefined;
if (process.env.TEST_DATABASE_URL?.trim()) {
  try {
    databaseUrl = await requireTestDatabaseTarget();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOTFOUND|timeout|connect/i.test(message)) {
      console.warn(`R5 PostgreSQL production-chain proof skipped: ${message}`);
    } else {
      throw error;
    }
  }
}

const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const digest = (value: string): string => sha256Text(value);

type ProviderRequest = {
  readonly model: string;
  readonly input: string | readonly string[];
  readonly dimensions: number;
};

/**
 * Deterministic external boundary for the real OpenAI embedding adapter.
 * It counts only metadata and never stores or logs Authorization/plaintext.
 */
class DeterministicOpenAIProvider {
  private server: Server | undefined;
  private readonly releaseWaiters: Array<() => void> = [];
  private paused = false;

  baseUrl = '';
  totalRequests = 0;
  buildRequests = 0;
  queryRequests = 0;

  async listen(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('The R5 provider harness did not expose a TCP address.'));
          return;
        }
        this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  reset(): void {
    this.totalRequests = 0;
    this.buildRequests = 0;
    this.queryRequests = 0;
  }

  pauseBuilds(): void {
    this.paused = true;
  }

  releaseBuilds(): void {
    this.paused = false;
    for (const release of this.releaseWaiters.splice(0)) release();
  }

  async waitForBuildRequests(count: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (this.buildRequests < count && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    if (this.buildRequests < count) {
      throw new Error(
        `R5 provider harness observed ${this.buildRequests} build requests, expected ${count}.`,
      );
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(body));
    };

    if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
      send(404, { error: 'not found' });
      return;
    }
    if (!request.headers.authorization?.startsWith('Bearer ')) {
      send(401, { error: 'authentication required' });
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProviderRequest;
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      if (
        typeof body.model !== 'string' ||
        !Number.isSafeInteger(body.dimensions) ||
        body.dimensions < 1 ||
        inputs.length < 1 ||
        inputs.some((input) => typeof input !== 'string')
      ) {
        send(400, { error: 'invalid request' });
        return;
      }

      this.totalRequests += 1;
      const isBuild = Array.isArray(body.input);
      if (isBuild) {
        this.buildRequests += 1;
        if (this.paused) await new Promise<void>((resolve) => this.releaseWaiters.push(resolve));
      } else {
        this.queryRequests += 1;
      }

      send(200, {
        object: 'list',
        data: inputs.map((input, index) => ({
          object: 'embedding',
          index,
          embedding: this.vectorFor(input as string, body.dimensions),
        })),
        model: body.model,
        usage: { prompt_tokens: 1, total_tokens: inputs.length },
      });
    } catch {
      send(500, { error: 'provider harness failure' });
    }
  }

  private vectorFor(text: string, dimension: number): readonly number[] {
    const vector = new Array<number>(dimension).fill(0);
    const normalized = text.toLocaleLowerCase();
    if (normalized.includes('entity')) {
      vector[1] = 1;
    } else {
      vector[0] = 1;
    }
    return vector;
  }
}

type Fixture = {
  readonly projectId: string;
  readonly principalId: string;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly claimId: string;
  readonly groupId: string;
  readonly claim: CanonicalClaim;
  readonly entity: KnowledgeCandidate;
  readonly credential: Awaited<ReturnType<CredentialVaultService['create']>>;
  readonly vault: CredentialVaultService;
  readonly profileService: SemanticEmbeddingProfileService;
  readonly approvalService: ProviderExternalTransferApprovalService;
};

const createFixture = async (): Promise<Fixture> => {
  if (!pool) throw new Error('R5 fixture requires PostgreSQL.');

  const suffix = randomUUID();
  const projectId = `r5-production-chain-${suffix}`;
  const auth = new PostgresAuthRepository(pool);
  const principal = await auth.bootstrapLocalOwnerPrincipal({
    accountId: `r5-owner-${suffix}`,
  });
  await pool.query(
    `INSERT INTO project_admin.projects
       (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $2, 'ACTIVE', true, now(), now(), 1)`,
    [projectId, `R5 production-chain ${suffix}`],
  );
  await pool.query(
    `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
     VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
    [principal.principalId, projectId],
  );
  const session = await auth.createSession(
    principal.principalId,
    projectId,
    '2099-01-01T00:00:00.000Z',
  );

  const sourceText = 'R5 canonical production chain source evidence.';
  const originalAssets = new PostgresOriginalAssetRepository(pool);
  const stored = await originalAssets.store({
    submissionId: `r5-source-${suffix}`,
    projectId,
    actorId: principal.principalId,
    channel: 'direct_text',
    materialKind: 'plain_text',
    mediaType: 'text/plain',
    contentHash: sha256Text(sourceText),
    sizeBytes: Buffer.byteLength(sourceText),
    storageKey: `r5/${suffix}/source.txt`,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: new Date().toISOString(),
  });

  const revisionId = randomUUID();
  const evidenceId = randomUUID();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, 'r5-fixture', '1', $6::jsonb, $7::jsonb, $5, $8, $9, 'private', $10)`,
    [
      revisionId,
      projectId,
      stored.sourceId,
      stored.sourceVersionId,
      sha256Text(sourceText),
      JSON.stringify({ mediaType: 'text/plain' }),
      JSON.stringify({}),
      sha256Text('r5-source-map'),
      ['owner'],
      now,
    ],
  );
  await pool.query(
    `INSERT INTO evidence.spans
       (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
        node_kind, origin, position, quote, selectors, exact_hash, access_scope,
        sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, '/paragraphs/1', 'paragraph', 'source', $6::jsonb,
             $7::jsonb, '[]'::jsonb, $8, $9, 'private', $10)`,
    [
      evidenceId,
      revisionId,
      projectId,
      stored.sourceId,
      stored.sourceVersionId,
      JSON.stringify({
        type: 'TextPositionSelector',
        start: 0,
        end: Array.from(sourceText).length,
        unit: 'unicode-code-point',
      }),
      JSON.stringify({ type: 'TextQuoteSelector', exact: sourceText }),
      sha256Text(sourceText),
      ['owner'],
      now,
    ],
  );

  const claimId = `r5-claim-${suffix}`;
  const claim: CanonicalClaim = {
    claimId,
    projectId,
    revisionNumber: 1,
    claimText: 'R5 canonical production chain is durable and authoritative.',
    sourceVersionId: stored.sourceVersionId,
    evidenceIds: [evidenceId],
    createdFromManifestId: null,
    authorityId: null,
    authorityDigest: null,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: now,
  };
  const snapshotDigest = canonicalSnapshotDigest(projectId, 1, [
    {
      claimId,
      text: claim.claimText,
      revisionNumber: 1,
      evidenceIds: [evidenceId],
    },
  ]);
  await pool.query(
    `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
     VALUES ($1, 1, $2, $3)`,
    [projectId, snapshotDigest, now],
  );
  await pool.query(
    `INSERT INTO canonical.claims
       (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [claimId, projectId, stored.sourceVersionId, randomUUID(), JSON.stringify(claim), now],
  );

  const entity: KnowledgeCandidate = {
    candidateId: `r5-entity-${suffix}`,
    candidateType: 'ENTITY',
    revisionNumber: 1,
    sourceVersionId: stored.sourceVersionId,
    evidenceIds: [evidenceId],
    modelOutputs: [],
    name: 'R5 Entity',
    entityKind: 'CONCEPT',
    aliases: [],
    resolution: { status: 'NEW' },
  };
  const groupId = `r5-group-${suffix}`;
  await pool.query(
    `INSERT INTO knowledge.review_groups
       (project_id, group_id, source_version_id, revision_number, status, content_digest,
        items, decisions, access_scope, sensitivity, created_at, updated_at)
     VALUES ($1, $2, $3, 1, 'APPROVED', $4, $5::jsonb, '[]'::jsonb, $6, 'private', $7, $7)`,
    [
      projectId,
      groupId,
      stored.sourceVersionId,
      knowledgeCandidateDigest([entity]),
      JSON.stringify([entity]),
      ['owner'],
      now,
    ],
  );

  const commitId = randomUUID();
  await pool.query(
    `INSERT INTO projection.search_documents
       (project_id, claim_id, commit_id, revision_id, canonical_version, claim_text,
        source_version_id, evidence_ids, access_scope, sensitivity, projected_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, 'private', $9)`,
    [
      projectId,
      claimId,
      commitId,
      `r5-revision-${suffix}`,
      claim.claimText,
      stored.sourceVersionId,
      [evidenceId],
      ['owner'],
      now,
    ],
  );
  await pool.query(
    `INSERT INTO projection.watermarks
       (project_id, last_commit_id, canonical_version, snapshot_digest, status, updated_at)
     VALUES ($1, $2, 1, $3, 'READY', $4)`,
    [projectId, commitId, snapshotDigest, now],
  );

  const vault = new CredentialVaultService(
    new PostgresCredentialVaultRepository(pool),
    new EnvironmentCredentialMasterKeyAuthority(),
  );
  const credential = await vault.create({
    projectId,
    providerId: 'openai',
    secret: 'r5-provider-fixture-token',
    now,
  });
  const approvalService = new ProviderExternalTransferApprovalService(
    new PostgresProviderExternalTransferApprovalRepository(pool),
    initialProviderRegistry(),
  );
  const proposal = await approvalService.propose({
    projectId,
    providerId: 'openai',
    approved: true,
    expectedApprovalRevision: 0,
    proposedBy: principal.principalId,
  });
  await approvalService.approve({
    proposalId: proposal.proposalId,
    projectId,
    providerId: 'openai',
    expectedApprovalRevision: 0,
    reviewedBy: principal.principalId,
  });

  const profileService = new SemanticEmbeddingProfileService(
    initialProviderRegistry(),
    initialSemanticEmbeddingRegistry(),
    new PostgresSemanticEmbeddingProfileRepository(pool),
    vault,
  );
  const profile = await profileService.createProfile({
    projectId,
    expectedRevision: 0,
    providerId: 'openai',
    embeddingModelId: 'text-embedding-3-small',
    credentialId: credential.credentialId,
    credentialRevision: credential.credentialRevision,
    dimension: 512,
    distanceMetric: 'cosine',
    normalizationPolicy: 'unit_length',
    status: 'PREPARED',
    updatedBy: principal.principalId,
    now,
  });
  await profileService.activateProfile({
    projectId,
    profileId: profile.profileId,
    profileRevision: profile.profileRevision,
    updatedBy: principal.principalId,
    now,
  });

  return {
    projectId,
    principalId: principal.principalId,
    sessionToken: session.sessionToken,
    csrfToken: session.csrfToken,
    sourceId: stored.sourceId,
    sourceVersionId: stored.sourceVersionId,
    evidenceId,
    claimId,
    groupId,
    claim,
    entity,
    credential,
    vault,
    profileService,
    approvalService,
  };
};

describe('AKP-1R R5: real PostgreSQL cross-WP semantic production-chain proof', () => {
  afterAll(async () => {
    await pool?.end();
  });

  if (!pool) {
    it.skip('PostgreSQL test database not available; R5 proof is deferred to CI.', () => {});
    return;
  }

  it('uses normal startShotgunApplication composition for durable build, restart, policy, stale, reuse, and CAS proof', async () => {
    await migrateUpTo(undefined, databaseUrl!);

    const provider = new DeterministicOpenAIProvider();
    await provider.listen();
    const environmentNames = [
      'DATABASE_URL',
      'OPENAI_BASE_URL',
      'AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS',
      'GEMINI_ALLOW_PRIVATE',
      'SOURCES_STAGING_SECRET',
      'SHOTGUN_CREDENTIAL_MASTER_KEY',
      'SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION',
      'NODE_ENV',
    ] as const;
    const previousEnvironment = Object.fromEntries(
      environmentNames.map((name) => [name, process.env[name]]),
    ) as Record<(typeof environmentNames)[number], string | undefined>;
    const databaseEnvironmentName = ['DATABASE', '_URL'].join('');
    process.env[databaseEnvironmentName] = databaseUrl;
    process.env.OPENAI_BASE_URL = provider.baseUrl;
    process.env.AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS = 'openai';
    process.env.GEMINI_ALLOW_PRIVATE = 'false';
    process.env.SOURCES_STAGING_SECRET = 'r5-production-chain-staging-secret-32-bytes';
    process.env.SHOTGUN_CREDENTIAL_MASTER_KEY = randomBytes(32).toString('base64url');
    process.env.SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION = 'r5-test';
    process.env.NODE_ENV = 'test';

    let application: ShotgunApplicationHandle | undefined;
    let topKCalls = 0;
    const fixture = await createFixture();
    const semanticRepository = new PostgresSemanticIndexRepository(pool);
    const cookie = `shotgun_session=${fixture.sessionToken}`;

    const startNormalApplication = async (): Promise<ShotgunApplicationHandle> =>
      startShotgunApplication({
        host: '127.0.0.1',
        port: 0,
        noSignals: true,
        disableAskWorker: true,
        semanticNearestNeighborObserver: () => {
          topKCalls += 1;
        },
      });

    const post = async (
      url: string,
      body: unknown,
    ): Promise<{ readonly statusCode: number; readonly body: string }> => {
      if (!application) throw new Error('R5 application is not running.');
      const response = await application.server.inject({
        method: 'POST',
        url,
        payload: JSON.stringify(body),
        headers: {
          cookie,
          'x-csrf-token': fixture.csrfToken,
          'content-type': 'application/json',
        },
      });
      return { statusCode: response.statusCode, body: response.body };
    };
    const refresh = async () => post('/projection/semantic/refresh', {});
    const hybrid = async (query = 'R5 canonical production chain') => {
      const response = await post('/search/hybrid', { query, limit: 10 });
      expect(response.statusCode).toBe(200);
      return (JSON.parse(response.body) as { hybridSearch: HybridSearchResponse }).hybridSearch;
    };
    const activeGeneration = async () => {
      const pointer = await pool.query<{ active_generation_id: string; pointer_revision: string }>(
        `SELECT active_generation_id, pointer_revision::text
           FROM projection.semantic_generation_pointers WHERE project_id = $1`,
        [fixture.projectId],
      );
      const generation = await pool.query<{
        generation_id: string;
        build_status: string;
        source_projection_digest: string;
        embedding_profile_revision: number;
      }>(
        `SELECT generation_id, build_status, source_projection_digest, embedding_profile_revision
           FROM projection.semantic_generations
           WHERE project_id = $1 AND generation_id = $2`,
        [fixture.projectId, pointer.rows[0]?.active_generation_id],
      );
      const membership = pointer.rows[0]
        ? await semanticRepository.readGenerationMembershipSummary(
            fixture.projectId,
            pointer.rows[0].active_generation_id,
          )
        : undefined;
      return { pointer: pointer.rows[0], generation: generation.rows[0], membership };
    };

    try {
      // The normal startup recovery may create a valid compiled-truth row.
      // Replace it with a stale row after startup so the generation builder
      // proves it cannot resurrect a missing Canonical resource.
      application = await startNormalApplication();
      await pool.query(
        `INSERT INTO projection.compiled_truth
             (project_id, projector_version, source_snapshot_digest, logical_digest,
              canonical_version, build_mode, projection, status, updated_at)
           VALUES ($1, 'r5-stale-fixture', $2, $3, 0, 'FULL_REBUILD', $4::jsonb, 'READY', now())
           ON CONFLICT (project_id) DO UPDATE SET
             projector_version = EXCLUDED.projector_version,
             source_snapshot_digest = EXCLUDED.source_snapshot_digest,
             logical_digest = EXCLUDED.logical_digest,
             canonical_version = EXCLUDED.canonical_version,
             build_mode = EXCLUDED.build_mode,
             projection = EXCLUDED.projection,
             status = EXCLUDED.status,
             last_error = NULL,
             updated_at = EXCLUDED.updated_at`,
        [
          fixture.projectId,
          digest('stale-compiled-truth-source'),
          digest('stale-compiled-truth-logical'),
          JSON.stringify({
            projectId: fixture.projectId,
            projectorVersion: 'r5-stale-fixture',
            sourceSnapshotDigest: digest('stale-compiled-truth-source'),
            logicalDigest: digest('stale-compiled-truth-logical'),
            canonicalVersion: 0,
            items: [
              {
                id: 'missing-canonical-resource',
                type: 'CLAIM',
                label: 'Must not be resurrected',
                state: 'CURRENT',
                source: 'CANONICAL_CLAIM',
                evidenceIds: [fixture.evidenceId],
                accessScope: ['owner'],
                sensitivity: 'private',
              },
            ],
            graph: {
              nodes: [],
              edges: [],
              fallback: { available: true, modes: ['LIST', 'TABLE'] },
            },
            projectedAt: new Date().toISOString(),
            buildMode: 'FULL_REBUILD',
          }),
        ],
      );

      // Initial build: real profile service/resolver, real approval/vault,
      // real OpenAI adapter, real Postgres lifecycle and normal refresh API.
      provider.reset();
      provider.pauseBuilds();
      const initialBuildA = refresh();
      const initialBuildB = refresh();
      try {
        await provider.waitForBuildRequests(2);
      } finally {
        // Do not leave an HTTP request suspended if the arrival assertion
        // fails; the test teardown must remain bounded.
        provider.releaseBuilds();
      }
      const initialResponses = await Promise.all([initialBuildA, initialBuildB]);
      expect(initialResponses.every((response) => response.statusCode === 200)).toBe(true);
      const initialResults = initialResponses.map(
        (response) =>
          JSON.parse(response.body) as {
            refresh: { status: string; generationId: string; itemCount: number };
          },
      );
      expect(initialResults.map((result) => result.refresh.status).sort()).toEqual([
        'ACTIVATED',
        'CONFLICT',
      ]);
      const initialResult = initialResults.find((result) => result.refresh.status === 'ACTIVATED')!;
      expect(initialResult.refresh.itemCount).toBe(2);
      expect(provider.buildRequests).toBe(2);
      expect(provider.queryRequests).toBe(0);
      const first = await activeGeneration();
      expect(first.generation?.build_status).toBe('READY');
      expect(first.generation?.embedding_profile_revision).toBe(1);
      expect(first.pointer?.active_generation_id).toBe(initialResult.refresh.generationId);
      expect(first.pointer?.pointer_revision).toBe('1');
      expect(first.membership?.itemCount).toBe(2);
      for (const result of initialResults) {
        expect(
          (
            await pool.query<{ build_status: string }>(
              `SELECT build_status FROM projection.semantic_generations
                 WHERE project_id = $1 AND generation_id = $2`,
              [fixture.projectId, result.refresh.generationId],
            )
          ).rows[0]?.build_status,
        ).toBe('READY');
      }
      expect(
        (
          await pool.query<{ resource_type: string }>(
            `SELECT resource_type FROM projection.semantic_items
             WHERE project_id = $1 AND generation_id = $2 ORDER BY resource_type`,
            [fixture.projectId, first.pointer?.active_generation_id],
          )
        ).rows.map((row) => row.resource_type),
      ).toEqual(['CLAIM', 'ENTITY']);

      topKCalls = 0;
      provider.reset();
      const firstSearch = await hybrid();
      expect(firstSearch.readiness.semantic).toMatchObject({
        status: 'READY',
        data: 'READY',
        execution: 'AVAILABLE',
      });
      expect(firstSearch.readiness.lexical.status).toBe('READY');
      expect(firstSearch.items.some((item) => item.resourceId === fixture.claimId)).toBe(true);
      expect(firstSearch.items.some((item) => item.resourceId === fixture.entity.candidateId)).toBe(
        true,
      );
      expect(firstSearch.items.every((item) => String(item.resourceType) !== 'FACT')).toBe(true);
      const canonicalResult = firstSearch.items.find(
        (item) => item.resourceId === fixture.claimId,
      )!;
      expect(canonicalResult.authority).toBe('CANONICAL');
      expect(canonicalResult.citations[0]).toMatchObject({
        sourceId: fixture.sourceId,
        sourceVersionId: fixture.sourceVersionId,
        evidenceId: fixture.evidenceId,
      });
      expect(provider.queryRequests).toBe(1);
      expect(topKCalls).toBe(1);

      // Restart/reconstruction: no in-memory semantic object is reused.
      await application.close();
      application = await startNormalApplication();
      topKCalls = 0;
      provider.reset();
      const afterRestart = await hybrid();
      expect(afterRestart.readiness.semantic.activeGenerationId).toBe(
        first.pointer?.active_generation_id,
      );
      expect(afterRestart.readiness.semantic.execution).toBe('AVAILABLE');
      expect(provider.queryRequests).toBe(1);
      expect(topKCalls).toBe(1);
      expect(
        (
          await pool.query(
            'SELECT 1 FROM projection.semantic_embedding_profiles WHERE project_id = $1 AND profile_revision = 1',
            [fixture.projectId],
          )
        ).rowCount,
      ).toBe(1);

      const profile2 = await fixture.profileService.createProfile({
        projectId: fixture.projectId,
        expectedRevision: 1,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: fixture.credential.credentialId,
        credentialRevision: fixture.credential.credentialRevision,
        dimension: 512,
        distanceMetric: 'cosine',
        normalizationPolicy: 'unit_length',
        status: 'PREPARED',
        updatedBy: fixture.principalId,
      });

      // Two real refreshes race against the same G1 pointer while the
      // deterministic provider holds both P2/G2 builds in BUILDING.
      provider.reset();
      topKCalls = 0;
      provider.pauseBuilds();
      const buildA = refresh();
      const buildB = refresh();
      let duringReplacement: HybridSearchResponse | undefined;
      try {
        await provider.waitForBuildRequests(2);
        duringReplacement = await hybrid('R5 canonical production chain while replacing');
      } finally {
        // Keep the in-flight provider boundary releasable on assertion error.
        provider.releaseBuilds();
      }
      expect(duringReplacement?.readiness.semantic.activeGenerationId).toBe(
        first.pointer?.active_generation_id,
      );
      expect(provider.queryRequests).toBe(1);
      expect(topKCalls).toBe(1);
      const replacementResponses = await Promise.all([buildA, buildB]);
      const replacementResults = replacementResponses.map(
        (response) =>
          (JSON.parse(response.body) as { refresh: { status: string; generationId: string } })
            .refresh,
      );
      expect(replacementResults.map((result) => result.status).sort()).toEqual([
        'ACTIVATED',
        'CONFLICT',
      ]);
      for (const result of replacementResults) {
        expect(
          (
            await pool.query<{ build_status: string }>(
              `SELECT build_status FROM projection.semantic_generations
               WHERE project_id = $1 AND generation_id = $2`,
              [fixture.projectId, result.generationId],
            )
          ).rows[0]?.build_status,
        ).toBe('READY');
      }
      const second = await activeGeneration();
      expect(second.generation?.build_status).toBe('READY');
      expect(second.pointer?.active_generation_id).not.toBe(first.pointer?.active_generation_id);
      expect(second.pointer?.pointer_revision).toBe('2');
      expect(second.generation?.embedding_profile_revision).toBe(profile2.profileRevision);
      expect(second.membership?.itemCount).toBe(2);
      await fixture.profileService.activateProfile({
        projectId: fixture.projectId,
        profileId: profile2.profileId,
        profileRevision: profile2.profileRevision,
        updatedBy: fixture.principalId,
      });
      provider.reset();
      topKCalls = 0;
      const afterReplacement = await hybrid();
      expect(afterReplacement.readiness.semantic.activeGenerationId).toBe(
        second.pointer?.active_generation_id,
      );
      expect(afterReplacement.readiness.semantic.execution).toBe('AVAILABLE');
      expect(provider.queryRequests).toBe(1);
      expect(topKCalls).toBe(1);

      // Change only membership/provenance while retaining the exact semantic
      // text and profile identity. Reusable vectors must avoid provider calls.
      const secondEvidenceId = randomUUID();
      const secondEvidenceText = `${fixture.claim.claimText} secondary evidence.`;
      const sourceRevision = await pool.query<{ revision_id: string }>(
        `SELECT revision_id::text FROM transformation.revisions
           WHERE project_id = $1 AND source_version_id = $2 LIMIT 1`,
        [fixture.projectId, fixture.sourceVersionId],
      );
      await pool.query(
        `INSERT INTO evidence.spans
             (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
              node_kind, origin, position, quote, selectors, exact_hash, access_scope,
              sensitivity, created_at)
           VALUES ($1, $2, $3, $4, $5, '/paragraphs/2', 'paragraph', 'source', $6::jsonb,
                   $7::jsonb, '[]'::jsonb, $8, $9, 'private', now())`,
        [
          secondEvidenceId,
          sourceRevision.rows[0]!.revision_id,
          fixture.projectId,
          fixture.sourceId,
          fixture.sourceVersionId,
          JSON.stringify({
            type: 'TextPositionSelector',
            start: 0,
            end: Array.from(secondEvidenceText).length,
            unit: 'unicode-code-point',
          }),
          JSON.stringify({ type: 'TextQuoteSelector', exact: secondEvidenceText }),
          sha256Text(secondEvidenceText),
          ['owner'],
        ],
      );
      const changedEntity = {
        ...fixture.entity,
        evidenceIds: [fixture.evidenceId, secondEvidenceId],
      };
      await pool.query(
        `UPDATE knowledge.review_groups
           SET items = $2::jsonb, content_digest = $3, updated_at = now()
           WHERE project_id = $1 AND group_id = $4`,
        [
          fixture.projectId,
          JSON.stringify([changedEntity]),
          knowledgeCandidateDigest([changedEntity]),
          fixture.groupId,
        ],
      );
      provider.reset();
      topKCalls = 0;
      const membershipRefresh = await refresh();
      expect(membershipRefresh.statusCode).toBe(200);
      const membershipResult = JSON.parse(membershipRefresh.body) as {
        refresh: { status: string; membershipDigest: string };
      };
      expect(membershipResult.refresh.status).toBe('ACTIVATED');
      expect(provider.buildRequests).toBe(0);
      const third = await activeGeneration();
      expect(third.pointer?.active_generation_id).not.toBe(second.pointer?.active_generation_id);
      expect(third.generation?.source_projection_digest).not.toBe(
        second.generation?.source_projection_digest,
      );
      expect(third.membership?.itemCount).toBe(2);
      expect(third.membership?.membershipDigest).not.toBe(second.membership?.membershipDigest);

      // Approved/security identity changes make the active semantic projection
      // STALE before classifier/provider/Postgres Top-K work; lexical survives.
      await pool.query(
        `UPDATE knowledge.review_groups SET sensitivity = 'restricted', updated_at = now()
           WHERE project_id = $1 AND group_id = $2`,
        [fixture.projectId, fixture.groupId],
      );
      provider.reset();
      topKCalls = 0;
      const stale = await hybrid();
      expect(stale.readiness.semantic).toMatchObject({
        status: 'STALE',
        data: 'STALE',
        execution: 'NOT_EVALUATED',
      });
      expect(stale.readiness.lexical.status).toBe('READY');
      expect(stale.items.some((item) => item.resourceId === fixture.claimId)).toBe(true);
      expect(provider.totalRequests).toBe(0);
      expect(topKCalls).toBe(0);
      await pool.query(
        `UPDATE knowledge.review_groups SET sensitivity = 'private', updated_at = now()
           WHERE project_id = $1 AND group_id = $2`,
        [fixture.projectId, fixture.groupId],
      );

      const setApproval = async (approved: boolean): Promise<void> => {
        const current = await fixture.approvalService.getCurrent(fixture.projectId, 'openai');
        const proposal = await fixture.approvalService.propose({
          projectId: fixture.projectId,
          providerId: 'openai',
          approved,
          expectedApprovalRevision: current?.approvalRevision ?? 0,
          proposedBy: fixture.principalId,
        });
        await fixture.approvalService.approve({
          proposalId: proposal.proposalId,
          projectId: fixture.projectId,
          providerId: 'openai',
          expectedApprovalRevision: current?.approvalRevision ?? 0,
          reviewedBy: fixture.principalId,
        });
      };

      // Ordinary query text is server-classified PRIVATE. Denial happens at
      // current policy resolution, so no provider or Top-K work is allowed.
      await setApproval(false);
      provider.reset();
      topKCalls = 0;
      const denied = await hybrid();
      expect(denied.readiness.semantic).toMatchObject({
        status: 'DEGRADED',
        data: 'READY',
        execution: 'POLICY_DENIED',
      });
      expect(denied.readiness.lexical.status).toBe('READY');
      expect(denied.items.some((item) => item.resourceId === fixture.claimId)).toBe(true);
      expect(provider.totalRequests).toBe(0);
      expect(topKCalls).toBe(0);
      expect((await activeGeneration()).pointer?.active_generation_id).toBe(
        third.pointer?.active_generation_id,
      );
      await setApproval(true);

      // Cross-WP negative proof: an authoritative EvidenceSpan whose source
      // lineage is corrupted cannot be cited by the Product response.
      const wrongSource = await new PostgresOriginalAssetRepository(pool).store({
        submissionId: `r5-wrong-source-${randomUUID()}`,
        projectId: fixture.projectId,
        actorId: fixture.principalId,
        channel: 'direct_text',
        materialKind: 'plain_text',
        mediaType: 'text/plain',
        contentHash: sha256Text(`wrong-source-${randomUUID()}`),
        sizeBytes: 16,
        storageKey: `r5/${randomUUID()}/wrong.txt`,
        accessScope: ['owner'],
        sensitivity: 'private',
        createdAt: new Date().toISOString(),
      });
      await pool.query(
        `UPDATE evidence.spans SET source_id = $2 WHERE project_id = $1 AND evidence_id = $3`,
        [fixture.projectId, wrongSource.sourceId, fixture.evidenceId],
      );
      const invalidLineage = await post('/search/hybrid', {
        query: 'R5 canonical production chain',
        limit: 10,
      });
      expect(invalidLineage.statusCode).toBeGreaterThanOrEqual(400);
      const invalidLineageBody = JSON.parse(invalidLineage.body) as {
        code?: string;
        message?: string;
      };
      expect(invalidLineageBody.code).toBe('VALIDATION_ERROR');
      expect(invalidLineageBody.message).toMatch(/lineage|SourceVersion|EvidenceSpan/i);
      await pool.query(
        `UPDATE evidence.spans SET source_id = $2 WHERE project_id = $1 AND evidence_id = $3`,
        [fixture.projectId, fixture.sourceId, fixture.evidenceId],
      );

      // Exact credential revocation blocks current provider execution while
      // leaving the READY generation, vectors and active pointer untouched.
      await fixture.vault.revoke({
        projectId: fixture.projectId,
        providerId: 'openai',
        credentialId: fixture.credential.credentialId,
        credentialRevision: fixture.credential.credentialRevision,
      });
      provider.reset();
      topKCalls = 0;
      const revoked = await hybrid();
      expect(revoked.readiness.semantic).toMatchObject({
        status: 'UNAVAILABLE',
        data: 'READY',
        execution: 'CREDENTIAL_UNAVAILABLE',
      });
      expect(revoked.readiness.lexical.status).toBe('READY');
      expect(revoked.items.some((item) => item.resourceId === fixture.claimId)).toBe(true);
      expect(provider.totalRequests).toBe(0);
      expect(topKCalls).toBe(0);
      expect((await activeGeneration()).pointer?.active_generation_id).toBe(
        third.pointer?.active_generation_id,
      );
      expect(
        (
          await pool.query<{ build_status: string }>(
            `SELECT build_status FROM projection.semantic_generations
             WHERE project_id = $1 AND generation_id = $2`,
            [fixture.projectId, third.pointer?.active_generation_id],
          )
        ).rows[0]?.build_status,
      ).toBe('READY');
    } finally {
      await application?.close();
      await provider.close();
      for (const name of environmentNames) {
        const value = previousEnvironment[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
