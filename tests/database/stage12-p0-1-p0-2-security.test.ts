import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  PostgresActionCandidateRepository,
  PostgresActionExecutionRepository,
} from '../../adapters/postgres-stage11/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { PostgresValidationRepository } from '../../adapters/postgres-stage4/src/index.js';
import {
  createPostgresPool,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  buildEvidenceCandidates,
  type EvidenceCandidate,
} from '../../modules/evidence/src/index.js';
import { hashPassword } from '../../packages/authentication/src/index.js';
import {
  actionEvidenceRecordDigest,
  sha256Text,
  stableJson,
  type DocumentIR,
  validationResultDigest,
  type ServerActionCandidate,
  type SourceMap,
  type TextPositionSelector,
  type TextQuoteSelector,
  unicodeSlice,
} from '../../packages/contracts/src/index.js';
import { actionServerCandidate } from '../helpers/stage-11.js';
import {
  createSentenceEvidenceFixture,
  deterministicEvidenceLocator,
  type SentenceEvidenceFixture,
} from '../helpers/stage-12-evidence.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the Stage 12.1 P0-1/P0-2 Security Gate tests.');
}

const pool = createPostgresPool(databaseUrl);
const projectId = 'shotgun';
const password = 'stage12-security-password';
const sourceText = 'The first sentence. abc is the cited sentence. The final sentence.';
const sourceContentHash = sha256Text(sourceText);
const evidenceExactText = 'abc';
const changedHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
const mismatchHash = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';

const actionScopes = [
  'owner',
  'action:candidate:stage',
  'action:approve',
  'action:execute',
  'action:verify',
  'action:read',
  'action:audit:read',
];

type Application = Awaited<ReturnType<typeof createApplication>>;
type TokenListResponse = {
  readonly tokens: readonly {
    readonly tokenId: string;
    readonly expiresAt: string;
  }[];
};

type AuthHarness = {
  readonly app: Application;
  readonly authRepository: PostgresAuthRepository;
  readonly principalId: string;
  readonly cookie: string;
  readonly csrfToken: string;
};

type ActionFixture = AuthHarness & {
  readonly connector: FakeDraftActionConnector;
  readonly actionRepository: PostgresActionExecutionRepository;
  readonly candidateId: string;
  readonly validationId: string;
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly originalAssetId: string;
  readonly revisionId: string;
  readonly canonicalFixture: SentenceEvidenceFixture;
  readonly sentenceEvidence: EvidenceCandidate;
  readonly actionId: string;
  readonly approvalId: string;
  readonly previewStatusCode: number;
  readonly approvalStatusCode: number;
};

let passwordHash = '';

beforeAll(async () => {
  passwordHash = await hashPassword(password);
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE auth.audit_events, auth.api_tokens, auth.sessions, auth.project_memberships, auth.credentials, auth.principals, action.audit_events, action.approval_records, action.preview_snapshots, action.approvals, action.executions, action.candidates, validation.results, candidate.claim_candidates, candidate.batches, evidence.spans, transformation.revisions, asset.storage_receipts, asset.source_versions, asset.sources, asset.original_assets CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});

const createAuthHarness = async (scopes: readonly string[]): Promise<AuthHarness> => {
  const authRepository = new PostgresAuthRepository(pool);
  await authRepository.bootstrapOwner({
    accountId: 'owner',
    passwordHash,
    projectId,
    scopes,
    sensitivityClearance: 'private',
  });
  const principal = await authRepository.authenticatePassword('owner', password);
  if (!principal) throw new Error('Expected the PostgreSQL owner fixture to authenticate.');

  const app = await createApplication({ authRepository, production: true });
  const login = await app.server.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { accountId: 'owner', password, projectId },
  });
  expect(login.statusCode).toBe(200);
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? '';
  const loginBody = login.json<{ csrfToken: string }>();
  return {
    app,
    authRepository,
    principalId: principal.principalId,
    cookie,
    csrfToken: loginBody.csrfToken,
  };
};

const createActionApplication = async (): Promise<
  AuthHarness & {
    readonly connector: FakeDraftActionConnector;
    readonly actionRepository: PostgresActionExecutionRepository;
    readonly candidateRepository: PostgresActionCandidateRepository;
    readonly validationRepository: PostgresValidationRepository;
    readonly evidenceRepository: PostgresEvidenceRepository;
  }
