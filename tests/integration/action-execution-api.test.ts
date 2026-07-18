import { describe, expect, it } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { InMemoryActionCandidateRepository } from '../../adapters/stage11-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import type { EvidenceRepositoryPort } from '../../modules/evidence/src/index.js';
import type {
  OriginalAssetRepositoryPort,
  StoredIntakeResult,
} from '../../modules/original-asset/src/index.js';
import type { ValidationRepositoryPort } from '../../modules/validation/src/index.js';
import type { TransformationRevisionSecurityRepositoryPort } from '../../modules/transformation/src/index.js';
import { actionServerCandidate } from '../helpers/stage-11.js';

import {
  validationResultDigest,
  actionEvidenceRecordDigest,
  sha256Text,
  type ValidationResult,
  type EvidenceSpan,
} from '../../packages/contracts/src/index.js';

describe('Stage 12.1 P0-2 external Action API vertical slice', () => {
  it('accepts reference-only Preview and approvalId-only Execute without exposing a Verify endpoint', async () => {
    const secret = 'api-connector-secret';
    const connector = new FakeDraftActionConnector(secret);
    const candidates = new InMemoryActionCandidateRepository();
    const sourceText = 'The first sentence. api is the cited sentence. The final sentence.';
    const sourceContentHash = sha256Text(sourceText);

    const validationMock: ValidationResult = {
      projectId: 'shotgun',
      validationId: 'validation:api',
      candidateId: 'action-candidate:api',
      revisionNumber: 1,
      sourceVersionId: 's1',
      status: 'READY' as const,
      dimensions: [],
      createdAt: '2026-07-17T10:00:00.000Z',
    };
    const evidenceMock: EvidenceSpan = {
      evidenceId: 'evidence:api',
      revisionId: 'revision:api',
      projectId: 'shotgun',
      sourceId: 'src1',
      sourceVersionId: 's1',
      pointer: '/blocks/0/sentences/0',
      nodeKind: 'sentence',
      origin: 'source',
      position: {
        type: 'TextPositionSelector',
        start: 0,
        end: 3,
        unit: 'unicode-code-point',
      },
      quote: { type: 'TextQuoteSelector', exact: 'api' },
      selectors: [],
      exactHash: sha256Text('api'),
      accessScope: ['action:read'],
      sensitivity: 'private' as const,
      createdAt: '2026-07-17T10:00:00.000Z',
    };
    const originalMock: StoredIntakeResult = {
      submissionId: 'submission:api',
      projectId: 'shotgun',
      sourceId: 'src1',
      sourceVersionId: 's1',
      versionNumber: 1,
      channel: 'direct_text',
      materialKind: 'plain_text',
      assetReference: {
        assetId: 'asset:api',
        versionId: 's1',
        mediaType: 'text/plain',
        contentHash: sourceContentHash,
        sizeBytes: Buffer.byteLength(sourceText, 'utf8'),
        storageUri: 'asset://asset:api/versions/s1',
        accessScope: ['action:read'],
      },
      storageKey: 'security/api',
      sensitivity: 'private' as const,
      assetReused: false,
      versionCreated: true,
    };

    const candidate = actionServerCandidate('api', {
      projectId: 'shotgun',
      validationDigest: validationResultDigest(validationMock),
      evidence: [
        {
          evidenceId: evidenceMock.evidenceId,
          digest: actionEvidenceRecordDigest(evidenceMock),
        },
      ],
      sourceSensitivity: originalMock.sensitivity,
    });
    await candidates.stage(candidate);

    const evidenceRepository: EvidenceRepositoryPort = {
      index: async () => ({ items: [evidenceMock], reusedCount: 0 }),
      listBySourceVersion: async () => [evidenceMock],
      findById: async (_projectId, evidenceId) =>
        evidenceId === evidenceMock.evidenceId ? evidenceMock : undefined,
    };
    const validationRepository: ValidationRepositoryPort = {
      save: async (validation) => validation,
      findByCandidateId: async (_projectId, candidateId) =>
        candidateId === validationMock.candidateId ? validationMock : undefined,
      findByValidationId: async (_projectId, validationId) =>
        validationId === validationMock.validationId ? validationMock : undefined,
    };
    const originalAssetRepository: OriginalAssetRepositoryPort = {
      assertSource: async () => undefined,
      store: async () => {
        throw new Error('The integration fixture does not store Original Assets.');
      },
      findBySubmission: async () => undefined,
      findByVersion: async (_projectId, sourceVersionId) =>
        sourceVersionId === originalMock.sourceVersionId ? originalMock : undefined,
      findSourceVersionSecurity: async () => ({
        projectId: originalMock.projectId,
        sourceId: originalMock.sourceId,
        sourceVersionId: originalMock.sourceVersionId,
        originalAssetId: originalMock.assetReference.assetId,
        contentHash: originalMock.assetReference.contentHash,
        accessScope: originalMock.assetReference.accessScope,
        sensitivity: originalMock.sensitivity,
      }),
    };
    const transformationRevisionSecurityRepository: TransformationRevisionSecurityRepositoryPort = {
      findTransformationRevisionSecurity: async (_projectId, revisionId) =>
        revisionId === evidenceMock.revisionId
          ? {
              revisionId: evidenceMock.revisionId,
              projectId: evidenceMock.projectId,
              sourceId: evidenceMock.sourceId,
              sourceVersionId: evidenceMock.sourceVersionId,
              sourceContentHash,
              accessScope: evidenceMock.accessScope,
              sensitivity: evidenceMock.sensitivity,
            }
          : undefined,
    };

    const app = await createApplication({
      actionConnector: connector,
      actionCandidateRepository: candidates,
      evidenceRepository,
      validationRepository,
      originalAssetRepository,
      transformationRevisionSecurityRepository,
    });
    const forbidden = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: {
        candidateId: candidate.candidate.candidateId,
        expectedRevision: 1,
        operationKey: 'CREATE_DRAFT',
        target: { connectorId: 'forged' },
      },
    });
    expect(forbidden.statusCode).toBe(400);
    expect(forbidden.json()).toMatchObject({ code: 'ACTION_SERVER_BINDING_REQUIRED' });

    const previewResponse = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: {
        candidateId: candidate.candidate.candidateId,
        expectedRevision: 1,
        operationKey: 'CREATE_DRAFT',
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json().action;
    expect(preview).toMatchObject({
      status: 'PREVIEW_READY',
      preview: { canonicalSerializer: 'action-preview-canonical-v1', sourceSensitivity: 'private' },
    });

    const approvalResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/approve`,
      payload: { expectedPreviewDigest: preview.preview.previewDigest },
    });
    expect(approvalResponse.statusCode).toBe(200);
    const approved = approvalResponse.json().action;

    const invalidExecute = await app.server.inject({
      method: 'POST',
      url: '/actions/execute',
      payload: { approvalId: approved.approval.approvalId, projectId: 'forged' },
    });
    expect(invalidExecute.statusCode).toBe(400);
    expect(invalidExecute.json()).toMatchObject({ code: 'ACTION_SERVER_BINDING_REQUIRED' });

    const executionResponse = await app.server.inject({
      method: 'POST',
      url: '/actions/execute',
      payload: { approvalId: approved.approval.approvalId },
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json().action).toMatchObject({
      status: 'VERIFIED',
      verification: { status: 'APPLIED' },
    });

    const queryResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/query`,
      payload: {},
    });
    expect(queryResponse.statusCode).toBe(200);
    const auditResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/audit`,
      payload: {},
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json().audit.at(-1).category).toBe('ACTION_VERIFIED');
    expect(
      `${previewResponse.body}${approvalResponse.body}${executionResponse.body}${auditResponse.body}`,
    ).not.toContain(secret);
    expect(connector.calls).toEqual({ preflight: 1, execute: 1, verify: 1 });

    const verifyResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/verify`,
      payload: {},
    });
    expect(verifyResponse.statusCode).toBe(404);
    await app.server.close();
  });

  it('rejects missing, cross-project, stale, and over-sensitive Candidate references', async () => {
    const candidates = new InMemoryActionCandidateRepository();
    const current = actionServerCandidate('current', { projectId: 'shotgun' });
    const restricted = actionServerCandidate('restricted', {
      projectId: 'shotgun',
      sourceSensitivity: 'restricted',
    });
    const otherProject = actionServerCandidate('other', { projectId: 'other-project' });
    await Promise.all([
      candidates.stage(current),
      candidates.stage(restricted),
      candidates.stage(otherProject),
    ]);
    const app = await createApplication({ actionCandidateRepository: candidates });

    const missing = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: { candidateId: 'missing', expectedRevision: 1, operationKey: 'CREATE_DRAFT' },
    });
    expect(missing.statusCode).toBe(404);
    const crossProject = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: {
        candidateId: otherProject.candidate.candidateId,
        expectedRevision: 1,
        operationKey: 'CREATE_DRAFT',
      },
    });
    expect(crossProject.statusCode).toBe(404);
    const stale = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: {
        candidateId: current.candidate.candidateId,
        expectedRevision: 2,
        operationKey: 'CREATE_DRAFT',
      },
    });
    expect(stale.statusCode).toBe(409);
    const sensitive = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: {
        candidateId: restricted.candidate.candidateId,
        expectedRevision: 1,
        operationKey: 'CREATE_DRAFT',
      },
    });
    expect(sensitive.statusCode).toBe(403);
    await app.server.close();
  });
});
