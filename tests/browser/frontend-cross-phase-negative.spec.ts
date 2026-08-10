import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

type CrossPhaseBackend = {
  startFrontendCrossPhaseBackend(): Promise<{
    grantRollbackCapability(projectId: string): Promise<void>;
    computeDraftRevisionDigest(input: {
      draftId: string;
      revision: number;
      base: unknown;
      operations: readonly unknown[];
    }): string;
    close(): Promise<void>;
  }>;
};

/**
 * WP-XP3 — Cross-Phase negative deltas (IR r1 §4/§5; GPT AUTHORIZED).
 *
 * Only the NEW_CROSS_PHASE_DELTA negatives CP-NEG-01~06 get new journey-level
 * tests here; CP-NEG-07~10 are REUSE_ONLY and closed by citation in the
 * cross-phase evidence document.
 *
 *   CP-NEG-01  Frontend의 Principal·Project 권위 생성 금지 — forged bootstrap
 *              body is ignored (server-derived identity) and legacy authority
 *              headers are rejected on every phase route.
 *   CP-NEG-02  다른 Project Cache 재사용 금지 — an Active Project switch
 *              isolates reads across phases (Sources / Knowledge / Review /
 *              Activity).
 *   CP-NEG-03  민감 Resource 존재 노출 금지 — cross-project reads of real
 *              resource identities fail closed (NOT_FOUND / NOT_ISSUED).
 *   CP-NEG-04  Candidate 자동 Canonical 반영 금지 — an unapproved Draft is
 *              absent from Canonical after another change is committed.
 *   CP-NEG-05  Approval 우회 금지 — Execute requires an ACTIVE approval bound
 *              to the exact same Manifest (missing → denied; different
 *              manifest → denied).
 *   CP-NEG-06  Approval과 Commit·Execute 혼합 금지 — creating an Approval
 *              commits nothing and executes nothing (separate resources).
 *
 * Same production-parity backend (127.0.0.1:3002) and the same real-session +
 * CSRF discipline as the WP-XP2 journey. WP-XP1/XP2 exact-head suites and
 * CI #746/#748/#750/#751 are NOT re-run; this focused delta + the automatic
 * CI on the WP-XP3 head are the evidence.
 */

const BASE = 'http://127.0.0.1:3002';
const PROJECT_A = 'neg-alpha';
const PROJECT_B = 'neg-beta';

const getJson = async <T>(
  response: Response,
): Promise<{ ok: boolean; status: number; body: T }> => {
  const body = (await response.json()) as T;
  return { ok: response.ok, status: response.status, body };
};

