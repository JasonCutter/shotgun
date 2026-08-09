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
    const canonical = await seedCanonical();
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
});
