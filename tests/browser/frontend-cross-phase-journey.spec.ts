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
    rebuildHistoryProjection(resourceProjectId: string): Promise<unknown>;
    close(): Promise<void>;
  }>;
};

/**
 * WP-XP2 — Cross-Phase journey E2E + lineage invariants (IR r1 §5).
 *
 * One user journey chains the 12 required flows (CP-AC-01 ~ CP-AC-12) through
 * the REAL product APIs (no stubbed endpoints) on the
 * production-composition-parity backend (127.0.0.1:3002):
 *
 *   Project → Source → Ask → Draft → Review → Approval → Canonical Commit →
 *   External Action → Activity → History → Reversal / Compensation
 *
 * asserting the XP-I01 ~ XP-I07 lineage invariants. The browser session is
 * created through the real session API (`/api/v1/session/local-bootstrap`) and
 * every governed mutation carries the real CSRF token — no authority is ever
 * declared by the client.
 *
 * Verified payloads come from `scratch/probe-journey.ts` (deleted before
 * commit): every request below was exercised against the REAL backend.
 *
 * FE-P5-XP Correction C: Source intake flows through the REAL production
 * Transformation/Evidence pipeline (wired into the Sources product service) —
 * there is NO fixture-side evidence bridging in this journey.
 *
 * Known product-gap / operator steps (real adapters, never stubs):
 *  - History projection rebuild: there is deliberately NO browser History
 *    refresh route (WP4 Round 1 fix E) → operator rebuild with the real
 *    `HistoryProjectionBuilder` + owning-Domain adapters (fixture).
 *  - Rollback capability + External Action credential/budget: provisioned as
 *    an administrator would (real auth / external-action stores, fixture).
 */

const BASE = 'http://127.0.0.1:3002';
const PROJECT_A = 'journey-alpha';
const PROJECT_B = 'journey-beta';

const getJson = async <T>(
  response: Response,
): Promise<{ ok: boolean; status: number; body: T }> => {
  const body = (await response.json()) as T;
  return { ok: response.ok, status: response.status, body };
};

