import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { OpenAIEmbeddingConnectivityAdapter } from '../../adapters/ai-provider-openai/src/embedding.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../../adapters/provider-privacy-deployment-postgres/src/index.js';
import {
  PostgresOriginalAssetRepository,
  createPostgresPool,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresStandingAIProcessingPolicyRepository } from '../../adapters/project-standing-ai-policy-postgres/src/index.js';
import { SemanticEmbeddingRouter } from '../../adapters/semantic-embedding-resolution/src/router.js';
import { PostgresSemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-postgres/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';
import {
  PostgresSemanticActiveGenerationReader,
  PostgresSemanticIndexRepository,
} from '../../adapters/semantic-index-postgres/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { SemanticEmbeddingAuthorityResolver } from '../../adapters/semantic-embedding-resolution/src/index.js';
import {
  EnvironmentCredentialMasterKeyAuthority,
  CredentialVaultService,
} from '../../modules/credential-vault/src/index.js';
import {
  parseProviderDeploymentCeiling,
  ProviderExternalTransferApprovalService,
} from '../../modules/provider-privacy-policy/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  SemanticEmbeddingProfileService,
  initialSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';
import {
  SemanticGenerationBuilder,
  SemanticProjectionRefreshService,
  SemanticProjectionConvergenceCoordinator,
} from '../../modules/semantic-generation/src/index.js';
import { StandingAIProcessingPolicyService } from '../../packages/policy/src/index.js';
import {
  approvedChangeSetManifestDigest,
  approvalTokenDigest,
  changeSetContentDigest,
  claimCandidateDigest,
  SEMANTIC_REPRESENTATION_VERSION_V2,
  sha256Text,
  type ApprovedChangeSetManifest,
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
      console.warn(`C7 PostgreSQL causal proof skipped: ${message}`);
    } else {
      throw error;
    }
  }
}

const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const EMBEDDING_SECRET = 'c7-real-provider-fixture-token';
const EMBEDDING_DIMENSION = 512;

type ProviderBody = {
  readonly model?: unknown;
  readonly input?: unknown;
  readonly dimensions?: unknown;
};

/** A local deterministic HTTP provider keeps this acceptance test external-boundary real. */
class DeterministicOpenAIProvider {
  private server: Server | undefined;
  private available = true;
  private paused = false;
  private readonly pausedResolvers: Array<() => void> = [];
  baseUrl = '';
  totalRequests = 0;
  pendingRequests = 0;

