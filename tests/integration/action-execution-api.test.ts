import { describe, expect, it } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { InMemoryActionCandidateRepository } from '../../adapters/stage11-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { actionServerCandidate } from '../helpers/stage-11.js';

import { sha256Text, stableJson } from '../../packages/contracts/src/index.js';

describe('Stage 12.1 P0-2 external Action API vertical slice', () => {
  it('accepts reference-only Preview and approvalId-only Execute without exposing a Verify endpoint', async () => {
    const secret = 'api-connector-secret';
    const connector = new FakeDraftActionConnector(secret);
    const candidates = new InMemoryActionCandidateRepository();

    const validationMock = {
      validationId: 'validation:api',
      candidateId: 'action-candidate:api',
      revisionNumber: 1,
      sourceVersionId: 's1',
      status: 'READY' as const,
      dimensions: [],
    };
    const evidenceMock = {
      evidenceId: 'evidence:api',
      sourceId: 'src1',
      sourceVersionId: 's1',
      exactHash: 'hash',
      sensitivity: 'private' as const,
    };
    const originalMock = { sensitivity: 'private' as const };

    const candidate = actionServerCandidate('api', {
      projectId: 'shotgun',
      validationDigest: sha256Text(stableJson({
        validationId: validationMock.validationId,
        candidateId: validationMock.candidateId,
        revisionNumber: validationMock.revisionNumber,
        sourceVersionId: validationMock.sourceVersionId,
        status: validationMock.status,
      })),
      evidence: [{
        ...evidenceMock,
        digest: sha256Text(stableJson(evidenceMock))
      }],
      sourceSensitivity: originalMock.sensitivity,
    });
    await candidates.stage(candidate);

    const evidenceRepository = {
      findById: async (p: string, id: string) => evidenceMock as unknown,
    } as unknown;
    const validationRepository = {
      findByCandidateId: async () => validationMock as unknown,
    } as unknown;
    const originalAssetRepository = {
      findByVersion: async () => originalMock as unknown,
    } as unknown;

    const app = await createApplication({
      actionConnector: connector,
      actionCandidateRepository: candidates,
      // @ts-expect-error Mock repositories for test
      evidenceRepository,
      // @ts-expect-error Mock repositories for test
      validationRepository,
      // @ts-expect-error Mock repositories for test
      originalAssetRepository,
    });
    app.server.setErrorHandler((error, request, reply) => {
      console.error('FASTIFY ERROR:', error);
      reply.status(500).send(error);
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
    if (previewResponse.statusCode !== 200) {
      console.log('PREVIEW ERROR:', previewResponse.json());
    }
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
