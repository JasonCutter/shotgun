import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import type { FrontendKnowledgeDraftTransactionRepositoriesV1 } from '../../modules/frontend-knowledge-draft/src/index.js';
import type { FrontendKnowledgeDraftChangeSetV1 } from '../../packages/contracts/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../modules/canonical-knowledge/src/index.js';
import { canonicalSnapshotDigest } from '../../packages/contracts/src/index.js';

/**
 * FE-P5-S2 WP6 (Round 1 Blocker B) — Reversal durable-authority →
 * derived-carrier recovery.
 *
 * The authoritative Reversal (change-set-review `review.reversals`) and the
 * derived SUBMITTED Knowledge Draft carrier (migration 025) are separate
 * persistence boundaries. When a carrier write fails AFTER the authoritative
 * save succeeds, the Reversal is durable but missing from the Review Queue.
 * This regression proves the recovery invariant:
 *
 *   Create Reversal → authoritative save succeeds → carrier insert forced
 *   failure → authoritative Reversal still exists + request reports failure
 *   safely → queue reconciliation regenerates the SAME reversalId carrier →
 *   Review Queue contains the same reversal → Context readable.
 *
 * The reconciliation NEVER creates a new Reversal id — it regenerates the
 * carrier deterministically from the authoritative record.
 */

/** First transaction fails (forced carrier-write failure), then delegates. */
class FailOnceDraftRepository extends InMemoryFrontendKnowledgeDraftRepository {
  private failed = false;

  override async transaction<T>(
    action: (repositories: FrontendKnowledgeDraftTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('forced carrier insert failure');
    }
    return super.transaction(action);
  }
}

