/**
 * LPA-WP4 Correction Round 1 (C1/C2) — launch orchestration as a bounded,
 * dependency-injected helper so the Frozen launch contract can be verified
 * deterministically with fakes (Frozen IR §12 / GPT C1, C3-A/B).
 *
 * Responsibilities (Frozen D01~D13):
 *   1. environment pre-check            → ENV_CONFIGURATION_INVALID
 *   2. SPA build (never `npm ci`)       → SPA_BUILD_FAILED
 *   3. built SPA assets presence        → SPA_ASSETS_UNAVAILABLE
 *   4. non-destructive DB preflight     → DATABASE_UNAVAILABLE / DATABASE_SCHEMA_INVALID
 *   5. in-process application start     → PORT_UNAVAILABLE / BACKEND_START_FAILED
 *   6. readiness (/health + SPA HTML)   → READINESS_TIMEOUT
 *   7. browser open (non-fatal)         → warning only
 *
 * This module NEVER calls `process.exit` (C2): failures after the application
 * handle is created are closed gracefully (exactly once) and rethrown as
 * `LaunchFailure`; the owner entry performs the final exit boundary.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type LaunchFailureCode =
  | 'ENV_CONFIGURATION_INVALID'
  | 'DATABASE_UNAVAILABLE'
  | 'DATABASE_SCHEMA_INVALID'
  | 'PORT_UNAVAILABLE'
  | 'SPA_BUILD_FAILED'
  | 'SPA_ASSETS_UNAVAILABLE'
  | 'BACKEND_START_FAILED'
  | 'READINESS_TIMEOUT';

export class LaunchFailure extends Error {
  constructor(
    readonly code: LaunchFailureCode,
    message: string,
    readonly check: string,
    readonly command: string,
  ) {
    super(message);
    this.name = 'LaunchFailure';
  }
}

export interface ShotgunLaunchOptions {
  readonly noOpen: boolean;
  readonly databaseUrl: string;
  readonly stagingSecret: string;
  readonly geminiApiKey: string;
  readonly port: number;
  readonly host: string;
  readonly spaDirectory: string;
  readonly rootDirectory: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface ApplicationHandleLike {
  listen(): Promise<void>;
  close(): Promise<void>;
}

export type BrowserOpenResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'spawn-error' | 'non-zero' | 'signal' };

export type SpawnLikeResult = {
  readonly error?: Error;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
};

/**
 * C1: classify a spawned browser command result. `spawnSync` does NOT throw on
 * spawn failure — it returns `error` — and non-zero/signal results are not
 * exceptions either. Every failure mode must be detected explicitly.
 */
export const classifyBrowserSpawn = (result: SpawnLikeResult): BrowserOpenResult => {
  if (result.error) return { ok: false, reason: 'spawn-error' };
  if (result.signal) return { ok: false, reason: 'signal' };
  if (result.status !== 0) return { ok: false, reason: 'non-zero' };
  return { ok: true };
};

export interface LaunchDeps {
  log(message: string): void;
  warn(message: string): void;
  buildSpa(cwd: string, env: NodeJS.ProcessEnv): void;
  probeDatabase(connectionString: string): Promise<void>;
  verifyDatabaseSchema(cwd: string, env: NodeJS.ProcessEnv): void;
  startApplication(options: {
    host: string;
    port: number;
    spaDirectory: string;
  }): Promise<ApplicationHandleLike>;
  fetchReadiness(url: string, timeoutMs: number): Promise<boolean>;
  openBrowser(platform: NodeJS.Platform, url: string): BrowserOpenResult;
}

/**
 * Real browser opener (D11). Detects actual failure instead of ignoring the
 * spawn result (C1): spawn error, non-zero status and signal termination are
 * all reported; the caller treats them as non-fatal warnings.
 */
export const openBrowser = (platform: NodeJS.Platform, url: string): BrowserOpenResult => {
  try {
    let result: SpawnSyncReturns<Buffer>;
    if (platform === 'win32') {
      // `shell: true` with a single command string (no args array) avoids
      // Node DEP0190 (args + shell concatenation warning).
      result = spawnSync(`start "" "${url}"`, { shell: true, stdio: 'ignore' });
    } else if (platform === 'darwin') {
      result = spawnSync('open', [url], { stdio: 'ignore' });
    } else {
      result = spawnSync('xdg-open', [url], { stdio: 'ignore' });
    }
    return classifyBrowserSpawn(result);
  } catch {
    return { ok: false, reason: 'spawn-error' };
  }
};

const READINESS_TIMEOUT_MS = 30_000;

/**
 * Runs the canonical owner launch sequence. Throws `LaunchFailure` for every
 * Frozen taxonomy category. When the application handle has already been
 * created, startup failures close it exactly once before throwing (C2).
 * Returns the running handle on success (caller keeps the process alive).
 */