  async listen(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('C7 provider harness did not expose a TCP address.'));
          return;
        }
        this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
        resolve();
      });
    });
  }

  setAvailable(value: boolean): void {
    this.available = value;
  }

  setPaused(value: boolean): void {
    this.paused = value;
    if (!value) {
      while (this.pausedResolvers.length > 0) this.pausedResolvers.shift()?.();
    }
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
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
    this.pendingRequests += 1;
    try {
      if (this.paused) {
        await new Promise<void>((resolve) => this.pausedResolvers.push(resolve));
      }
      if (!this.available) {
        send(503, { error: 'provider temporarily unavailable' });
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProviderBody;
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      if (
        typeof body.model !== 'string' ||
        typeof body.dimensions !== 'number' ||
        !Number.isSafeInteger(body.dimensions) ||
        body.dimensions < 1 ||
        inputs.length < 1 ||
        inputs.some((input) => typeof input !== 'string')
      ) {
        send(400, { error: 'invalid request' });
        return;
      }
      this.totalRequests += 1;
      send(200, {
        object: 'list',
        data: (inputs as string[]).map((input, index) => ({
          object: 'embedding',
          index,
          embedding: this.vectorFor(input, body.dimensions as number),
        })),
        model: body.model,
        usage: { prompt_tokens: 1, total_tokens: inputs.length },
      });
    } catch {
      send(500, { error: 'provider harness failure' });
    } finally {
      this.pendingRequests -= 1;
    }
  }

  private vectorFor(text: string, dimension: number): readonly number[] {
    const vector = new Array<number>(dimension).fill(0);
    vector[text.toLocaleLowerCase().includes('entity') ? 1 : 0] = 1;
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
  readonly profileService: SemanticEmbeddingProfileService;
  readonly vault: CredentialVaultService;
  readonly approvalService: ProviderExternalTransferApprovalService;
};

const createFixture = async (): Promise<Fixture> => {
  if (!pool) throw new Error('C7 fixture requires PostgreSQL.');
  const suffix = randomUUID();
  const projectId = `c7-causal-${suffix}`;
  const auth = new PostgresAuthRepository(pool);
  const principal = await auth.bootstrapLocalOwnerPrincipal({ accountId: `c7-owner-${suffix}` });
  await pool.query(
    `INSERT INTO project_admin.projects
       (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $2, 'ACTIVE', true, now(), now(), 1)`,
    [projectId, `C7 causal ${suffix}`],
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

  const now = new Date().toISOString();
  const sourceText = 'C7 causal acceptance source evidence for the verified owner release.';
  const stored = await new PostgresOriginalAssetRepository(pool).store({
    submissionId: `c7-source-${suffix}`,
    projectId,
    actorId: principal.principalId,
    channel: 'direct_text',
    materialKind: 'plain_text',
    mediaType: 'text/plain',
    contentHash: sha256Text(sourceText),
    sizeBytes: Buffer.byteLength(sourceText),
    storageKey: `c7/${suffix}/source.txt`,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: now,
  });
  const revisionId = randomUUID();
  const evidenceId = randomUUID();
  await pool.query(
    `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, 'c7-fixture', '1', $6::jsonb, $7::jsonb, $5, $8, $9, 'private', $10)`,
    [
      revisionId,
      projectId,
      stored.sourceId,
      stored.sourceVersionId,
      sha256Text(sourceText),
      JSON.stringify({ mediaType: 'text/plain' }),
      JSON.stringify({}),
      sha256Text(`c7-source-map:${suffix}`),
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

  const vault = new CredentialVaultService(
    new PostgresCredentialVaultRepository(pool),
    new EnvironmentCredentialMasterKeyAuthority(),
  );
  const credential = await vault.create({
    projectId,
    providerId: 'openai',
    secret: EMBEDDING_SECRET,
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
    representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
    dimension: EMBEDDING_DIMENSION,
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
    profileService,
    vault,
    approvalService,
  };
};

const commitApprovedClaim = async (fixture: Fixture, claimText: string) => {
  if (!pool) throw new Error('C7 commit requires PostgreSQL.');
  const canonical = new PostgresCanonicalKnowledgeRepository(pool);
  const before = await canonical.getSnapshot(fixture.projectId);
  const suffix = randomUUID();
  const manifestId = randomUUID();
  const changeSetId = randomUUID();
  const candidateId = `c7-candidate-${suffix}`;
  const candidateDigest = claimCandidateDigest({
    candidateId,
    revisionNumber: 1,
    sourceVersionId: fixture.sourceVersionId,
    claimText,
    evidenceIds: [fixture.evidenceId],
    status: 'READY',
  });
  const diffDigest = sha256Text(`c7-diff:${suffix}`);
  const contentDigest = changeSetContentDigest({
    operation: 'ADD_CLAIM',
    classification: 'NEW_CLAIM',
    candidateId,
    candidateRevisionNumber: 1,
    candidateDigest,
    sourceVersionId: fixture.sourceVersionId,
    evidenceIds: [fixture.evidenceId],
    accessScope: ['owner'],
    sensitivity: 'private',
    expectedCanonicalVersion: before.version,
    snapshotDigest: before.digest,
    diffDigest,
  });
  const unsignedToken = {
    tokenId: `c7-token-${suffix}`,
    changeSetId,
    changeSetRevisionNumber: 1 as const,
    actorId: fixture.principalId,
    contentDigest,
    expectedCanonicalVersion: before.version,
    snapshotDigest: before.digest,
    issuedAt: '2026-09-16T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const approvalToken = { ...unsignedToken, tokenDigest: approvalTokenDigest(unsignedToken) };
  const unsignedManifest: Omit<ApprovedChangeSetManifest, 'manifestDigest'> = {
    manifestId,
    changeSetId,
    changeSetRevisionNumber: 1,
    projectId: fixture.projectId,
    sourceVersionId: fixture.sourceVersionId,
    candidateId,
    candidateRevisionNumber: 1,
    claimText,
    operation: 'ADD_CLAIM',
    classification: 'NEW_CLAIM',
    candidateDigest,
    evidenceIds: [fixture.evidenceId],
    accessScope: ['owner'],
    sensitivity: 'private',
    expectedCanonicalVersion: before.version,
    snapshotDigest: before.digest,
    diffDigest,
    contentDigest,
    approvalToken,
    reason: 'C7 causal acceptance owner approval.',
    createdAt: '2026-09-16T00:00:00.000Z',
  };
  const manifest: ApprovedChangeSetManifest = {
    ...unsignedManifest,
    manifestDigest: approvedChangeSetManifestDigest(unsignedManifest),
  };
  return canonical.commit({
    commitId: randomUUID(),
    revisionId: `c7-revision-${suffix}`,
    historyEventId: `c7-history-${suffix}`,
    outboxId: `c7-outbox-${suffix}`,
    claimId: `c7-claim-${suffix}`,
    manifest,
    actor: { type: 'user', id: fixture.principalId },
    committedAt: new Date().toISOString(),
  });
};

const waitFor = async (
  predicate: () => Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

type InjectResponse = {
  readonly hybridSearch?: {
    readonly readiness: { readonly semantic: Record<string, unknown> };
    readonly items: readonly unknown[];
  };
  readonly answer?: Record<string, unknown>;
};

describe('RUS-2-C7 real PostgreSQL causal semantic convergence acceptance', () => {
  beforeAll(async () => {
    if (databaseUrl) await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool?.end();
  });

  if (!pool) {
    it.skip('TEST_DATABASE_URL is unavailable; PostgreSQL causal proof is deferred to CI.', () => {});
    return;
  }

  it('proves Canonical→Stage7→stale exclusion→C7 recovery→hybrid Ask citation across restart', async () => {
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
    let application: ShotgunApplicationHandle | undefined;
    try {
      process.env[databaseEnvironmentName] = databaseUrl;
      process.env.OPENAI_BASE_URL = provider.baseUrl;
      process.env.AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS = 'openai';
      process.env.GEMINI_ALLOW_PRIVATE = 'false';
      process.env.SOURCES_STAGING_SECRET = 'c7-causal-staging-secret-32-bytes';
      process.env.SHOTGUN_CREDENTIAL_MASTER_KEY = randomBytes(32).toString('base64url');
      process.env.SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION = 'c7-test';
      process.env.NODE_ENV = 'test';

      const fixture = await createFixture();
      const canonical = new PostgresCanonicalKnowledgeRepository(pool);
      const firstCommit = await commitApprovedClaim(
        fixture,
        'C7 canonical v1 fact is durable and authoritative.',
      );
      expect(firstCommit).toMatchObject({ status: 'COMMITTED', afterVersion: 1 });

      application = await startShotgunApplication({
        host: '127.0.0.1',
        port: 0,
        noSignals: true,
        disableAskWorker: true,
        recoveryIntervalMs: false,
      });
      const cookieHeaders = {
        cookie: `shotgun_session=${fixture.sessionToken}`,
        'x-csrf-token': fixture.csrfToken,
        'content-type': 'application/json',
      };
      const inject = async (url: string, body: unknown): Promise<InjectResponse> => {
        const response = await application!.server.inject({
          method: 'POST',
          url,
          payload: JSON.stringify(body),
          headers: cookieHeaders,
        });
        expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
        return JSON.parse(response.body) as InjectResponse;
      };
      const activeGeneration = async () =>
        (
          await pool.query<{
            generation_id: string;
            canonical_base_version: number;
            build_status: string;
          }>(
            `SELECT g.generation_id, g.canonical_base_version, g.build_status
               FROM projection.semantic_generation_pointers p
               JOIN projection.semantic_generations g
                 ON g.project_id = p.project_id AND g.generation_id = p.active_generation_id
              WHERE p.project_id = $1`,
            [fixture.projectId],
          )
        ).rows[0];
      const projectionWatermark = async () =>
        (
          await pool.query<{ canonical_version: number; status: string }>(
            `SELECT canonical_version, status
               FROM projection.watermarks WHERE project_id = $1`,
            [fixture.projectId],
          )
        ).rows[0];

      await waitFor(
        async () => (await activeGeneration())?.canonical_base_version === 1,
        'initial G0 semantic projection',
      );
      expect(await projectionWatermark()).toMatchObject({ canonical_version: 1, status: 'READY' });
      const generation0 = await activeGeneration();
      expect(generation0?.build_status).toBe('READY');

      const secondCommit = await commitApprovedClaim(
        fixture,
        'C7 canonical v2 fact: the verified owner release is green.',
      );
      expect(secondCommit).toMatchObject({ status: 'COMMITTED', afterVersion: 2 });
      expect(await projectionWatermark()).toMatchObject({ canonical_version: 1 });
      expect(await activeGeneration()).toMatchObject({
        generation_id: generation0?.generation_id,
        canonical_base_version: 1,
      });
      expect(await canonical.findOutbox(fixture.projectId, secondCommit.outboxId)).toMatchObject({
        status: 'pending',
      });

      const staleSearch = await inject('/search/hybrid', {
        query: 'verified owner release green',
        limit: 10,
      });
      expect(staleSearch.hybridSearch?.readiness.semantic).toMatchObject({
        status: 'STALE',
        data: 'STALE',
      });
      expect(staleSearch.hybridSearch?.items).toEqual([]);

      await application.close();
      application = undefined;

      // The event is already durable but the process restarts while G0 is
      // active. Stage 7 can catch up while C7 is temporarily unable to call
      // the provider; both facts are observable independently in PostgreSQL.
      provider.setAvailable(false);
      application = await startShotgunApplication({
        host: '127.0.0.1',
        port: 0,
        noSignals: true,
        disableAskWorker: true,
        recoveryIntervalMs: 50,
      });
      expect(await canonical.findOutbox(fixture.projectId, secondCommit.outboxId)).toMatchObject({
        status: 'published',
      });
      expect(await projectionWatermark()).toMatchObject({ canonical_version: 2, status: 'READY' });
      expect(await activeGeneration()).toMatchObject({
        generation_id: generation0?.generation_id,
        canonical_base_version: 1,
      });
      await waitFor(async () => {
        const response = await application!.server.inject({ method: 'GET', url: '/health' });
        if (response.statusCode !== 200) return false;
        const body = JSON.parse(response.body) as {
          readonly recoveries?: readonly {
            readonly runnerId?: string;
            readonly outcome?: string;
          }[];
        };
        return (
          body.recoveries?.some(
            (recovery) =>
              recovery.runnerId === 'semantic-projection-convergence' &&
              /DEGRADED|FAILED/.test(recovery.outcome ?? ''),
          ) === true
        );
      }, 'startup C7 provider failure observation');
      const failedHealth = await application.server.inject({ method: 'GET', url: '/health' });
      expect(failedHealth.statusCode).toBe(200);

      const providerRequestsBeforeRestore = provider.totalRequests;
      provider.setAvailable(true);
      await waitFor(
        async () => (await activeGeneration())?.canonical_base_version === 2,
        'periodic C7 recovery to G1',
      );
      expect(provider.totalRequests).toBeGreaterThan(providerRequestsBeforeRestore);
      await waitFor(async () => {
        const response = await application!.server.inject({
          method: 'GET',
          url: '/api/v1/settings/ai/semantic-comparison-status',
          headers: { cookie: `shotgun_session=${fixture.sessionToken}` },
        });
        if (response.statusCode !== 200) return false;
        const body = JSON.parse(response.body) as { status?: { status?: string } };
        return body.status?.status === 'READY';
      }, 'C7 project semantic Product status READY after recovery');
      const recoveredHealth = await application.server.inject({ method: 'GET', url: '/health' });
      expect(recoveredHealth.statusCode).toBe(200);
      expect(JSON.parse(recoveredHealth.body).recoveries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runnerId: 'semantic-projection-convergence',
            executionStatus: 'COMPLETED',
          }),
        ]),
      );

      const sourceReader = new PostgresSemanticCorpusSourceSnapshotReader(pool);
      const semanticRepository = new PostgresSemanticIndexRepository(pool);
      const activeReader = new PostgresSemanticActiveGenerationReader(semanticRepository);
      const deployment = parseProviderDeploymentCeiling({ providerAllowlist: 'openai' });
      const standingPolicy = new StandingAIProcessingPolicyService(
        new PostgresStandingAIProcessingPolicyRepository(pool),
        { enforceDeepSeekOnly: true },
      );
      const resolver = new SemanticEmbeddingAuthorityResolver(
        initialProviderRegistry(),
        initialSemanticEmbeddingRegistry(),
        fixture.profileService,
        fixture.vault,
        {
          deploymentCeiling: deployment,
          approvalAuthority: fixture.approvalService,
          standingPolicyAuthority: standingPolicy,
        },
      );
      const router = new SemanticEmbeddingRouter(
        initialProviderRegistry(),
        initialSemanticEmbeddingRegistry(),
        fixture.vault,
        fixture.approvalService,
        deployment,
        [new OpenAIEmbeddingConnectivityAdapter({ baseUrl: provider.baseUrl })],
        { standingPolicyAuthority: standingPolicy },
      );
      const builder = new SemanticGenerationBuilder(
        semanticRepository,
        sourceReader,
        resolver,
        router,
        fixture.profileService,
      );
      const refresh = new SemanticProjectionRefreshService(fixture.profileService, builder);
      const duplicateCoordinator = new SemanticProjectionConvergenceCoordinator({
        profileService: fixture.profileService,
        source: sourceReader,
        activeGenerationReader: activeReader,
        refresh,
        semanticEmbeddingResolver: resolver,
      });
      const duplicateInput = {
        projectId: fixture.projectId,
        actor: { type: 'service' as const, id: 'c7-duplicate-replay' },
        security: {
          accessScope: ['owner'],
          sensitivity: 'private' as const,
          dataClassification: 'c7-duplicate-replay',
        },
        trigger: 'EVENT' as const,
      };
      const requestsBeforeDuplicate = provider.totalRequests;
      const duplicateResults = await Promise.all([
        duplicateCoordinator.converge(duplicateInput),
        duplicateCoordinator.converge({ ...duplicateInput, trigger: 'PERIODIC' }),
      ]);
      expect(duplicateResults.map((result) => result.action)).toEqual(['NO_OP', 'NO_OP']);
      expect(provider.totalRequests).toBe(requestsBeforeDuplicate);

      const answer = await inject('/ask/query', {
        question: 'verified owner release green',
        limit: 5,
      });
      expect(answer.answer).toMatchObject({
        status: 'ANSWERED',
        statements: [
          {
            text: 'C7 canonical v2 fact: the verified owner release is green.',
            citations: [
              {
                evidenceId: fixture.evidenceId,
                sourceVersionId: fixture.sourceVersionId,
              },
            ],
          },
        ],
      });
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

  it('keeps application readiness independent from a paused startup convergence provider', async () => {
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
    let application: ShotgunApplicationHandle | undefined;
    let setupApplication: ShotgunApplicationHandle | undefined;
    try {
      process.env[databaseEnvironmentName] = databaseUrl;
      process.env.OPENAI_BASE_URL = provider.baseUrl;
      process.env.AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS = 'openai';
      process.env.GEMINI_ALLOW_PRIVATE = 'false';
      process.env.SOURCES_STAGING_SECRET = 'c7-startup-readiness-staging-secret-32-bytes';
      process.env.SHOTGUN_CREDENTIAL_MASTER_KEY = randomBytes(32).toString('base64url');
      process.env.SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION = 'c7-startup-readiness';
      process.env.NODE_ENV = 'test';

      const fixture = await createFixture();
      const canonical = new PostgresCanonicalKnowledgeRepository(pool);
      const committed = await commitApprovedClaim(
        fixture,
        'C7 startup readiness keeps lexical knowledge available.',
      );
      expect(committed).toMatchObject({ status: 'COMMITTED', afterVersion: 1 });

      // Publish the Canonical event before the real readiness assertion. The
      // provider fails quickly here, leaving the already-published historical
      // gap for the later automatic startup reconciliation to recover.
      provider.setAvailable(false);
      setupApplication = await startShotgunApplication({
        host: '127.0.0.1',
        port: 0,
        noSignals: true,
        disableAskWorker: true,
        recoveryIntervalMs: false,
      });
      expect(await canonical.findOutbox(fixture.projectId, committed.outboxId)).toMatchObject({
        status: 'published',
      });
      await setupApplication.close();
      setupApplication = undefined;

      provider.setPaused(true);
      const startPromise = startShotgunApplication({
        host: '127.0.0.1',
        port: 0,
        noSignals: true,
        disableAskWorker: true,
        recoveryIntervalMs: 50,
      });
      await waitFor(
        async () => provider.pendingRequests > 0,
        'paused startup convergence provider request',
      );

      const startupOutcome = await Promise.race([
        startPromise.then(() => 'READY' as const),
        new Promise<'BLOCKED'>((resolve) => setTimeout(() => resolve('BLOCKED'), 1_500)),
      ]);
      expect(startupOutcome).toBe('READY');
      application = await startPromise;
      expect(application.url).toContain('http://127.0.0.1:');

      const health = await application.server.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(await application.readCanonicalProjectIds()).toContain(fixture.projectId);
      const shell = await application.server.inject({
        method: 'GET',
        url: '/product-api/frontend/global-shell',
        headers: { cookie: `shotgun_session=${fixture.sessionToken}` },
      });
      expect(shell.statusCode).toBe(200);

      const lexical = await application.server.inject({
        method: 'POST',
        url: '/search/hybrid',
        payload: JSON.stringify({
          query: 'startup readiness keeps lexical knowledge available',
          limit: 10,
        }),
        headers: {
          cookie: `shotgun_session=${fixture.sessionToken}`,
          'x-csrf-token': fixture.csrfToken,
          'content-type': 'application/json',
        },
      });
      expect(lexical.statusCode, lexical.body).toBe(200);
      expect(
        (JSON.parse(lexical.body) as InjectResponse).hybridSearch?.items.length,
      ).toBeGreaterThan(0);

      provider.setPaused(false);
      await waitFor(async () => {
        const response = await application!.server.inject({ method: 'GET', url: '/health' });
        if (response.statusCode !== 200) return false;
        const body = JSON.parse(response.body) as {
          readonly recoveries?: readonly {
            readonly runnerId?: string;
            readonly outcome?: string;
          }[];
        };
        return (
          body.recoveries?.some(
            (recovery) =>
              recovery.runnerId === 'semantic-projection-convergence' &&
              /DEGRADED|FAILED/.test(recovery.outcome ?? ''),
          ) === true
        );
      }, 'startup provider failure recorded as degraded/pending');

      provider.setAvailable(true);
      await waitFor(async () => {
        const row = await pool.query<{ canonical_base_version: number; build_status: string }>(
          `SELECT g.canonical_base_version, g.build_status
             FROM projection.semantic_generation_pointers p
             JOIN projection.semantic_generations g
               ON g.project_id = p.project_id AND g.generation_id = p.active_generation_id
            WHERE p.project_id = $1`,
          [fixture.projectId],
        );
        return row.rows[0]?.canonical_base_version === 1 && row.rows[0]?.build_status === 'READY';
      }, 'provider restoration convergence');
    } finally {
      provider.setPaused(false);
      await application?.close();
      await setupApplication?.close();
      await provider.close();
      for (const name of environmentNames) {
        const value = previousEnvironment[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