> => {
  const authRepository = new PostgresAuthRepository(pool);
  await authRepository.bootstrapOwner({
    accountId: 'owner',
    passwordHash,
    projectId,
    scopes: actionScopes,
    sensitivityClearance: 'private',
  });
  const principal = await authRepository.authenticatePassword('owner', password);
  if (!principal) throw new Error('Expected the PostgreSQL owner fixture to authenticate.');

  const connector = new FakeDraftActionConnector();
  const actionRepository = new PostgresActionExecutionRepository(pool);
  const candidateRepository = new PostgresActionCandidateRepository(pool);
  const validationRepository = new PostgresValidationRepository(pool);
  const evidenceRepository = new PostgresEvidenceRepository(pool);
  const originalAssetRepository = new PostgresOriginalAssetRepository(pool);
  const transformationRevisionSecurityRepository = new PostgresTransformationRepository(pool);
  const app = await createApplication({
    authRepository,
    actionExecutionRepository: actionRepository,
    actionCandidateRepository: candidateRepository,
    validationRepository,
    evidenceRepository,
    originalAssetRepository,
    transformationRevisionSecurityRepository,
    actionConnector: connector,
    production: true,
  });
  const login = await app.server.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { accountId: 'owner', password, projectId },
  });
  expect(login.statusCode).toBe(200);
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? '';
  const loginBody = login.json<{ csrfToken: string }>();
  return {
    app,
    authRepository,
    principalId: principal.principalId,
    cookie,
    csrfToken: loginBody.csrfToken,
    connector,
    actionRepository,
    candidateRepository,
    validationRepository,
    evidenceRepository,
  };
};

const seedSourceVersion = async (
  hash = sourceContentHash,
): Promise<{
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly originalAssetId: string;
}> => {
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const originalAssetId = randomUUID();
  await pool.query(
    `INSERT INTO asset.original_assets
       (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, $3, $4, now())`,
    [originalAssetId, hash, Buffer.byteLength(sourceText, 'utf8'), `security/${originalAssetId}`],
  );
  await pool.query(
    `INSERT INTO asset.sources
       (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, 'owner', now())`,
    [sourceId, projectId],
  );
  await pool.query(
    `INSERT INTO asset.source_versions
       (source_version_id, source_id, version_number, original_asset_id, media_type,
        access_scope, sensitivity, created_at)
     VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['action:read'], 'public', now())`,
    [sourceVersionId, sourceId, originalAssetId],
  );
  await pool.query(
    `INSERT INTO asset.storage_receipts
       (receipt_id, submission_id, project_id, source_version_id, channel, material_kind,
        original_file_name, asset_reused, version_created, created_at)
     VALUES ($1, $2, $3, $4, 'direct_text', 'plain_text', 'security.txt', false, true, now())`,
    [randomUUID(), randomUUID(), projectId, sourceVersionId],
  );
  return { sourceId, sourceVersionId, originalAssetId };
};

