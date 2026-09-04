import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-in-memory/src/index.js';
import { InMemoryFrontendKnowledgeDraftTargetResolver } from '../../adapters/frontend-knowledge-draft-api-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  FrontendKnowledgeDraftProductCoordinator,
  frontendKnowledgeDraftMaterializeDigest,
  frontendKnowledgeDraftSaveDigest,
} from '../../modules/frontend-knowledge-draft/src/product-api.js';
import { frontendKnowledgeDraftRevisionDigest } from '../../modules/frontend-knowledge-draft/src/index.js';
import type {
  AcceptFrontendCommandInput,
  CompleteFrontendCommandInput,
} from '../../modules/frontend-command-gateway/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeOperationV1,
  type MaterializeDraftRequestV1,
  type SaveKnowledgeDraftRequestV1,
} from '../../packages/contracts/src/index.js';
import { pBase, pOperation } from '../helpers/frontend-knowledge-draft-parity.js';

const PROJECT_ID = 'shotgun';

const base = (
  overrides: Partial<FrontendKnowledgeDraftBaseV1> = {},
): FrontendKnowledgeDraftBaseV1 =>
  ({ ...pBase, resourceProjectId: PROJECT_ID, ...overrides }) as FrontendKnowledgeDraftBaseV1;

class CountingTargetResolver extends InMemoryFrontendKnowledgeDraftTargetResolver {
  resolveSeedCalls = 0;
  override async resolveSeed(
    input: Parameters<InMemoryFrontendKnowledgeDraftTargetResolver['resolveSeed']>[0],
  ) {
    this.resolveSeedCalls += 1;
    return super.resolveSeed(input);
  }
}

class FailingCompleteGateway extends InMemoryFrontendCommandGateway {
  failComplete = false;
  override async completeInTransaction(transaction: unknown, input: CompleteFrontendCommandInput) {
    if (this.failComplete) throw new Error('simulated Ledger COMPLETED failure');
    return super.completeInTransaction(transaction, input);
  }
}

