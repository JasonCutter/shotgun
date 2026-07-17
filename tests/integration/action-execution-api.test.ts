import { describe, expect, it } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { actionCandidate } from '../helpers/stage-11.js';

const headers = (scope: string) => ({ 'x-access-scope': scope });

describe('Stage 11 external Action API vertical slice', () => {
  it('requires stage-specific permissions and completes a verified draft Action', async () => {
    const secret = 'api-connector-secret';
    const connector = new FakeDraftActionConnector(secret);
    const app = await createApplication({ actionConnector: connector });
    const candidate = actionCandidate('api');

    const denied = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      payload: candidate,
    });
    expect(denied.statusCode).toBe(403);

    const previewResponse = await app.server.inject({
      method: 'POST',
      url: '/actions/preview',
      headers: headers('action:candidate:stage'),
      payload: candidate,
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json().action;
    expect(preview).toMatchObject({
      status: 'PREVIEW_READY',
      preview: { riskDecision: { level: 'R1' } },
    });

    const approvalResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/approve`,
      headers: headers('action:approve'),
      payload: { expectedPreviewDigest: preview.preview.previewDigest, expiresInMs: 60000 },
    });
    expect(approvalResponse.statusCode).toBe(200);
    const approved = approvalResponse.json().action;

    const executionResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/execute`,
      headers: headers('action:execute'),
      payload: { approvalTokenId: approved.approval.tokenId },
    });
    expect(executionResponse.statusCode).toBe(200);
    expect(executionResponse.json().action).toMatchObject({
      status: 'VERIFIED',
      verification: { status: 'APPLIED' },
    });

    const queryResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/query`,
      headers: headers('action:read'),
      payload: {},
    });
    expect(queryResponse.statusCode).toBe(200);
    expect(queryResponse.json().action.status).toBe('VERIFIED');

    const auditResponse = await app.server.inject({
      method: 'POST',
      url: `/actions/${preview.actionId}/audit`,
      headers: headers('action:audit:read'),
      payload: {},
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json().audit.at(-1).category).toBe('ACTION_VERIFIED');
    expect(
      `${previewResponse.body}${approvalResponse.body}${executionResponse.body}${auditResponse.body}`,
    ).not.toContain(secret);
    expect(connector.calls).toEqual({ preflight: 1, execute: 1, verify: 1 });
    await app.server.close();
  });
});
