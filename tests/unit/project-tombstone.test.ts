import { describe, expect, it } from 'vitest';

import { InMemoryProjectTombstoneStore } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import {
  DELETED_PROJECT_AUDIT_READ_CAPABILITY,
  isDeletedProjectAuditReadPermitted,
} from '../../modules/project-administration/src/index.js';

const now = '2026-08-09T00:00:00.000Z';

const auditContext = (
  principalId: string,
  capabilities: readonly string[] = [DELETED_PROJECT_AUDIT_READ_CAPABILITY],
) => ({
  projectId: 'p1',
  principalId,
  currentCapabilities: capabilities,
});

describe('project-administration WP2-C ProjectTombstone / DeletedProjectAuditScope', () => {
  it('creates a tombstone and preserves lineage digest', async () => {
    const store = new InMemoryProjectTombstoneStore();
    const tombstone = await store.createTombstone({
      projectId: 'p1',
      deletedBy: 'admin-1',
      reason: 'user requested deletion',
      retentionClass: 'STANDARD',
      lineageDigest: `sha256:${'a'.repeat(64)}`,
      deletedAt: now,
    });
    expect(tombstone.projectId).toBe('p1');
    expect(tombstone.lineageDigest).toBe(`sha256:${'a'.repeat(64)}`);
    expect(await store.getTombstone('p1')).toEqual(tombstone);
    expect(await store.getTombstone('missing')).toBeNull();
  });

  it('rejects a second tombstone for the same project', async () => {
    const store = new InMemoryProjectTombstoneStore();
    await store.createTombstone({
      projectId: 'p1',
      deletedBy: 'admin-1',
      reason: 'first',
      retentionClass: 'STANDARD',
      lineageDigest: 'sha256:aaaa',
      deletedAt: now,
    });
    await expect(
      store.createTombstone({
        projectId: 'p1',
        deletedBy: 'admin-2',
        reason: 'second',
        retentionClass: 'STANDARD',
        lineageDigest: 'sha256:bbbb',
        deletedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('grants an audit scope only when a tombstone exists, then revokes', async () => {
    const store = new InMemoryProjectTombstoneStore();
    // No tombstone -> grant rejected
    await expect(
      store.grantAuditScope({
        scopeId: 'scope-1',
        projectId: 'p1',
        grantedPrincipalIds: ['auditor-1'],
        grantedBy: 'admin-1',
        grantedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await store.createTombstone({
      projectId: 'p1',
      deletedBy: 'admin-1',
      reason: 'delete',
      retentionClass: 'STANDARD',
      lineageDigest: 'sha256:aaaa',
      deletedAt: now,
    });
    const granted = await store.grantAuditScope({
      scopeId: 'scope-1',
      projectId: 'p1',
      grantedPrincipalIds: ['auditor-1', 'auditor-2'],
      grantedBy: 'admin-1',
      grantedAt: now,
    });
    expect(granted.grantedPrincipalIds).toEqual(['auditor-1', 'auditor-2']);

    // Read-time Capability revalidation: scope binding + CURRENT capability.
    expect(isDeletedProjectAuditReadPermitted(granted, auditContext('auditor-1'))).toBe(true);
    expect(isDeletedProjectAuditReadPermitted(granted, auditContext('auditor-2'))).toBe(true);
    // Negative cases required by review:
    // - scope grant present but current capability missing -> false
    expect(isDeletedProjectAuditReadPermitted(granted, auditContext('auditor-1', []))).toBe(false);
    // - principal not in granted set -> false (past membership alone never grants)
    expect(isDeletedProjectAuditReadPermitted(granted, auditContext('past-member'))).toBe(false);
    // - no scope -> false
    expect(isDeletedProjectAuditReadPermitted(null, auditContext('auditor-1'))).toBe(false);
    // - wrong project scope -> false
    expect(
      isDeletedProjectAuditReadPermitted(granted, {
        projectId: 'other-project',
        principalId: 'auditor-1',
        currentCapabilities: [DELETED_PROJECT_AUDIT_READ_CAPABILITY],
      }),
    ).toBe(false);

    // Duplicate active grant rejected
    await expect(
      store.grantAuditScope({
        scopeId: 'scope-1',
        projectId: 'p1',
        grantedPrincipalIds: ['auditor-3'],
        grantedBy: 'admin-1',
        grantedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const revoked = await store.revokeAuditScope({
      scopeId: 'scope-1',
      revokedAt: '2026-08-09T01:00:00.000Z',
    });
    expect(revoked.revokedAt).toBe('2026-08-09T01:00:00.000Z');
    expect(isDeletedProjectAuditReadPermitted(revoked, auditContext('auditor-1'))).toBe(false);
    await expect(
      store.revokeAuditScope({ scopeId: 'scope-1', revokedAt: now }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lists scopes per project and rejects invalid inputs', async () => {
    const store = new InMemoryProjectTombstoneStore();
    await store.createTombstone({
      projectId: 'p1',
      deletedBy: 'admin-1',
      reason: 'delete',
      retentionClass: 'STANDARD',
      lineageDigest: 'sha256:aaaa',
      deletedAt: now,
    });
    await store.grantAuditScope({
      scopeId: 'scope-a',
      projectId: 'p1',
      grantedPrincipalIds: ['auditor-1'],
      grantedBy: 'admin-1',
      grantedAt: now,
    });
    await store.grantAuditScope({
      scopeId: 'scope-b',
      projectId: 'p1',
      grantedPrincipalIds: ['auditor-2'],
      grantedBy: 'admin-1',
      grantedAt: now,
    });
    const scopes = await store.listAuditScopes('p1');
    expect(scopes.map((s) => s.scopeId)).toEqual(['scope-a', 'scope-b']);
    expect(await store.listAuditScopes('other')).toEqual([]);
    await expect(
      store.createTombstone({
        projectId: '',
        deletedBy: 'x',
        reason: 'x',
        retentionClass: 'x',
        lineageDigest: 'x',
        deletedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