test('Cross-Phase journey: Project→Source→Ask→Draft→Review→Approval→Commit→Action→Activity→History→Reversal/Compensation (XP-I01~07)', async () => {
  // The cross-phase fixture loads production server code that imports the
  // contracts package's JSON schemas; Playwright's spec loader cannot handle
  // JSON import attributes, so the fixture is loaded through the tsx ESM
  // loader exactly like `frontend-global-setup.ts` does for the 3001 backend.
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
    // CP-AC-01 — Real session bootstrap + CSRF (no stubs, no authority).
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
    ): Promise<{ ok: boolean; status: number; body: unknown }> => {
      const headers: Record<string, string> = { cookie, 'x-csrf-token': csrfToken };
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
    // CP-AC-02 — Create two projects + switch (XP-I01). Existing projects
    // from a previous shared-DB run are skipped.
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
          description: `Cross-Phase journey project ${project}`,
        }),
      );
      expect(created.ok, JSON.stringify(created.body)).toBe(true);
    }
    // Provision the CURRENT `project:action:rollback` capability (operator
    // step through the real auth repository — fixture docs).
    await backend.grantRollbackCapability(PROJECT_A);
    await backend.grantRollbackCapability(PROJECT_B);

    const switchProject = async (projectId: string) => {
      const switched = await mutate('/api/v1/session/active-project', { projectId });
      expect(switched.ok, JSON.stringify(switched.body)).toBe(true);
      return switched;
    };
    await switchProject(PROJECT_A);

    // ---------------------------------------------------------------------
    // CP-AC-03 — Source intake: stage DIRECT_TEXT bytes, submit, poll
    // SUCCEEDED (real submission; unique text per run avoids the
    // exact-duplicate ACTION_REQUIRED path on the shared DB).
    // ---------------------------------------------------------------------
    const draftId = `source-draft-${randomUUID()}`;
    const itemId = uid('source-item');
    const runSuffix = randomUUID().slice(0, 8);
    const sourceText =
      `Shotgun Sources run ${runSuffix}: the founding knowledge base entry for the cross-phase journey. ` +
      'The core claim is that evidence lineage is preserved across phases.';
    const stageQuery = new URLSearchParams({
      draftId,
      itemId,
      kind: 'DIRECT_TEXT',
      label: 'Journey founding source',
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
          { itemId, kind: 'DIRECT_TEXT', label: 'Journey founding source', stagingReference },
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

    // Sources library → newest source version on the active project.
    const library = await mutate('/product-api/frontend/sources/query', {
      schemaVersion: '1.0.0',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 20,
    });
    expect(library.ok, JSON.stringify(library.body)).toBe(true);
    const page = library.body as {
      page?: { items?: { sourceId?: string; label?: string; selectedSourceVersionId?: string }[] };
    };
    const source = page.page?.items?.[0];
    const sourceId = source?.sourceId;
    const sourceVersionId = source?.selectedSourceVersionId;
    expect(sourceId, 'source should be processed into the library').toBeTruthy();
    expect(sourceVersionId).toBeTruthy();

    // XP-I01: the resource stays on Project A after an Active Project switch.
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
      'XP-I01: source not on B',
    ).toBe(false);
    await switchProject(PROJECT_A);
    const libA = await mutate('/product-api/frontend/sources/query', {
      schemaVersion: '1.0.0',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 20,
    });
    const itemsA = (libA.body as { page?: { items?: { sourceId?: string }[] } }).page?.items ?? [];
    expect(
      itemsA.some((item) => item.sourceId === sourceId),
      'XP-I01: source back on A',
    ).toBe(true);

    // ---------------------------------------------------------------------
    // CP-AC-04 — Ask with pinned EvidenceSpans → citations (XP-I02).
    // FE-P5-XP Correction C: the Source intake already ran the REAL production
    // Stage 3 pipeline, so the freshly ingested SourceVersion's EvidenceSpans
    // are indexed by the Product path (no fixture-side bridging).
    // ---------------------------------------------------------------------
    const evidenceList = await get<{ evidence?: { items?: { evidenceId?: string }[] } }>(
      `/product-api/frontend/sources/${sourceId}/versions/${sourceVersionId}/evidence`,
    );
    expect(evidenceList.ok, JSON.stringify(evidenceList.body)).toBe(true);
    const pinnedEvidenceIds = (evidenceList.body.evidence?.items ?? [])
      .map((item) => item.evidenceId)
      .filter((id): id is string => Boolean(id));
    expect(
      pinnedEvidenceIds.length,
      'Correction C: the real production intake must index EvidenceSpans',
    ).toBeGreaterThan(0);

    const ask = await mutate('/product-api/frontend/ask/questions', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      question: 'What is the founding claim of the journey?',
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
          citations?: {
            sourceId?: string;
            sourceVersionId?: string;
            evidenceId?: string;
          }[];
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
    // XP-I02: the citation points at the SAME SourceVersion/Evidence identity.
    expect(citation?.sourceId).toBe(sourceId);
    expect(citation?.sourceVersionId).toBe(sourceVersionId);
    expect(evidenceSpanId).toBeTruthy();

    // ---------------------------------------------------------------------
    // CP-AC-06 — Draft: transition seed → materialize → save CLAIM_ADD
    // (XP-I02/I03).
    // ---------------------------------------------------------------------
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
          contentDigest?: string;
          resourceId?: string;
          base?: { canonicalVersion?: number; canonicalSnapshotDigest?: string };
        };
      }
    ).draft;
    const journeyDraftId = materializedDraft?.draftId;
    const draftRevision = materializedDraft?.revision ?? 0;
    const baseRevision = materializedDraft?.base?.canonicalVersion ?? 0;
    expect(journeyDraftId).toBeTruthy();

    const claimOperation = {
      operationId: uid('operation'),
      kind: 'CLAIM_ADD',
      target: { targetType: 'CLAIM', resourceId: materializedDraft?.resourceId },
      baseRevision,
      rationale: 'The reviewed answer claim from the journey source.',
      evidenceReferences: [{ sourceId, sourceVersionId, evidenceSpanId: evidenceSpanId! }],
      expectedImpact: { summary: 'One claim is added to Canonical.' },
      operationRevision: 2,
      contentDigest: `sha256:${'b'.repeat(64)}`,
      after: {
        schemaVersion: 'claim.v1',
        statement: 'Evidence lineage is preserved across phases.',
      },
    };
    const savedContentDigest = backend.computeDraftRevisionDigest({
      draftId: journeyDraftId!,
      revision: draftRevision + 1,
      base: materializedDraft?.base,
      operations: [claimOperation],
    });
    const saved = await mutate('/product-api/frontend/knowledge/drafts/save', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: journeyDraftId,
      expectedDraftRevision: draftRevision,
      expectedBaseRevision: baseRevision,
      operationRevision: 2,
      operations: [claimOperation],
      contentDigest: savedContentDigest,
    });
    expect(saved.ok, JSON.stringify(saved.body)).toBe(true);
    const savedDraft = saved.body as {
      draft?: {
        revision?: number;
        operations?: {
          kind?: string;
          evidenceReferences?: {
            sourceId?: string;
            sourceVersionId?: string;
            evidenceSpanId?: string;
          }[];
        }[];
      };
    };
    const nextRevision = savedDraft.draft?.revision ?? draftRevision + 1;
    // XP-I02: the saved CLAIM_ADD carries the SAME evidence lineage —
    // sourceId, sourceVersionId AND evidenceSpanId all match the Ask citation.
    const savedClaimOp = savedDraft.draft?.operations?.find((op) => op.kind === 'CLAIM_ADD');
    expect(savedClaimOp?.evidenceReferences?.[0]?.sourceId).toBe(sourceId);
    expect(savedClaimOp?.evidenceReferences?.[0]?.sourceVersionId).toBe(sourceVersionId);
    expect(savedClaimOp?.evidenceReferences?.[0]?.evidenceSpanId).toBe(evidenceSpanId);

    const validated = await mutate('/product-api/frontend/knowledge/drafts/validate', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: journeyDraftId,
      expectedDraftRevision: nextRevision,
      expectedBaseRevision: baseRevision,
    });
    expect(validated.ok, JSON.stringify(validated.body)).toBe(true);
    const impacted = await mutate('/product-api/frontend/knowledge/drafts/impact-preview', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: journeyDraftId,
      expectedDraftRevision: nextRevision,
      expectedBaseRevision: baseRevision,
    });
    expect(impacted.ok, JSON.stringify(impacted.body)).toBe(true);

    const submittedReview = await mutate('/product-api/frontend/knowledge/drafts/submit-review', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: journeyDraftId,
      expectedDraftRevision: nextRevision,
      expectedBaseRevision: baseRevision,
      validationArtifact: (validated.body as { validation?: unknown }).validation,
      impactArtifact: (impacted.body as { impactPreview?: unknown }).impactPreview,
    });
    expect(submittedReview.ok, JSON.stringify(submittedReview.body)).toBe(true);
    const submittedDraft = submittedReview.body as {
      reviewSubmission?: {
        reviewResource?: { reviewResourceId?: string };
        contentDigest?: string;
      };
    };
    const draftContentDigest = submittedDraft.reviewSubmission?.contentDigest;
    expect(draftContentDigest).toBeTruthy();

    // ---------------------------------------------------------------------
    // CP-AC-07 — Review + Approval (XP-I03).
    // ---------------------------------------------------------------------
    const queue = await mutate('/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      targetKinds: ['KNOWLEDGE_DRAFT_CHANGE_SET'],
      pageSize: 20,
    });
    expect(queue.ok, JSON.stringify(queue.body)).toBe(true);
    const queueBody = queue.body as {
      items?: { reviewContextId?: string; contextRevision?: number; targetId?: string }[];
    };
    const queueItem = (queueBody.items ?? []).find((item) => item.targetId === journeyDraftId);
    expect(queueItem, 'the submitted draft should appear in the review queue').toBeTruthy();
    const reviewContextId = queueItem!.reviewContextId;
    const contextRevision = queueItem!.contextRevision;

    const context = await mutate('/product-api/frontend/review/contexts/read', {
      schemaVersion: '1.0.0',
      reviewContextId,
      contextRevision,
    });
    expect(context.ok, JSON.stringify(context.body)).toBe(true);
    const ctx = context.body as {
      context?: {
        targetId?: string;
        targetRevision?: string;
        targetDigest?: string;
        items?: { reviewItemId?: string; allowedDecisions?: string[] }[];
      };
    };
    // XP-I03: the Review Context points at the SAME Draft change identity.
    expect(ctx.context?.targetId).toBe(journeyDraftId);
    expect(ctx.context?.targetRevision).toBe(String(nextRevision));
    expect(ctx.context?.targetDigest).toBe(draftContentDigest);
    const expectedTargetRevision = ctx.context?.targetRevision ?? '';
    const expectedTargetDigest = ctx.context?.targetDigest ?? '';
    const reviewItems = ctx.context?.items ?? [];
    expect(reviewItems.length).toBeGreaterThan(0);

    const recorded = await mutate('/product-api/frontend/review/decisions', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      reviewContextId,
      expectedContextRevision: contextRevision,
      expectedTargetRevision,
      expectedTargetDigest,
      itemDecisions: reviewItems.map((item) => ({
        schemaVersion: '1.0.0',
        reviewItemId: item.reviewItemId,
        intent: 'APPROVE',
        reason: 'Matches the cited evidence lineage.',
      })),
      comment: 'Approved in the cross-phase journey.',
    });
    expect(recorded.ok, JSON.stringify(recorded.body)).toBe(true);
    const approval = (
      recorded.body as {
        approvals?: {
          approvalId?: string;
          status?: string;
          reviewContextId?: string;
          contextRevision?: number;
          targetId?: string;
          targetRevision?: string;
          targetDigest?: string;
          approvedItemIds?: string[];
        }[];
      }
    ).approvals?.[0];
    const approvalId = approval?.approvalId;
    expect(approvalId).toBeTruthy();
    expect(approval?.status).toBe('ACTIVE');
    // XP-I03: the Approval Resource is bound to the SAME Review Context and
    // Draft change identity (reviewContextId/contextRevision/targetId/
    // targetRevision/targetDigest/approvedItemIds).
    expect(approval?.reviewContextId).toBe(reviewContextId);
    expect(approval?.contextRevision).toBe(contextRevision);
    expect(approval?.targetId).toBe(journeyDraftId);
    expect(approval?.targetRevision).toBe(String(nextRevision));
    expect(approval?.targetDigest).toBe(draftContentDigest);
    expect([...(approval?.approvedItemIds ?? [])].sort()).toEqual(
      reviewItems.map((item) => item.reviewItemId).sort(),
    );

    // ---------------------------------------------------------------------
    // CP-AC-08 — Canonical Commit (XP-I04): Approval and Commit are separate;
    // creating the Approval causes NO Canonical change; only the approved
    // exact ChangeSet commits.
    // ---------------------------------------------------------------------
    // XP-I04 (before commit): the Knowledge Workspace projection exposes the
    // LIVE canonical version/digest (GetProjectionReadiness resolves the
    // current Canonical snapshot). Creating the Approval must leave Canonical
    // at the SAME version/digest the Draft was based on (no Canonical change).
    const workspaceBefore = await mutate('/product-api/frontend/knowledge/workspace', {
      schemaVersion: '1.0.0',
    });
    expect(workspaceBefore.ok, JSON.stringify(workspaceBefore.body)).toBe(true);
    const workspaceBeforeView = workspaceBefore.body as {
      workspace?: {
        projectId?: string;
        projection?: { canonicalVersion?: number; canonicalSnapshotDigest?: string };
      };
    };
    expect(workspaceBeforeView.workspace?.projectId).toBe(PROJECT_A);
    const canonicalVersionBefore =
      workspaceBeforeView.workspace?.projection?.canonicalVersion ?? -1;
    const canonicalDigestBefore =
      workspaceBeforeView.workspace?.projection?.canonicalSnapshotDigest;
    expect(canonicalDigestBefore, 'XP-I04: the Approval alone must not change Canonical').toBe(
      materializedDraft?.base?.canonicalSnapshotDigest,
    );

    const approvalRead = await mutate('/product-api/frontend/review/approvals/read', {
      schemaVersion: '1.0.0',
      approvalId,
    });
    expect(approvalRead.ok, JSON.stringify(approvalRead.body)).toBe(true);
    const approvalStatusRevision =
      (approvalRead.body as { approvalStatusRevision?: number }).approvalStatusRevision ?? 1;

    const committed = await mutate('/product-api/frontend/knowledge/drafts/commit', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      draftId: journeyDraftId,
      approvalId,
      expectedApprovalRevision: approvalStatusRevision,
    });
    expect(committed.ok, JSON.stringify(committed.body)).toBe(true);
    const canonicalCommitId = (committed.body as { commitIds?: string[] }).commitIds?.[0];
    expect(canonicalCommitId).toBeTruthy();

    // XP-I04: the Approval was consumed by the commit — the public read API
    // fail-closes and no longer exposes the non-ACTIVE Approval.
    const approvalAfter = await mutate('/product-api/frontend/review/approvals/read', {
      schemaVersion: '1.0.0',
      approvalId,
    });
    expect(approvalAfter.status).toBe(409);
    expect((approvalAfter.body as { code?: string }).code).toBe('REVIEW_APPROVAL_NOT_ISSUED');

    // XP-I04 (after commit): the same Workspace projection now reflects the
    // advanced Canonical version (the commit changed Canonical, the Approval
    // did not).
    const workspace = await mutate('/product-api/frontend/knowledge/workspace', {
      schemaVersion: '1.0.0',
    });
    expect(workspace.ok, JSON.stringify(workspace.body)).toBe(true);
    const workspaceView = workspace.body as {
      workspace?: {
        projectId?: string;
        pages?: unknown[];
        projection?: { canonicalVersion?: number; canonicalSnapshotDigest?: string };
      };
    };
    expect(workspaceView.workspace?.projectId).toBe(PROJECT_A);
    expect((workspaceView.workspace?.pages ?? []).length).toBeGreaterThan(0);
    expect(
      workspaceView.workspace?.projection?.canonicalVersion,
      'XP-I04: the Commit must advance Canonical',
    ).toBeGreaterThan(canonicalVersionBefore);
    expect(workspaceView.workspace?.projection?.canonicalSnapshotDigest).not.toBe(
      canonicalDigestBefore,
    );

    // ---------------------------------------------------------------------
    // CP-AC-09 — External Action: validate → prepare → approve → preflight →
    // execute (XP-I05). Action revision: validate=1, prepare=2, approve=3,
    // preflight expects 3, execute expects 4.
    // ---------------------------------------------------------------------
    const actionId = uid('action');
    const candidateId = uid('candidate');
    const targetRevision = 'rev-1';
    const externalRevision = 'ext-1';
    const validatedAction = await mutate('/product-api/frontend/external-action/validate', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId,
      candidateId,
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
        parameterId: `${actionId}:param`,
        parameterRevision: '1',
        parameterDigest: `sha256:${'a'.repeat(64)}`,
      },
      evidenceRefs: [],
      reason: 'Journey action against the committed canonical change.',
    });
    expect(validatedAction.ok, JSON.stringify(validatedAction.body)).toBe(true);

    const prepared = await mutate('/product-api/frontend/external-action/prepare', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId,
      expectedActionRevision: 1,
      reason: 'Prepare the journey action.',
    });
    expect(prepared.ok, JSON.stringify(prepared.body)).toBe(true);
    const preparedBody = prepared.body as {
      actionId?: string;
      manifest?: {
        actionId?: string;
        manifestId?: string;
        manifestRevision?: number;
        targetRevision?: string;
        externalRevision?: string;
      };
    };
    expect(preparedBody.actionId).toBe(actionId);
    const manifest = preparedBody.manifest;
    const manifestId = manifest?.manifestId;
    const manifestRevision = manifest?.manifestRevision ?? 1;
    const manifestTargetRevision = manifest?.targetRevision ?? targetRevision;
    const manifestExternalRevision = manifest?.externalRevision ?? externalRevision;
    expect(manifestId).toBeTruthy();
    // XP-I05: the Manifest is bound to the SAME action id and revision.
    expect(manifest?.actionId).toBe(actionId);

    const approvedAction = await mutate('/product-api/frontend/external-action/approve', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId,
      manifestId,
      manifestRevision,
      expectedTargetRevision: manifestTargetRevision,
      expectedExternalRevision: manifestExternalRevision,
      reason: 'Approve the journey action.',
    });
    expect(approvedAction.ok, JSON.stringify(approvedAction.body)).toBe(true);
    const actionApproval = (
      approvedAction.body as {
        approval?: {
          approvalId?: string;
          status?: string;
          actionId?: string;
          manifestId?: string;
          manifestRevision?: number;
          resourceProjectId?: string;
          effectiveProjectId?: string;
          accessRevision?: string;
          policyContextRevision?: string;
        };
      }
    ).approval;
    expect(actionApproval?.status).toBe('ACTIVE');
    // XP-I05: the External Action Approval is bound to the same action +
    // manifest and the server-derived project/policy context.
    expect(actionApproval?.actionId).toBe(actionId);
    expect(actionApproval?.manifestId).toBe(manifestId);
    expect(actionApproval?.manifestRevision).toBe(manifestRevision);
    expect(actionApproval?.resourceProjectId).toBe(PROJECT_A);
    expect(actionApproval?.effectiveProjectId).toBe(PROJECT_A);
    expect(actionApproval?.accessRevision?.length).toBeGreaterThan(0);
    expect(actionApproval?.policyContextRevision).toBe('1');

    const preflighted = await mutate('/product-api/frontend/external-action/preflight', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId,
      expectedActionRevision: 3,
      manifestRevision,
      expectedExternalRevision: manifestExternalRevision,
      reason: 'Preflight the journey action.',
    });
    expect(preflighted.ok, JSON.stringify(preflighted.body)).toBe(true);
    const preflight = (
      preflighted.body as {
        preflight?: {
          preflightId?: string;
          status?: string;
          actionId?: string;
          manifestRevision?: number;
          policyRevalidated?: boolean;
          resourceProjectId?: string;
        };
      }
    ).preflight;
    const preflightId = preflight?.preflightId;
    expect(preflightId).toBeTruthy();
    // XP-I05: Preflight revalidates the policy binding against the SAME
    // action + manifest (policyRevalidated === true).
    expect(preflight?.actionId).toBe(actionId);
    expect(preflight?.manifestRevision).toBe(manifestRevision);
    expect(preflight?.policyRevalidated).toBe(true);
    expect(preflight?.resourceProjectId).toBe(PROJECT_A);

    const executed = await mutate('/product-api/frontend/external-action/execute', {
      schemaVersion: '1.0.0',
      clientRequestId: clientRequest(),
      idempotencyKey: idempotency(),
      actionId,
      expectedActionRevision: 4,
      manifestRevision,
      preflightId,
      expectedExternalRevision: manifestExternalRevision,
      reason: 'Execute the journey action.',
    });
    expect(executed.ok, JSON.stringify(executed.body)).toBe(true);
    const executionBody = executed.body as {
      execution?: {
        executionId?: string;
        status?: string;
        actionId?: string;
        manifestRevision?: number;
      };
      attempt?: {
        attemptId?: string;
        status?: string;
        actionId?: string;
        resourceProjectId?: string;
        policyContextRevision?: string;
      };
    };
    const executionId = executionBody.execution?.executionId;
    expect(executionId).toBeTruthy();
    expect(executionBody.attempt?.status).toBe('SUCCEEDED');
    // XP-I05: the Execution + Attempt continue the same action/manifest/policy
    // binding.
    expect(executionBody.execution?.actionId).toBe(actionId);
    expect(executionBody.execution?.manifestRevision).toBe(manifestRevision);
    expect(executionBody.attempt?.actionId).toBe(actionId);
    expect(executionBody.attempt?.resourceProjectId).toBe(PROJECT_A);
    expect(executionBody.attempt?.policyContextRevision).toBe('1');

    // ---------------------------------------------------------------------
    // CP-AC-10 — Activity (XP-I06): explicit refresh (real route) then queue.
    // Activity domains are SOURCES / ASK / EXTERNAL_ACTION — the journey
    // asserts its executed External Action surfaced with the execution ref.
    // ---------------------------------------------------------------------
    const activityRefresh = await mutate('/product-api/frontend/activity/refresh', {
      schemaVersion: '1.0.0',
    });
    expect(activityRefresh.ok, JSON.stringify(activityRefresh.body)).toBe(true);
    const activity = await mutate('/product-api/frontend/activity/queue', {
      schemaVersion: '1.0.0',
      limit: 50,
    });
    expect(activity.ok, JSON.stringify(activity.body)).toBe(true);
    const activityItems =
      (
        activity.body as {
          items?: {
            root?: { domainResourceId?: string; domainKind?: string; runId?: string };
          }[];
        }
      ).items ?? [];
    const actionActivity = activityItems.find((item) => item.root?.domainResourceId === actionId);
    expect(actionActivity, 'XP-I06: the executed action appears in Activity').toBeTruthy();
    expect(actionActivity!.root?.runId).toBe(executionId);

    // ---------------------------------------------------------------------
    // CP-AC-11 — History (XP-I06): operator rebuild of the federated History
    // projection (no browser refresh route by design), then read the real
    // History Product API. The canonical entry carries the SAME commit id and
    // the Review Approval authority id.
    // ---------------------------------------------------------------------
    await backend.rebuildHistoryProjection(PROJECT_A);
    const history = await mutate('/product-api/frontend/history/workspace', {
      schemaVersion: '1.0.0',
      resourceProjectId: PROJECT_A,
      limit: 50,
    });
    expect(history.ok, JSON.stringify(history.body)).toBe(true);
    const historyEntries =
      (
        history.body as {
          entries?: {
            sourceEventKind?: string;
            sourceEventId?: string;
            payloadSnapshot?: { commitId?: string; authorityId?: string };
          }[];
        }
      ).entries ?? [];
    const canonicalEntry = historyEntries.find(
      (entry) => entry.payloadSnapshot?.commitId === canonicalCommitId,
    );
    expect(canonicalEntry, 'XP-I06: history contains the canonical commit').toBeTruthy();
    expect(canonicalEntry!.payloadSnapshot?.authorityId).toBe(approvalId);
    // XP-I06: History preserves the authoritative SOURCE identity (the
    // projection identity is never substituted for it) — the canonical entry
    // carries the frozen sourceEventKind/sourceEventId of the HistoryEvent.
    expect(canonicalEntry!.sourceEventKind).toBe('CANONICAL_CLAIM_ADDED');
    expect(canonicalEntry!.sourceEventId).toBe(`history:${canonicalCommitId}`);

    // ---------------------------------------------------------------------
    // CP-AC-12 — Reversal + Compensation (XP-I07): Canonical change →
    // Reversal; External change → Compensation; never substituted.
    // ---------------------------------------------------------------------
    const reversal = await mutate('/product-api/frontend/review/reversal-draft', {
      schemaVersion: '1.0.0',
      resourceProjectId: PROJECT_A,
      sourceRevisionId: `revision:${canonicalCommitId}`,
      reason: 'Reversal of the journey canonical commit.',
    });
    expect(reversal.ok, JSON.stringify(reversal.body)).toBe(true);
    const reversalView = reversal.body as {
      reversal?: {
        reversalId?: string;
        sourceCommitId?: string;
        historicalApprovalRef?: string;
        status?: string;
      };
    };
    const reversalId = reversalView.reversal?.reversalId;
    expect(reversalId).toBeTruthy();
    expect(reversalView.reversal?.sourceCommitId).toBe(canonicalCommitId);
    // XP-I07 Canonical branch: the Reversal references the historical Review
    // Approval (evidence-only) that authorized the source commit.
    expect(reversalView.reversal?.historicalApprovalRef).toBe(approvalId);
    expect(reversalView.reversal?.status).toBe('CANDIDATE');

    // XP-I07 (Frozen IR: Historical Revision → Reversal Draft → Review entry):
    // the created Reversal is materialized as a SUBMITTED Knowledge Draft
    // carrier (`draftId = reversalId`) and MUST surface in the real Review
    // queue/context as a reviewable entry.
    const reversalQueue = await mutate('/product-api/frontend/review/queue', {
      schemaVersion: '1.0.0',
      targetKinds: ['KNOWLEDGE_DRAFT_CHANGE_SET'],
      pageSize: 20,
    });
    expect(reversalQueue.ok, JSON.stringify(reversalQueue.body)).toBe(true);
    const reversalQueueBody = reversalQueue.body as {
      items?: { reviewContextId?: string; contextRevision?: number; targetId?: string }[];
    };
    const reversalQueueItem = (reversalQueueBody.items ?? []).find(
      (item) => item.targetId === reversalId,
    );
    expect(
      reversalQueueItem,
      'XP-I07: the Reversal carrier must appear in the Review queue',
    ).toBeTruthy();
    expect(reversalQueueItem!.reviewContextId).toBeTruthy();
    const reversalContext = await mutate('/product-api/frontend/review/contexts/read', {
      schemaVersion: '1.0.0',
      reviewContextId: reversalQueueItem!.reviewContextId,
      contextRevision: reversalQueueItem!.contextRevision,
    });
    expect(reversalContext.ok, JSON.stringify(reversalContext.body)).toBe(true);
    const reversalContextView = reversalContext.body as {
      context?: { targetId?: string; items?: { reviewItemId?: string }[] };
    };
    expect(reversalContextView.context?.targetId).toBe(reversalId);
    expect((reversalContextView.context?.items ?? []).length).toBeGreaterThan(0);

    const compensation = await mutate(
      '/product-api/frontend/external-action/compensations/prepare',
      {
        schemaVersion: '1.0.0',
        clientRequestId: clientRequest(),
        idempotencyKey: idempotency(),
        sourceActionId: actionId,
        sourceExecutionId: executionId,
        reason: 'Compensate the executed journey action.',
      },
    );
    expect(compensation.ok, JSON.stringify(compensation.body)).toBe(true);
    const compensationView = compensation.body as {
      compensation?: {
        compensationId?: string;
        actionId?: string;
        sourceActionId?: string;
        sourceExecutionId?: string;
      };
    };
    // XP-I07 External Action branch: the Compensation preserves the original
    // action + execution lineage.
    expect(compensationView.compensation?.compensationId).toBeTruthy();
    expect(compensationView.compensation?.sourceActionId).toBe(actionId);
    expect(compensationView.compensation?.sourceExecutionId).toBe(executionId);
  } finally {
    await backend.close();
  }
});
