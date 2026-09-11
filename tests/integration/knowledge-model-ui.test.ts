import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Knowledge read API compatibility', () => {
  it('keeps the typed Graph API after the legacy standalone page is removed', async () => {
    const app = await createApplication();

    const graph = await app.server.inject({
      method: 'POST',
      url: '/knowledge/graph/query',
      payload: {},
    });
    expect(graph.statusCode).toBe(200);
    expect(graph.json()).toEqual({
      graph: {
        nodes: [],
        edges: [],
        tableRows: [],
        fallback: { available: true, modes: ['LIST', 'TABLE'] },
      },
    });
    await app.server.close();
  });
});
