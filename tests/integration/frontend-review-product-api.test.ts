import { beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import {
  InMemoryFrontendReviewStore,
  DraftReviewTargetAdapter,
  DiscoveryCandidateReviewTargetAdapter,
  UserDirectiveReviewTargetAdapter,
  createInMemoryReviewDraftSourceReader,
  createInMemoryReviewDiscoveryCandidateReader,
  createInMemoryReviewUserDirectiveReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import { FrontendReviewProductCoordinator } from '../../modules/frontend-review/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  sha256Text,
  stableJson,
  type FrontendKnowledgeDraftChangeSetV1,
} from '../../packages/contracts/src/index.js';

const PROJECT_ID = 'shotgun';

const createSubmittedDraft = (): FrontendKnowledgeDraftChangeSetV1 => {
  const draftId = 'draft-1';
  const contentDigest = sha256Text(stableJson({ draftId, revision: 1 }));
  const reviewResource = {
    reviewResourceId: 'review-resource-1',
    draftId,
    draftRevision: 1,
    resourceProjectId: PROJECT_ID,
    draftProjectId: PROJECT_ID,
    effectiveProjectId: PROJECT_ID,
    policyContextRevision: '1',
    digest: contentDigest,
  };
  return {
    schemaVersion: '1.0.0',
    draftId,
    seedId: 'seed-1',
    startMode: 'SEED_MATERIALIZATION',
    status: 'SUBMITTED',
    revision: 1,
    activeProjectId: PROJECT_ID,
    resourceProjectId: PROJECT_ID,
    draftProjectId: PROJECT_ID,
    effectiveProjectId: PROJECT_ID,
    resourceId: 'resource-1',
    base: {
      resourceProjectId: PROJECT_ID,
      canonicalSnapshotId: 'canonical-snapshot-1',
      canonicalVersion: 3,
      canonicalSnapshotDigest: 'canonical-digest',
      accessRevision: 'access-1',
      policyContextRevision: '1',
      sourceLineage: [],
      revisionIdentityKind: 'RESOURCE_REVISION',
      canonicalResourceId: 'resource-1',
      canonicalRevisionId: 'canonical-revision-1',
    },
    operations: [
      {
        operationId: 'op-1',
        kind: 'FACT_ADD',
        baseRevision: 3,
        rationale: 'Add the founding fact.',
        evidenceReferences: [
          { sourceId: 'source-1', sourceVersionId: 'source-1-v2', evidenceSpanId: 'span-1' },
        ],
        expectedImpact: { summary: 'Introduces one canonical fact.' },
        operationRevision: 1,
        contentDigest: 'op-1-digest',
        target: { targetType: 'FACT', resourceId: 'resource-1' },
        after: {
          schemaVersion: 'fact.v1',
          subjectRef: 'resource-1',
          predicate: 'foundedIn',
          value: 2020,
        },
      },
    ],
    validation: {
      artifactId: 'validation-1',
      artifactRevision: 1,
      digest: 'validation-digest',
      status: 'COMPLETE',
      projectPolicyContext: {
        activeProjectId: PROJECT_ID,
        resourceProjectId: PROJECT_ID,
        draftProjectId: PROJECT_ID,
        effectiveProjectId: PROJECT_ID,
        accessRevision: 'access-1',
        policyContextRevision: '1',
      },
    },
    impactPreview: {
      artifactId: 'impact-1',
      artifactRevision: 1,
      digest: 'impact-digest',
      status: 'COMPLETE',
      projectPolicyContext: {
        activeProjectId: PROJECT_ID,
        resourceProjectId: PROJECT_ID,
        draftProjectId: PROJECT_ID,
        effectiveProjectId: PROJECT_ID,
        accessRevision: 'access-1',
        policyContextRevision: '1',
      },
    },
    reviewResource,
    reviewSubmission: {
      reviewSubmissionId: 'review-submission-1',
      draftId,
      draftRevision: 1,
      operationDigest: 'operation-digest',
      contentDigest,
      validationArtifact: {
        artifactId: 'validation-1',
        artifactRevision: 1,
        digest: 'validation-digest',
        status: 'COMPLETE',
        projectPolicyContext: {
          activeProjectId: PROJECT_ID,
          resourceProjectId: PROJECT_ID,
          draftProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          accessRevision: 'access-1',
          policyContextRevision: '1',
        },
      },
      impactArtifact: {
        artifactId: 'impact-1',
        artifactRevision: 1,
        digest: 'impact-digest',
        status: 'COMPLETE',
        projectPolicyContext: {
          activeProjectId: PROJECT_ID,
          resourceProjectId: PROJECT_ID,
          draftProjectId: PROJECT_ID,
          effectiveProjectId: PROJECT_ID,
          accessRevision: 'access-1',
          policyContextRevision: '1',
        },
      },
      evidenceLineage: [
        { sourceId: 'source-1', sourceVersionId: 'source-1-v2', evidenceSpanId: 'span-1' },
      ],
      projectPolicyContext: {
        activeProjectId: PROJECT_ID,
        resourceProjectId: PROJECT_ID,
        draftProjectId: PROJECT_ID,
        effectiveProjectId: PROJECT_ID,
        accessRevision: 'access-1',
        policyContextRevision: '1',
      },
      reviewResource,
    },
    contentDigest,
    createdAt: '2026-08-04T10:00:00.000Z',
    updatedAt: '2026-08-04T10:00:00.000Z',
  };
};

describe('FE-P4-S1 Review Center Product API', () => {
  let auth: InMemoryAuthRepository;
  let draftRepository: InMemoryFrontendKnowledgeDraftRepository;

  beforeEach(() => {
    auth = new InMemoryAuthRepository();
    draftRepository = new InMemoryFrontendKnowledgeDraftRepository();
    draftRepository.drafts.set(`${PROJECT_ID}:draft-1`, createSubmittedDraft());
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'review-api-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('review-api-owner');
    if (!principal) throw new Error('Review API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    return `shotgun_session=${session.sessionToken}`;
  };

  const buildApplication = async () => {
    const reviewCoordinator = new FrontendReviewProductCoordinator(
      new InMemoryFrontendReviewStore(),
      new InMemoryFrontendCommandGateway(),
      [
        new DraftReviewTargetAdapter(createInMemoryReviewDraftSourceReader(draftRepository)),
        new DiscoveryCandidateReviewTargetAdapter(createInMemoryReviewDiscoveryCandidateReader()),
        new UserDirectiveReviewTargetAdapter(createInMemoryReviewUserDirectiveReader()),
      ],
    );
    return createApplication({
      authRepository: auth,
      frontendKnowledgeDraftRepository: draftRepository,
      frontendReviewCoordinator: reviewCoordinator,
    });
  };

  const csrf = async (application: Awaited<ReturnType<typeof createApplication>>, cookie: string) =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken?: string }>();

  it('lists the queue, reads a context and records a decision with an Approval', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };

    const queue = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/queue',
      headers,
      payload: { schemaVersion: '1.0.0', pageSize: 50 },
    });
    expect(queue.statusCode).toBe(200);
    const queueBody = queue.json<{
      items: { reviewContextId: string; contextRevision: number; targetKind: string }[];
    }>();
    const draftItem = queueBody.items.find(
      (item) => item.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );
    expect(draftItem).toBeDefined();

    const context = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/contexts/read',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        reviewContextId: draftItem!.reviewContextId,
        contextRevision: draftItem!.contextRevision,
      },
    });
    expect(context.statusCode).toBe(200);
    const contextBody = context.json<{
      context: {
        reviewContextId: string;
        targetKind: string;
        targetDigest: string;
        items: { reviewItemId: string }[];
        aggregateState: string;
      };
    }>();
    expect(contextBody.context.targetKind).toBe('KNOWLEDGE_DRAFT_CHANGE_SET');
    expect(contextBody.context.aggregateState).toBe('PENDING');

    const decisions = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/decisions',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-api-1',
        idempotencyKey: 'idem-api-1',
        reviewContextId: contextBody.context.reviewContextId,
        expectedContextRevision: draftItem!.contextRevision,
        expectedTargetRevision: '1',
        expectedTargetDigest: contextBody.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: contextBody.context.items[0]!.reviewItemId,
            intent: 'APPROVE',
            reason: 'Matches canonical evidence.',
          },
        ],
      },
    });
    expect(decisions.statusCode).toBe(200);
    const decisionsBody = decisions.json<{
      aggregateState: string;
      approvals: { approvalId: string; purpose: string }[];
    }>();
    expect(decisionsBody.aggregateState).toBe('APPROVED_READY');
    expect(decisionsBody.approvals[0]?.purpose).toBe('KNOWLEDGE_CANONICAL_CHANGE');

    const approval = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/approvals/read',
      headers,
      payload: { schemaVersion: '1.0.0', approvalId: decisionsBody.approvals[0]!.approvalId },
    });
    expect(approval.statusCode).toBe(200);
    const approvalBody = approval.json<{ approval: { status: string } }>();
    expect(approvalBody.approval.status).toBe('ACTIVE');
  });

  it('rejects an illegal partial approval with a typed failure envelope', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const headers = { cookie, 'x-csrf-token': token.csrfToken ?? '' };

    const queue = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/queue',
      headers,
      payload: { schemaVersion: '1.0.0', pageSize: 50 },
    });
    const queueBody = queue.json<{
      items: { reviewContextId: string; contextRevision: number; targetKind: string }[];
    }>();
    const item = queueBody.items.find(
      (candidate) => candidate.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET',
    );

    const context = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/contexts/read',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        reviewContextId: item!.reviewContextId,
        contextRevision: item!.contextRevision,
      },
    });
    const contextBody = context.json<{
      context: {
        reviewContextId: string;
        targetKind: string;
        targetDigest: string;
        items: { reviewItemId: string }[];
      };
    }>();

    // Reject with an unknown Item id -> typed REVIEW_ITEM_NOT_FOUND (404).
    const rejected = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/decisions',
      headers,
      payload: {
        schemaVersion: '1.0.0',
        clientRequestId: 'client-api-2',
        idempotencyKey: 'idem-api-2',
        reviewContextId: contextBody.context.reviewContextId,
        expectedContextRevision: item!.contextRevision,
        expectedTargetRevision: '1',
        expectedTargetDigest: contextBody.context.targetDigest,
        itemDecisions: [
          {
            schemaVersion: '1.0.0',
            reviewItemId: 'missing-item',
            intent: 'APPROVE',
            reason: 'N/A',
          },
        ],
      },
    });
    expect(rejected.statusCode).toBe(404);
    const envelope = rejected.json<{ code: string }>();
    expect(envelope.code).toBe('REVIEW_ITEM_NOT_FOUND');
  });

  it('does not expose a canonical merge route on the review API', async () => {
    const cookie = await projectSession();
    const app = await buildApplication();
    const token = await csrf(app, cookie);
    const response = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/review/merge',
      headers: { cookie, 'x-csrf-token': token.csrfToken ?? '' },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });
});
