import os from 'node:os';
import path from 'node:path';

import { Pool } from 'pg';

import { composePostgresKnowledgeResetOwners } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-composition.js';
import { PostgresKnowledgeResetExecutorPersistence } from '../../adapters/source-knowledge-reset-postgres/src/execution-persistence.js';
import { PostgresKnowledgeResetMaintenanceBoundary } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { PostgresKnowledgeResetPersistence } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createPostgresKnowledgeResetProductionRebuilders } from '../../adapters/source-knowledge-reset-postgres/src/production-rebuilders.js';
import { createKnowledgeResetMaintenanceExecutor } from '../../modules/source-knowledge-reset/src/index.js';
import {
  appendSourceErasureJournalRecord,
  sourceErasureJournalConfigFromEnvironment,
} from '../../scripts/source-erasure-journal.js';

const [projectId, requestId] = process.argv.slice(2);
if (!projectId || !requestId) throw new Error('Project and request IDs are required.');

const runtimeUrl = process.env.DATABASE_URL?.trim();
const executorUrl = process.env.SHOTGUN_ERASURE_EXECUTOR_DATABASE_URL?.trim();
const journal = sourceErasureJournalConfigFromEnvironment(process.env);
if (!runtimeUrl || !executorUrl || runtimeUrl === executorUrl || !journal) {
  throw new Error('Isolated runtime, executor, and journal configuration are required.');
}

const backupRoot = path.resolve(
  process.env.SHOTGUN_BACKUP_ROOT?.trim() || path.join(os.homedir(), 'Shotgun Backups'),
);
const runtimePool = new Pool({
  connectionString: runtimeUrl,
  application_name: `shotgun-t3-reset-crash-runtime:${process.pid}`,
  max: 4,
});
const executorPool = new Pool({
  connectionString: executorUrl,
  application_name: `shotgun-t3-reset-crash-executor:${process.pid}`,
  max: 4,
});

try {
  const persistentState = new PostgresKnowledgeResetPersistence(runtimePool);
  const impactInspector = new PostgresKnowledgeResetImpactInspector(runtimePool, true);
  const rebuilders = createPostgresKnowledgeResetProductionRebuilders({
    runtimePool,
    executorPool,
  });
  const owners = composePostgresKnowledgeResetOwners(executorPool, rebuilders).map((owner) => ({
    ...owner,
    async fence(context: Parameters<typeof owner.fence>[0]) {
      if (owner.ownerId === 'external-action') {
        const authorization = await runtimePool.query<{
          request_state: string;
          epoch_state: string;
          owner_manifest_digest: string | null;
        }>(
          `SELECT request.state AS request_state,
                    epoch.state AS epoch_state,
                    request.owner_manifest_digest
               FROM project_admin.project_knowledge_reset_requests AS request
               JOIN project_admin.project_knowledge_epoch AS epoch
                 ON epoch.project_id = request.project_id
                AND epoch.epoch = request.resulting_knowledge_epoch
              WHERE request.project_id = $1 AND request.request_id = $2`,
          [context.projectId, context.requestId],
        );
        const row = authorization.rows[0];
        if (
          row?.request_state !== 'FENCING' ||
          row.epoch_state !== 'RESET_PENDING' ||
          !row.owner_manifest_digest
        ) {
          throw new Error('Approved reset was not durably fenced before owner maintenance.');
        }
      }
      await owner.fence(context);
    },
    async purge(context: Parameters<typeof owner.purge>[0]) {
      await owner.purge(context);
      if (owner.ownerId === 'external-action') {
        // This marker is emitted only after the owner's committed purge has
        // returned. The parent test kills this process while it still holds
        // the advisory lock and before the runner can persist its checkpoint.
        process.stdout.write('T3_OWNER_COMMIT:external-action\n');
        await new Promise<never>(() => {});
      }
    },
  }));
  const executor = createKnowledgeResetMaintenanceExecutor({
    repository: new PostgresKnowledgeResetExecutorPersistence(executorPool),
    maintenance: new PostgresKnowledgeResetMaintenanceBoundary(executorPool),
    owners,
    async inspectApprovedImpact(targetProjectId) {
      return impactInspector.inspectProjectSourceKnowledge(targetProjectId);
    },
    fingerprintPreservedConfiguration(targetProjectId) {
      return persistentState.fingerprintPreservedProjectConfiguration(targetProjectId);
    },
    async appendJournal(record) {
      await appendSourceErasureJournalRecord({ config: journal, backupRoot, ...record });
    },
  });
  await executor.execute({ projectId, requestId });
  throw new Error('Crash worker unexpectedly completed before the owner commit marker.');
} finally {
  await Promise.all([runtimePool.end(), executorPool.end()]);
}