describe('FE-P3-S2 Knowledge Draft Product API foundation', () => {
  let auth: InMemoryAuthRepository;

  beforeEach(() => {
    auth = new InMemoryAuthRepository();
  });

  const projectSession = async () => {
    await auth.bootstrapOwner({
      accountId: 'draft-api-owner',
      projectId: PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('draft-api-owner');
    if (!principal) throw new Error('Draft API fixture Principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      PROJECT_ID,
      new Date(Date.now() + 60_000).toISOString(),
    );
    return `shotgun_session=${session.sessionToken}`;
  };

  const buildApplication = async (resolver: InMemoryFrontendKnowledgeDraftTargetResolver) => {
    const coordinator = new FrontendKnowledgeDraftProductCoordinator(
      new InMemoryFrontendKnowledgeDraftRepository(),
      new InMemoryFrontendCommandGateway(),
      resolver,
    );
    return createApplication({
      authRepository: auth,
      frontendKnowledgeDraftCoordinator: coordinator,
    });
  };

  const csrf = async (application: Awaited<ReturnType<typeof createApplication>>, cookie: string) =>
    (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;

  const inject = async (
    application: Awaited<ReturnType<typeof createApplication>>,
    cookie: string,
    url: string,
    payload: object,
  ) => {
    const token = await csrf(application, cookie);
    return application.server.inject({
      method: 'POST',
      url,
      headers: { cookie, 'x-csrf-token': token },
      payload,
    });
  };

  const envelope = (clientRequestId: string, extra: Record<string, unknown> = {}) => ({
    schemaVersion: '1.0.0' as const,
    clientRequestId,
    idempotencyKey: `key-${clientRequestId}`,
    ...extra,
  });

  const registerAccepted = async (input: {
    readonly gateway: InMemoryFrontendCommandGateway;
    readonly principalId: string;
    readonly commandType: string;
    readonly clientRequestId: string;
    readonly idempotencyKey: string;
    readonly commandSemanticDigest: string;
    readonly payload: object;
  }) => {
    const now = new Date().toISOString();
    const acceptInput: AcceptFrontendCommandInput = {
      commandId: `cmd-registered-${input.clientRequestId}`,
      commandRevision: '1',
      principalId: input.principalId,
      request: {
        envelopeVersion: '1.0.0',
        commandType: input.commandType,
        commandSchemaVersion: '1.0.0',
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
        projectContext: {
          activeProjectId: PROJECT_ID,
          targetProjectId: PROJECT_ID,
          resourceProjectId: PROJECT_ID,
          observedProjectAccessRevision: 'access-7',
        },
        policyBinding: { mode: 'CURRENT', observedPolicyContextRevision: '7' },
        preconditions: [],
        clientIssuedAt: now,
        payload: input.payload,
      },
      commandSemanticDigest: input.commandSemanticDigest,
      acceptedPolicyContext: {
        policyContextId: 'frontend-knowledge-draft-current-policy',
        policyContextRevision: '7',
        acceptedAt: now,
      },
      correlationId: 'corr-test',
      traceId: 'trace-test',
      receivedAt: now,
      acceptedAt: now,
    };
    await input.gateway.accept(acceptInput);
  };

  it('materializes a Seed into a server-authoritative Draft and replays idempotently', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const application = await buildApplication(resolver);
    const cookie = await projectSession();

    const first = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{
      outcome: string;
      draft: {
        draftId: string;
        seedId: string;
        startMode: string;
        revision: number;
        resourceProjectId: string;
        effectiveProjectId: string;
      };
    }>();
    expect(firstBody.outcome).toBe('COMPLETED');
    expect(firstBody.draft.seedId).toBe('seed-1');
    expect(firstBody.draft.startMode).toBe('SEED_MATERIALIZATION');
    expect(firstBody.draft.revision).toBe(1);
    expect(firstBody.draft.resourceProjectId).toBe(PROJECT_ID);
    expect(firstBody.draft.effectiveProjectId).toBe(PROJECT_ID);

    // Same clientRequestId + same meaning replays the existing result.
    const replay = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ draft: { draftId: string } }>().draft.draftId).toBe(
      firstBody.draft.draftId,
    );

    // Same clientRequestId + different meaning fails closed with DIGEST_MISMATCH.
    const mismatch = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-2' }),
    );
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json<{ code: string }>().code).toBe('DIGEST_MISMATCH');
    await application.server.close();
  });

  it('starts a Seedless Knowledge Page Draft with a server-pinned base', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerPage('page-1', {
      resourceId: 'resource-page-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base({
        revisionIdentityKind: 'NEW_RESOURCE_SNAPSHOT',
        canonicalResourceId: undefined,
        canonicalRevisionId: undefined,
      }),
    });
    const application = await buildApplication(resolver);
    const cookie = await projectSession();
    const response = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/start-seedless',
      envelope('request-1', { pageId: 'page-1' }),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      draft: {
        seedId?: string;
        startMode: string;
        resourceId: string;
        base: { revisionIdentityKind: string };
      };
    }>();
    expect(body.draft.startMode).toBe('KNOWLEDGE_PAGE');
    expect(body.draft.seedId).toBeUndefined();
    expect(body.draft.resourceId).toBe('resource-page-1');
    expect(body.draft.base.revisionIdentityKind).toBe('NEW_RESOURCE_SNAPSHOT');
    await application.server.close();
  });

  it('saves a new Draft revision and records a REJECTED outcome on a stale save', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const application = await buildApplication(resolver);
    const cookie = await projectSession();
    const materialized = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    const draft = materialized.json<{
      draft: { draftId: string; base: FrontendKnowledgeDraftBaseV1 };
    }>().draft;
    const operations: readonly FrontendKnowledgeOperationV1[] = [pOperation(2)];
    const contentDigest = frontendKnowledgeDraftRevisionDigest({
      draftId: draft.draftId,
      revision: 2,
      base: draft.base,
      operations,
    });
    const savePayload = envelope('request-2', {
      draftId: draft.draftId,
      expectedDraftRevision: 1,
      expectedBaseRevision: draft.base.canonicalVersion,
      operationRevision: 2,
      operations,
      contentDigest,
    });
    const saved = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/save',
      savePayload,
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ draft: { revision: number } }>().draft.revision).toBe(2);

    // A stale save fails closed with DRAFT_REVISION_CONFLICT and the command
    // outcome is recorded as REJECTED (original identity resolves it).
    const stalePayload = envelope('request-3', {
      draftId: draft.draftId,
      expectedDraftRevision: 5,
      expectedBaseRevision: draft.base.canonicalVersion,
      operationRevision: 3,
      operations: [pOperation(3)],
      contentDigest: frontendKnowledgeDraftRevisionDigest({
        draftId: draft.draftId,
        revision: 3,
        base: draft.base,
        operations: [pOperation(3)],
      }),
    });
    const stale = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/save',
      stalePayload,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe('DRAFT_REVISION_CONFLICT');

    const resolved = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-3',
        idempotencyKey: 'key-request-3',
        semanticDigest: frontendKnowledgeDraftSaveDigest(
          stalePayload as unknown as SaveKnowledgeDraftRequestV1,
        ),
      },
    );
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<{ outcome: string }>().outcome).toBe('REJECTED');
    await application.server.close();
  });

  it('derives a deterministic, de-duplicated Evidence lineage for Review Submission', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const repository = new InMemoryFrontendKnowledgeDraftRepository();
    const coordinator = new FrontendKnowledgeDraftProductCoordinator(
      repository,
      new InMemoryFrontendCommandGateway(),
      resolver,
    );
    const application = await createApplication({
      authRepository: auth,
      frontendKnowledgeDraftRepository: repository,
      frontendKnowledgeDraftCoordinator: coordinator,
    });
    const cookie = await projectSession();

    const materialized = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    expect(materialized.statusCode).toBe(200);
    const draft = materialized.json<{
      draft: { draftId: string; base: FrontendKnowledgeDraftBaseV1 };
    }>().draft;

    const evidenceReferences = [
      { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
      { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-2' },
      // A repeated reference must not create a second Review Evidence entry.
      { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
    ] as const;
    const operations: readonly FrontendKnowledgeOperationV1[] = [
      { ...pOperation(2), evidenceReferences },
    ];
    const contentDigest = frontendKnowledgeDraftRevisionDigest({
      draftId: draft.draftId,
      revision: 2,
      base: draft.base,
      operations,
    });
    const saved = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/save',
      envelope('request-2', {
        draftId: draft.draftId,
        expectedDraftRevision: 1,
        expectedBaseRevision: draft.base.canonicalVersion,
        operationRevision: 2,
        operations,
        contentDigest,
      }),
    );
    expect(saved.statusCode).toBe(200);

    const validation = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/validate',
      envelope('request-3', {
        draftId: draft.draftId,
        expectedDraftRevision: 2,
        expectedBaseRevision: draft.base.canonicalVersion,
      }),
    );
    expect(validation.statusCode).toBe(200);
    const validationArtifact = validation.json<{ validation: object }>().validation;

    const impact = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/impact-preview',
      envelope('request-4', {
        draftId: draft.draftId,
        expectedDraftRevision: 2,
        expectedBaseRevision: draft.base.canonicalVersion,
      }),
    );
    expect(impact.statusCode).toBe(200);
    const impactArtifact = impact.json<{ impactPreview: object }>().impactPreview;

    const submitPayload = envelope('request-5', {
      draftId: draft.draftId,
      expectedDraftRevision: 2,
      expectedBaseRevision: draft.base.canonicalVersion,
      validationArtifact,
      impactArtifact,
    });
    const submitted = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/submit-review',
      submitPayload,
    );
    expect(submitted.statusCode).toBe(200);
    const submission = submitted.json<{
      reviewSubmission: { evidenceLineage: readonly unknown[] };
    }>().reviewSubmission;
    expect(submission.evidenceLineage).toEqual([evidenceReferences[0], evidenceReferences[1]]);

    const queue = await inject(application, cookie, '/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      pageSize: 50,
    });
    expect(queue.statusCode).toBe(200);
    const queueItem = queue
      .json<{
        items: readonly {
          reviewContextId: string;
          contextRevision: number;
          targetKind: string;
        }[];
      }>()
      .items.find((item) => item.targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET');
    expect(queueItem).toBeDefined();

    const context = await inject(
      application,
      cookie,
      '/product-api/frontend/review/contexts/read',
      {
        schemaVersion: '1.0.0',
        reviewContextId: queueItem!.reviewContextId,
        contextRevision: queueItem!.contextRevision,
      },
    );
    expect(context.statusCode).toBe(200);
    expect(
      context.json<{ context: { artifactRefs: { evidence?: object } } }>().context.artifactRefs
        .evidence,
    ).toBeDefined();

    const itemDetail = await inject(
      application,
      cookie,
      '/product-api/frontend/review/items/read',
      {
        schemaVersion: '1.0.0',
        reviewContextId: queueItem!.reviewContextId,
        contextRevision: queueItem!.contextRevision,
        reviewItemId: 'item-1',
        includeEvidence: true,
      },
    );
    expect(itemDetail.statusCode).toBe(200);
    expect(itemDetail.json<{ evidence: readonly unknown[] }>().evidence).toEqual([
      {
        schemaVersion: '1.0.0',
        sourceId: evidenceReferences[0].sourceId,
        sourceVersionId: evidenceReferences[0].sourceVersionId,
        evidenceSpanId: evidenceReferences[0].evidenceSpanId,
        snippet: 'Evidence span span-1 in source source-1.',
      },
      {
        schemaVersion: '1.0.0',
        sourceId: evidenceReferences[1].sourceId,
        sourceVersionId: evidenceReferences[1].sourceVersionId,
        evidenceSpanId: evidenceReferences[1].evidenceSpanId,
        snippet: 'Evidence span span-2 in source source-1.',
      },
    ]);

    // Replaying the same command reads the immutable submitted Draft and must
    // return exactly the same lineage, without creating another Evidence entry.
    const replayed = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/submit-review',
      submitPayload,
    );
    expect(replayed.statusCode).toBe(200);
    expect(
      replayed.json<{ reviewSubmission: { evidenceLineage: readonly unknown[] } }>()
        .reviewSubmission.evidenceLineage,
    ).toEqual(submission.evidenceLineage);
    await application.server.close();
  });

  it('abandons a Draft as persistent state', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const application = await buildApplication(resolver);
    const cookie = await projectSession();
    const materialized = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    const draft = materialized.json<{
      draft: { draftId: string; base: FrontendKnowledgeDraftBaseV1 };
    }>().draft;
    const abandoned = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/abandon',
      envelope('request-2', {
        draftId: draft.draftId,
        expectedDraftRevision: 1,
        expectedBaseRevision: draft.base.canonicalVersion,
      }),
    );
    expect(abandoned.statusCode).toBe(200);
    expect(abandoned.json<{ draft: { status: string } }>().draft.status).toBe('ABANDONED');

    // Abandoning an abandoned Draft is a conflict (terminal state).
    const again = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/abandon',
      envelope('request-3', {
        draftId: draft.draftId,
        expectedDraftRevision: 1,
        expectedBaseRevision: draft.base.canonicalVersion,
      }),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('DRAFT_REVISION_CONFLICT');
    await application.server.close();
  });

  it('resolves a completed outcome through the original command identity only', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const application = await buildApplication(resolver);
    const cookie = await projectSession();
    const materializePayload = envelope('request-1', { seedId: 'seed-1' });
    const materialized = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      materializePayload,
    );
    expect(materialized.statusCode).toBe(200);
    const draftId = materialized.json<{ draft: { draftId: string } }>().draft.draftId;

    const resolved = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-request-1',
        semanticDigest: frontendKnowledgeDraftMaterializeDigest(
          materializePayload as unknown as MaterializeDraftRequestV1,
        ),
      },
    );
    expect(resolved.statusCode).toBe(200);
    const body = resolved.json<{
      outcome: string;
      originalClientRequestId: string;
      draft: { draftId: string };
    }>();
    expect(body.outcome).toBe('COMPLETED');
    expect(body.originalClientRequestId).toBe('request-1');
    expect(body.draft.draftId).toBe(draftId);

    const digestMismatch = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-request-1',
        semanticDigest: 'sha256:wrong',
      },
    );
    expect(digestMismatch.statusCode).toBe(409);
    expect(digestMismatch.json<{ code: string }>().code).toBe('DIGEST_MISMATCH');

    const unknown = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-unknown',
        idempotencyKey: 'key-unknown',
        semanticDigest: 'sha256:unknown',
      },
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ code: string }>().code).toBe('OUTCOME_NOT_FOUND');
    await application.server.close();
  });

  it('rejects browser authority fields and unauthenticated / CSRF-less requests', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const application = await buildApplication(resolver);

    const noSession = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/drafts/materialize',
      payload: envelope('request-1', { seedId: 'seed-1' }),
    });
    expect(noSession.statusCode).toBe(401);

    const cookie = await projectSession();
    const noCsrf = await application.server.inject({
      method: 'POST',
      url: '/product-api/frontend/knowledge/drafts/materialize',
      headers: { cookie },
      payload: envelope('request-2', { seedId: 'seed-1' }),
    });
    expect(noCsrf.statusCode).toBe(403);

    const authorityInjected = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      {
        ...envelope('request-3', { seedId: 'seed-1' }),
        activeProjectId: 'browser-project',
        principalId: 'browser-principal',
        policyContextRevision: 'browser-policy',
      },
    );
    expect(authorityInjected.statusCode).toBe(403);
    expect(authorityInjected.json<{ code: string }>().code).toBe('PRECONDITION_ACCESS_DENIED');
    await application.server.close();
  });

  it('keeps the Draft and Ledger consistent when the COMPLETED transition fails', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const repository = new InMemoryFrontendKnowledgeDraftRepository();
    const gateway = new FailingCompleteGateway();
    const coordinator = new FrontendKnowledgeDraftProductCoordinator(repository, gateway, resolver);
    const application = await createApplication({
      authRepository: auth,
      frontendKnowledgeDraftCoordinator: coordinator,
    });
    const cookie = await projectSession();

    const materialized = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    expect(materialized.statusCode).toBe(200);
    const draft = materialized.json<{
      draft: { draftId: string; base: FrontendKnowledgeDraftBaseV1 };
    }>().draft;

    // The Draft write succeeds inside the transaction, then the Ledger
    // COMPLETED transition fails. The whole transaction must roll back.
    gateway.failComplete = true;
    const savePayload = envelope('request-2', {
      draftId: draft.draftId,
      expectedDraftRevision: 1,
      expectedBaseRevision: draft.base.canonicalVersion,
      operationRevision: 2,
      operations: [pOperation(2)],
      contentDigest: frontendKnowledgeDraftRevisionDigest({
        draftId: draft.draftId,
        revision: 2,
        base: draft.base,
        operations: [pOperation(2)],
      }),
    });
    const failed = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/save',
      savePayload,
    );
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);

    // The Draft revision was NOT committed (rolled back to revision 1).
    const after = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-request-1',
        semanticDigest: frontendKnowledgeDraftMaterializeDigest(
          envelope('request-1', { seedId: 'seed-1' }) as unknown as MaterializeDraftRequestV1,
        ),
      },
    );
    expect(after.statusCode).toBe(200);
    expect(after.json<{ draft: { revision: number } }>().draft.revision).toBe(1);

    // The uncertain command is OUTCOME_UNKNOWN, never a misleading
    // REJECTED or COMPLETED.
    const resolved = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-2',
        idempotencyKey: 'key-request-2',
        semanticDigest: frontendKnowledgeDraftSaveDigest(
          savePayload as unknown as SaveKnowledgeDraftRequestV1,
        ),
      },
    );
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<{ outcome: string }>().outcome).toBe('OUTCOME_UNKNOWN');
    await application.server.close();
  });

  it('never re-runs the action for a replayed ACCEPTED command', async () => {
    const resolver = new CountingTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const repository = new InMemoryFrontendKnowledgeDraftRepository();
    const gateway = new InMemoryFrontendCommandGateway();
    const coordinator = new FrontendKnowledgeDraftProductCoordinator(repository, gateway, resolver);
    const application = await createApplication({
      authRepository: auth,
      frontendKnowledgeDraftCoordinator: coordinator,
    });
    const cookie = await projectSession();
    const principal = await auth.findPrincipalByAccountId('draft-api-owner');
    if (!principal) throw new Error('Draft API fixture Principal was not created.');

    const materializeEnvelope = envelope('request-1', { seedId: 'seed-1' });
    // Pre-register an in-flight ACCEPTED command with the same identity, as
    // if a previous executor accepted but never completed it.
    await registerAccepted({
      gateway,
      principalId: principal.principalId,
      commandType: FRONTEND_KNOWLEDGE_DRAFT_COMMAND_TYPES.materialize,
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      commandSemanticDigest: frontendKnowledgeDraftMaterializeDigest(
        materializeEnvelope as unknown as MaterializeDraftRequestV1,
      ),
      payload: materializeEnvelope,
    });

    const response = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      materializeEnvelope,
    );
    // An unresolved in-flight command is OUTCOME_INDETERMINATE (503): it is
    // never auto re-executed and never mislabelled as a conflict.
    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe('OUTCOME_INDETERMINATE');
    // The action (which would call resolveSeed) was never executed.
    expect(resolver.resolveSeedCalls).toBe(0);
    await application.server.close();
  });

  it('returns the existing result for the same idempotency key and meaning with a new clientRequestId', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const application = await buildApplication(resolver);
    const cookie = await projectSession();

    const first = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-1', { seedId: 'seed-1' }),
    );
    expect(first.statusCode).toBe(200);
    const firstDraftId = first.json<{ draft: { draftId: string } }>().draft.draftId;

    // Same idempotency key + same command meaning, but a NEW clientRequestId.
    const second = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/materialize',
      envelope('request-2', { seedId: 'seed-1', idempotencyKey: 'key-request-1' }),
    );
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{
      clientRequestId: string;
      draft: { draftId: string };
    }>();
    expect(secondBody.clientRequestId).toBe('request-2');
    expect(secondBody.draft.draftId).toBe(firstDraftId);
    await application.server.close();
  });

  it('rejects resolve when the idempotency key or command type does not match', async () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: base(),
    });
    const repository = new InMemoryFrontendKnowledgeDraftRepository();
    const gateway = new InMemoryFrontendCommandGateway();
    const coordinator = new FrontendKnowledgeDraftProductCoordinator(repository, gateway, resolver);
    const application = await createApplication({
      authRepository: auth,
      frontendKnowledgeDraftCoordinator: coordinator,
    });
    const cookie = await projectSession();
    const principal = await auth.findPrincipalByAccountId('draft-api-owner');
    if (!principal) throw new Error('Draft API fixture Principal was not created.');

    const materializeEnvelope = envelope('request-1', { seedId: 'seed-1' });
    const digest = frontendKnowledgeDraftMaterializeDigest(
      materializeEnvelope as unknown as MaterializeDraftRequestV1,
    );
    // Register an outcome whose commandType is NOT in the FE-P3-S2 family
    // under the same client identity.
    await registerAccepted({
      gateway,
      principalId: principal.principalId,
      commandType: 'other.command.v1',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      commandSemanticDigest: digest,
      payload: materializeEnvelope,
    });

    // Wrong idempotency key: identity does not match -> OUTCOME_NOT_FOUND.
    const wrongKey = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-wrong',
        semanticDigest: digest,
      },
    );
    expect(wrongKey.statusCode).toBe(404);
    expect(wrongKey.json<{ code: string }>().code).toBe('OUTCOME_NOT_FOUND');

    // Correct idempotency key but non-Draft command type -> OUTCOME_NOT_FOUND.
    const wrongType = await inject(
      application,
      cookie,
      '/product-api/frontend/knowledge/drafts/resolve-outcome',
      {
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-request-1',
        semanticDigest: digest,
      },
    );
    expect(wrongType.statusCode).toBe(404);
    expect(wrongType.json<{ code: string }>().code).toBe('OUTCOME_NOT_FOUND');
    await application.server.close();
  });
});
