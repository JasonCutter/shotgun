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
import { createDefaultLaunchDeps } from './launch-default-deps.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');
  const spaDirectory = path.join(rootDirectory, 'apps', 'shotgun-web', 'dist');

  const application = await runLaunch(
    {
      noOpen,
      port: Number.parseInt(process.env.PORT ?? '3000', 10),
      host: process.env.HOST ?? '127.0.0.1',
      spaDirectory,
      rootDirectory,
      env: process.env,
      environmentProfile: 'runtime-development',
    },
    createDefaultLaunchDeps(),
  );
  if (!application) throw new Error('unreachable: launch returned without an application.');

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
