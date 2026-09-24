import type { Pool } from 'pg';

import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../../postgres-maintenance-lock/src/index.js';
import {
  KnowledgeResetExecutionError,
  type KnowledgeResetMaintenanceBoundaryPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

type ExecutorRoleRow = {
  session_role: string;
  current_role: string;
  is_superuser: boolean;
  can_create_database: boolean;
  can_create_role: boolean;
  can_inherit: boolean;
  can_bypass_rls: boolean;
  can_replicate: boolean;
  has_application_data_privileges: boolean;
};

/** Dedicated non-superuser connection and ADR-170 exclusive maintenance lock. */
export class PostgresKnowledgeResetMaintenanceBoundary implements KnowledgeResetMaintenanceBoundaryPort {
  constructor(
    private readonly pool: Pool,
    private readonly expectedExecutorRole = 'shotgun_erasure_executor',
  ) {}

  async assertDedicatedExecutor(): Promise<void> {
    const result = await this.pool.query<ExecutorRoleRow>(
      `SELECT session_user::text AS session_role,
              current_user::text AS current_role,
              role.rolsuper AS is_superuser,
              role.rolcreatedb AS can_create_database,
              role.rolcreaterole AS can_create_role,
              role.rolinherit AS can_inherit,
              role.rolbypassrls AS can_bypass_rls,
              role.rolreplication AS can_replicate,
              EXISTS (
                SELECT 1
                FROM pg_class AS relation
                JOIN pg_namespace AS schema ON schema.oid = relation.relnamespace
                WHERE schema.nspname <> 'information_schema'
                  AND schema.nspname NOT LIKE 'pg_%'
                  AND (
                    (relation.relkind IN ('r', 'p') AND (
                      has_table_privilege(session_user, relation.oid, 'SELECT') OR
                      has_table_privilege(session_user, relation.oid, 'INSERT') OR
                      has_table_privilege(session_user, relation.oid, 'UPDATE') OR
                      has_table_privilege(session_user, relation.oid, 'DELETE') OR
                      has_table_privilege(session_user, relation.oid, 'TRUNCATE') OR
                      has_table_privilege(session_user, relation.oid, 'REFERENCES') OR
                      has_table_privilege(session_user, relation.oid, 'TRIGGER')
                    )) OR
                    (relation.relkind = 'S' AND (
                      has_sequence_privilege(session_user, relation.oid, 'USAGE') OR
                      has_sequence_privilege(session_user, relation.oid, 'SELECT') OR
                      has_sequence_privilege(session_user, relation.oid, 'UPDATE')
                    )) OR
                    (schema.nspname <> 'public' AND
                      has_schema_privilege(session_user, schema.oid, 'CREATE'))
                  )
              ) AS has_application_data_privileges
       FROM pg_roles AS role
       WHERE role.rolname = session_user`,
    );
    const role = result.rows[0];
    if (
      !role ||
      role.session_role !== this.expectedExecutorRole ||
      role.current_role !== this.expectedExecutorRole ||
      role.is_superuser ||
      role.can_create_database ||
      role.can_create_role ||
      role.can_inherit ||
      role.can_bypass_rls ||
      role.can_replicate ||
      role.has_application_data_privileges
    ) {
      throw new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Database connection is not the dedicated non-superuser erasure executor.',
      );
    }
  }

  async withExclusiveMaintenanceLock<T>(action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let acquired = false;
    try {
      acquired = await acquireMaintenanceLock(client, 'exclusive', true);
      if (!acquired) {
        throw new KnowledgeResetExecutionError(
          'RESET_IN_PROGRESS',
          'Runtime or another maintenance process still holds the shared maintenance lock.',
        );
      }
      return await action();
    } finally {
      try {
        if (acquired) await releaseMaintenanceLock(client, 'exclusive');
      } finally {
        client.release();
      }
    }
  }
}
