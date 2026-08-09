import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { InMemoryProjectTombstoneStore } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createInMemoryHistoryReadModelStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import type { HistoryEntryV1 } from '../../packages/contracts/src/index.js';

/**
 * FE-P5-S2 WP5 C — Deleted Project Audit read path (WP2-C tombstone bridge).
 *
 * Authorized success requires ALL of: valid ProjectTombstone + active
 * DeletedProjectAuditScope bound to the current principal + the CURRENT
 * `project:deleted-audit:read` capability. Missing scope / missing capability
 * / revoked scope / past-membership-only all fail closed with the same
 * non-disclosing denial.
 */
describe('FE-P5-S2 WP5 Deleted Project Audit History read', () => {
  let auth: InMemoryAuthRepository;

  beforeEach(async () => {
    auth = new InMemoryAuthRepository();
  });

  const sessionCookie = async (
    scopes: readonly string[],
    activeProject: string,
  ): Promise<string> => {
    await auth.bootstrapOwner({
      accountId: 'deleted-audit-owner',
      projectId: activeProject,
      scopes,
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('deleted-audit-owner');
    if (!principal) throw new Error('Fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      activeProject,
      new Date(Date.now() + 60_000).toISOString(),
    );
    return `shotgun_session=${session.sessionToken}`;
  };

  const csrfToken = async (
    application: Awaited<ReturnType<typeof createApplication>>,
    cookie: string,
  ): Promise<string> =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;

  const deletedProjectEntry = (): HistoryEntryV1 => ({
    schemaVersion: '1.0.0',
    historyEntryId: 'history:deleted-1:e-1',
    resourceProjectId: 'deleted-1',
    domainKind: 'CANONICAL',
    domainResourceKind: 'CANONICAL_CLAIM',
    domainResourceId: 'claim:deleted-1',
    sourceEventKind: 'CANONICAL_CLAIM_ADDED',
    sourceEventId: 'e-1',
    occurredAt: '2026-08-09T00:00:00.000Z',
    payloadAvailability: 'AVAILABLE',
    payloadSnapshot: { eventType: 'CANONICAL_CLAIM_ADDED', reason: 'legacy' },
    projectedAt: '2026-08-09T00:00:00.000Z',
  });

  const applicationWithDeletedProject = async (
    cookie: string,
    withAuditScope: boolean,
  ): Promise<Awaited<ReturnType<typeof createApplication>>> => {
    const historyReadModelStore = createInMemoryHistoryReadModelStore();
    await historyReadModelStore.index.upsert(deletedProjectEntry());
    const tombstoneStore = new InMemoryProjectTombstoneStore();
    await tombstoneStore.createTombstone({
      projectId: 'deleted-1',
      deletedAt: '2026-08-09T01:00:00.000Z',
      deletedBy: 'admin',
      reason: 'retention',
      retentionClass: 'audit',
      lineageDigest: 'digest:deleted-1',
    });
    if (withAuditScope) {
      const principal = await auth.findPrincipalByAccountId('deleted-audit-owner');
      await tombstoneStore.grantAuditScope({
        projectId: 'deleted-1',
        scopeId: 'scope:deleted-1',
        grantedPrincipalIds: [principal!.principalId],
        grantedAt: '2026-08-09T02:00:00.000Z',
        grantedBy: 'admin',
      });
    }
    return createApplication({
      authRepository: auth,
      historyReadModelStore,
      projectTombstoneStore: tombstoneStore,
    });
  };

  const listWorkspace = async (
    application: Awaited<ReturnType<typeof createApplication>>,
    cookie: string,
    token: string,
    resourceProjectId: string,
  ) =>
    application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/history/workspace',
      headers: { cookie, 'x-csrf-token': token },
      payload: { schemaVersion: '1.0.0', resourceProjectId, limit: 20 },
    });

  it('allows deleted-project audit History read with tombstone + scope + current capability', async () => {
    const cookie = await sessionCookie(
      ['owner', 'history:read', 'project:deleted-audit:read'],
      'shotgun',
    );
    const application = await applicationWithDeletedProject(cookie, true);
    const token = await csrfToken(application, cookie);
    const response = await listWorkspace(application, cookie, token, 'deleted-1');
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      schemaVersion: string;
      entries: readonly { sourceEventId: string }[];
    }>();
    expect(body.schemaVersion).toBe('1.0.0');
    expect(body.entries.map((entry) => entry.sourceEventId)).toContain('e-1');
    await application.server.close();
  });

  it('denies deleted-project audit without an active audit scope (non-disclosing)', async () => {
    const cookie = await sessionCookie(
      ['owner', 'history:read', 'project:deleted-audit:read'],
      'shotgun',
    );
    const application = await applicationWithDeletedProject(cookie, false);
    const token = await csrfToken(application, cookie);
    const response = await listWorkspace(application, cookie, token, 'deleted-1');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await application.server.close();
  });

  it('denies deleted-project audit without the current project:deleted-audit:read capability', async () => {
    const cookie = await sessionCookie(['owner', 'history:read'], 'shotgun');
    const application = await applicationWithDeletedProject(cookie, true);
    const token = await csrfToken(application, cookie);
    const response = await listWorkspace(application, cookie, token, 'deleted-1');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await application.server.close();
  });

  it('denies a non-tombstoned cross-project read (no leak)', async () => {
    const cookie = await sessionCookie(
      ['owner', 'history:read', 'project:deleted-audit:read'],
      'shotgun',
    );
    const application = await applicationWithDeletedProject(cookie, true);
    const token = await csrfToken(application, cookie);
    const response = await listWorkspace(application, cookie, token, 'missing-project');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await application.server.close();
  });
});
