import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Stage 9 knowledge list/table compatibility', () => {
  it('keeps the accessible fallback and typed Graph API after the Stage 10 canvas upgrade', async () => {
    const app = await createApplication();
    const page = await app.server.inject({ method: 'GET', url: '/knowledge' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('지식 목록·표 보기');
    expect(page.body).toContain('aria-label="승인된 지식 항목"');
    expect(page.body).toContain('/compiled-truth/query');
    expect(page.body).toContain('id="graph"');

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
