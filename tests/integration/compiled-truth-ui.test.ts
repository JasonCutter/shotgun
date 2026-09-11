import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { directTextCommand } from '../helpers/stage-3.js';
import { compiledTruthReadSnapshotQuery } from '../helpers/stage-10.js';
import type { GetCompiledTruthReadSnapshotResult } from '../../packages/contracts/src/index.js';

describe('Stage 10 Compiled Truth read APIs', () => {
  it('keeps the projection query contract after Knowledge moves to the Product SPA', async () => {
    const app = await createApplication();
    const build = await app.server.inject({
      method: 'POST',
      url: '/compiled-truth/build',
      payload: { mode: 'FULL_REBUILD' },
    });
    expect(build.statusCode).toBe(200);

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
