import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Stage 10 Compiled Truth graph UI', () => {
  it('serves local Cytoscape and keeps the list/table fallback', async () => {
    const app = await createApplication();
    const build = await app.server.inject({
      method: 'POST',
      url: '/compiled-truth/build',
      payload: { mode: 'FULL_REBUILD' },
    });
    expect(build.statusCode).toBe(200);

    const page = await app.server.inject({ method: 'GET', url: '/knowledge' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Compiled Truth 그래프');
    expect(page.body).toContain('id="graph"');
    expect(page.body).toContain('지식 목록·표 보기');
    expect(page.body).toContain('aria-label="승인된 지식 항목"');
    expect(page.body).toContain('/vendor/cytoscape.min.js');

    const vendor = await app.server.inject({ method: 'GET', url: '/vendor/cytoscape.min.js' });
    expect(vendor.statusCode).toBe(200);
    expect(vendor.headers['content-type']).toContain('application/javascript');
    expect(vendor.body).toContain('cytoscape');

    const projection = await app.server.inject({
      method: 'POST',
      url: '/compiled-truth/query',
      payload: {},
    });
    expect(projection.statusCode).toBe(200);
    expect(projection.json()).toMatchObject({
      projection: { graph: { fallback: { available: true, modes: ['LIST', 'TABLE'] } } },
      status: { status: 'READY', lag: 0 },
    });
    await app.server.close();
  });
});
