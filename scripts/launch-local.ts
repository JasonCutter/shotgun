/**
 * Shotgun Local Launch (LPA-WP4 D01 ~ D13) — owner-facing single command.
 *
 * `npm run launch`:
 *   1. validates required environment (ENV_CONFIGURATION_INVALID)
 *   2. builds the SPA (`npm run frontend:build`) — never `npm ci` (D06)
 *   3. verifies the database non-destructively (D07)
 *   4. starts the SAME production composition in-process (D08) serving the
 *      built SPA same-origin (D02/D03/D04)
 *   5. waits for readiness (/health + SPA HTML on `/`, D10)
 *   6. opens the browser (D11; `--no-open` to skip; failure is non-fatal)
 *   7. SIGINT/SIGTERM safe shutdown is handled idempotently by the runtime
 *      boundary (D09)
 *
 * This entry is intentionally thin (C1): the orchestration and every Frozen
 * failure taxonomy category live in `./launch-core.ts`. The owner entry is
 * the only place that performs the final exit boundary (C2) — the core never
 * calls `process.exit`.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

import { LaunchFailure, runLaunch } from './launch-core.js';
import {
  createDefaultCanonicalLaunchDeps,
  runCanonicalLaunchPreflight,
} from './launch-canonical.js';
import { installSignalShutdown } from '../assemblies/shotgun-app/src/shutdown.js';
import { recoverSourceKnowledgeResetsBeforeRuntime } from './t3-launch-recovery.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');
  const spaDirectory = path.join(rootDirectory, 'apps', 'shotgun-web', 'dist');
  const canonical = await runCanonicalLaunchPreflight(
    {
      rootDirectory,
      host: process.env.HOST ?? '127.0.0.1',
      port: Number.parseInt(process.env.PORT ?? '3000', 10),
      reexecCount: Number.parseInt(process.env.SHOTGUN_LAUNCH_REEXEC_COUNT ?? '0', 10),
      log: (message) => console.log(message),
    },
    createDefaultCanonicalLaunchDeps(),
  );

  if (canonical.kind === 'reexec') {
    process.exit(canonical.exitCode);
    return;
  }

  if (canonical.kind === 'reuse') {
    const { openBrowser } = await import('./launch-core.js');
    if (!noOpen) {
      const result = openBrowser(process.platform, canonical.identity.url);
      if (!result.ok) {
        console.warn(`[launch] WARN  could not open the browser automatically (${result.reason}).`);
      }
    } else {
      console.log('[launch] --no-open: browser open skipped.');
    }
    console.log(`[launch] Open ${canonical.identity.url} manually if the browser did not open.`);
    return;
  }

  const { createDefaultLaunchDeps } = await import('./launch-default-deps.js');

  let application;
  try {
    application = await runLaunch(
      {
        noOpen,
        noSignals: true,
        onReady: canonical.runtime.markReady,
        port: canonical.runtime.identity.port,
        host: canonical.runtime.identity.host,
        spaDirectory,
        rootDirectory,
        env: process.env,
        environmentProfile: 'runtime-development',
        beforeApplicationStart: async ({ databaseUrl, rootDirectory, environment }) => {
          await recoverSourceKnowledgeResetsBeforeRuntime({
            databaseUrl,
            rootDirectory,
            environment,
            log: (message) => console.log(message),
          });
        },
      },
      createDefaultLaunchDeps(),
    );
  } catch (error) {
    await canonical.runtime.release().catch(() => {});
    throw error;
  }
  if (!application) throw new Error('unreachable: launch returned without an application.');

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await application.close();
    } finally {
      await canonical.runtime.release();
    }
  };

  installSignalShutdown({
    close,
    exit: (code) => process.exit(code),
  });

  // 7. Keep the process alive; SIGINT/SIGTERM shutdown is handled by the
  //    runtime boundary (LPA-D09, idempotent). This await never resolves until
  //    the process receives a signal.
  await new Promise<void>(() => {});
};

void main().catch((error) => {
  if (error instanceof LaunchFailure) {
    console.error(`[launch] FAILURE ${error.code}: ${error.message}`);
    console.error(`[launch]   check:  ${error.check}`);
    console.error(`[launch]   action: ${error.command}`);
  } else {
    console.error('[launch] UNEXPECTED', error);
  }
  // C2: final exit boundary. Application resources were already closed by the
  // orchestration before the LaunchFailure was thrown.
  process.exit(1);
});
