import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  DELETED_PROJECT_AUDIT_READ_CAPABILITY,
  isDeletedProjectAuditReadPermitted,
} from '../../modules/project-administration/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const auditContext = (projectId: string, principalId: string) => ({
  projectId,
  principalId,
  currentCapabilities: [DELETED_PROJECT_AUDIT_READ_CAPABILITY],
});

describe.runIf(pool)('FE-P5-S2 WP2-C ProjectTombstone (PostgreSQL)', () => {
  it('creates a tombstone, grants/revokes an audit scope and enforces read revalidation', async () => {
    const { PostgresProjectTombstoneStore } = await import('../../adapters/postgres/src/index.js');
    const store = new PostgresProjectTombstoneStore(pool!);
    const project = `pg-tomb-${randomUUID().slice(0, 8)}`;
    const now = '2026-08-09T00:00:00.000Z';
    const lineage = `sha256:${'c'.repeat(64)}`;

    const tombstone = await store.createTombstone({
      projectId: project,
      deletedBy: 'admin-1',
      reason: 'user requested deletion',
      retentionClass: 'STANDARD',
      lineageDigest: lineage,
      deletedAt: now,
    });
    expect(tombstone.lineageDigest).toBe(lineage);
    expect(await store.getTombstone(project)).toEqual(tombstone);

    // Grant requires a tombstone
    await expect(
      store.grantAuditScope({
        scopeId: `scope-${randomUUID().slice(0, 8)}`,
        projectId: `missing-${randomUUID().slice(0, 8)}`,
        grantedPrincipalIds: ['auditor-1'],
        grantedBy: 'admin-1',
        grantedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const scopeId = `scope-${randomUUID().slice(0, 8)}`;
    const granted = await store.grantAuditScope({
      scopeId,
      projectId: project,
      grantedPrincipalIds: ['auditor-1', 'auditor-2'],
      grantedBy: 'admin-1',
      grantedAt: now,
    });
    expect(granted.grantedPrincipalIds).toEqual(['auditor-1', 'auditor-2']);

    // Read-time capability revalidation (fail-closed): scope + CURRENT capability
    expect(isDeletedProjectAuditReadPermitted(granted, auditContext(project, 'auditor-1'))).toBe(
      true,
    );
    // scope present but current capability missing -> false
    expect(
      isDeletedProjectAuditReadPermitted(granted, {
        projectId: project,
        principalId: 'auditor-1',
        currentCapabilities: [],
      }),
    ).toBe(false);
    // past membership alone never grants
    expect(isDeletedProjectAuditReadPermitted(granted, auditContext(project, 'past-member'))).toBe(
      false,
    );

    const revoked = await store.revokeAuditScope({
      scopeId,
      revokedAt: '2026-08-09T01:00:00.000Z',
    });
    expect(revoked.revokedAt).toBe('2026-08-09T01:00:00.000Z');
    expect(isDeletedProjectAuditReadPermitted(revoked, auditContext(project, 'auditor-1'))).toBe(
      false,
    );
    await expect(store.revokeAuditScope({ scopeId, revokedAt: now })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const listed = await store.listAuditScopes(project);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.scopeId).toBe(scopeId);
    expect(listed[0]!.revokedAt).toBe('2026-08-09T01:00:00.000Z');

    // Cleanup
    await pool!.query(
      `DELETE FROM project_audit.deleted_project_audit_scopes WHERE project_id = $1`,
      [project],
    );
    await pool!.query(`DELETE FROM project_audit.project_tombstones WHERE project_id = $1`, [
      project,
    ]);
  });

  it('rejects invalid inputs', async () => {
    const { PostgresProjectTombstoneStore } = await import('../../adapters/postgres/src/index.js');
    const store = new PostgresProjectTombstoneStore(pool!);
    await expect(store.getTombstone('')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(store.getAuditScope('')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
