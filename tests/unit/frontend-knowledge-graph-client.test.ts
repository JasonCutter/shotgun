import { describe, expect, it, vi } from 'vitest';

import { createFrontendKnowledgeGraphClient } from '../../packages/shotgun-api-client/src/index.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const appliedLimits = {
  schemaVersion: '1.0.0',
  maxDepth: 3,
  maxNodes: 100,
  maxEdges: 200,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
  requestedMaxDepth: 3,
  requestedMaxNodes: 100,
  requestedMaxEdges: 200,
  clamped: false,
};

const snapshotResult = (snapshotId: string, projectionRevision: string) => ({
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId,
    projectId: 'project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision,
    generatedAt: '2026-08-04T08:00:00.000Z',
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: [],
  edges: [],
  appliedLimits,
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
});

describe('createFrontendKnowledgeGraphClient (FE-P3-S3 Product API connection)', () => {
  it('fetches a semantic snapshot through the graph endpoint with CSRF and strict decoding', async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-graph' });
      }
      return jsonResponse(200, snapshotResult('snapshot-1', 'proj-1'));
    });

    const client = createFrontendKnowledgeGraphClient({ fetch: fetchMock });
    const result = await client.getGraphSnapshot({
      schemaVersion: '1.0.0',
      viewKind: 'KNOWLEDGE_SEMANTIC',
      overlayKinds: [],
    });

    expect(result.identity.snapshotId).toBe('snapshot-1');
    const snapshot = calls.find((call) => call.url.includes('/knowledge/graph/snapshot'));
    expect(snapshot?.init?.method).toBe('POST');
    expect(snapshot?.init?.headers).toMatchObject({ 'x-csrf-token': 'csrf-graph' });
  });

  it('rejects a refresh response that does not issue a new snapshot identity', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-graph' });
      }
      return jsonResponse(200, snapshotResult('snapshot-1', 'proj-1'));
    });

    const client = createFrontendKnowledgeGraphClient({ fetch: fetchMock });
    await expect(
      client.refreshGraphSnapshot({
        schemaVersion: '1.0.0',
        snapshotId: 'snapshot-1',
        projectionRevision: 'proj-1',
        expectedSnapshotRevision: 'proj-2',
      }),
    ).rejects.toThrow();
  });

  it('decodes a neighborhood result with a continuation token', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/v1/security/csrf')) {
        return jsonResponse(200, { csrfToken: 'csrf-graph' });
      }
      return jsonResponse(200, {
        schemaVersion: '1.0.0',
        snapshotId: 'snapshot-1',
        projectionRevision: 'proj-1',
        centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
        addedNodes: [],
        addedEdges: [],
        completeness: 'PARTIAL',
        appliedLimits,
        continuation: {
          schemaVersion: '1.0.0',
          token: 'tok-1',
          expiresAt: '2026-08-04T08:05:00.000Z',
        },
      });
    });

    const client = createFrontendKnowledgeGraphClient({ fetch: fetchMock });
    const result = await client.expandGraphNeighborhood({
      schemaVersion: '1.0.0',
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      centerRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
    });
    expect(result.continuation?.token).toBe('tok-1');
    expect(result.completeness).toBe('PARTIAL');
  });
});
