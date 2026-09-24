import os from 'node:os';
import path from 'node:path';

import 'dotenv/config';
import { Pool } from 'pg';

import { createPostgresKnowledgeResetMaintenanceExecutor } from '../adapters/source-knowledge-reset-postgres/src/maintenance-composition.js';
import { PostgresKnowledgeResetExecutorPersistence } from '../adapters/source-knowledge-reset-postgres/src/execution-persistence.js';
import { PostgresKnowledgeResetMaintenanceBoundary } from '../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import { PostgresKnowledgeResetImpactInspector } from '../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { PostgresKnowledgeResetPersistence } from '../adapters/source-knowledge-reset-postgres/src/index.js';
import { createPostgresKnowledgeResetProductionRebuilders } from '../adapters/source-knowledge-reset-postgres/src/production-rebuilders.js';
import {
  appendSourceErasureJournalRecord,
  sourceErasureJournalConfigFromEnvironment,
} from './source-erasure-journal.js';

const USAGE =
  'Usage: npm run t3:reset -- execute --project-id <project-id> --request-id <approved-request-uuid>';

type ExecuteArguments = Readonly<{ projectId: string; requestId: string }>;

const parseExecuteArguments = (arguments_: readonly string[]): ExecuteArguments => {
  if (arguments_[0] !== 'execute') throw new Error(USAGE);
  const values = new Map<string, string>();
  for (let index = 1; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (
      (key !== '--project-id' && key !== '--request-id') ||
      !value ||
      value.startsWith('--') ||
      values.has(key)
    ) {
      throw new Error(USAGE);
    }
    values.set(key, value);
  }
  const projectId = values.get('--project-id');
  const requestId = values.get('--request-id');
  if (
    !projectId ||
    !requestId ||
    values.size !== 2 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)
  ) {
    throw new Error(USAGE);
  }
  return { projectId, requestId };
};

const assertRuntimeIdentity = async (pool: Pool): Promise<void> => {
  const result = await pool.query<{
    session_role: string;
    current_role: string;
    is_superuser: boolean;
    can_create_role: boolean;
    can_create_database: boolean;
    can_bypass_rls: boolean;
    can_replicate: boolean;
    can_execute_reset_control: boolean;
    can_read_canonical_reset_snapshot: boolean;
  }>(
    `SELECT session_user::text AS session_role,
            current_user::text AS current_role,
            role.rolsuper AS is_superuser,
            role.rolcreaterole AS can_create_role,
            role.rolcreatedb AS can_create_database,
            role.rolbypassrls AS can_bypass_rls,
            role.rolreplication AS can_replicate,
            has_function_privilege(
              session_user,
              'project_admin.t3_set_reset_execution_state(text,uuid,text,text[])',
              'EXECUTE'
            ) AS can_execute_reset_control,
            has_table_privilege(
              session_user,
              'canonical.t3_reset_owner_snapshots',
              'SELECT'
            ) AS can_read_canonical_reset_snapshot
       FROM pg_roles AS role
      WHERE role.rolname = session_user`,
  );
  const identity = result.rows[0];
  if (
    !identity ||
    identity.session_role !== 'shotgun_runtime' ||
    identity.current_role !== 'shotgun_runtime' ||
    identity.is_superuser ||
    identity.can_create_role ||
    identity.can_create_database ||
    identity.can_bypass_rls ||
    identity.can_replicate ||
    identity.can_execute_reset_control ||
    identity.can_read_canonical_reset_snapshot
  ) {
    throw new Error('DATABASE_URL must use the dedicated, non-superuser shotgun_runtime role.');
  }
};

export const executeSourceKnowledgeReset = async (
  input: ExecuteArguments,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const runtimeUrl = environment.DATABASE_URL?.trim();
  const executorUrl = environment.SHOTGUN_ERASURE_EXECUTOR_DATABASE_URL?.trim();
  if (!runtimeUrl || !executorUrl || runtimeUrl === executorUrl) {
    throw new Error(
      'DATABASE_URL and a separate SHOTGUN_ERASURE_EXECUTOR_DATABASE_URL are required.',
    );
  }
  const journal = sourceErasureJournalConfigFromEnvironment(environment);
  if (!journal) {
    throw new Error(
      'SHOTGUN_ERASURE_JOURNAL_ROOT and SHOTGUN_ERASURE_JOURNAL_HMAC_KEY are required.',
    );
  }
  const backupRoot = path.resolve(
    environment.SHOTGUN_BACKUP_ROOT?.trim() || path.join(os.homedir(), 'Shotgun Backups'),
  );
  const runtimePool = new Pool({
    connectionString: runtimeUrl,
    application_name: `shotgun-t3-reset-runtime-read:${process.pid}`,
    max: 4,
  });
  const executorPool = new Pool({
    connectionString: executorUrl,
    application_name: `shotgun-t3-reset-executor:${process.pid}`,
    max: 4,
  });
  try {
    await assertRuntimeIdentity(runtimePool);
    const persistentState = new PostgresKnowledgeResetPersistence(runtimePool);
    const rebuilders = createPostgresKnowledgeResetProductionRebuilders({
      runtimePool,
      executorPool,
    });
    const executor = createPostgresKnowledgeResetMaintenanceExecutor({
      pool: executorPool,
      rebuilders,
      dependencies: {
        repository: new PostgresKnowledgeResetExecutorPersistence(executorPool),
        maintenance: new PostgresKnowledgeResetMaintenanceBoundary(executorPool),
        async inspectApprovedImpact(projectId) {
          return new PostgresKnowledgeResetImpactInspector(
            runtimePool,
            true,
          ).inspectProjectSourceKnowledge(projectId);
        },
        fingerprintPreservedConfiguration(projectId) {
          return persistentState.fingerprintPreservedProjectConfiguration(projectId);
        },
        async appendJournal(record) {
          await appendSourceErasureJournalRecord({
            config: journal,
            backupRoot,
            ...record,
          });
        },
      },
    });
    const request = await executor.execute(input);
    console.log(
      JSON.stringify(
        {
          status: request.state,
          projectId: request.projectId,
          requestId: request.requestId,
          knowledgeEpoch: request.knowledgeEpoch,
          casStatus: request.casStatus,
          backupStatus: request.backupStatus,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all([runtimePool.end(), executorPool.end()]);
  }
};

if (process.argv[1]?.endsWith('t3-source-knowledge-reset.ts')) {
  try {
    await executeSourceKnowledgeReset(parseExecuteArguments(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'T3 maintenance execution failed.';
    console.error(`T3 source knowledge reset failed: ${message}`);
    process.exitCode = 1;
  }
}
