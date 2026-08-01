import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { directTextCommand } from '../helpers/stage-3.js';
import { compiledTruthReadSnapshotQuery } from '../helpers/stage-10.js';
import type { GetCompiledTruthReadSnapshotResult } from '../../packages/contracts/src/index.js';

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

  it('exposes the Stage 10 read snapshot through the kernel without widening the legacy query', async () => {
    const app = await createApplication();
    const parent = directTextCommand('stage10-read-snapshot-integration', 'Integration fixture.');
    const snapshot = (
      await app.kernel.connector.query<GetCompiledTruthReadSnapshotResult>(
        compiledTruthReadSnapshotQuery(parent),
      )
    ).result.payload;
    expect(snapshot).toMatchObject({
      projectId: parent.projectId,
      status: { status: 'NOT_BUILT' },
    });
    await expect(
      app.kernel.connector.query(compiledTruthReadSnapshotQuery(parent)),
    ).resolves.toMatchObject({ result: { payload: { status: { status: 'NOT_BUILT' } } } });
    await app.server.close();
  });
});