const seedCandidate = async (
  harness: Awaited<ReturnType<typeof createActionApplication>>,
): Promise<{
  readonly candidateId: string;
  readonly validationId: string;
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly originalAssetId: string;
  readonly revisionId: string;
  readonly canonicalFixture: SentenceEvidenceFixture;
  readonly sentenceEvidence: EvidenceCandidate;
}> => {
  const { sourceId, sourceVersionId, originalAssetId } = await seedSourceVersion();
  const revisionId = randomUUID();
  const evidenceId = randomUUID();
  const candidateId = randomUUID();
  const validationId = randomUUID();
  const batchId = randomUUID();
  const canonicalFixture = createSentenceEvidenceFixture({
    revisionId,
    projectId,
    sourceId,
    sourceVersionId,
    sourceText,
    evidenceExactText,
    accessScope: ['action:read'],
    sensitivity: 'public',
    createdAt: new Date().toISOString(),
  });
  const builtEvidence = buildEvidenceCandidates(
    canonicalFixture.revision,
    deterministicEvidenceLocator,
  );
  const sentenceEvidence = builtEvidence.find(
    (candidate) =>
      candidate.nodeKind === 'sentence' && candidate.pointer === '/blocks/0/sentences/0',
  );
  if (!sentenceEvidence) {
    throw new Error('The canonical Security fixture did not produce Sentence Evidence.');
  }

  await pool.query(
    `INSERT INTO transformation.revisions
       (revision_id, project_id, source_id, source_version_id, source_content_hash,
        transformer_id, transformer_version, document_ir, source_map, document_hash,
        source_map_hash, access_scope, sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14)`,
    [
      canonicalFixture.revision.revisionId,
      canonicalFixture.revision.projectId,
      canonicalFixture.revision.sourceId,
      canonicalFixture.revision.sourceVersionId,
      canonicalFixture.revision.sourceContentHash,
      canonicalFixture.revision.transformer.id,
      canonicalFixture.revision.transformer.version,
      JSON.stringify(canonicalFixture.revision.documentIR),
      JSON.stringify(canonicalFixture.revision.sourceMap),
      canonicalFixture.revision.documentHash,
      canonicalFixture.revision.sourceMapHash,
      canonicalFixture.revision.accessScope,
      canonicalFixture.revision.sensitivity,
      canonicalFixture.revision.createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO evidence.spans
       (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
        node_kind, origin, position, quote, selectors, exact_hash, access_scope,
        sensitivity, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
             $11::jsonb, $12, $13, $14, $15)`,
    [
      evidenceId,
      sentenceEvidence.revisionId,
      sentenceEvidence.projectId,
      sentenceEvidence.sourceId,
      sentenceEvidence.sourceVersionId,
      sentenceEvidence.pointer,
      sentenceEvidence.nodeKind,
      sentenceEvidence.origin,
      JSON.stringify(sentenceEvidence.position),
      JSON.stringify(sentenceEvidence.quote),
      JSON.stringify(sentenceEvidence.selectors ?? []),
      sentenceEvidence.exactHash,
      sentenceEvidence.accessScope,
      sentenceEvidence.sensitivity,
      sentenceEvidence.createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO candidate.batches
       (batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, now())`,
    [batchId, projectId, sourceVersionId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO candidate.claim_candidates
       (candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
        evidence_id, evidence_mode, extraction_profile, status, provider_call, access_scope,
        sensitivity, created_at)
     VALUES ($1, $2, $3, $4, 1, 'security claim', $5, 'DIRECT_EVIDENCE', 'direct-only',
             'READY', '{}'::jsonb, ARRAY['action:read'], 'public', now())`,
    [candidateId, batchId, projectId, sourceVersionId, evidenceId],
  );
  await pool.query(
    `INSERT INTO validation.results
       (validation_id, candidate_id, revision_number, project_id, source_version_id,
        status, dimensions, created_at)
     VALUES ($1, $2, 1, $3, $4, 'READY', $5::jsonb, now())`,
    [
      validationId,
      candidateId,
      projectId,
      sourceVersionId,
      JSON.stringify([{ name: 'grounding', score: 1, status: 'PASS', explanation: 'bound' }]),
    ],
  );

  const validation = await harness.validationRepository.findByValidationId(projectId, validationId);
  const evidence = await harness.evidenceRepository.findById(projectId, evidenceId);
  if (!validation || !evidence) throw new Error('Expected authoritative security fixtures.');

  const base = actionServerCandidate(candidateId, { projectId, sourceSensitivity: 'public' });
  const evidenceBinding = {
    evidenceId: evidence.evidenceId,
    digest: actionEvidenceRecordDigest(evidence),
  };
  const candidate: ServerActionCandidate = {
    ...base,
    projectId,
    candidate: {
      ...base.candidate,
      candidateId,
      validation: {
        ...base.candidate.validation,
        validationId,
        evidenceIds: [evidenceId],
      },
    },
    validationDigest: validationResultDigest(validation),
    evidence: [evidenceBinding],
    sourceSensitivity: 'public',
  };
  await harness.candidateRepository.stage(candidate);
  return {
    candidateId,
    validationId,
    evidenceId,
    sourceId,
    sourceVersionId,
    originalAssetId,
    revisionId,
    canonicalFixture,
    sentenceEvidence,
  };
};

const previewAndApprove = async (
  harness: Awaited<ReturnType<typeof createActionApplication>>,
  candidateId: string,
): Promise<{
  readonly actionId: string;
  readonly approvalId: string;
  readonly previewStatusCode: number;
  readonly approvalStatusCode: number;
}> => {
  const preview = await harness.app.server.inject({
    method: 'POST',
    url: '/actions/preview',
    headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
    payload: { candidateId, expectedRevision: 1, operationKey: 'CREATE_DRAFT' },
  });
  expect(preview.statusCode, preview.body).toBe(200);
  const previewBody = preview.json<{
    action: { actionId: string; preview: { previewDigest: string } };
  }>();
  const approval = await harness.app.server.inject({
    method: 'POST',
    url: `/actions/${previewBody.action.actionId}/approve`,
    headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
    payload: { expectedPreviewDigest: previewBody.action.preview.previewDigest },
  });
  expect(approval.statusCode).toBe(200);
  const approvalBody = approval.json<{ action: { approval: { approvalId: string } } }>();
  return {
    actionId: previewBody.action.actionId,
    approvalId: approvalBody.action.approval.approvalId,
    previewStatusCode: preview.statusCode,
    approvalStatusCode: approval.statusCode,
  };
};

const createActionFixture = async (): Promise<ActionFixture> => {
  const harness = await createActionApplication();
  const seeded = await seedCandidate(harness);
  const approved = await previewAndApprove(harness, seeded.candidateId);
  return { ...harness, ...seeded, ...approved };
};

const execute = (fixture: ActionFixture) =>
  fixture.app.server.inject({
    method: 'POST',
    url: '/actions/execute',
    headers: { cookie: fixture.cookie, 'x-csrf-token': fixture.csrfToken },
    payload: { approvalId: fixture.approvalId },
  });

const executionStatus = async (actionId: string): Promise<string | undefined> => {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM action.executions WHERE action_id = $1',
    [actionId],
  );
  return result.rows[0]?.status;
};

const claimedAuditCount = async (actionId: string): Promise<number> => {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM action.audit_events
      WHERE action_id = $1 AND category = 'ACTION_EXECUTION_CLAIMED'`,
    [actionId],
  );
  return Number(result.rows[0]?.count ?? 0);
};

const expectRejectedBeforeClaim = async (
  fixture: ActionFixture,
  response: Awaited<ReturnType<typeof execute>>,
): Promise<void> => {
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'STALE_ACTION_SNAPSHOT' });
  expect(await executionStatus(fixture.actionId)).toBe('APPROVED');
  expect(fixture.connector.calls.execute).toBe(0);
  expect(await claimedAuditCount(fixture.actionId)).toBe(0);
};