test('Cross-Phase negative deltas CP-NEG-01~06 (no authority, switch isolation, non-disclosure, no auto-canonical, no approval bypass, no approval/commit/execute mix)', async () => {
  const fixture = (await tsImport(
    './fixtures/frontend-cross-phase-backend.ts',
    import.meta.url,
  )) as CrossPhaseBackend;
  const backend = await fixture.startFrontendCrossPhaseBackend();
  const uid = (prefix: string) => `${prefix}-${randomUUID()}`;
  const clientRequest = () => `cr-${randomUUID()}`;
  const idempotency = () => `idem-${randomUUID()}`;

  try {
    // ---------------------------------------------------------------------
    // Real session bootstrap + CSRF (same discipline as the WP-XP2 journey).
    // ---------------------------------------------------------------------
    const bootRes = await fetch(`${BASE}/api/v1/session/local-bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const bootJson = await getJson<{ session?: { principal?: { id?: string } } }>(bootRes);
    expect(bootJson.ok, JSON.stringify(bootJson.body)).toBe(true);
    const setCookie = bootRes.headers.get('set-cookie') ?? '';
    const match = /shotgun_session=([^;]+)/.exec(setCookie);
    const sessionToken = match?.[1] ?? '';
    expect(sessionToken.length).toBeGreaterThan(0);
    const cookie = `shotgun_session=${sessionToken}`;

    const csrfRes = await getJson<{ csrfToken?: string }>(
      await fetch(`${BASE}/api/v1/security/csrf`, { headers: { cookie } }),
    );
    expect(csrfRes.body.csrfToken).toBeTruthy();
    const csrfToken = csrfRes.body.csrfToken as string;

    const mutate = async (
      path: string,
      payload: unknown,
      rawBody?: string,
      extraHeaders?: Record<string, string>,
    ): Promise<{ ok: boolean; status: number; body: unknown }> => {
      const headers: Record<string, string> = { cookie, 'x-csrf-token': csrfToken };
      if (extraHeaders) Object.assign(headers, extraHeaders);
      headers['content-type'] =
        rawBody !== undefined ? 'application/octet-stream' : 'application/json';
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers,
        body: rawBody ?? JSON.stringify(payload),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        /* keep raw text */
      }
      return { ok: res.ok, status: res.status, body };
    };

    const get = async <T>(path: string): Promise<{ ok: boolean; status: number; body: T }> => {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
      return getJson<T>(res);
    };

    const commandEnvelope = (
      commandType: string,
      activeProjectId: string,
      payload: Record<string, unknown>,
    ) => ({
      envelopeVersion: '1.0.0',
      commandType,
      commandSchemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      projectContext: {
        activeProjectId,
        targetProjectId: activeProjectId,
        resourceProjectId: activeProjectId,
      },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [],
      clientIssuedAt: new Date().toISOString(),
      payload,
    });

    // ---------------------------------------------------------------------
    // CP-NEG-01 — Frontend의 Principal·Project 권위 생성 금지.
    // ---------------------------------------------------------------------
    // 1a. A forged bootstrap body can never author a Principal: the server
    // derives the identity from the loopback binding, never from the body.
    const forgedBoot = await fetch(`${BASE}/api/v1/session/local-bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        principalId: 'attacker-principal',
        projectId: 'attacker-project',
        scopes: ['owner'],
      }),
    });
    const forgedBootJson = await getJson<{ session?: { principal?: { id?: string } } }>(forgedBoot);
    expect(forgedBootJson.ok, JSON.stringify(forgedBootJson.body)).toBe(true);
    expect(
      forgedBootJson.body.session?.principal?.id,
      'CP-NEG-01: a client can never author a Principal via the bootstrap body',
    ).not.toBe('attacker-principal');

    // 1b. Legacy authority headers are rejected on EVERY phase route — the
    // journey browser requests never carry authority across any phase.
    const authorityHeaders: Record<string, string>[] = [
      { 'x-project-id': 'attacker-project' },
      { 'x-actor-id': 'attacker-principal' },
      { 'x-access-scope': 'owner' },
      { 'x-sensitivity': 'private' },
    ];
    const phaseWriteRoutes = [
      '/product-api/frontend/sources/query',
      '/product-api/frontend/knowledge/workspace',
      '/product-api/frontend/review/queue',
      '/product-api/frontend/activity/queue',
      '/product-api/frontend/history/workspace',
      '/product-api/frontend/external-action/queue',
      '/api/v1/projects',
    ];
    for (const route of phaseWriteRoutes) {
      for (const authority of authorityHeaders) {
        const rejected = await mutate(route, {}, undefined, authority);
        expect(
          rejected.status,
          `CP-NEG-01: ${route} rejects authority header ${Object.keys(authority)[0]}`,
        ).toBe(400);
        expect((rejected.body as { code?: string }).code).toBe('LEGACY_SECURITY_HEADER_FORBIDDEN');
      }
    }
    // GET phase routes reject authority headers too (sources detail).
    const forgedGet = await fetch(`${BASE}/product-api/frontend/sources/any-source-id`, {
      headers: { cookie, 'x-project-id': 'attacker-project' },
    });
    expect(forgedGet.status).toBe(400);
    expect(((await forgedGet.json()) as { code?: string }).code).toBe(
      'LEGACY_SECURITY_HEADER_FORBIDDEN',
    );

    // ---------------------------------------------------------------------
    // Setup: create the two projects (real governed commands, no authority).
    // ---------------------------------------------------------------------
    const existing = await get<{ projects?: { id?: string }[] }>('/api/v1/projects');
    const existingIds = (existing.body.projects ?? []).map((p) => p.id).filter(Boolean);
    for (const project of [PROJECT_A, PROJECT_B]) {
      if (existingIds.includes(project)) continue;
      const created = await mutate(
        '/api/v1/projects',
        commandEnvelope('project.create.v1', 'shotgun', {
          newProjectId: project,
          name: project,
          description: `Cross-Phase negative project ${project}`,
        }),
      );
      expect(created.ok, JSON.stringify(created.body)).toBe(true);
    }
    await backend.grantRollbackCapability(PROJECT_A);
    await backend.grantRollbackCapability(PROJECT_B);

    const switchProject = async (projectId: string) => {
      const switched = await mutate('/api/v1/session/active-project', { projectId });
      expect(switched.ok, JSON.stringify(switched.body)).toBe(true);
      return switched;
    };
    await switchProject(PROJECT_A);

    // ---------------------------------------------------------------------
    // Compact journey in Project A: real Source intake → Ask → Draft-1
    // (approved + committed) and Draft-2 (unapproved candidate).
    // ---------------------------------------------------------------------
    const draftId = `source-draft-${randomUUID()}`;
    const itemId = uid('source-item');
    const runSuffix = randomUUID().slice(0, 8);
    const sourceText =
      `Shotgun Sources neg run ${runSuffix}: the negative-journey founding source. ` +
      'The core claim is that unapproved candidates never auto-commit.';
    const stageQuery = new URLSearchParams({
      draftId,
      itemId,
      kind: 'DIRECT_TEXT',
      label: 'Negative journey founding source',
      mediaType: 'text/plain',
    }).toString();
    const staged = await mutate(
      `/product-api/frontend/sources/staging/bytes?${stageQuery}`,
      undefined,
      sourceText,
    );
    expect(staged.ok, JSON.stringify(staged.body)).toBe(true);
    const stagingReference = (staged.body as { receipt?: { stagingReference?: string } }).receipt
      ?.stagingReference;
    expect(stagingReference).toBeTruthy();
    const submitted = await mutate(
      '/product-api/frontend/sources/submissions',
      commandEnvelope('sources.intake.submit.v1', PROJECT_A, {
        draftId,
        inputs: [
          {
            itemId,
            kind: 'DIRECT_TEXT',
            label: 'Negative journey founding source',
            stagingReference,
          },
        ],
      }),
    );
    expect(submitted.ok, JSON.stringify(submitted.body)).toBe(true);
    const submissionId = (submitted.body as { submission?: { submissionId?: string } }).submission
      ?.submissionId;
    expect(submissionId).toBeTruthy();
    let submissionState = '';
    for (let attempt = 0; attempt < 40 && submissionState !== 'SUCCEEDED'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const s = await get<{ submission?: { state?: string } }>(
        `/product-api/frontend/sources/submissions/${submissionId}`,
      );
      submissionState = s.body.submission?.state ?? '';
    }
    expect(submissionState, 'intake should succeed').toBe('SUCCEEDED');
    const library = await mutate('/product-api/frontend/sources/query', {
      schemaVersion: '1.0.0',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 20,
    });
    const page = library.body as {
      page?: { items?: { sourceId?: string; selectedSourceVersionId?: string }[] };
    };
    const sourceId = page.page?.items?.[0]?.sourceId;
    const sourceVersionId = page.page?.items?.[0]?.selectedSourceVersionId;
    expect(sourceId, 'source should be processed into the library').toBeTruthy();
    expect(sourceVersionId).toBeTruthy();

    const evidenceList = await get<{ evidence?: { items?: { evidenceId?: string }[] } }>(
      `/product-api/frontend/sources/${sourceId}/versions/${sourceVersionId}/evidence`,
    );
    const pinnedEvidenceIds = (evidenceList.body.evidence?.items ?? [])
      .map((item) => item.evidenceId)
      .filter((id): id is string => Boolean(id));
    expect(pinnedEvidenceIds.length).toBeGreaterThan(0);

    // Ask → transition-seed → materialize (Draft-1 target).
    const ask = await mutate('/product-api/frontend/ask/questions', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      question: 'What is the approved claim of the negative journey?',
      mode: 'SOURCE_EXPLORATION',
      sourceSelections: [{ sourceId, sourceVersionId, evidenceIds: pinnedEvidenceIds }],
    });
    expect(ask.ok, JSON.stringify(ask.body)).toBe(true);
    const answerRunId = (ask.body as { submission?: { answerRun?: { answerRunId?: string } } })
      .submission?.answerRun?.answerRunId;
    expect(answerRunId).toBeTruthy();
    let answerState = '';
    let answerRunView: {
      answerRun?: {
        state?: string;
        statements?: {
          text?: string;
          citations?: { sourceId?: string; sourceVersionId?: string; evidenceId?: string }[];
        }[];
      };
    } = {};
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const view = await get<typeof answerRunView>(
        `/product-api/frontend/ask/answer-runs/${answerRunId}`,
      );
      answerRunView = view.body;
      answerState = view.body.answerRun?.state ?? '';
      if (answerState === 'SUCCEEDED' || answerState === 'FAILED') break;
    }
    expect(answerState, 'answer run should succeed').toBe('SUCCEEDED');
    const citation = answerRunView.answerRun?.statements?.[0]?.citations?.[0];
    const evidenceSpanId = citation?.evidenceId;
    expect(evidenceSpanId).toBeTruthy();

    const transitioned = await mutate(
      `/product-api/frontend/ask/answer-runs/${answerRunId}/transition-seed`,
      {
        schemaVersion: '1.0.0',
        clientRequestId: clientRequest(),
        idempotencyKey: idempotency(),
        kind: 'DRAFT_CHANGE_SET',
      },
    );
    expect(transitioned.ok, JSON.stringify(transitioned.body)).toBe(true);
    const seedId = (transitioned.body as { seed?: { seedId?: string } }).seed?.seedId;
    expect(seedId).toBeTruthy();
    const materialized = await mutate('/product-api/frontend/knowledge/drafts/materialize', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      seedId,
    });
    expect(materialized.ok, JSON.stringify(materialized.body)).toBe(true);
    const materializedDraft = (
      materialized.body as {
        draft?: {
          draftId?: string;
          revision?: number;
          resourceId?: string;
          base?: { canonicalVersion?: number; canonicalSnapshotDigest?: string };
        };
      }
    ).draft;
    const draft1Id = materializedDraft?.draftId;
    const draft1Revision = materializedDraft?.revision ?? 0;
    const draft1BaseRevision = materializedDraft?.base?.canonicalVersion ?? 0;
    expect(draft1Id).toBeTruthy();

    const alphaOperationId = uid('operation-alpha');
    const alphaStatement = 'CP-NEG-04 alpha: the approved claim that must appear in Canonical.';
    const alphaOperation = {
      operationId: alphaOperationId,
      kind: 'CLAIM_ADD',
      target: { targetType: 'CLAIM', resourceId: materializedDraft?.resourceId },
      baseRevision: draft1BaseRevision,
      rationale: 'The approved negative-journey claim.',
      evidenceReferences: [{ sourceId, sourceVersionId, evidenceSpanId: evidenceSpanId! }],
      expectedImpact: { summary: 'One approved claim is added to Canonical.' },
      operationRevision: 2,
      contentDigest: `sha256:${'c'.repeat(64)}`,
      after: {
        schemaVersion: 'claim.v1',
        statement: alphaStatement,
      },
    };
    const alphaDigest = backend.computeDraftRevisionDigest({
      draftId: draft1Id!,
      revision: draft1Revision + 1,
      base: materializedDraft?.base,
      operations: [alphaOperation],
    });
    const alphaSaved = await mutate('/product-api/frontend/knowledge/drafts/save', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft1Id,
      expectedDraftRevision: draft1Revision,
      expectedBaseRevision: draft1BaseRevision,
      operationRevision: 2,
      operations: [alphaOperation],
      contentDigest: alphaDigest,
    });
    expect(alphaSaved.ok, JSON.stringify(alphaSaved.body)).toBe(true);
    const alphaNextRevision =
      (alphaSaved.body as { draft?: { revision?: number } }).draft?.revision ?? draft1Revision + 1;
    const alphaValidated = await mutate('/product-api/frontend/knowledge/drafts/validate', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft1Id,
      expectedDraftRevision: alphaNextRevision,
      expectedBaseRevision: draft1BaseRevision,
    });
    expect(alphaValidated.ok, JSON.stringify(alphaValidated.body)).toBe(true);
    const alphaImpacted = await mutate('/product-api/frontend/knowledge/drafts/impact-preview', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft1Id,
      expectedDraftRevision: alphaNextRevision,
      expectedBaseRevision: draft1BaseRevision,
    });
    expect(alphaImpacted.ok, JSON.stringify(alphaImpacted.body)).toBe(true);
    const alphaSubmitted = await mutate('/product-api/frontend/knowledge/drafts/submit-review', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft1Id,
      expectedDraftRevision: alphaNextRevision,
      expectedBaseRevision: draft1BaseRevision,
      validationArtifact: (alphaValidated.body as { validation?: unknown }).validation,
      impactArtifact: (alphaImpacted.body as { impactPreview?: unknown }).impactPreview,
    });
    expect(alphaSubmitted.ok, JSON.stringify(alphaSubmitted.body)).toBe(true);
    const alphaContentDigest = (
      alphaSubmitted.body as { reviewSubmission?: { contentDigest?: string } }
    ).reviewSubmission?.contentDigest;
    expect(alphaContentDigest).toBeTruthy();

    // ---------------------------------------------------------------------
    // CP-NEG-06a — Approval ≠ Commit: creating the Approval for Draft-1 must
    // cause NO Canonical change (canonicalVersion/digest stay at the base).
    // ---------------------------------------------------------------------
    const alphaQueue = await mutate('/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      targetKinds: ['KNOWLEDGE_DRAFT_CHANGE_SET'],
      pageSize: 20,
    });
    const alphaQueueBody = alphaQueue.body as {
      items?: { reviewContextId?: string; contextRevision?: number; targetId?: string }[];
    };
    const alphaQueueItem = (alphaQueueBody.items ?? []).find((item) => item.targetId === draft1Id);
    expect(alphaQueueItem, 'Draft-1 should appear in the review queue').toBeTruthy();
    const alphaContext = await mutate('/product-api/frontend/review/contexts/read', {
      schemaVersion: '1.0.0',
      reviewContextId: alphaQueueItem!.reviewContextId,
      contextRevision: alphaQueueItem!.contextRevision,
    });
    const alphaCtx = alphaContext.body as {
      context?: {
        targetRevision?: string;
        targetDigest?: string;
        items?: { reviewItemId?: string }[];
      };
    };
    expect(alphaCtx.context?.targetDigest).toBe(alphaContentDigest);
    const alphaRecorded = await mutate('/product-api/frontend/review/decisions', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      reviewContextId: alphaQueueItem!.reviewContextId,
      expectedContextRevision: alphaQueueItem!.contextRevision,
      expectedTargetRevision: alphaCtx.context?.targetRevision,
      expectedTargetDigest: alphaCtx.context?.targetDigest,
      itemDecisions: (alphaCtx.context?.items ?? []).map((item) => ({
        schemaVersion: '1.0.0',
        reviewItemId: item.reviewItemId,
        intent: 'APPROVE',
        reason: 'Approved in the negative journey.',
      })),
      comment: 'Approved Draft-1 (CP-NEG-06a).',
    });
    expect(alphaRecorded.ok, JSON.stringify(alphaRecorded.body)).toBe(true);
    const alphaApproval = (
      alphaRecorded.body as {
        approvals?: { approvalId?: string; status?: string }[];
      }
    ).approvals?.[0];
    expect(alphaApproval?.approvalId).toBeTruthy();
    expect(alphaApproval?.status).toBe('ACTIVE');
    const approval1Id = alphaApproval!.approvalId;

    const workspaceAfterApproval = await mutate('/product-api/frontend/knowledge/workspace', {
      schemaVersion: '1.0.0',
    });
    const afterApprovalView = workspaceAfterApproval.body as {
      workspace?: { projection?: { canonicalVersion?: number; canonicalSnapshotDigest?: string } };
    };
    expect(
      afterApprovalView.workspace?.projection?.canonicalVersion,
      'CP-NEG-06a: Approval alone must not advance Canonical',
    ).toBe(draft1BaseRevision);
    expect(afterApprovalView.workspace?.projection?.canonicalSnapshotDigest).toBe(
      materializedDraft?.base?.canonicalSnapshotDigest,
    );

    // Commit Draft-1 (the only approved change).
    const approvalRead = await mutate('/product-api/frontend/review/approvals/read', {
      schemaVersion: '1.0.0',
      approvalId: approval1Id,
    });
    const approvalStatusRevision =
      (approvalRead.body as { approvalStatusRevision?: number }).approvalStatusRevision ?? 1;
    const alphaCommitted = await mutate('/product-api/frontend/knowledge/drafts/commit', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft1Id,
      approvalId: approval1Id,
      expectedApprovalRevision: approvalStatusRevision,
    });
    expect(alphaCommitted.ok, JSON.stringify(alphaCommitted.body)).toBe(true);
    const canonicalCommitId = (alphaCommitted.body as { commitIds?: string[] }).commitIds?.[0];
    expect(canonicalCommitId).toBeTruthy();

    // ---------------------------------------------------------------------
    // CP-NEG-04 — Candidate 자동 Canonical 반영 금지: Draft-2 is a real
    // unapproved candidate; after Draft-1's commit its claim must be ABSENT
    // from Canonical while Draft-1's claim IS present.
    // ---------------------------------------------------------------------
    // Draft-2 targets the now-committed canonical claim (seedless resource).
    const claim1Id = `claim:${alphaOperationId}`;
    const seedless = await mutate('/product-api/frontend/knowledge/drafts/start-seedless', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      resourceId: claim1Id,
    });
    expect(seedless.ok, JSON.stringify(seedless.body)).toBe(true);
    const seedlessDraft = (
      seedless.body as {
        draft?: {
          draftId?: string;
          revision?: number;
          resourceId?: string;
          base?: { canonicalVersion?: number };
        };
      }
    ).draft;
    const draft2Id = seedlessDraft?.draftId;
    const draft2Revision = seedlessDraft?.revision ?? 0;
    const draft2BaseRevision = seedlessDraft?.base?.canonicalVersion ?? 0;
    expect(draft2Id).toBeTruthy();

    const betaOperationId = uid('operation-beta');
    const betaStatement =
      'CP-NEG-04 beta: the unapproved candidate that must NEVER appear in Canonical.';
    const betaOperation = {
      operationId: betaOperationId,
      kind: 'CLAIM_ADD',
      target: { targetType: 'CLAIM', resourceId: seedlessDraft?.resourceId },
      baseRevision: draft2BaseRevision,
      rationale: 'The unapproved negative-journey candidate.',
      evidenceReferences: [{ sourceId, sourceVersionId, evidenceSpanId: evidenceSpanId! }],
      expectedImpact: { summary: 'One unapproved claim is added to Canonical.' },
      operationRevision: 2,
      contentDigest: `sha256:${'d'.repeat(64)}`,
      after: {
        schemaVersion: 'claim.v1',
        statement: betaStatement,
      },
    };
    const betaDigest = backend.computeDraftRevisionDigest({
      draftId: draft2Id!,
      revision: draft2Revision + 1,
      base: seedlessDraft?.base,
      operations: [betaOperation],
    });
    const betaSaved = await mutate('/product-api/frontend/knowledge/drafts/save', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft2Id,
      expectedDraftRevision: draft2Revision,
      expectedBaseRevision: draft2BaseRevision,
      operationRevision: 2,
      operations: [betaOperation],
      contentDigest: betaDigest,
    });
    expect(betaSaved.ok, JSON.stringify(betaSaved.body)).toBe(true);
    const betaNextRevision =
      (betaSaved.body as { draft?: { revision?: number } }).draft?.revision ?? draft2Revision + 1;
    const betaValidated = await mutate('/product-api/frontend/knowledge/drafts/validate', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft2Id,
      expectedDraftRevision: betaNextRevision,
      expectedBaseRevision: draft2BaseRevision,
    });
    expect(betaValidated.ok, JSON.stringify(betaValidated.body)).toBe(true);
    const betaImpacted = await mutate('/product-api/frontend/knowledge/drafts/impact-preview', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft2Id,
      expectedDraftRevision: betaNextRevision,
      expectedBaseRevision: draft2BaseRevision,
    });
    expect(betaImpacted.ok, JSON.stringify(betaImpacted.body)).toBe(true);
    const betaSubmitted = await mutate('/product-api/frontend/knowledge/drafts/submit-review', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: draft2Id,
      expectedDraftRevision: betaNextRevision,
      expectedBaseRevision: draft2BaseRevision,
      validationArtifact: (betaValidated.body as { validation?: unknown }).validation,
      impactArtifact: (betaImpacted.body as { impactPreview?: unknown }).impactPreview,
    });
    expect(betaSubmitted.ok, JSON.stringify(betaSubmitted.body)).toBe(true);
    // Draft-2 stays a review candidate — NO decision is recorded.

    const workspaceAfterCommit = await mutate('/product-api/frontend/knowledge/workspace', {
      schemaVersion: '1.0.0',
    });
    const afterCommitView = workspaceAfterCommit.body as {
      workspace?: {
        projectId?: string;
        projection?: { canonicalVersion?: number };
      };
    };
    expect(afterCommitView.workspace?.projectId).toBe(PROJECT_A);
    expect(
      afterCommitView.workspace?.projection?.canonicalVersion,
      'CP-NEG-04: the approved Draft-1 commit advances Canonical',
    ).toBeGreaterThan(draft1BaseRevision);
    // The Canonical page for the source must expose the APPROVED claim and
    // must NOT expose the unapproved candidate claim.
    const detail = await mutate('/product-api/frontend/knowledge/detail', {
      schemaVersion: '1.0.0',
      resourceId: sourceId,
    });
    expect(detail.ok, JSON.stringify(detail.body)).toBe(true);
    const detailView = detail.body as {
      detail?: {
        resourceId?: string;
        page?: {
          resourceId?: string;
          items?: { label?: string; content?: string; authority?: string }[];
        };
      };
    };
    expect(detailView.detail?.page?.resourceId).toBe(sourceId);
    const detailLabels = (detailView.detail?.page?.items ?? []).map(
      (item) => `${item.label ?? ''} ${item.content ?? ''}`,
    );
    expect(
      detailLabels.some((label) => label.includes('CP-NEG-04 alpha')),
      'CP-NEG-04: the approved claim IS reflected in Canonical',
    ).toBe(true);
    expect(
      detailLabels.some((label) => label.includes('CP-NEG-04 beta')),
      'CP-NEG-04: the unapproved candidate must NOT be reflected in Canonical',
    ).toBe(false);

    // ---------------------------------------------------------------------
    // External Action negatives (CP-NEG-05 Approval 우회 금지; CP-NEG-06
    // Approval ≠ Commit ≠ Execute). One action exercises all deltas:
    //   validate(1) → prepare#1(2) → [05a preflight w/o approval DENIED] →
    //   approve#1(3) → [06b no execution] → prepare#2(4, new manifest) →
    //   [05b preflight DENIED: approval binds the OLD manifest] →
    //   approve#2(5) → preflight(6, READY) → execute(7, SUCCESS).
    // ---------------------------------------------------------------------
    const action1Id = uid('action1');
    const candidate1Id = uid('candidate1');
    const targetRevision = 'rev-1';
    const externalRevision = 'ext-1';
    const action1Params = `${action1Id}:param`;
    const validate1 = await mutate('/product-api/frontend/external-action/validate', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      candidateId: candidate1Id,
      operation: 'UPDATE_REVERSIBLE',
      targetRef: {
        schemaVersion: '1.0.0',
        targetKind: 'KNOWN_TARGET',
        targetId: canonicalCommitId,
        targetRevision,
        externalRevision,
      },
      parameterRef: {
        schemaVersion: '1.0.0',
        parameterId: action1Params,
        parameterRevision: '1',
        parameterDigest: `sha256:${'e'.repeat(64)}`,
      },
      evidenceRefs: [],
      reason: 'Negative-journey action 1.',
    });
    expect(validate1.ok, JSON.stringify(validate1.body)).toBe(true);
    const prepare1 = await mutate('/product-api/frontend/external-action/prepare', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      expectedActionRevision: 1,
      reason: 'Prepare negative-journey action 1.',
    });
    expect(prepare1.ok, JSON.stringify(prepare1.body)).toBe(true);
    const manifest1 = (
      prepare1.body as {
        manifest?: {
          manifestId?: string;
          manifestRevision?: number;
          targetRevision?: string;
          externalRevision?: string;
        };
      }
    ).manifest;
    const manifest1Id = manifest1?.manifestId;
    const manifest1Revision = manifest1?.manifestRevision ?? 1;
    const manifest1TargetRevision = manifest1?.targetRevision ?? targetRevision;
    const manifest1ExternalRevision = manifest1?.externalRevision ?? externalRevision;
    expect(manifest1Id).toBeTruthy();

    // CP-NEG-05a — Approval 우회 금지: an unapproved action cannot even be
    // preflighted (a hard prerequisite of Execute), so Execute can never be
    // reached without an ACTIVE approval — 403 ACTION_APPROVAL_REQUIRED.
    const preflightWithoutApproval = await mutate(
      '/product-api/frontend/external-action/preflight',
      {
        schemaVersion: '1.0.0',
        clientRequestId: clientRequest(),
        idempotencyKey: idempotency(),
        actionId: action1Id,
        expectedActionRevision: 2,
        manifestRevision: manifest1Revision,
        expectedExternalRevision: manifest1ExternalRevision,
        reason: 'Try to preflight without approval.',
      },
    );
    expect(
      preflightWithoutApproval.status,
      'CP-NEG-05a: preflight (and therefore Execute) requires an ACTIVE approval',
    ).toBe(403);
    expect((preflightWithoutApproval.body as { code?: string }).code).toBe(
      'ACTION_APPROVAL_REQUIRED',
    );

    // Approve action-1 on its own manifest (rev 3).
    const approve1 = await mutate('/product-api/frontend/external-action/approve', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      manifestId: manifest1Id,
      manifestRevision: manifest1Revision,
      expectedTargetRevision: manifest1TargetRevision,
      expectedExternalRevision: manifest1ExternalRevision,
      reason: 'Approve negative-journey action 1.',
    });
    expect(approve1.ok, JSON.stringify(approve1.body)).toBe(true);
    const approvalA1 = (approve1.body as { approval?: { approvalId?: string; status?: string } })
      .approval;
    expect(approvalA1?.status).toBe('ACTIVE');

    // CP-NEG-06b — Approval ≠ Execute: after approving action-1, NO execution
    // exists yet (the Approval Resource is distinct from an Execution).
    const noExecutionYet = await mutate('/product-api/frontend/external-action/executions/read', {
      schemaVersion: '1.0.0',
      actionId: action1Id,
    });
    expect(noExecutionYet.status, 'CP-NEG-06b: Approval alone must not create an Execution').toBe(
      404,
    );
    expect((noExecutionYet.body as { code?: string }).code).toBe('EXTERNAL_ACTION_NOT_FOUND');

    // CP-NEG-05b — the approved manifest is re-prepared (a NEW manifest
    // identity/revision), so the ACTIVE approval no longer binds the current
    // manifest. Preflight must DENY with ACTION_APPROVAL_INVALID — an approval
    // never authorizes a different manifest without re-approval.
    const prepare2 = await mutate('/product-api/frontend/external-action/prepare', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      expectedActionRevision: 3,
      reason: 'Re-prepare action 1 with a new manifest revision.',
    });
    expect(prepare2.ok, JSON.stringify(prepare2.body)).toBe(true);
    const manifest2 = (
      prepare2.body as {
        manifest?: {
          manifestId?: string;
          manifestRevision?: number;
          targetRevision?: string;
          externalRevision?: string;
        };
      }
    ).manifest;
    const manifest2Id = manifest2?.manifestId;
    const manifest2Revision = manifest2?.manifestRevision ?? 2;
    const manifest2TargetRevision = manifest2?.targetRevision ?? targetRevision;
    const manifest2ExternalRevision = manifest2?.externalRevision ?? externalRevision;
    expect(manifest2Id).toBeTruthy();
    expect(manifest2Id, 'CP-NEG-05b: the re-prepared manifest is a new identity').not.toBe(
      manifest1Id,
    );
    const preflightAfterManifestChange = await mutate(
      '/product-api/frontend/external-action/preflight',
      {
        schemaVersion: '1.0.0',
        clientRequestId: clientRequest(),
        idempotencyKey: idempotency(),
        actionId: action1Id,
        expectedActionRevision: 4,
        manifestRevision: manifest2Revision,
        expectedExternalRevision: manifest2ExternalRevision,
        reason: 'Try to preflight with an approval bound to the old manifest.',
      },
    );
    expect(
      preflightAfterManifestChange.status,
      'CP-NEG-05b: an Approval bound to another manifest must not authorize preflight',
    ).toBe(409);
    expect((preflightAfterManifestChange.body as { code?: string }).code).toBe(
      'ACTION_APPROVAL_INVALID',
    );

    // Re-approve on the CURRENT manifest (rev 5) → preflight READY (rev 6) →
    // execute SUCCEEDS (rev 7): the positive control for the negatives above.
    const approve2 = await mutate('/product-api/frontend/external-action/approve', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      manifestId: manifest2Id,
      manifestRevision: manifest2Revision,
      expectedTargetRevision: manifest2TargetRevision,
      expectedExternalRevision: manifest2ExternalRevision,
      reason: 'Re-approve negative-journey action 1 on the current manifest.',
    });
    expect(approve2.ok, JSON.stringify(approve2.body)).toBe(true);
    expect((approve2.body as { approval?: { status?: string } }).approval?.status).toBe('ACTIVE');

    const preflight1 = await mutate('/product-api/frontend/external-action/preflight', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      expectedActionRevision: 5,
      manifestRevision: manifest2Revision,
      expectedExternalRevision: manifest2ExternalRevision,
      reason: 'Preflight negative-journey action 1.',
    });
    expect(preflight1.ok, JSON.stringify(preflight1.body)).toBe(true);
    const preflight1Id = (preflight1.body as { preflight?: { preflightId?: string } }).preflight
      ?.preflightId;
    expect(preflight1Id).toBeTruthy();

    const executed1 = await mutate('/product-api/frontend/external-action/execute', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId: action1Id,
      expectedActionRevision: 6,
      manifestRevision: manifest2Revision,
      preflightId: preflight1Id,
      expectedExternalRevision: manifest2ExternalRevision,
      reason: 'Execute negative-journey action 1.',
    });
    expect(executed1.ok, JSON.stringify(executed1.body)).toBe(true);
    const execution1Id = (
      executed1.body as {
        execution?: { executionId?: string };
        attempt?: { status?: string };
      }
    ).execution?.executionId;
    expect(execution1Id).toBeTruthy();
    expect((executed1.body as { attempt?: { status?: string } }).attempt?.status).toBe('SUCCEEDED');

    // Activity (Project A): the executed action surfaces (needed for the
    // Project-switch isolation assertion in Project B).
    const activityRefreshA = await mutate('/product-api/frontend/activity/refresh', {
      schemaVersion: '1.0.0',
    });
    expect(activityRefreshA.ok, JSON.stringify(activityRefreshA.body)).toBe(true);
    const activityA = await mutate('/product-api/frontend/activity/queue', {
      schemaVersion: '1.0.0',
      limit: 50,
    });
    const activityAItems =
      (
        activityA.body as {
          items?: { root?: { domainResourceId?: string; runId?: string } }[];
        }
      ).items ?? [];
    const action1Activity = activityAItems.find(
      (item) => item.root?.domainResourceId === action1Id,
    );
    expect(action1Activity, 'the executed action appears in Project A activity').toBeTruthy();

    // ---------------------------------------------------------------------
    // CP-NEG-02 — 다른 Project Cache 재사용 금지: switching to Project B
    // isolates reads across phases (Sources / Knowledge / Review / Activity).
    // ---------------------------------------------------------------------
    await switchProject(PROJECT_B);

    const libB = await mutate('/product-api/frontend/sources/query', {
      schemaVersion: '1.0.0',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 20,
    });
    const itemsB = (libB.body as { page?: { items?: { sourceId?: string }[] } }).page?.items ?? [];
    expect(
      itemsB.some((item) => item.sourceId === sourceId),
      'CP-NEG-02: Sources read is isolated after the Project switch',
    ).toBe(false);

    const workspaceB = await mutate('/product-api/frontend/knowledge/workspace', {
      schemaVersion: '1.0.0',
    });
    const workspaceBView = workspaceB.body as {
      workspace?: {
        projectId?: string;
        pages?: { resourceId?: string }[];
      };
    };
    expect(workspaceBView.workspace?.projectId).toBe(PROJECT_B);
    expect(
      (workspaceBView.workspace?.pages ?? []).some((p) => p.resourceId === sourceId),
      'CP-NEG-02: Knowledge workspace is isolated after the Project switch',
    ).toBe(false);

    const reviewQueueB = await mutate('/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      targetKinds: ['KNOWLEDGE_DRAFT_CHANGE_SET'],
      pageSize: 20,
    });
    const reviewQueueBItems =
      (
        reviewQueueB.body as {
          items?: { targetId?: string }[];
        }
      ).items ?? [];
    expect(
      reviewQueueBItems.some((item) => item.targetId === draft1Id || item.targetId === draft2Id),
      'CP-NEG-02: Review queue is isolated after the Project switch',
    ).toBe(false);

    const activityRefreshB = await mutate('/product-api/frontend/activity/refresh', {
      schemaVersion: '1.0.0',
    });
    expect(activityRefreshB.ok, JSON.stringify(activityRefreshB.body)).toBe(true);
    const activityB = await mutate('/product-api/frontend/activity/queue', {
      schemaVersion: '1.0.0',
      limit: 50,
    });
    const activityBItems =
      (
        activityB.body as {
          items?: { root?: { domainResourceId?: string } }[];
        }
      ).items ?? [];
    expect(
      activityBItems.some((item) => item.root?.domainResourceId === action1Id),
      'CP-NEG-02: Activity is isolated after the Project switch',
    ).toBe(false);

    // ---------------------------------------------------------------------
    // CP-NEG-03 — 민감 Resource 존재 노출 금지: cross-project reads of real
    // Project-A identities fail closed (no existence disclosure).
    // ---------------------------------------------------------------------
    const crossSource = await get<{ code?: string; message?: string }>(
      `/product-api/frontend/sources/${sourceId}`,
    );
    expect(crossSource.status, 'CP-NEG-03: cross-project Source identity is masked').toBe(404);
    expect(crossSource.body.code).toBe('NOT_FOUND');

    const crossApproval = await mutate('/product-api/frontend/review/approvals/read', {
      schemaVersion: '1.0.0',
      approvalId: approval1Id,
    });
    expect(crossApproval.status, 'CP-NEG-03: cross-project Review Approval is not disclosed').toBe(
      409,
    );
    expect((crossApproval.body as { code?: string }).code).toBe('REVIEW_APPROVAL_NOT_ISSUED');

    const crossAction = await mutate('/product-api/frontend/external-action/actions/read', {
      schemaVersion: '1.0.0',
      actionId: action1Id,
    });
    expect(crossAction.status, 'CP-NEG-03: cross-project External Action identity is masked').toBe(
      404,
    );
    expect((crossAction.body as { code?: string }).code).toBe('EXTERNAL_ACTION_NOT_FOUND');

    const crossExecution = await mutate('/product-api/frontend/external-action/executions/read', {
      schemaVersion: '1.0.0',
      actionId: action1Id,
    });
    expect(crossExecution.status, 'CP-NEG-03: cross-project Execution identity is masked').toBe(
      404,
    );
    expect((crossExecution.body as { code?: string }).code).toBe('EXTERNAL_ACTION_NOT_FOUND');
  } finally {
    await backend.close();
  }
});