describe('FE-P5-S2 WP6 Reversal carrier recovery', () => {
  const PROJECT_ID = 'shotgun';
  let auth: InMemoryAuthRepository;

  beforeEach(async () => {
    auth = new InMemoryAuthRepository();
  });

  const seedCanonical = async (
    count: number,
  ): Promise<{ repo: CanonicalKnowledgeRepositoryPort }> => {
    const { InMemoryCanonicalKnowledgeRepository } =
      await import('../../adapters/stage6-in-memory/src/index.js');
    const { approvedChangeSetManifestDigest, approvalTokenDigest } =
      await import('../../packages/contracts/src/index.js');
    const repo = new InMemoryCanonicalKnowledgeRepository();
    const actor = { type: 'user' as const, id: 'principal-1' };
    const claims: {
      claimId: string;
      text: string;
      revisionNumber: 1;
      evidenceIds: readonly string[];
    }[] = [];
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
    for (let i = 1; i <= count; i += 1) {
      const claim = {
        claimId: `claim-${i}`,
        text: `Claim ${i}`,
        revisionNumber: 1 as const,
        evidenceIds: [] as readonly string[],
      };
      claims.push(claim);
      const snapshotBefore = canonicalSnapshotDigest(
        PROJECT_ID,
        i - 1,
        claims.slice(0, i - 1).map((c) => ({
          claimId: c.claimId,
          text: c.text,
          revisionNumber: c.revisionNumber,
          evidenceIds: [...c.evidenceIds],
        })),
      );
      const createdAt = `2026-08-09T0${i}:00:00.000Z`;
      const m = manifest(
        `manifest-${i}`,
        `change-set-${i}`,
        `candidate-${i}`,
        `Claim ${i}`,
        i - 1,
        snapshotBefore,
        createdAt,
      );
      await repo.commit({
        commitId: `commit-${i}`,
        revisionId: `revision:${i}`,
        historyEventId: `e-${i}`,
        outboxId: `outbox-${i}`,
        claimId: `claim-${i}`,
        manifest: { ...m, manifestDigest: approvedChangeSetManifestDigest(m) },
        actor,
        committedAt: createdAt,
      });
    }
    return { repo };
  };

  /** Commits one more Canonical revision on top of the seeded repo (new tip). */
  const commitNextRevision = async (
    repo: CanonicalKnowledgeRepositoryPort,
    revision: number,
  ): Promise<void> => {
    const { approvedChangeSetManifestDigest, approvalTokenDigest } =
      await import('../../packages/contracts/src/index.js');
    const actor = { type: 'user' as const, id: 'principal-1' };
    const snapshot = await repo.getSnapshot(PROJECT_ID);
    const beforeClaims = snapshot.claims.map((c) => ({
      claimId: c.claimId,
      text: c.text,
      revisionNumber: c.revisionNumber,
      evidenceIds: [...c.evidenceIds],
    }));
    const snapshotBefore = canonicalSnapshotDigest(PROJECT_ID, snapshot.version, beforeClaims);
    const createdAt = `2026-08-09T1${revision}:00:00.000Z`;
    const approvalTokenInput = {
      tokenId: `token:commit-${revision}`,
      changeSetId: `change-set-${revision}`,
      changeSetRevisionNumber: 1 as const,
      actorId: 'principal-1',
      contentDigest: `content:change-set-${revision}`,
      expectedCanonicalVersion: snapshot.version,
      snapshotDigest: snapshotBefore,
      issuedAt: createdAt,
      expiresAt: '2026-12-31T00:00:00.000Z',
    };
    const m = {
      manifestId: `manifest-${revision}`,
      changeSetId: `change-set-${revision}`,
      changeSetRevisionNumber: 1 as const,
      projectId: PROJECT_ID,
      sourceVersionId: 'source-1',
      candidateId: `candidate-${revision}`,
      candidateRevisionNumber: 1 as const,
      claimText: `Claim ${revision}`,
      operation: 'ADD_CLAIM' as const,
      classification: 'NEW_CLAIM' as const,
      candidateDigest: `candidate-digest:candidate-${revision}`,
      evidenceIds: [] as readonly string[],
      accessScope: ['owner'],
      sensitivity: 'private' as const,
      expectedCanonicalVersion: snapshot.version,
      snapshotDigest: snapshotBefore,
      diffDigest: `diff:change-set-${revision}`,
      contentDigest: `content:change-set-${revision}`,
      approvalToken: {
        ...approvalTokenInput,
        tokenDigest: approvalTokenDigest(approvalTokenInput),
      },
      reason: 'commit',
      createdAt,
    };
    await repo.commit({
      commitId: `commit-${revision}`,
      revisionId: `revision:${revision}`,
      historyEventId: `e-${revision}`,
      outboxId: `outbox-${revision}`,
      claimId: `claim-${revision}`,
      manifest: { ...m, manifestDigest: approvedChangeSetManifestDigest(m) },
      actor,
      committedAt: createdAt,
    });
  };

  const sessionCookie = async (scopes: readonly string[]): Promise<string> => {
    await auth.bootstrapOwner({
      accountId: 'carrier-recovery-owner',
      projectId: PROJECT_ID,
      scopes,
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('carrier-recovery-owner');
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

  it('reconciles a missing derived carrier from the authoritative Reversal (same reversalId) into the Review Queue', async () => {
    const cookie = await sessionCookie(['owner', 'project:action:rollback']);
    const { repo: canonical } = await seedCanonical(1);
    const draftRepository = new FailOnceDraftRepository();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
      frontendKnowledgeDraftRepository: draftRepository,
    });
    const token = await csrfToken(application, cookie);

    // 1) Create the Reversal: authoritative save succeeds, derived carrier
    //    insert is FORCED to fail (first transaction throws).
    const created = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: PROJECT_ID,
        sourceRevisionId: 'revision:1',
        reason: 'Reversal with a forced carrier-write failure.',
      },
    );
    // The request reports the failure safely (not 200), and the authoritative
    // Reversal is durable.
    expect(created.statusCode).toBe(500);

    // The authoritative record must exist even though the carrier failed.
    const reversals = await application.repositories.reviews.listReversals(PROJECT_ID);
    expect(reversals.length).toBe(1);
    const reversalId = reversals[0]!.reversalId;
    expect(reversals[0]?.sourceRevisionId).toBe('revision:1');

    // 2) Before recovery the carrier is missing (queue would be empty for it).
    const carrierBefore = (await draftRepository.transaction(({ drafts }) =>
      drafts.findById(PROJECT_ID, reversalId),
    )) as FrontendKnowledgeDraftChangeSetV1 | undefined;
    expect(carrierBefore).toBeUndefined();

    // 3) Queue read triggers reconciliation: the SAME reversalId carrier is
    //    regenerated from the authoritative record and the Review Queue
    //    contains the same Reversal.
    const queue = await post(application, cookie, token, '/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    expect(queue.statusCode).toBe(200);
    const queueBody = queue.json<{
      items: readonly { targetId: string; reviewContextId: string }[];
    }>();
    const reversalItem = queueBody.items.find((item) => item.targetId === reversalId);
    expect(reversalItem).toBeDefined();

    // 4) The regenerated carrier is the SAME reversalId (never a new Reversal)
    //    and the Review Context is readable.
    const carrierAfter = (await draftRepository.transaction(({ drafts }) =>
      drafts.findById(PROJECT_ID, reversalId),
    )) as FrontendKnowledgeDraftChangeSetV1 | undefined;
    expect(carrierAfter?.draftId).toBe(reversalId);
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
      context: { targetId: string };
    }>();
    expect(contextBody.context.targetId).toBe(reversalId);

    await application.server.close();
  });

  it('fail-closed: does NOT regenerate a stale/superseded Reversal carrier after a newer Canonical revision (WP6 Round 2)', async () => {
    const cookie = await sessionCookie(['owner', 'project:action:rollback']);
    // revision:1 + revision:2 (revision:2 is the current tip).
    const { repo: canonical } = await seedCanonical(2);
    const draftRepository = new FailOnceDraftRepository();
    const application = await createApplication({
      authRepository: auth,
      canonicalKnowledgeRepository: canonical,
      frontendKnowledgeDraftRepository: draftRepository,
    });
    const token = await csrfToken(application, cookie);

    // 1) Create a Reversal of the CURRENT tip (revision:2): authoritative save
    //    succeeds, derived carrier insert is FORCED to fail.
    const created = await post(
      application,
      cookie,
      token,
      '/product-api/frontend/review/reversal-draft',
      {
        schemaVersion: '1.0.0',
        resourceProjectId: PROJECT_ID,
        sourceRevisionId: 'revision:2',
        reason: 'Reversal with a forced carrier-write failure (later superseded).',
      },
    );
    expect(created.statusCode).toBe(500);
    const reversals = await application.repositories.reviews.listReversals(PROJECT_ID);
    expect(reversals.length).toBe(1);
    const reversalId = reversals[0]!.reversalId;
    expect(reversals[0]?.sourceRevisionId).toBe('revision:2');

    // 2) A NEW Canonical revision:3 commits (the Reversal source is now
    //    superseded — a later ADD_CLAIM exists on the current tip).
    await commitNextRevision(canonical, 3);

    // 3) Queue read triggers reconciliation, but the Reversal's CURRENT
    //    canonical eligibility is now stale/superseded → fail-closed: the
    //    SAME reversalId carrier is NOT regenerated and the newer Canonical
    //    change is never folded into the Reversal impact.
    const queue = await post(application, cookie, token, '/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    expect(queue.statusCode).toBe(200);
    const queueBody = queue.json<{
      items: readonly { targetId: string }[];
    }>();
    expect(queueBody.items.find((item) => item.targetId === reversalId)).toBeUndefined();

    // 4) The carrier is NOT regenerated, but the authoritative Reversal is
    //    still durable (never deleted — recovery is not rollback).
    const carrier = (await draftRepository.transaction(({ drafts }) =>
      drafts.findById(PROJECT_ID, reversalId),
    )) as FrontendKnowledgeDraftChangeSetV1 | undefined;
    expect(carrier).toBeUndefined();
    const still = await application.repositories.reviews.findReversalById(PROJECT_ID, reversalId);
    expect(still?.status).toBe('CANDIDATE');

    await application.server.close();
  });
});