const expectRejectedAfterClaim = async (
  fixture: ActionFixture,
  response: Awaited<ReturnType<typeof execute>>,
): Promise<void> => {
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'STALE_ACTION_SNAPSHOT' });
  expect(await executionStatus(fixture.actionId)).toBe('PREFLIGHT_FAILED');
  expect(fixture.connector.calls.execute).toBe(0);
  expect(await claimedAuditCount(fixture.actionId)).toBe(1);
};

const withConstraintBypass = async (
  operation: (client: PoolClient) => Promise<void>,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await operation(client);
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

describe('P0-1 authentication security', () => {
  it('rejects POST without CSRF', async () => {
    const harness = await createAuthHarness(['owner']);
    const response = await harness.app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie: harness.cookie },
      payload: { message: 'missing csrf' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'REQUEST_ORIGIN_DENIED' });
    await harness.app.server.close();
  });

  it('revokes sessions after password change', async () => {
    const harness = await createAuthHarness(['owner']);
    const changed = await harness.app.server.inject({
      method: 'POST',
      url: '/auth/password',
      headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
      payload: { currentPassword: password, newPassword: 'changed-stage12-password' },
    });
    expect(changed.statusCode).toBe(200);
    const revoked = await harness.app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
      payload: { message: 'revoked session' },
    });
    expect(revoked.statusCode).toBe(401);
    await harness.app.server.close();
  });

  it('blocks token scope escalation', async () => {
    const harness = await createAuthHarness(['action:read', 'action:execute', 'auth:token:issue']);
    const restricted = await harness.authRepository.issueApiToken({
      principalId: harness.principalId,
      scopes: ['action:read', 'auth:token:issue'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const before = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM auth.api_tokens',
    );
    const response = await harness.app.server.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: {
        authorization: `Bearer ${restricted.token}`,
        'x-shotgun-project': projectId,
      },
      payload: {
        scopes: ['action:execute'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    const after = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM auth.api_tokens',
    );
    const audit = await pool.query('SELECT event, reason FROM auth.audit_events');
    const listed = await harness.app.server.inject({
      method: 'GET',
      url: '/auth/tokens',
      headers: {
        authorization: `Bearer ${restricted.token}`,
        'x-shotgun-project': projectId,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    expect(response.body).not.toContain(restricted.token);
    expect(JSON.stringify(audit.rows)).not.toContain(restricted.token);
    expect(listed.body).not.toContain(restricted.token);
    await harness.app.server.close();
  });

  it('blocks token issuance without issue scope', async () => {
    const harness = await createAuthHarness(['action:read']);
    const response = await harness.app.server.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
      payload: {
        scopes: ['action:read'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await harness.app.server.close();
  });

  it('blocks token scopes outside membership', async () => {
    const harness = await createAuthHarness(['action:read', 'auth:token:issue']);
    const response = await harness.app.server.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
      payload: {
        scopes: ['action:execute'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await harness.app.server.close();
  });

  it('rejects an empty token scope list', async () => {
    const harness = await createAuthHarness(['auth:token:issue']);
    const response = await harness.app.server.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
      payload: {
        scopes: [],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    await harness.app.server.close();
  });

  it('enforces the 90-day token expiry ceiling', async () => {
    const harness = await createAuthHarness(['action:read', 'auth:token:issue']);
    const response = await harness.app.server.inject({
      method: 'POST',
      url: '/auth/tokens',
      headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
      payload: {
        scopes: ['action:read'],
        expiresAt: new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    await harness.app.server.close();
  });

  it('returns token plaintext only in the one-time issuance response', async () => {
    const harness = await createAuthHarness(['action:read', 'auth:token:issue']);
    const logged: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      logged.push(JSON.stringify(values));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      logged.push(JSON.stringify(values));
    });
    try {
      const issued = await harness.app.server.inject({
        method: 'POST',
        url: '/auth/tokens',
        headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
        payload: {
          scopes: ['action:read'],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
      expect(issued.statusCode).toBe(200);
      const token = issued.json<{ tokenId: string; token: string; expiresAt: string }>();
      const listed = await harness.app.server.inject({
        method: 'GET',
        url: '/auth/tokens',
        headers: { cookie: harness.cookie },
      });
      const listBody = listed.json<TokenListResponse>();
      const audit = await pool.query('SELECT event, reason FROM auth.audit_events');
      const stored = await pool.query<{ token_hash: string }>(
        'SELECT token_hash FROM auth.api_tokens WHERE token_id = $1',
        [token.tokenId],
      );

      expect(listed.statusCode).toBe(200);
      expect(listBody.tokens).toContainEqual({
        tokenId: token.tokenId,
        expiresAt: token.expiresAt,
      });
      expect(listed.body).not.toContain(token.token);
      expect(JSON.stringify(audit.rows)).not.toContain(token.token);
      expect(logged.join('\n')).not.toContain(token.token);
      expect(stored.rows[0]?.token_hash).not.toContain(token.token);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await harness.app.server.close();
    }
  });
});

describe('P0-2 authoritative action execution', () => {
  it('executes with a valid sentence Evidence hash distinct from SourceVersion content hash', async () => {
    const fixture = await createActionFixture();
    const persisted = await pool.query<{
      source_content_hash: string;
      original_content_hash: string;
      document_ir: DocumentIR;
      source_map: SourceMap;
      document_hash: string;
      source_map_hash: string;
      evidence_pointer: string;
      evidence_position: TextPositionSelector;
      evidence_quote: TextQuoteSelector;
      evidence_exact_text: string;
      evidence_exact_hash: string;
    }>(
      `SELECT r.source_content_hash,
              a.content_hash AS original_content_hash,
              r.document_ir,
              r.source_map,
              r.document_hash,
              r.source_map_hash,
              e.pointer AS evidence_pointer,
              e.position AS evidence_position,
              e.quote AS evidence_quote,
              e.quote->>'exact' AS evidence_exact_text,
              e.exact_hash AS evidence_exact_hash
         FROM evidence.spans e
         JOIN transformation.revisions r ON r.revision_id = e.revision_id
         JOIN asset.source_versions sv ON sv.source_version_id = e.source_version_id
         JOIN asset.original_assets a ON a.asset_id = sv.original_asset_id
        WHERE e.evidence_id = $1`,
      [fixture.evidenceId],
    );
    const row = persisted.rows[0];
    if (!row) throw new Error('Expected the canonical Security fixture to be persisted.');
    const builtEvidence = buildEvidenceCandidates(
      fixture.canonicalFixture.revision,
      deterministicEvidenceLocator,
    );
    const rootEntry = row.source_map.entries.find((entry) => entry.pointer === '');
    const sentenceEntry = row.source_map.entries.find(
      (entry) => entry.pointer === '/blocks/0/sentences/0',
    );
    if (!rootEntry || !sentenceEntry) {
      throw new Error('Expected canonical document-root and Sentence SourceMap entries.');
    }
    expect(builtEvidence).toContainEqual(fixture.sentenceEvidence);
    expect(fixture.previewStatusCode).toBe(200);
    expect(fixture.approvalStatusCode).toBe(200);
    expect(row.evidence_exact_hash).not.toBe(row.source_content_hash);
    expect(row.evidence_exact_hash).toBe(sha256Text(row.evidence_quote.exact));
    expect(row.evidence_exact_hash).toBe(fixture.canonicalFixture.evidenceExactHash);
    expect(row.evidence_exact_text).toBe(evidenceExactText);
    expect(row.evidence_position.start).toBe(fixture.canonicalFixture.evidenceStart);
    expect(row.evidence_position.end).toBe(fixture.canonicalFixture.evidenceEnd);
    expect(unicodeSlice(sourceText, row.evidence_position.start, row.evidence_position.end)).toBe(
      row.evidence_quote.exact,
    );
    expect(row.source_content_hash).toBe(row.original_content_hash);
    expect(row.document_hash).toBe(sha256Text(stableJson(row.document_ir)));
    expect(row.source_map_hash).toBe(sha256Text(stableJson(row.source_map)));
    expect(rootEntry.quote.exact).toBe(sourceText);
    expect(rootEntry.exactHash).toBe(row.source_content_hash);
    expect(sentenceEntry.position).toEqual(row.evidence_position);
    expect(sentenceEntry.quote).toEqual(row.evidence_quote);
    expect(sentenceEntry.exactHash).toBe(row.evidence_exact_hash);
    expect(row.evidence_pointer).toBe('/blocks/0/sentences/0');
    expect(row.document_ir.blocks[0]?.sentences[0]?.text).toBe(row.evidence_quote.exact);
    const response = await execute(fixture);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ action: { status: 'VERIFIED' } });
    expect(fixture.connector.calls.execute).toBe(1);
    expect(await claimedAuditCount(fixture.actionId)).toBe(1);
    await fixture.app.server.close();
  });

  const evidenceMutations = [
    {
      name: 'rejects Evidence exactHash changed without changing quote',
      mutate: (fixture: ActionFixture) =>
        pool.query('UPDATE evidence.spans SET exact_hash = $2 WHERE evidence_id = $1', [
          fixture.evidenceId,
          changedHash,
        ]),
    },
    {
      name: 'rejects Evidence quote changed without updating exactHash',
      mutate: (fixture: ActionFixture) =>
        pool.query(`UPDATE evidence.spans SET quote = $2::jsonb WHERE evidence_id = $1`, [
          fixture.evidenceId,
          JSON.stringify({ type: 'TextQuoteSelector', exact: 'tampered' }),
        ]),
    },
    {
      name: 'rejects Evidence whose position does not match its exact quote',
      mutate: (fixture: ActionFixture) => {
        const position = fixture.sentenceEvidence.position;
        return pool.query(`UPDATE evidence.spans SET position = $2::jsonb WHERE evidence_id = $1`, [
          fixture.evidenceId,
          JSON.stringify({
            ...position,
            start: position.start - 1,
            end: position.end - 1,
          }),
        ]);
      },
    },
    {
      name: 'rejects Evidence pointer mutation',
      mutate: (fixture: ActionFixture) =>
        pool.query('UPDATE evidence.spans SET pointer = $2 WHERE evidence_id = $1', [
          fixture.evidenceId,
          `/tampered/${fixture.evidenceId}`,
        ]),
    },
    {
      name: 'rejects Evidence selectors mutation',
      mutate: (fixture: ActionFixture) =>
        pool.query(`UPDATE evidence.spans SET selectors = $2::jsonb WHERE evidence_id = $1`, [
          fixture.evidenceId,
          JSON.stringify([{ type: 'PageSelector', page: 2 }]),
        ]),
    },
    {
      name: 'rejects Evidence access scope mutation',
      mutate: (fixture: ActionFixture) =>
        pool.query(
          `UPDATE evidence.spans SET access_scope = ARRAY['action:read', 'action:execute'] WHERE evidence_id = $1`,
          [fixture.evidenceId],
        ),
    },
    {
      name: 'rejects Evidence sourceVersionId mutation',
      mutate: (fixture: ActionFixture) =>
        pool.query('UPDATE evidence.spans SET source_version_id = $2 WHERE evidence_id = $1', [
          fixture.evidenceId,
          randomUUID(),
        ]),
    },
  ];

  for (const attack of evidenceMutations) {
    it(attack.name, async () => {
      const fixture = await createActionFixture();
      await attack.mutate(fixture);
      await expectRejectedAfterClaim(fixture, await execute(fixture));
      await fixture.app.server.close();
    });
  }

  it('rejects Evidence record deletion', async () => {
    const fixture = await createActionFixture();
    await withConstraintBypass(async (client) => {
      await client.query('DELETE FROM evidence.spans WHERE evidence_id = $1', [fixture.evidenceId]);
    });
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects Validation READY/PASS dimension mutation', async () => {
    const fixture = await createActionFixture();
    await pool.query(
      `UPDATE validation.results
          SET dimensions = $2::jsonb
        WHERE validation_id = $1`,
      [
        fixture.validationId,
        JSON.stringify([
          { name: 'grounding', score: 0.75, status: 'PASS', explanation: 'changed' },
        ]),
      ],
    );
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  const validationBindingMutations = [
    {
      name: 'rejects Validation wrong candidateId binding',
      sql: 'UPDATE validation.results SET candidate_id = $2 WHERE validation_id = $1',
      value: () => randomUUID(),
    },
    {
      name: 'rejects Validation wrong validationId binding',
      sql: 'UPDATE validation.results SET validation_id = $2 WHERE validation_id = $1',
      value: () => randomUUID(),
    },
  ];

  for (const attack of validationBindingMutations) {
    it(attack.name, async () => {
      const fixture = await createActionFixture();
      await withConstraintBypass(async (client) => {
        await client.query(attack.sql, [fixture.validationId, attack.value()]);
      });
      await expectRejectedAfterClaim(fixture, await execute(fixture));
      await fixture.app.server.close();
    });
  }

  it('rejects Validation wrong revisionNumber binding', async () => {
    const fixture = await createActionFixture();
    await pool.query(
      `UPDATE action.candidates
          SET candidate_json = jsonb_set(candidate_json, '{candidate,revisionNumber}', '2')
        WHERE project_id = $1 AND candidate_id = $2`,
      [projectId, fixture.candidateId],
    );
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects Validation and Evidence sourceVersion mismatch', async () => {
    const fixture = await createActionFixture();
    const second = await seedSourceVersion(changedHash);
    await pool.query(
      'UPDATE validation.results SET source_version_id = $2 WHERE validation_id = $1',
      [fixture.validationId, second.sourceVersionId],
    );
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects SourceVersion sensitivity mutation', async () => {
    const fixture = await createActionFixture();
    await pool.query(
      `UPDATE asset.source_versions SET sensitivity = 'internal' WHERE source_version_id = $1`,
      [fixture.sourceVersionId],
    );
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects SourceVersion access scope mutation', async () => {
    const fixture = await createActionFixture();
    await pool.query(
      `UPDATE asset.source_versions
          SET access_scope = ARRAY['action:read', 'action:execute']
        WHERE source_version_id = $1`,
      [fixture.sourceVersionId],
    );
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects Transformation source content hash changed after approval', async () => {
    const fixture = await createActionFixture();
    await pool.query(
      'UPDATE transformation.revisions SET source_content_hash = $2 WHERE revision_id = $1',
      [fixture.revisionId, changedHash],
    );
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects Transformation Revision sourceVersionId binding changed after approval', async () => {
    const fixture = await createActionFixture();
    await withConstraintBypass(async (client) => {
      await client.query(
        'UPDATE transformation.revisions SET source_version_id = $2 WHERE revision_id = $1',
        [fixture.revisionId, randomUUID()],
      );
    });
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects missing Transformation Revision authority record', async () => {
    const fixture = await createActionFixture();
    await withConstraintBypass(async (client) => {
      await client.query('DELETE FROM transformation.revisions WHERE revision_id = $1', [
        fixture.revisionId,
      ]);
    });
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects SourceVersion content hash changed independently of Transformation Revision', async () => {
    const fixture = await createActionFixture();
    await pool.query('UPDATE asset.original_assets SET content_hash = $2 WHERE asset_id = $1', [
      fixture.originalAssetId,
      changedHash,
    ]);
    await expectRejectedAfterClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  const projectionMutations = [
    {
      name: 'rejects execution Preview projection mutation',
      sql: `UPDATE action.executions
               SET record_json = jsonb_set(record_json, '{preview,renderedPayload,title}', '"tampered"')
             WHERE action_id = $1`,
    },
    {
      name: 'rejects execution Approval projection mutation',
      sql: `UPDATE action.executions
               SET record_json = jsonb_set(record_json, '{approval,candidateRevision}', '2')
             WHERE action_id = $1`,
    },
    {
      name: 'rejects missing execution Approval projection',
      sql: `UPDATE action.executions SET record_json = record_json - 'approval' WHERE action_id = $1`,
    },
    {
      name: 'rejects missing execution Preview projection',
      sql: `UPDATE action.executions SET record_json = record_json - 'preview' WHERE action_id = $1`,
    },
  ];

  for (const attack of projectionMutations) {
    it(attack.name, async () => {
      const fixture = await createActionFixture();
      await pool.query(attack.sql, [fixture.actionId]);
      await expectRejectedBeforeClaim(fixture, await execute(fixture));
      await fixture.app.server.close();
    });
  }

  it('blocks immutable Snapshot row mutation with the append-only trigger', async () => {
    const fixture = await createActionFixture();
    await expect(
      pool.query(
        `UPDATE action.preview_snapshots
            SET snapshot_json = jsonb_set(snapshot_json, '{renderedPayload,title}', '"tampered"')
          WHERE action_id = $1`,
        [fixture.actionId],
      ),
    ).rejects.toThrow(/append-only/);
    expect(fixture.connector.calls.execute).toBe(0);
    expect(await executionStatus(fixture.actionId)).toBe('APPROVED');
    expect(await claimedAuditCount(fixture.actionId)).toBe(0);
    await fixture.app.server.close();
  });

  it('blocks immutable Approval row mutation with the append-only trigger', async () => {
    const fixture = await createActionFixture();
    await expect(
      pool.query('UPDATE action.approval_records SET snapshot_digest = $2 WHERE approval_id = $1', [
        fixture.approvalId,
        mismatchHash,
      ]),
    ).rejects.toThrow(/append-only/);
    expect(fixture.connector.calls.execute).toBe(0);
    expect(await executionStatus(fixture.actionId)).toBe('APPROVED');
    expect(await claimedAuditCount(fixture.actionId)).toBe(0);
    await fixture.app.server.close();
  });

  it('rejects inconsistent immutable Approval JSON', async () => {
    const fixture = await createActionFixture();
    await withConstraintBypass(async (client) => {
      await client.query(
        `UPDATE action.approval_records
            SET approval_json = jsonb_set(approval_json, '{snapshotDigest}', to_jsonb($2::text))
          WHERE approval_id = $1`,
        [fixture.approvalId, mismatchHash],
      );
    });
    await expectRejectedBeforeClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects immutable Approval-to-Snapshot digest mismatch', async () => {
    const fixture = await createActionFixture();
    await withConstraintBypass(async (client) => {
      await client.query(
        'UPDATE action.approval_records SET snapshot_digest = $2 WHERE approval_id = $1',
        [fixture.approvalId, mismatchHash],
      );
    });
    await expectRejectedBeforeClaim(fixture, await execute(fixture));
    await fixture.app.server.close();
  });

  it('rejects concurrent duplicate execution with one Connector call', async () => {
    const fixture = await createActionFixture();
    const [first, second] = await Promise.all([execute(fixture), execute(fixture)]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(fixture.connector.calls.execute).toBe(1);
    expect(await claimedAuditCount(fixture.actionId)).toBe(1);
    expect(await executionStatus(fixture.actionId)).toBe('VERIFIED');
    await fixture.app.server.close();
  });

  it('does not expose sensitive binding digests in logs or HTTP errors', async () => {
    const harness = await createActionApplication();
    const seeded = await seedCandidate(harness);
    await pool.query(
      `UPDATE action.candidates
          SET candidate_json = jsonb_set(candidate_json, '{validationDigest}', to_jsonb($2::text))
        WHERE project_id = $1 AND candidate_id = $3`,
      [projectId, mismatchHash, seeded.candidateId],
    );
    const logged: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      logged.push(JSON.stringify(values));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      logged.push(JSON.stringify(values));
    });
    try {
      const response = await harness.app.server.inject({
        method: 'POST',
        url: '/actions/preview',
        headers: { cookie: harness.cookie, 'x-csrf-token': harness.csrfToken },
        payload: {
          candidateId: seeded.candidateId,
          expectedRevision: 1,
          operationKey: 'CREATE_DRAFT',
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'STALE_ACTION_SNAPSHOT',
        message:
          'Candidate data no longer matches the authoritative Validation, Evidence, Source, or Transformation records.',
      });
      expect(response.body).not.toContain(mismatchHash);
      expect(response.body).not.toContain(sourceContentHash);
      expect(logged.join('\n')).not.toContain(mismatchHash);
      expect(logged.join('\n')).not.toContain(sourceContentHash);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await harness.app.server.close();
    }
  });
});
