/**
 * Shotgun Local Launch (LPA-WP4 D01 ~ D13) — owner-facing single command.
 *
 * `npm run launch`:
 *   1. validates required environment (ENV_CONFIGURATION_INVALID)
 *   2. builds the SPA (`npm run frontend:build`) — never `npm ci` (D06)
 *   3. verifies the database non-destructively (D07): availability check then
 *      the existing `db:verify`; never `db:reset`
 *   4. starts the SAME production composition in-process
 *      (`startShotgunApplication`, D08) serving the built SPA same-origin
 *      (D02/D03/D04) — no separate Frontend child process
 *   5. waits for readiness (backend /health + SPA HTML on `/`, D10)
 *   6. opens the browser (D11; `--no-open` to skip; failure is non-fatal)
 *   7. SIGINT/SIGTERM safe shutdown is handled idempotently by the runtime
 *      boundary (D09)
 *
 * Failure output follows the LPA-WP4 taxonomy (D12): what failed / what to
 * check / which command to run.
 */
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

import { startShotgunApplication } from '../assemblies/shotgun-app/src/application.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type LaunchFailureCode =
  | 'ENV_CONFIGURATION_INVALID'
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_SCHEMA_INVALID'
  | 'PORT_UNAVAILABLE'
  | 'SPA_BUILD_FAILED'
  | 'SPA_ASSETS_UNAVAILABLE'
  | 'BACKEND_START_FAILED'
  | 'READINESS_TIMEOUT';

class LaunchFailure extends Error {
  constructor(
    readonly code: LaunchFailureCode,
    message: string,
    readonly check: string,
    readonly command: string,
  ) {
    super(message);
  }
}

const fail = (code: LaunchFailureCode, message: string, check: string, command: string): never => {
  console.error(`[launch] FAILURE ${code}: ${message}`);
  console.error(`[launch]   check:  ${check}`);
  console.error(`[launch]   action: ${command}`);
  process.exit(1);
};

