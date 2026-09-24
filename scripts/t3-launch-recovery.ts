import { spawn } from 'node:child_process';
import path from 'node:path';

import { Pool } from 'pg';

export type PendingSourceKnowledgeReset = Readonly<{
  projectId: string;
  requestId: string;
  requestState: string;
  epoch: number;
  epochState: string;
}>;

export type SourceKnowledgeResetRecoveryRepository = Readonly<{
  listUnresolved(): Promise<readonly PendingSourceKnowledgeReset[]>;
}>;

export const recoverPendingSourceKnowledgeResets = async (
  repository: SourceKnowledgeResetRecoveryRepository,
  execute: (request: PendingSourceKnowledgeReset) => Promise<void>,
): Promise<readonly PendingSourceKnowledgeReset[]> => {
  const pending = await repository.listUnresolved();
  if (pending.length === 0) return [];

  const recoverableRequestStates = new Set([
    'APPROVED',
    'FENCING',
    'PURGING',
    'REBUILDING',
    'VERIFYING',
    'BLOCKED',
    'OUTCOME_UNKNOWN',
    'ERASURE_UNVERIFIED',
  ]);
  const projects = new Set<string>();
  for (const request of pending) {
    if (
      !request.projectId ||
      !request.requestId ||
      !Number.isSafeInteger(request.epoch) ||
      request.epoch < 1 ||
      !['RESET_PENDING', 'RESET_UNVERIFIED'].includes(request.epochState) ||
      !recoverableRequestStates.has(request.requestState) ||
      projects.has(request.projectId)
    ) {
      throw new Error('T3 launch recovery found an invalid unresolved Project epoch.');
    }
    projects.add(request.projectId);
  }

  for (const request of pending) await execute(request);

  const remaining = await repository.listUnresolved();
  if (remaining.length > 0) {
    throw new Error(
      'T3 launch recovery did not verify every Project reset; Shotgun runtime startup is blocked.',
    );
  }
  return pending;
};

const listUnresolvedFromPostgres = async (
  pool: Pool,
): Promise<readonly PendingSourceKnowledgeReset[]> => {
  const available = await pool.query<{ available: boolean }>(
    `SELECT to_regclass('project_admin.project_knowledge_epoch') IS NOT NULL AS available`,
  );
  if (!available.rows[0]?.available) return [];

  const result = await pool.query<{
    project_id: string;
    request_id: string | null;
    request_state: string | null;
    epoch: string;
    epoch_state: string;
  }>(
    `SELECT epoch.project_id,
            request.request_id::text AS request_id,
            request.state AS request_state,
            epoch.epoch::text AS epoch,
            epoch.state AS epoch_state
       FROM project_admin.project_knowledge_epoch AS epoch
       FULL OUTER JOIN project_admin.project_knowledge_reset_requests AS request
         ON request.project_id = epoch.project_id
        AND request.resulting_knowledge_epoch = epoch.epoch
      WHERE (epoch.project_id IS NOT NULL AND epoch.state <> 'READY')
         OR (request.request_id IS NOT NULL AND request.state <> 'COMPLETE')
      ORDER BY COALESCE(epoch.project_id, request.project_id)`,
  );
  return result.rows.map((row) => ({
    projectId: row.project_id,
    requestId: row.request_id ?? '',
    requestState: row.request_state ?? '',
    epoch: Number(row.epoch),
    epochState: row.epoch_state,
  }));
};

export const executeT3ResetCli = (input: {
  rootDirectory: string;
  environment: NodeJS.ProcessEnv;
  projectId: string;
  requestId: string;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(input.rootDirectory, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(input.rootDirectory, 'scripts', 't3-source-knowledge-reset.ts'),
        'execute',
        '--project-id',
        input.projectId,
        '--request-id',
        input.requestId,
      ],
      {
        cwd: input.rootDirectory,
        env: input.environment,
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `T3 maintenance process failed before runtime startup (exit=${code ?? 'null'}, signal=${signal ?? 'none'}).`,
          ),
        );
      }
    });
  });

/** Run before opening the runtime's shared ADR-170 maintenance lock. */
export const recoverSourceKnowledgeResetsBeforeRuntime = async (input: {
  databaseUrl: string;
  rootDirectory: string;
  environment: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}): Promise<readonly PendingSourceKnowledgeReset[]> => {
  const pool = new Pool({
    connectionString: input.databaseUrl,
    application_name: `shotgun-t3-launch-preflight:${process.pid}`,
    max: 1,
  });
  try {
    const recovered = await recoverPendingSourceKnowledgeResets(
      { listUnresolved: () => listUnresolvedFromPostgres(pool) },
      async (request) => {
        input.log?.('[launch] Recovering an approved Project Source reset before runtime startup.');
        await executeT3ResetCli({
          rootDirectory: input.rootDirectory,
          environment: input.environment,
          projectId: request.projectId,
          requestId: request.requestId,
        });
      },
    );
    return recovered;
  } finally {
    await pool.end();
  }
};
