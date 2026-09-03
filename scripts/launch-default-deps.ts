/**
 * LPA-WP4 (Correction Round 1 C1/C2) — real default launch dependencies.
 * Kept separate from the pure orchestration so the core module stays
 * deterministic and fakeable in focused tests.
 */
import { execSync } from 'node:child_process';

import { startShotgunApplication } from '../assemblies/shotgun-app/src/application.js';
import { openBrowser, type LaunchDeps } from './launch-core.js';

export const createDefaultLaunchDeps = (): LaunchDeps => ({
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
  buildSpa: (cwd, env) => {
    execSync('npm run frontend:build', { cwd, stdio: 'inherit', env });
  },
  probeDatabase: async (connectionString) => {
    const { default: pg } = await import('pg');
    const probe = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
    try {
      await probe.query('SELECT 1');
    } finally {
      await probe.end().catch(() => {});
    }
  },
  verifyDatabaseSchema: (cwd, env) => {
    execSync('npm run db:verify', { cwd, stdio: 'inherit', env });
  },
  startApplication: async ({
    host,
    port,
    spaDirectory,
    environment,
    stagingSecret,
    environmentProfile,
  }) =>
    startShotgunApplication({
      host,
      port,
      spaDirectory,
      environment,
      stagingSecret,
      environmentProfile,
    }),
  fetchReadiness: async (url, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const health = await fetch(`${url}/health`);
        if (health.ok) {
          const root = await fetch(url);
          if (root.ok) {
            const html = await root.text();
            if (html.includes('<div id="root">')) {
              return true;
            }
          }
        }
      } catch {
        // retry until the deadline
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  },
  openBrowser,
});
