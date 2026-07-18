import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  PostgresActionExecutionRepository,
  PostgresActionCandidateRepository,
} from '../../adapters/postgres-stage11/src/index.js';
import { PostgresEvidenceRepository } from '../../adapters/postgres-stage3/src/index.js';
import { PostgresValidationRepository } from '../../adapters/postgres-stage4/src/index.js';
import { PostgresOriginalAssetRepository } from '../../adapters/postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { hashPassword } from '../../packages/authentication/src/index.js';
import { actionServerCandidate } from '../helpers/stage-11.js';
import type {
  ValidationResult,
  ServerActionCandidate,
} from '../../packages/contracts/src/index.js';
import {
  stableJson,
  sha256Text,
  actionEvidenceSetDigest,
  validationResultDigest,
  actionEvidenceRecordDigest,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Stage 12.1 P0-1/2 Postgres Integration Tests', () => {
  beforeEach(async () => {
    await pool!.query(
      'TRUNCATE auth.audit_events, auth.api_tokens, auth.sessions, auth.project_memberships, auth.credentials, auth.principals, action.executions, action.preview_snapshots, action.approval_records, action.audit_events, action.candidates, validation.results, evidence.spans, transformation.revisions, asset.source_versions, asset.sources, asset.original_assets, candidate.claim_candidates, candidate.batches CASCADE',
    );
  });
  afterAll(async () => {
    await pool!.end();
  });

  it('handles CSRF, project switching, password change, tampering resistance, and audit binding', async () => {
    const authRepository = new PostgresAuthRepository(pool!);
    const actionExecutionRepository = new PostgresActionExecutionRepository(pool!);
    const actionCandidateRepository = new PostgresActionCandidateRepository(pool!);
    const validationRepository = new PostgresValidationRepository(pool!);
    const evidenceRepository = new PostgresEvidenceRepository(pool!);
    const originalAssetRepository = new PostgresOriginalAssetRepository(pool!);

    await authRepository.bootstrapOwner({
      accountId: 'owner',
      passwordHash: await hashPassword('initial-password'),
      projectId: 'shotgun',
      scopes: [
        'owner',
        'action:candidate:stage',
        'action:approve',
        'action:execute',
        'action:verify',
        'action:read',
        'action:audit:read',
      ],
      sensitivityClearance: 'private',
    });

    const app = await createApplication({
      authRepository,
      actionExecutionRepository,
      actionCandidateRepository,
      validationRepository,
      evidenceRepository,
      originalAssetRepository,
      production: true,
    });

    const login = await app.server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { accountId: 'owner', password: 'initial-password', projectId: 'shotgun' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0] ?? '';
    const csrfToken = login.json().csrfToken as string;

    const noCsrf = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie },
      payload: { message: 'hi' },
    });
    expect(noCsrf.statusCode).toBe(403);

    const switchProj = await app.server.inject({
      method: 'POST',
      url: '/auth/projects/active',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { projectId: 'shotgun' },
    });
    expect(switchProj.statusCode).toBe(200);

    const badPw = await app.server.inject({
      method: 'POST',
      url: '/auth/password',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { currentPassword: 'wrong', newPassword: 'new-password' },
    });
    expect(badPw.statusCode).toBe(401);

    const goodPw = await app.server.inject({
      method: 'POST',
      url: '/auth/password',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { currentPassword: 'initial-password', newPassword: 'new-password' },
    });
    expect(goodPw.statusCode).toBe(200);

    const revoked = await app.server.inject({
      method: 'POST',
      url: '/demo/ping',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { message: 'hi' },
    });
    expect(revoked.statusCode).toBe(401);

    const login2 = await app.server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { accountId: 'owner', password: 'new-password', projectId: 'shotgun' },
    });
    expect(login2.statusCode).toBe(200);
    const cookie2 =
      (Array.isArray(login2.headers['set-cookie'])
        ? login2.headers['set-cookie'][0]
        : login2.headers['set-cookie']
      )?.split(';')[0] ?? '';
    const csrfToken2 = login2.json().csrfToken as string;

    const assetId = randomUUID();
    const srcId = randomUUID();
    const s1Id = randomUUID();
    const evId = randomUUID();
    const revId = randomUUID();

    const fakeHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';

    // Seed Data
    await pool!.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at) VALUES ($1, $2, 1, 'key', now())`, [assetId, fakeHash]
    );
    await pool!.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at) VALUES ($1, 'shotgun', 'owner', now())`, [srcId]
    );
    await pool!.query(
      `INSERT INTO asset.source_versions (source_version_id, source_id, version_number, original_asset_id, media_type, access_scope, sensitivity, created_at) VALUES ($1, $2, 1, $3, 'text/plain', '{"action:read"}', 'public', now())`, [s1Id, srcId, assetId]
    );
    await pool!.query(
      `INSERT INTO asset.storage_receipts (receipt_id, submission_id, project_id, source_version_id, channel, material_kind, original_file_name, asset_reused, version_created, created_at) 
       VALUES ($1, $2, 'shotgun', $3, 'direct_text', 'plain_text', 'test.txt', false, true, now())`,
      [randomUUID(), randomUUID(), s1Id]
    );
    const globalFakeHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const globalRevId = randomUUID();

    await pool!.query(
      `INSERT INTO transformation.revisions (revision_id, project_id, source_id, source_version_id, source_content_hash, transformer_id, transformer_version, document_ir, source_map, document_hash, source_map_hash, access_scope, sensitivity, created_at)
       VALUES ($1, 'shotgun', $2, $3, $4, 'test-transformer', '1.0.0', '[]'::jsonb, '[]'::jsonb, $5, $6, $7, 'public', now())`,
      [globalRevId, srcId, s1Id, globalFakeHash, globalFakeHash, globalFakeHash, ['action:read']]
    );

    const setupCandidate = async () => {
      const evId = randomUUID();

      const evObj = {
        evidenceId: evId,
        sourceId: srcId,
        sourceVersionId: s1Id,
        exactHash: globalFakeHash,
        sensitivity: 'public',
        nodeKind: 'sentence' as const,
        origin: 'source' as const,
        quote: { exact: 'abc', prefix: '', suffix: '' },
        position: { startLine: 1, endLine: 1 },
        pointers: [],
      };
      await pool!.query(
        `INSERT INTO evidence.spans (evidence_id, revision_id, project_id, source_id, source_version_id, pointer, node_kind, origin, position, quote, selectors, exact_hash, access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, now())`,
        [
          evId,
          globalRevId,
          'shotgun',
          srcId,
          s1Id,
          randomUUID(), // pointer must be unique per revision
          'sentence',
          'source',
          JSON.stringify({ startLine: 1, endLine: 1 }),
          JSON.stringify({ exact: 'abc', prefix: '', suffix: '' }),
          JSON.stringify([]),
          globalFakeHash,
          ['action:read'],
          'public',
        ],
      );

      const c1Id = randomUUID();
      const v1Id = randomUUID();
      const baseCandidate = actionServerCandidate('test', {
        projectId: 'shotgun',
        sourceSensitivity: 'public',
      });
      const candidate = {
        ...baseCandidate,
        candidate: {
          ...baseCandidate.candidate,
          candidateId: c1Id,
          validation: { 
            expiresAt: new Date(Date.now() + 1000 * 60 * 60),
            validationId: v1Id,
            evidenceIds: [evId],
            status: 'READY' as const 
          },
        },
      };

      const validationRecord = {
        validationId: candidate.candidate.validation.validationId,
        projectId: 'shotgun',
        sourceVersionId: s1Id,
        candidateId: candidate.candidate.candidateId,
        revisionNumber: candidate.candidate.revisionNumber,
        status: 'READY' as const,
        dimensions: [{ name: 'test', score: 1.0, status: 'PASS' as const }],
        createdAt: new Date().toISOString(),
      };
      const batchId = randomUUID();
      await pool!.query(
        `INSERT INTO candidate.batches (batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at)
         VALUES ($1, 'shotgun', $2, $3, '{}'::jsonb, now())`,
        [batchId, s1Id, randomUUID()]
      );
      await pool!.query(
        `INSERT INTO candidate.claim_candidates (candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text, evidence_id, evidence_mode, extraction_profile, status, provider_call, access_scope, sensitivity, created_at)
         VALUES ($1, $2, 'shotgun', $3, 1, 'test claim', $4, 'DIRECT_EVIDENCE', 'direct-only', 'READY', '{}'::jsonb, ARRAY['action:read'], 'public', now())`,
        [candidate.candidate.candidateId, batchId, s1Id, evId]
      );
      await pool!.query(
        `INSERT INTO validation.results (validation_id, candidate_id, revision_number, project_id, source_version_id, status, dimensions, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())`,
        [
          validationRecord.validationId,
          validationRecord.candidateId,
          validationRecord.revisionNumber,
          validationRecord.projectId,
          validationRecord.sourceVersionId,
          validationRecord.status,
          JSON.stringify(validationRecord.dimensions),
        ],
      );

      const v = await validationRepository.findByValidationId('shotgun', validationRecord.validationId);
      const calculatedValidationDigest = validationResultDigest(v!);

      const e = await evidenceRepository.findById('shotgun', evId);
      const evBinding = {
        evidenceId: e!.evidenceId,
        sourceId: e!.sourceId,
        sourceVersionId: e!.sourceVersionId,
        exactHash: e!.exactHash,
        sensitivity: e!.sensitivity,
        digest: actionEvidenceRecordDigest(e!),
      };
      const calculatedEvidenceSetDigest = actionEvidenceSetDigest([evBinding]);
      
      const finalCandidate = {
        ...candidate,
        evidence: [evBinding],
        validationDigest: calculatedValidationDigest,
        evidenceSetDigest: calculatedEvidenceSetDigest,
        sourceSensitivity: 'public' as const,
      };
      
      await actionCandidateRepository.stage(finalCandidate as unknown as ServerActionCandidate);
      
      return { evId, c1Id, v1Id, validationRecord, fakeHash: globalFakeHash, globalRevId };
    };

    const runPreviewAndApprove = async (candidateId: string) => {
      const previewResp = await app.server.inject({
        method: 'POST',
        url: '/actions/preview',
        headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
        payload: {
          candidateId,
          expectedRevision: 1,
          operationKey: 'CREATE_DRAFT',
        },
      });
      if (previewResp.statusCode !== 200) {
        console.error('Preview error:', previewResp.json());
      }
      expect(previewResp.statusCode).toBe(200);
      const actionId = previewResp.json().action.actionId;
      const previewDigest = previewResp.json().action.preview.previewDigest;

      const approveRespForged = await app.server.inject({
        method: 'POST',
        url: `/actions/${actionId}/approve`,
        headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
        payload: {
          expectedPreviewDigest:
            'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        },
      });
      expect(approveRespForged.statusCode).toBe(409);

      const approveResp = await app.server.inject({
        method: 'POST',
        url: `/actions/${actionId}/approve`,
        headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
        payload: { expectedPreviewDigest: previewDigest },
      });
      expect(approveResp.statusCode).toBe(200);
      return { actionId, approvalId: approveResp.json().action.approval.approvalId };
    };

    const runExecute = async (approvalId: string) => {
      return app.server.inject({
        method: 'POST',
        url: `/actions/execute`,
        headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
        payload: { approvalId },
      });
    };

    // 2. Evidence Canonical Digest mutation attack: change exact_hash
    {
      const { evId, c1Id, fakeHash } = await setupCandidate();
      const { actionId, approvalId } = await runPreviewAndApprove(c1Id);
      await pool!.query(
        `UPDATE evidence.spans SET exact_hash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222' WHERE evidence_id = $1`,
        [evId]
      );
      const executeResp = await runExecute(approvalId);
      console.log('attack 2 status:', executeResp.statusCode);
      expect(executeResp.statusCode).toBe(409); // STALE_ACTION_SNAPSHOT
      // revert
      await pool!.query(
        `UPDATE evidence.spans SET exact_hash = $2 WHERE evidence_id = $1`,
        [evId, fakeHash]
      );
    }

    // 3. Validation mutation attack: change dimensions
    {
      const { c1Id, validationRecord } = await setupCandidate();
      const { actionId, approvalId } = await runPreviewAndApprove(c1Id);
      await pool!.query(
        `UPDATE validation.results SET dimensions = '[{"name": "test", "status": "FAIL", "score": 0.0}]'::jsonb WHERE validation_id = $1`,
        [validationRecord.validationId],
      );
      const executeResp = await runExecute(approvalId);
      console.log('attack 3 status:', executeResp.statusCode);
      expect(executeResp.statusCode).toBe(409);
      // revert
      await pool!.query(
        `UPDATE validation.results SET dimensions = $2::jsonb WHERE validation_id = $1`,
        [validationRecord.validationId, JSON.stringify(validationRecord.dimensions)],
      );
    }

    // 4. SourceVersion missing attack (Blocked by Postgres FK Constraints)
    {
      const { c1Id } = await setupCandidate();
      const { actionId, approvalId } = await runPreviewAndApprove(c1Id);
      // It's impossible to secretly delete a SourceVersion if Evidence/Candidate exists
      await expect(pool!.query(`DELETE FROM asset.source_versions WHERE source_version_id = $1`, [s1Id])).rejects.toThrow(/foreign key constraint/);
    }

    }
    // 1. Happy Path Execute
    {
      const { c1Id } = await setupCandidate();
      const { actionId, approvalId } = await runPreviewAndApprove(c1Id);
      const executeResp = await runExecute(approvalId);
      expect(executeResp.statusCode).toBe(200);

      const audits = await actionExecutionRepository.listAudit('shotgun', actionId);
      expect(audits.some((a) => a.category === 'ACTION_EXECUTION_CLAIMED')).toBe(true);
    }

    // verify token is revoked and un-listable
    {
      const listResp = await app.server.inject({
        method: 'GET',
        url: `/auth/tokens`,
        headers: { cookie: cookie2, 'x-csrf-token': csrfToken2 },
      });
      expect(listResp.statusCode).toBe(200);
      const listJson = listResp.json<{ tokens: any[] }>();
      expect(listJson.tokens.some((t) => t.id === tokenId2)).toBe(false);
    }
    await app.server.close();
  }, 15000);
});
