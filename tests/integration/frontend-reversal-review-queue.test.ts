import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../modules/canonical-knowledge/src/index.js';
import { canonicalSnapshotDigest } from '../../packages/contracts/src/index.js';

/**
 * FE-P5-S2 WP5 Round 2 B — Reversal candidate → persisted owning-Domain
 * DraftChangeSet → existing Review Context → existing Review queue.
 *
 * The browser names ONLY the authoritative Canonical revision identity
 * (`revision:2`, never the numeric afterVersion). The server derives the
 * current capability + principal, persists the CANDIDATE Reversal to the
 * owning change-set-review store, and the existing KNOWLEDGE_DRAFT_CHANGE_SET
 * Review queue surfaces it (current Review Context path).
 */
describe('FE-P5-S2 WP5 Round 2 B Reversal → Review queue', () => {
  const PROJECT_ID = 'project-1';
  let auth: InMemoryAuthRepository;

  beforeEach(async () => {
    auth = new InMemoryAuthRepository();
  });

  /** Canonical store seeded through the real in-memory repository (commit). */
  const seedCanonical = async (): Promise<CanonicalKnowledgeRepositoryPort> => {
    const { InMemoryCanonicalKnowledgeRepository } =
      await import('../../adapters/stage6-in-memory/src/index.js');
    const repo = new InMemoryCanonicalKnowledgeRepository();
    const actor = { type: 'user' as const, id: 'principal-1' };
    const claimA = { claimId: 'claim-a', text: 'Claim A', revisionNumber: 1, evidenceIds: [] };
    const snapshot0 = canonicalSnapshotDigest(PROJECT_ID, 0, []);
    const snapshot1 = canonicalSnapshotDigest(PROJECT_ID, 1, [claimA]);
    const { approvedChangeSetManifestDigest, approvalTokenDigest } =
      await import('../../packages/contracts/src/index.js');
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
    const manifest2 = manifest(
      'manifest-2',
      'change-set-2',
      'candidate-2',
      'Claim B',
      1,
      snapshot1,
      '2026-08-09T02:00:00.000Z',
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
    await repo.commit({
      commitId: 'commit-2',
      revisionId: 'revision:2',
      historyEventId: 'e-2',
      outboxId: 'outbox-2',
      claimId: 'claim-b',
      manifest: { ...manifest2, manifestDigest: approvedChangeSetManifestDigest(manifest2) },
      actor,
      committedAt: '2026-08-09T02:00:00.000Z',
    });
    return repo;
  };

  const sessionCookie = async (scopes: readonly string[]): Promise<string> => {
    await auth.bootstrapOwner({
      accountId: 'reversal-owner',
      projectId: PROJECT_ID,
      scopes,
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('reversal-owner');
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
    token: string,
    url: string,
    payload: Record<string, unknown>,
  ) =>
    application.server.inject({
      method: 'POST',
      url,
      headers: { cookie, 'x-csrf-token': token },
      payload,
    });

  it('persists the Reversal candidate and surfaces it in the Review queue with a Review Context (authoritative revisionId)', async () => {
    const cookie = await sessionCookie(['owner', 'project:action:rollback']);
    const canonical = await seedCanonical();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
    });
    const token = await csrfToken(application, cookie);

    // 1) Create the Reversal with the authoritative revision identity.
    const created = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: PROJECT_ID,
        sourceRevisionId: 'revision:2',
        reason: 'Reversal initiated from the History Workspace.',
      },
    );
    expect(created.statusCode).toBe(200);
    const createdBody = created.json<{
      schemaVersion: string;
      reversal: { schemaVersion: string; reversalId: string; status: string };
    }>();
    expect(createdBody.schemaVersion).toBe('1.0.0');
    expect(createdBody.reversal.status).toBe('CANDIDATE');
    const reversalId = createdBody.reversal.reversalId;
    expect(reversalId.startsWith('reversal:')).toBe(true);

    // 2) The existing KNOWLEDGE_DRAFT_CHANGE_SET Review queue surfaces it.
    const queue = await post(application, cookie, token, '/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    expect(queue.statusCode).toBe(200);
    const queueBody = queue.json<{
      schemaVersion: string;
      items: readonly {
        reviewContextId: string;
        targetKind: string;
        targetId: string;
        targetLabel: string;
      }[];
    }>();
    const reversalItem = queueBody.items.find((item) => item.targetId === reversalId);
    expect(reversalItem).toBeDefined();
    expect(reversalItem?.targetKind).toBe('KNOWLEDGE_DRAFT_CHANGE_SET');
    expect(reversalItem?.targetLabel).toContain('revision:2');

    // 3) The corresponding Review Context exists (deep-link target).
    const context = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/contexts/read',
      {
        schemaVersion: '1.0.0',
        reviewContextId: reversalItem!.reviewContextId,
        contextRevision: 1,
      },
    );
    expect(context.statusCode).toBe(200);
    const contextBody = context.json<{
      schemaVersion: string;
      context: {
        schemaVersion: string;
        targetKind: string;
        targetId: string;
        targetDigest: string;
      };
    }>();
    expect(contextBody.context.targetKind).toBe('KNOWLEDGE_DRAFT_CHANGE_SET');
    expect(contextBody.context.targetId).toBe(reversalId);

    await application.server.close();
  });

  it('rejects a numeric afterVersion used as the revision identity (non-disclosing)', async () => {
    const cookie = await sessionCookie(['owner', 'project:action:rollback']);
    const canonical = await seedCanonical();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
    });
    const token = await csrfToken(application, cookie);
    const created = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: PROJECT_ID,
        sourceRevisionId: '2',
        reason: 'Reversal attempted with a numeric afterVersion.',
      },
    );
    // A numeric afterVersion is NOT a canonical revision identity → the
    // eligibility gate fails closed (REVERSAL_SOURCE_NOT_FOUND), reported as a
    // non-disclosing NOT_FOUND (no revision existence leak).
    expect(created.statusCode).toBe(404);
    expect(created.json()).toMatchObject({ code: 'REVERSAL_SOURCE_NOT_FOUND' });
    await application.server.close();
  });
});
