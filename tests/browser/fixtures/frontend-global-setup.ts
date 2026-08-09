import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ViteDevServer } from 'vite';
import { tsImport } from 'tsx/esm/api';

type ViteRuntime = {
  createServer(options: {
    configFile: string;
    root: string;
    server?: { port?: number; strictPort?: boolean };
  }): Promise<ViteDevServer>;
};

type BackendFixture = {
  startFrontendTestBackend(): Promise<{ close(): Promise<void> }>;
};

export default async function globalSetup() {
  const repositoryRoot = process.cwd();
  const frontendRoot = path.resolve(repositoryRoot, 'apps/shotgun-web');
  const backendFixture = (await tsImport(
    './frontend-test-backend.ts',
    import.meta.url,
  )) as BackendFixture;
  const backend = await backendFixture.startFrontendTestBackend();
  let frontend: ViteDevServer | undefined;

  try {
    process.env.VITE_BACKEND_TARGET = 'http://127.0.0.1:3001';
    process.env.VITE_E2E_TEST_BRIDGE = 'true';
    const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'));
    const viteEntry = frontendRequire.resolve('vite');
    const vite = (await import(pathToFileURL(viteEntry).href)) as ViteRuntime;
    frontend = await vite.createServer({
      configFile: path.join(frontendRoot, 'vite.config.ts'),
      root: frontendRoot,
    });
    await frontend.listen();
  } catch (error) {
    await frontend?.close();
    await backend.close();
    throw error;
  }

  const runningFrontend = frontend;
  return async () => {
    await runningFrontend.close();
    await backend.close();
  };
}
