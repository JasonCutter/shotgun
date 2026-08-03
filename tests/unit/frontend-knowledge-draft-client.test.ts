import { describe, expect, it, vi } from 'vitest';

import { createFrontendKnowledgeDraftClient } from '../../packages/shotgun-api-client/src/index.js';
import { pDraft } from '../helpers/frontend-knowledge-draft-parity.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const draftV1 = () => pDraft('seed-1');
const materializeResult = () => ({
  schemaVersion: '1.0.0',
  outcome: 'COMPLETED',
  clientRequestId: 'req-1',
  idempotencyKey: 'idem-1',
  draft: draftV1(),
});

describe('createFrontendKnowledgeDraftClient (FE-P3-S2 Product API connection)', () => {
  it('materializes a Seed through the draft endpoint with a CSRF token and strict decoding', async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-1' });
      }
      return jsonResponse(200, materializeResult());
    });

    const client = createFrontendKnowledgeDraftClient({ fetch: fetchMock });
    const result = await client.materializeDraft({
      schemaVersion: '1.0.0',
      clientRequestId: 'req-1',
      idempotencyKey: 'idem-1',
      seedId: 'seed-1',
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(result.draft.draftId).toBe('draft-seed-1');
    const materialize = calls.find((call) =>
      call.url.includes('/product-api/frontend/knowledge/drafts/materialize'),
    );
    expect(materialize?.init?.method).toBe('POST');
    expect(materialize?.init?.headers).toMatchObject({ 'x-csrf-token': 'csrf-1' });
  });

  it('retries once with a fresh CSRF token on a 403 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'csrf-stale' }))
      .mockResolvedValueOnce(jsonResponse(403, { code: 'FORBIDDEN' }))
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'csrf-fresh' }))
      .mockResolvedValueOnce(jsonResponse(200, materializeResult()));

    const client = createFrontendKnowledgeDraftClient({ fetch: fetchMock });
    const result = await client.materializeDraft({
      schemaVersion: '1.0.0',
      clientRequestId: 'req-1',
      idempotencyKey: 'idem-1',
      seedId: 'seed-1',
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const materializeCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/knowledge/drafts/materialize'),
    );
    expect(materializeCalls).toHaveLength(2);
    const headers = materializeCalls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('csrf-fresh');
  });

  it('saves a Draft revision and decodes the server-authoritative result', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-1' });
      }
      return jsonResponse(200, materializeResult());
    });

    const client = createFrontendKnowledgeDraftClient({ fetch: fetchMock });
    const result = await client.saveDraft({
      schemaVersion: '1.0.0',
      clientRequestId: 'req-1',
      idempotencyKey: 'idem-1',
      draftId: 'draft-seed-1',
      expectedDraftRevision: 1,
      expectedBaseRevision: 7,
      operationRevision: 2,
      operations: [],
      contentDigest: 'sha256:v2',
    });

    expect(result.draft.draftId).toBe('draft-seed-1');
    const save = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/knowledge/drafts/save'),
    );
    expect(save).toBeDefined();
  });

  it('resolves a command outcome through the original identity', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-1' });
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: 'req-1',
        originalIdempotencyKey: 'idem-1',
        draft: draftV1(),
      });
    });

    const client = createFrontendKnowledgeDraftClient({ fetch: fetchMock });
    const result = await client.resolveCommandOutcome({
      schemaVersion: '1.0.0',
      clientRequestId: 'req-1',
      idempotencyKey: 'idem-1',
      semanticDigest: 'sha256:save',
    });

    expect(result.outcome).toBe('COMPLETED');
    expect(result.draft?.draftId).toBe('draft-seed-1');
    const resolve = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/knowledge/drafts/resolve-outcome'),
    );
    expect(resolve).toBeDefined();
  });
});
