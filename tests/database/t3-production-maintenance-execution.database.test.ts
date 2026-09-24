import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresKnowledgeResetExecutorPersistence } from '../../adapters/source-knowledge-reset-postgres/src/execution-persistence.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { PostgresKnowledgeResetMaintenanceBoundary } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import { PostgresKnowledgeResetPersistence } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { startShotgunApplication } from '../../assemblies/shotgun-app/src/application.js';
import { createKnowledgeResetCoordinator } from '../../modules/source-knowledge-reset/src/index.js';
import {
  runLaunch,
  type LaunchDeps,
  type ShotgunLaunchOptions,
} from '../../scripts/launch-core.js';
import {
  initializeSourceErasureJournal,
  readSourceErasureJournal,
  type SourceErasureJournalConfig,
} from '../../scripts/source-erasure-journal.js';
import { recoverSourceKnowledgeResetsBeforeRuntime } from '../../scripts/t3-launch-recovery.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const reserveLoopbackPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('A loopback test port was not assigned.');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
};

describe('T3 production maintenance execution', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let runtimePool: Pool;
  let executorPool: Pool;
  let runtimePassword: string;
  let executorPassword: string;
  let journalRoot: string;
  let backupRoot: string;
  let temporaryRoot: string;
  let journal: SourceErasureJournalConfig;
  const launchedRuntimes: Array<Awaited<ReturnType<typeof runLaunch>>> = [];

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    runtimePassword = randomUUID();
    executorPassword = randomUUID();
    await adminPool.query(`ALTER ROLE shotgun_runtime LOGIN PASSWORD ${literal(runtimePassword)}`);
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(executorPassword)}`,
    );
    const runtimeUrl = new URL(database.databaseUrl);
    runtimeUrl.username = 'shotgun_runtime';
    runtimeUrl.password = runtimePassword;
    runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 3 });
    const executorUrl = new URL(database.databaseUrl);
    executorUrl.username = 'shotgun_erasure_executor';
    executorUrl.password = executorPassword;
    executorPool = new Pool({ connectionString: executorUrl.toString(), max: 3 });
    await Promise.all([runtimePool.query('SELECT 1'), executorPool.query('SELECT 1')]);

    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-maintenance-'));
    journalRoot = path.join(temporaryRoot, 'journal');
    backupRoot = path.join(temporaryRoot, 'backups');
    await mkdir(backupRoot, { recursive: true });
    journal = { root: journalRoot, hmacKey: randomUUID() + randomUUID() };
    await initializeSourceErasureJournal(journal, backupRoot);
  });

  afterAll(async () => {
    await Promise.all(launchedRuntimes.splice(0).map((runtime) => runtime.close().catch(() => {})));
    await executorPool?.end();
    await runtimePool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await adminPool?.query('ALTER ROLE shotgun_runtime NOLOGIN PASSWORD NULL');
    await database?.dispose();
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  });

  it('recovers a killed 25-owner run and executes approved resets before launcher startup', async () => {
    const projectId = `t3-maintenance-${randomUUID()}`;
    const principalId = randomUUID();
    const requestId = randomUUID();
    const previewId = randomUUID();
    const now = new Date();
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 maintenance integration fixture', 'ACTIVE', true)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at)
       VALUES ($1, 'user', 'active', $2, $3)`,
      [principalId, `t3-${principalId}@example.test`, now],
    );
    await adminPool.query(
      `INSERT INTO auth.project_memberships (
         principal_id, project_id, scopes, sensitivity_clearance, is_owner
       ) VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
      [principalId, projectId],
    );
    await adminPool.query(
      `INSERT INTO settings.project_settings (project_id, key, value, category)
       VALUES ($1, 'locale', '"ko-KR"'::jsonb, 'general')`,
      [projectId],
    );

    const runtimePersistence = new PostgresKnowledgeResetPersistence(runtimePool);
    const impactInspector = new PostgresKnowledgeResetImpactInspector(runtimePool, true);
    const preservedConfigurationDigest =
      await runtimePersistence.fingerprintPreservedProjectConfiguration(projectId);
    const requestIds = [previewId, requestId];
    const coordinator = createKnowledgeResetCoordinator({
      projectState: runtimePersistence,
      requests: runtimePersistence,
      configurationFingerprint: runtimePersistence,
      impact: impactInspector,
      id: () => requestIds.shift() ?? randomUUID(),
    });
    const preview = await coordinator.preview({ projectId, actorPrincipalId: principalId });
    expect(preview.blockers).toEqual([]);
    const approval = await coordinator.confirm({
      projectId,
      actorPrincipalId: principalId,
      confirmation: {
        previewId: preview.previewId,
        manifestDigest: preview.manifestDigest,
        expectedProjectRevision: preview.projectRevision,
        expectedKnowledgeEpoch: preview.knowledgeEpoch,
        idempotencyKey: randomUUID(),
        confirmIrreversibleReset: true,
      },
    });
    expect(approval.request.requestId).toBe(requestId);
    expect(approval.request.ownerManifestDigest).toBeTruthy();

    // A real child process commits the first owner purge, then waits while it
    // still holds the exclusive maintenance lock. Kill it before the runner
    // can checkpoint the owner so the following CLI proves crash recovery.
    const cliRuntimeUrl = new URL(database.databaseUrl);
    cliRuntimeUrl.username = 'shotgun_runtime';
    cliRuntimeUrl.password = runtimePassword;
    const cliExecutorUrl = new URL(database.databaseUrl);
    cliExecutorUrl.username = 'shotgun_erasure_executor';
    cliExecutorUrl.password = executorPassword;
    let crashMarkerSeen = false;
    let crashKillIssued = false;
    let crashWorkerTimedOut = false;
    const crashWorker = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.resolve('node_modules/tsx/dist/cli.mjs'),
          path.resolve('tests/helpers/t3-reset-crash-worker.ts'),
          projectId,
          requestId,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: cliRuntimeUrl.toString(),
            SHOTGUN_ERASURE_EXECUTOR_DATABASE_URL: cliExecutorUrl.toString(),
            SHOTGUN_ERASURE_JOURNAL_ROOT: journal.root,
            SHOTGUN_ERASURE_JOURNAL_HMAC_KEY: journal.hmacKey,
            SHOTGUN_BACKUP_ROOT: backupRoot,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        crashWorkerTimedOut = true;
        if (!child.killed) child.kill('SIGKILL');
      }, 30_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.includes('T3_OWNER_COMMIT:external-action') && !crashKillIssued) {
          crashMarkerSeen = true;
          crashKillIssued = child.kill('SIGKILL');
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (exitCode, signal) => {
        clearTimeout(timeout);
        resolve({ exitCode, signal, stdout, stderr });
      });
    });
    expect(crashWorkerTimedOut, crashWorker.stderr).toBe(false);
    expect(crashMarkerSeen, crashWorker.stderr).toBe(true);
    expect(crashKillIssued, crashWorker.stderr).toBe(true);
    expect(crashWorker.exitCode, `${crashWorker.stdout}\n${crashWorker.stderr}`).not.toBe(0);
    const executionPersistence = new PostgresKnowledgeResetExecutorPersistence(executorPool);
    const crashedSnapshot = await executionPersistence.readForExecution({ projectId, requestId });
    expect(crashedSnapshot?.request.state).toBe('PURGING');
    expect(crashedSnapshot?.completedSteps).toContain('fence:external-action');
    expect(crashedSnapshot?.completedSteps).not.toContain('purge:external-action');

    // The production CLI resumes the same durable request after the killed
    // process loses its advisory lock and the owner purge remains uncheckpointed.
    const cli = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.resolve('node_modules/tsx/dist/cli.mjs'),
          path.resolve('scripts/t3-source-knowledge-reset.ts'),
          'execute',
          '--project-id',
          projectId,
          '--request-id',
          requestId,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: cliRuntimeUrl.toString(),
            SHOTGUN_ERASURE_EXECUTOR_DATABASE_URL: cliExecutorUrl.toString(),
            SHOTGUN_ERASURE_JOURNAL_ROOT: journal.root,
            SHOTGUN_ERASURE_JOURNAL_HMAC_KEY: journal.hmacKey,
            SHOTGUN_BACKUP_ROOT: backupRoot,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.once('error', reject);
      child.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
    expect(cli.exitCode, `${cli.stdout}\n${cli.stderr}`).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ status: 'COMPLETE', projectId, requestId });
    const completed = await runtimePersistence.findById(projectId, requestId);
    if (!completed) throw new Error('Restarted T3 maintenance request was not persisted.');
    expect(completed).toMatchObject({
      projectId,
      requestId,
      state: 'COMPLETE',
      knowledgeEpoch: 1,
    });
    expect(await runtimePersistence.fingerprintPreservedProjectConfiguration(projectId)).toBe(
      preservedConfigurationDigest,
    );
    await expect(runtimePersistence.readResetActorPrincipalId(projectId, requestId)).resolves.toBe(
      principalId,
    );
    await expect(
      adminPool.query<{ name: string }>('SELECT name FROM project_admin.projects WHERE id = $1', [
        projectId,
      ]),
    ).resolves.toMatchObject({ rows: [{ name: 'T3 maintenance integration fixture' }] });
    const historyPublication = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM frontend_history.history_projection_index
       WHERE resource_project_id = $1 AND source_event_kind = 'CANONICAL_KNOWLEDGE_RESET'`,
      [projectId],
    );
    expect(Number(historyPublication.rows[0]?.count)).toBe(1);
    const journalRecords = await readSourceErasureJournal(journal);
    expect(
      journalRecords.filter((record) => record.requestId === requestId).map((r) => r.phase),
    ).toEqual(['PREPARED', 'VERIFIED']);

    const launchProjectId = `t3-launch-recovery-${randomUUID()}`;
    const launchPrincipalId = randomUUID();
    const launchNow = new Date();
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'T3 launcher recovery fixture', 'ACTIVE', true)`,
      [launchProjectId],
    );
    await adminPool.query(
      `INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at)
       VALUES ($1, 'user', 'active', $2, $3)`,
      [launchPrincipalId, `t3-${launchPrincipalId}@example.test`, launchNow],
    );
    await adminPool.query(
      `INSERT INTO auth.project_memberships (
         principal_id, project_id, scopes, sensitivity_clearance, is_owner
       ) VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
      [launchPrincipalId, launchProjectId],
    );
    await adminPool.query(
      `INSERT INTO settings.project_settings (project_id, key, value, category)
       VALUES ($1, 'locale', '"ko-KR"'::jsonb, 'general')`,
      [launchProjectId],
    );
    const launcherEnvironment = {
      ...process.env,
      DATABASE_URL: cliRuntimeUrl.toString(),
      NODE_ENV: 'development',
      SHOTGUN_DEVELOPMENT_AUTH: 'true',
      SHOTGUN_ERASURE_EXECUTOR_DATABASE_URL: cliExecutorUrl.toString(),
      SHOTGUN_ERASURE_JOURNAL_ROOT: journal.root,
      SHOTGUN_ERASURE_JOURNAL_HMAC_KEY: journal.hmacKey,
      SHOTGUN_BACKUP_ROOT: backupRoot,
    };
    const launcherSpaDirectory = path.join(temporaryRoot, 'launcher-spa');
    const launcherAssetRoot = path.join(temporaryRoot, 'launcher-assets');
    await mkdir(launcherSpaDirectory, { recursive: true });
    await writeFile(
      path.join(launcherSpaDirectory, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf8',
    );
    const launcherPort = await reserveLoopbackPort();
    const launcherHost = '127.0.0.1';
    const launcherStagingSecret = randomUUID() + randomUUID();
    let requestStateAtRuntimeStart: string | undefined;
    const launchRuntime = async (
      beforeApplicationStart?: ShotgunLaunchOptions['beforeApplicationStart'],
      expectedCompleteRequestId?: string,
    ) => {
      const options: ShotgunLaunchOptions = {
        noOpen: true,
        databaseUrl: cliRuntimeUrl.toString(),
        stagingSecret: launcherStagingSecret,
        port: launcherPort,
        host: launcherHost,
        spaDirectory: launcherSpaDirectory,
        rootDirectory: process.cwd(),
        env: launcherEnvironment,
        environmentProfile: 'runtime-development',
        ...(beforeApplicationStart ? { beforeApplicationStart } : {}),
      };
      const dependencies: LaunchDeps = {
        log: () => {},
        warn: () => {},
        buildSpa: () => {},
        async probeDatabase() {
          await runtimePool.query('SELECT 1');
        },
        verifyDatabaseSchema: () => {},
        async startApplication(applicationOptions) {
          if (expectedCompleteRequestId) {
            const request = await runtimePersistence.findById(
              launchProjectId,
              expectedCompleteRequestId,
            );
            requestStateAtRuntimeStart = request?.state;
            if (requestStateAtRuntimeStart !== 'COMPLETE') {
              throw new Error('Runtime startup ran before T3 reset verification completed.');
            }
          }
          return startShotgunApplication({
            ...applicationOptions,
            databaseUrl: cliRuntimeUrl.toString(),
            assetRoot: launcherAssetRoot,
          });
        },
        async fetchReadiness(url, timeoutMs) {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            try {
              const health = await fetch(`${url}/health`);
              const root = await fetch(url);
              if (health.ok && root.ok && (await root.text()).includes('<div id="root">')) {
                return true;
              }
            } catch {
              // Retry until the production launch readiness deadline.
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        },
        openBrowser: () => ({ ok: true }),
      };
      const runtime = await runLaunch(options, dependencies);
      launchedRuntimes.push(runtime);
      return runtime;
    };

    // The owner UI confirms while the real production runtime holds its
    // shared maintenance lock. Reset must wait until that runtime drains.
    const activeRuntime = await launchRuntime();
    expect(activeRuntime).toBeDefined();
    const launcherRequestIds = [randomUUID(), randomUUID()];
    const launcherCoordinator = createKnowledgeResetCoordinator({
      projectState: runtimePersistence,
      requests: runtimePersistence,
      configurationFingerprint: runtimePersistence,
      impact: impactInspector,
      id: () => launcherRequestIds.shift() ?? randomUUID(),
    });
    const launcherPreview = await launcherCoordinator.preview({
      projectId: launchProjectId,
      actorPrincipalId: launchPrincipalId,
    });
    expect(launcherPreview.blockers).toEqual([]);
    const launcherApproval = await launcherCoordinator.confirm({
      projectId: launchProjectId,
      actorPrincipalId: launchPrincipalId,
      confirmation: {
        previewId: launcherPreview.previewId,
        manifestDigest: launcherPreview.manifestDigest,
        expectedProjectRevision: launcherPreview.projectRevision,
        expectedKnowledgeEpoch: launcherPreview.knowledgeEpoch,
        idempotencyKey: randomUUID(),
        confirmIrreversibleReset: true,
      },
    });
    const maintenanceBoundary = new PostgresKnowledgeResetMaintenanceBoundary(executorPool);
    await expect(
      maintenanceBoundary.withExclusiveMaintenanceLock(async () => 'unsafe'),
    ).rejects.toMatchObject({
      blockerCode: 'RESET_IN_PROGRESS',
    });
    await activeRuntime.close();
    await expect(
      maintenanceBoundary.withExclusiveMaintenanceLock(async () => 'runtime stopped'),
    ).resolves.toBe('runtime stopped');

    const recoveryLogs: string[] = [];
    let recoveredBeforeLaunch: Awaited<
      ReturnType<typeof recoverSourceKnowledgeResetsBeforeRuntime>
    > = [];
    const restartedRuntime = await launchRuntime(
      async ({ databaseUrl, rootDirectory, environment }) => {
        recoveredBeforeLaunch = await recoverSourceKnowledgeResetsBeforeRuntime({
          databaseUrl,
          rootDirectory,
          environment,
          log: (message) => recoveryLogs.push(message),
        });
      },
      launcherApproval.request.requestId,
    );
    expect(recoveredBeforeLaunch).toMatchObject([
      {
        projectId: launchProjectId,
        requestId: launcherApproval.request.requestId,
        requestState: 'APPROVED',
        epoch: 1,
        epochState: 'RESET_PENDING',
      },
    ]);
    expect(recoveryLogs).toHaveLength(1);
    expect(requestStateAtRuntimeStart).toBe('COMPLETE');
    await expect(
      maintenanceBoundary.withExclusiveMaintenanceLock(async () => 'unsafe'),
    ).rejects.toMatchObject({ blockerCode: 'RESET_IN_PROGRESS' });
    await restartedRuntime.close();
    await expect(
      maintenanceBoundary.withExclusiveMaintenanceLock(async () => 'runtime stopped'),
    ).resolves.toBe('runtime stopped');
    await expect(
      runtimePersistence.findById(launchProjectId, launcherApproval.request.requestId),
    ).resolves.toMatchObject({ state: 'COMPLETE' });
    const unresolvedEpochs = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM project_admin.project_knowledge_epoch
       WHERE state <> 'READY'`,
    );
    expect(unresolvedEpochs.rows[0]?.count).toBe('0');
    const allJournalRecords = await readSourceErasureJournal(journal);
    expect(
      allJournalRecords
        .filter((record) => record.requestId === launcherApproval.request.requestId)
        .map((record) => record.phase),
    ).toEqual(['PREPARED', 'VERIFIED']);
  }, 60_000);
});
