import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Stage 1 application', () => {
  it('loads two independent modules and exposes their capabilities', async () => {
    const { server } = await createApplication();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      modules: [
        'stage1.ping',
        'stage1.pong',
        'stage2.intake',
        'stage2.original-asset',
        'stage3.transformation',
        'stage3.evidence',
        'stage4.ai-provider',
        'stage4.candidate-generation',
        'stage4.validation',
        'stage5.comparison',
        'stage5.change-set-review',
        'stage6.canonical-knowledge',
      ],
      capabilities: [
        'ping-command',
        'pong-query',
        'intake-submit',
        'original-asset-store',
        'asset-resolver',
        'plain-text-transformation',
        'document-revision-provider',
        'evidence-index',
        'evidence-resolver',
        'structured-ai-provider',
        'claim-candidate-provider',
        'candidate-validation-provider',
        'claim-comparison-provider',
        'change-set-review-provider',
        'canonical-knowledge-provider',
        'canonical-snapshot-provider',
      ],
    });

    await server.close();
  });

  it('stores and resolves direct text only through an Asset Reference', async () => {
    const { server } = await createApplication();

    const intake = await server.inject({
      method: 'POST',
      url: '/intake',
      payload: {
        submissionId: 'http-intake-1',
        input: {
          kind: 'direct_text',
          text: 'HTTP original\r\nunchanged',
        },
      },
    });
    expect(intake.statusCode).toBe(200);
    const body = intake.json();
    expect(body.stored.assetReference.storageUri).toMatch(/^asset:\/\//);
    expect(body.document.documentIR.blocks).toHaveLength(1);
    expect(body.evidence.items.length).toBeGreaterThan(1);
    expect(body.trace.map((record: { messageType: string }) => record.messageType)).toContain(
      'OriginalAssetStored',
    );

    const resolved = await server.inject({
      method: 'POST',
      url: '/assets/resolve',
      payload: {
        assetReference: body.stored.assetReference,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().resolved.text).toBe('HTTP original\r\nunchanged');

    const evidence = await server.inject({
      method: 'POST',
      url: '/evidence/resolve',
      payload: {
        evidenceId: body.evidence.items[0].evidenceId,
      },
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().evidence.quote.exact).toBe('HTTP original\r\nunchanged');

    await server.close();
  });

  it('rejects an invalid sensitivity header before Intake', async () => {
    const { server } = await createApplication();

    const response = await server.inject({
      method: 'POST',
      url: '/intake',
      headers: {
        'x-sensitivity': 'unknown',
      },
      payload: {
        submissionId: 'invalid-sensitivity',
        input: {
          kind: 'direct_text',
          text: 'must be rejected',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

    await server.close();
  });

  it('demonstrates PingCommand to PongEvent to QueryResult through the API', async () => {
    const { server } = await createApplication();

    const response = await server.inject({
      method: 'POST',
      url: '/demo/ping',
      payload: {
        requestId: 'demo-1',
        message: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      commandStatus: 'processed',
      pong: {
        requestId: 'demo-1',
        reply: 'pong:hello',
        receivedCount: 1,
      },
    });
    expect(
      response
        .json()
        .trace.filter((record: { status: string }) => record.status === 'succeeded')
        .map((record: { messageType: string }) => record.messageType),
    ).toEqual(['PongEvent', 'PingCommand', 'GetPongResult']);

    await server.close();
  });
});
