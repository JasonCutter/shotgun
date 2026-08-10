import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

/**
 * LPA-WP4 focused tests (Frozen IR §5) — static SPA serving (D03/D04/D05),
 * the browser-route-only SPA fallback (AC-09/AC-10) and exactly-once resource
 * cleanup on shutdown (D09). No Cross-Phase suite re-run; new delta only.
 */
let tempDir: string | undefined;

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const makeSpaDirectory = async (): Promise<string> => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'shotgun-lpa-wp4-'));
  await writeFile(
    path.join(tempDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
    'utf8',
  );
  await mkdir(path.join(tempDir, 'assets'), { recursive: true });
  await writeFile(path.join(tempDir, 'assets', 'app.js'), 'console.log("shotgun-spa");', 'utf8');
  return tempDir;
};

describe('LPA-WP4 Local Launch / Serving Usability', () => {
  it('serves the built SPA same-origin with a browser-route-only fallback', async () => {
    const spaDirectory = await makeSpaDirectory();
    const { server } = await createApplication({
      spaDirectory,
      authRepository: new InMemoryAuthRepository(),
    });
    try {
      // `/` serves the SPA index (public GET browser route).
      const root = await server.inject({ method: 'GET', url: '/' });
      expect(root.statusCode).toBe(200);
      expect(root.headers['content-type']).toContain('text/html');
      expect(root.body).toContain('<div id="root">');

      // Real static asset is served.
      const asset = await server.inject({ method: 'GET', url: '/assets/app.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toContain('shotgun-spa');

      // Browser deep route falls back to the SPA index.
      const deep = await server.inject({ method: 'GET', url: '/knowledge/some/deep/route' });
      expect(deep.statusCode).toBe(200);
      expect(deep.headers['content-type']).toContain('text/html');
      expect(deep.body).toContain('<div id="root">');

      // Unknown /api routes are NEVER absorbed into the SPA fallback.
      const api = await server.inject({ method: 'GET', url: '/api/v1/unknown-route' });
      expect(api.statusCode).toBe(401);
      expect(api.headers['content-type'] ?? '').not.toContain('text/html');

      // Unknown /product-api routes are NEVER absorbed into the SPA fallback.
      const productApi = await server.inject({
        method: 'GET',
        url: '/product-api/frontend/unknown-route',
      });
      expect(productApi.statusCode).toBe(401);
      expect(productApi.headers['content-type'] ?? '').not.toContain('text/html');

      // Non-GET unknown browser routes keep 404 semantics (not SPA HTML).
      const postUnknown = await server.inject({ method: 'POST', url: '/some/unknown' });
      expect(postUnknown.statusCode).toBe(401);
      expect(postUnknown.headers['content-type'] ?? '').not.toContain('text/html');

      // /health keeps its existing semantics (public kernel health).
      const health = await server.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.headers['content-type']).toContain('application/json');
    } finally {
      await server.close();
    }
  });

  it('runs closeResources exactly once on shutdown (idempotent close path)', async () => {
    const spaDirectory = await makeSpaDirectory();
    let closes = 0;
    const { server } = await createApplication({
      spaDirectory,
      authRepository: new InMemoryAuthRepository(),
      closeResources: async () => {
        closes += 1;
      },
    });
    await server.close();
    await server.close();
    await server.inject({ method: 'GET', url: '/health' }).catch(() => {});
    expect(closes).toBe(1);
  });
});
