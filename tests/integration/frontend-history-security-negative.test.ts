import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../modules/canonical-knowledge/src/index.js';
import { canonicalSnapshotDigest } from '../../packages/contracts/src/index.js';

/**
 * FE-P5-S2 WP6 — History / Reversal HTTP security negatives (AC-13 read-time
 * capability revalidation; AC-07 direct-restore-forbidden gate).
 *
 * These prove the fail-closed gates through the REAL HTTP product API:
 * - History workspace read requires the CURRENT `history:read` capability.
 * - Reversal creation requires the CURRENT `project:action:rollback`
 *   capability, an active-project resource, and a CSRF token. Every denial is
 *   non-disclosing (no revision/project existence leak).
 */
describe('FE-P5-S2 WP6 History/Reversal HTTP security negatives', () => {
  const PROJECT_ID = 'shotgun';
  let auth: InMemoryAuthRepository;

  beforeEach(async () => {
    auth = new InMemoryAuthRepository();
  });

  const sessionCookie = async (scopes: readonly string[]): Promise<string> => {
    await auth.bootstrapOwner({
      accountId: 'wp6-security-owner',
      projectId: PROJECT_ID,
      scopes,
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('wp6-security-owner');
    if (!principal) throw new Error('Fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
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

  const post = async (
    application: Awaited<ReturnType<typeof createApplication>>,
    cookie: string,
    token: string | undefined,
    url: string,
    payload: Record<string, unknown>,
  ) =>
    application.server.inject({
      method: 'POST',
      url,
      headers: token === undefined ? { cookie } : { cookie, 'x-csrf-token': token },
      payload,
    });

  const seedCanonical = async (): Promise<CanonicalKnowledgeRepositoryPort> => {
    const { InMemoryCanonicalKnowledgeRepository } =
      await import('../../adapters/stage6-in-memory/src/index.js');
    const { approvedChangeSetManifestDigest, approvalTokenDigest } =
      await import('../../packages/contracts/src/index.js');
    const repo = new InMemoryCanonicalKnowledgeRepository();
    const actor = { type: 'user' as const, id: 'principal-1' };
    const snapshot0 = canonicalSnapshotDigest(PROJECT_ID, 0, []);
    const manifest = (
      manifestId: string,
      changeSetId: string,
      candidateId: string,
      claimText: string,
      expectedCanonicalVersion: number,
      snapshotDigest: string,
      createdAt: string,
    ) => {
      const approvalTokenInput = {
        tokenId: `token:${changeSetId}`,
        changeSetId,
        changeSetRevisionNumber: 1 as const,
        actorId: 'principal-1',
        contentDigest: `content:${changeSetId}`,
        expectedCanonicalVersion,
        snapshotDigest,
        issuedAt: createdAt,
        expiresAt: '2026-12-31T00:00:00.000Z',
      };
      const base = {
        manifestId,
        changeSetId,
        changeSetRevisionNumber: 1 as const,
        projectId: PROJECT_ID,
        sourceVersionId: 'source-1',
        candidateId,
        candidateRevisionNumber: 1 as const,
        claimText,
        operation: 'ADD_CLAIM' as const,
        classification: 'NEW_CLAIM' as const,
        candidateDigest: `candidate-digest:${candidateId}`,
        evidenceIds: [] as readonly string[],
        accessScope: ['owner'],
        sensitivity: 'private' as const,
        expectedCanonicalVersion,
        snapshotDigest,
        diffDigest: `diff:${changeSetId}`,
        contentDigest: `content:${changeSetId}`,
        approvalToken: {
          ...approvalTokenInput,
          tokenDigest: approvalTokenDigest(approvalTokenInput),
        },
        reason: 'commit',
        createdAt,
      };
      return base;
    };
    const manifest1 = manifest(
      'manifest-1',
      'change-set-1',
      'candidate-1',
      'Claim A',
      0,
      snapshot0,
      '2026-08-09T01:00:00.000Z',
    );
    await repo.commit({
      commitId: 'commit-1',
      revisionId: 'revision:1',
      historyEventId: 'e-1',
      outboxId: 'outbox-1',
      claimId: 'claim-a',
      manifest: { ...manifest1, manifestDigest: approvedChangeSetManifestDigest(manifest1) },
      actor,
      committedAt: '2026-08-09T01:00:00.000Z',
    });
    return repo;
  };

  it('denies History workspace read without the current history:read capability (HTTP, non-disclosing)', async () => {
    // `owner` implies history:read in the History scope gate; use a scope that
    // grants project membership WITHOUT history:read.
    const cookie = await sessionCookie(['project:read']);
    const application = await createApplication({ authRepository: auth });
    const token = await csrfToken(application, cookie);
    const response = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/history/workspace',
      { schemaVersion: '1.0.0', resourceProjectId: PROJECT_ID, limit: 20 },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await application.server.close();
  });

  it('allows History workspace read with the current history:read capability (HTTP)', async () => {
    const cookie = await sessionCookie(['owner', 'history:read']);
    const application = await createApplication({ authRepository: auth });
    const token = await csrfToken(application, cookie);
    const response = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/history/workspace',
      { schemaVersion: '1.0.0', resourceProjectId: PROJECT_ID, limit: 20 },
    );
    expect(response.statusCode).toBe(200);
    await application.server.close();
  });

  it('denies Reversal creation without the current project:action:rollback capability (HTTP, non-disclosing)', async () => {
    const cookie = await sessionCookie(['owner', 'history:read']);
    const canonical = await seedCanonical();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
    });
    const token = await csrfToken(application, cookie);
    const response = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: PROJECT_ID,
        sourceRevisionId: 'revision:1',
        reason: 'Reversal without the rollback capability.',
      },
    );
    // Fail-closed, non-disclosing (no capability/revision existence leak).
    expect(response.statusCode).not.toBe(200);
    expect(response.json()).toMatchObject({ code: 'REVERSAL_MISSING_CURRENT_CAPABILITY' });
    await application.server.close();
  });

  it('denies Reversal creation for a resource outside the active project (HTTP)', async () => {
    const cookie = await sessionCookie(['owner', 'history:read', 'project:action:rollback']);
    const canonical = await seedCanonical();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
    });
    const token = await csrfToken(application, cookie);
    const response = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: 'other-project',
        sourceRevisionId: 'revision:1',
        reason: 'Cross-project Reversal.',
      },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PROJECT_ACCESS_DENIED' });
    await application.server.close();
  });

  it('rejects Reversal creation without a CSRF token (HTTP)', async () => {
    const cookie = await sessionCookie(['owner', 'history:read', 'project:action:rollback']);
    const canonical = await seedCanonical();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
    });
    const response = await post(
      application,
      cookie,
      undefined,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: PROJECT_ID,
        sourceRevisionId: 'revision:1',
        reason: 'CSRF-less Reversal.',
      },
    );
    expect(response.statusCode).toBe(403);
    await application.server.close();
  });
});