export const runLaunch = async (
  options: ShotgunLaunchOptions,
  deps: LaunchDeps,
): Promise<ApplicationHandleLike> => {
  const {
    noOpen,
    databaseUrl,
    stagingSecret,
    geminiApiKey,
    port,
    host,
    spaDirectory,
    rootDirectory,
    env,
  } = options;

  // 1. Environment pre-check (D12 ENV_CONFIGURATION_INVALID).
  const missing = [
    databaseUrl ? undefined : 'DATABASE_URL',
    !stagingSecret || stagingSecret.trim().length < 32 ? 'SOURCES_STAGING_SECRET' : undefined,
    geminiApiKey ? undefined : 'GEMINI_API_KEY',
  ].filter((value): value is string => value !== undefined);
  if (missing.length > 0) {
    throw new LaunchFailure(
      'ENV_CONFIGURATION_INVALID',
      `Required environment variable(s) missing: ${missing.join(', ')}.`,
      'Copy `.env.example` to `.env` and fill the required values.',
      'Copy-Item .env.example .env',
    );
  }

  const url = `http://${host}:${port}`;

  // 2. SPA build (D06) — never `npm ci` / dependency install / `db:reset`.
  deps.log('[launch] START spa-build: npm run frontend:build');
  try {
    deps.buildSpa(rootDirectory, env);
    deps.log('[launch] PASS  spa-build');
  } catch {
    throw new LaunchFailure(
      'SPA_BUILD_FAILED',
      'The SPA build (npm run frontend:build) failed.',
      'Confirm Node/npm and the @shotgun/web workspace are healthy.',
      'npm run frontend:build',
    );
  }
  const indexHtml = path.join(spaDirectory, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new LaunchFailure(
      'SPA_ASSETS_UNAVAILABLE',
      `Built SPA index is missing at ${indexHtml}.`,
      'Confirm the frontend build produced `apps/shotgun-web/dist/index.html`.',
      'npm run frontend:build',
    );
  }

  // 3. Database verification (D07) — non-destructive only.
  try {
    await deps.probeDatabase(databaseUrl);
  } catch {
    throw new LaunchFailure(
      'DATABASE_UNAVAILABLE',
      'PostgreSQL is not reachable.',
      'Start the DB container (or your local PostgreSQL) and retry.',
      'docker compose up -d --wait db',
    );
  }
  deps.log('[launch] START database-verify (npm run db:verify)');
  try {
    deps.verifyDatabaseSchema(rootDirectory, env);
    deps.log('[launch] PASS  database-verify');
  } catch {
    throw new LaunchFailure(
      'DATABASE_SCHEMA_INVALID',
      'The database schema is not aligned with the migrations.',
      'Run the migrations then verify the schema.',
      'npm run db:migrate; npm run db:verify',
    );
  }

  // 4. Start the canonical production composition in-process, same origin
  //    (D02/D03/D04/D08). C2: any failure AFTER the handle is created must
  //    close it gracefully exactly once before reporting.
  let application: ApplicationHandleLike | undefined;
  try {
    application = await deps.startApplication({ host, port, spaDirectory });
    await application.listen();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (application) {
      await application.close().catch(() => {});
    }
    if (code === 'EADDRINUSE') {
      throw new LaunchFailure(
        'PORT_UNAVAILABLE',
        `Port ${port} is already in use.`,
        'Stop the process occupying the port or choose another PORT.',
        `Set PORT=3001 (or another free port) and run npm run launch again.`,
      );
    }
    throw new LaunchFailure(
      'BACKEND_START_FAILED',
      'The Shotgun backend failed to start.',
      'Check the error above and your `.env` configuration.',
      'npm run start',
    );
  }
  if (!application) {
    throw new Error('unreachable: backend start failure was not classified.');
  }

  // 5. Readiness (D10): backend /health + SPA HTML on `/`.
  const ready = await deps.fetchReadiness(url, READINESS_TIMEOUT_MS);
  if (!ready) {
    await application.close();
    throw new LaunchFailure(
      'READINESS_TIMEOUT',
      `Shotgun did not become ready within ${READINESS_TIMEOUT_MS / 1000}s.`,
      'Check backend logs for startup failures.',
      'npm run launch (again) or npm run start',
    );
  }
  deps.log(`[launch] READY Shotgun is running at ${url}`);

  // 6. Browser open (D11) — non-fatal on failure; browser is NEVER opened
  //    before readiness (D10).
  if (!noOpen) {
    const result = deps.openBrowser(process.platform, url);
    if (!result.ok) {
      deps.warn(`[launch] WARN  could not open the browser automatically (${result.reason}).`);
    }
  } else {
    deps.log('[launch] --no-open: browser open skipped.');
  }
  deps.log(`[launch] Open ${url} manually if the browser did not open.`);

  return application;
};