const runStep = (name: string, command: string, args: readonly string[]): void => {
  console.log(`[launch] START ${name}: ${command} ${args.join(' ')}`);
  try {
    execSync(`${command} ${args.map((a) => `"${a}"`).join(' ')}`, {
      cwd: rootDirectory,
      stdio: 'inherit',
      env: process.env,
    });
    console.log(`[launch] PASS  ${name}`);
  } catch {
    throw new LaunchFailure(
      'SPA_BUILD_FAILED',
      `${name} exited with a non-zero status.`,
      'Confirm Node/npm and the @shotgun/web workspace are healthy.',
      'npm run frontend:build',
    );
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const noOpen = args.includes('--no-open');

  // 1. Environment pre-check (LPA-D12 ENV_CONFIGURATION_INVALID).
  const databaseUrl = process.env.DATABASE_URL;
  const stagingSecret = process.env.SOURCES_STAGING_SECRET;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const missing = [
    databaseUrl ? undefined : 'DATABASE_URL',
    !stagingSecret || stagingSecret.trim().length < 32 ? 'SOURCES_STAGING_SECRET' : undefined,
    geminiApiKey ? undefined : 'GEMINI_API_KEY',
  ].filter((value): value is string => value !== undefined);
  if (missing.length > 0) {
    fail(
      'ENV_CONFIGURATION_INVALID',
      `Required environment variable(s) missing: ${missing.join(', ')}.`,
      'Copy `.env.example` to `.env` and fill the required values.',
      'Copy-Item .env.example .env',
    );
  }

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  const url = `http://${host}:${port}`;
  const spaDirectory = path.join(rootDirectory, 'apps', 'shotgun-web', 'dist');

  // 2. SPA build (LPA-D06): always build so the owner never needs to remember
  //    a separate build command; never `npm ci`/dependency install.
  try {
    runStep('spa-build', 'npm', ['run', 'frontend:build']);
  } catch (error) {
    if (error instanceof LaunchFailure) {
      console.error(`[launch] FAILURE ${error.code}: ${error.message}`);
      console.error(`[launch]   check:  ${error.check}`);
      console.error(`[launch]   action: ${error.command}`);
      process.exit(1);
    }
    throw error;
  }
  const indexHtml = path.join(spaDirectory, 'index.html');
  const { existsSync } = await import('node:fs');
  if (!existsSync(indexHtml)) {
    fail(
      'SPA_ASSETS_UNAVAILABLE',
      `Built SPA index is missing at ${indexHtml}.`,
      'Confirm the frontend build produced `apps/shotgun-web/dist/index.html`.',
      'npm run frontend:build',
    );
  }

  // 3. Database verification (LPA-D07) — non-destructive only.
  //    Availability first (DATABASE_UNAVAILABLE), then schema/verification
  //    (DATABASE_SCHEMA_INVALID). `db:reset` is never invoked by launch.
  {
    const { default: pg } = await import('pg');
    const probe = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
    try {
      await probe.query('SELECT 1');
    } catch {
      fail(
        'DATABASE_UNAVAILABLE',
        'PostgreSQL is not reachable.',
        'Start the DB container (or your local PostgreSQL) and retry.',
        'docker compose up -d --wait db',
      );
    } finally {
      await probe.end().catch(() => {});
    }
    console.log('[launch] START database-verify (npm run db:verify)');
    try {
      execSync('npm run db:verify', { cwd: rootDirectory, stdio: 'inherit', env: process.env });
      console.log('[launch] PASS  database-verify');
    } catch {
      fail(
        'DATABASE_SCHEMA_INVALID',
        'The database schema is not aligned with the migrations.',
        'Run the migrations then verify the schema.',
        'npm run db:migrate; npm run db:verify',
      );
    }
  }

  // 4. Start the canonical production composition in-process, same origin
  //    (LPA-D02/D03/D04/D08). No separate Frontend child process.
  let application: Awaited<ReturnType<typeof startShotgunApplication>> | undefined;
  try {
    application = await startShotgunApplication({ host, port, spaDirectory });
    await application.listen();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'EADDRINUSE') {
      fail(
        'PORT_UNAVAILABLE',
        `Port ${port} is already in use.`,
        'Stop the process occupying the port or choose another PORT.',
        'Set PORT=3001 (or another free port) and run npm run launch again.',
      );
    }
    console.error(error);
    fail(
      'BACKEND_START_FAILED',
      'The Shotgun backend failed to start.',
      'Check the error above and your `.env` configuration.',
      'npm run start',
    );
  }
  // fail() above never returns: application is always assigned here.
  if (!application) throw new Error('unreachable: backend start failure was not classified.');

  // 5. Readiness (LPA-D10): backend /health + SPA HTML on `/`.
  const readinessDeadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < readinessDeadline) {
    try {
      const health = await fetch(`${url}/health`);
      if (health.ok) {
        const root = await fetch(url);
        if (root.ok) {
          const html = await root.text();
          if (html.includes('<div id="root">')) {
            ready = true;
            break;
          }
        }
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    await application.close();
    fail(
      'READINESS_TIMEOUT',
      'Shotgun did not become ready within 30s.',
      'Check backend logs for startup failures.',
      'npm run launch (again) or npm run start',
    );
  }

  console.log(`[launch] READY Shotgun is running at ${url}`);

  // 6. Browser open (LPA-D11) — non-fatal on failure.
  if (!noOpen) {
    const platform = process.platform;
    try {
      if (platform === 'win32') {
        spawnSync('start', [url], { shell: true, stdio: 'ignore' });
      } else if (platform === 'darwin') {
        spawnSync('open', [url], { stdio: 'ignore' });
      } else {
        spawnSync('xdg-open', [url], { stdio: 'ignore' });
      }
    } catch {
      console.error('[launch] WARN  could not open the browser automatically.');
    }
  } else {
    console.log('[launch] --no-open: browser open skipped.');
  }
  console.log(`[launch] Open ${url} manually if the browser did not open.`);

  // 7. Keep the process alive; SIGINT/SIGTERM shutdown is handled by the
  //    runtime boundary (LPA-D09, idempotent). This await never resolves until
  //    the process receives a signal.
  await new Promise<void>(() => {});
};

void main().catch((error) => {
  console.error('[launch] UNEXPECTED', error);
  process.exit(1);
});
