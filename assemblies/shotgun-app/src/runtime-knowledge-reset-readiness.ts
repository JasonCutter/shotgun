import type { Client } from 'pg';

/** A crashed or paused reset keeps all product runtimes stopped for recovery. */
export const assertNoUnresolvedProjectKnowledgeReset = async (
  client: Pick<Client, 'query'>,
): Promise<void> => {
  const control = await client.query<{ available: boolean }>(
    `SELECT to_regclass('project_admin.project_knowledge_epoch') IS NOT NULL AS available`,
  );
  if (!control.rows[0]?.available) return;

  const unresolved = await client.query(
    `SELECT 1
     FROM project_admin.project_knowledge_epoch
     WHERE state <> 'READY'
     LIMIT 1`,
  );
  if ((unresolved.rowCount ?? 0) > 0) {
    throw new Error(
      'Shotgun runtime cannot start while Project Source knowledge reset requires maintenance recovery.',
    );
  }
};
