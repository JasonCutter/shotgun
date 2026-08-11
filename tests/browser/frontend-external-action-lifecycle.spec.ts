import { expect, test, type Page } from '@playwright/test';

/**
 * FE-P4-S2 WP6 remediation (Review 4868951109 blocker 1) — Frozen Browser E2E
 * Lifecycle.
 *
 * The Implementation Request's WP6 requires a browser E2E for
 * `Queue → Detail → Verify → Cancel → Rollback → Compensation → Recovery`.
 * WP6 evidence previously limited the browser spec to read-only AC-19
 * accessibility; this spec exercises the GOVERNED commands through the real
 * browser wiring with LOCAL fake fixtures only (no real Connector, no external
 * mutation, no lower-layer invariant duplication). It verifies command
 * wiring, state transitions, command separation, frozen Announcements · Focus
 * and OUTCOME_UNKNOWN recovery — and that recovery never re-executes or issues
 * a new mutation.
 */

const routeGuard = {
  decision: {
    schemaVersion: '1.0.0',
    decision: 'ALLOW',
    targetRoute: { routeId: 'external-action', href: '/external-action' },
    masked: false,
    message: 'Allowed.',
    accessRevision: '1',
    policyContextRevision: '1',
  },
};

const now = '2026-08-05T12:00:00.000Z';
const PROJECT = 'shotgun';
const DIGEST = `sha256:${'f'.repeat(64)}`;

// Per-action manifest digests (computed with `externalActionManifestDigest`).
const MANIFEST_DIGESTS: Record<string, string> = {
  'action-1': 'sha256:1ed27477073453b8ad727910f27384acab69d9813f64160d7a91dd0378e0df69',
  'action-2': 'sha256:d0c510b7ca2916c8417755a7e7419e566230f4e27d7e9047cc43483080d9955f',
  'action-3': 'sha256:ce2c61772c3c7ccea989bc3140dca849c1720794cce8479b28a1f7a4d0dd33a2',
};

const makeManifest = (actionId: string) => ({
  schemaVersion: '1.0.0',
  manifestId: `manifest-${actionId}`,
  manifestRevision: 1,
  actionId,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'a'.repeat(64)}`,
  externalRevision: 'ext-7',
  parameterRef: {
    schemaVersion: '1.0.0',
    parameterId: 'param-1',
    parameterRevision: '2',
    parameterDigest: `sha256:${'b'.repeat(64)}`,
  },
  parameterDigest: `sha256:${'b'.repeat(64)}`,
  evidenceSetRef: {
    schemaVersion: '1.0.0',
    evidenceSetId: 'evidence-1',
    evidenceSetDigest: `sha256:${'c'.repeat(64)}`,
  },
  evidenceSetDigest: `sha256:${'c'.repeat(64)}`,
  payloadDigest: `sha256:${'d'.repeat(64)}`,
  manifestDigest: MANIFEST_DIGESTS[actionId],
  expiresAt: '2026-09-01T00:00:00.000Z',
  createdAt: now,
  createdBy: { schemaVersion: '1.0.0', principalId: 'principal-1', actorId: 'user-1' },
});

const makeRisk = (actionId: string) => ({
  schemaVersion: '1.0.0',
  riskDecisionId: `risk-${actionId}`,
  actionId,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  riskLevel: 'R4',
  policyVersion: 'stage11.action-risk.v1',
  requiresUserApproval: true,
  reasons: ['High impact'],
  decidedAt: now,
});

const makeAction = (actionId: string, status: string) => ({
  schemaVersion: '1.0.0',
  actionId,
  actionRevision: 4,
  operation: 'UPDATE_REVERSIBLE',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  status,
  aggregateState: 'AVAILABLE',
  accessMasking: 'VISIBLE',
  maskedFields: [],
  capabilities: [],
  updatedAt: now,
  createdAt: now,
  targetRef: {
    schemaVersion: '1.0.0',
    targetKind: 'KNOWN_TARGET',
    targetId: 'target-1',
    targetRevision: 'rev-3',
    externalRevision: 'ext-7',
  },
  manifestRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'manifest',
    resourceId: `manifest-${actionId}`,
  },
  riskDecisionRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'riskDecision',
    resourceId: `risk-${actionId}`,
  },
  latestExecutionRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'execution',
    resourceId: `execution-${actionId}`,
  },
});

const makeExecution = (actionId: string) => ({
  schemaVersion: '1.0.0',
  executionId: `execution-${actionId}`,
  concreteKind: 'EXECUTION',
  actionId,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  manifestRevision: 1,
  status: 'SUCCEEDED',
  attemptCount: 1,
  startedAt: now,
  completedAt: now,
  latestAttemptRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'attempt',
    resourceId: `attempt-${actionId}`,
  },
});

const makeAttempts = (actionId: string) => [
  {
    schemaVersion: '1.0.0',
    attemptId: `attempt-${actionId}`,
    attemptNumber: 1,
    executionId: `execution-${actionId}`,
    actionId,
    resourceProjectId: PROJECT,
    effectiveProjectId: PROJECT,
    idempotencyKey: `idem-attempt-${actionId}`,
    status: 'SUCCEEDED',
    policyContextRevision: 'policy-1',
    externalRevision: 'ext-7',
    correlationId: 'corr-1',
    startedAt: now,
    completedAt: now,
  },
];

const makeApproval = (actionId: string) => ({
  schemaVersion: '1.0.0',
  approvalId: `approval-${actionId}`,
  purpose: 'EXTERNAL_ACTION',
  actionId,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  manifestId: `manifest-${actionId}`,
  manifestRevision: 1,
  manifestDigest: MANIFEST_DIGESTS[actionId],
  targetId: 'target-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'a'.repeat(64)}`,
  externalRevision: 'ext-7',
  actor: { schemaVersion: '1.0.0', principalId: 'principal-1', actorId: 'user-1' },
  projectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  reason: 'Governed workspace request.',
  issuedAt: now,
  expiresAt: '2026-09-01T00:00:00.000Z',
  status: 'ACTIVE',
});

const makePreflight = (actionId: string) => ({
  schemaVersion: '1.0.0',
  preflightId: `preflight-${actionId}`,
  concreteKind: 'PREFLIGHT',
  actionId,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  manifestRevision: 1,
  preflightDigest: `sha256:${'e'.repeat(64)}`,
  status: 'READY',
  reasons: [],
  permissionRevalidated: true,
  credentialRevalidated: true,
  budgetRevalidated: true,
  policyRevalidated: true,
  targetStateRevalidated: true,
  externalRevisionRevalidated: true,
  runAt: now,
  expiresAt: '2026-09-01T00:00:00.000Z',
});

const makeVerification = (actionId: string) => ({
  schemaVersion: '1.0.0',
  verificationId: `verification-${actionId}`,
  concreteKind: 'VERIFICATION',
  actionId,
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  executionId: `execution-${actionId}`,
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'a'.repeat(64)}`,
  externalRevision: 'ext-7',
  status: 'APPLIED',
  observedDigest: `sha256:${'a'.repeat(64)}`,
  verifiedAt: now,
});

// action-1 READY_TO_EXECUTE -> Cancel surface; action-2 VERIFYING -> Cancel +
// Verify; action-3 VERIFIED -> Rollback + Compensation.
const statusByAction: Record<string, string> = {
  'action-1': 'READY_TO_EXECUTE',
  'action-2': 'VERIFYING',
  'action-3': 'VERIFIED',
};

const queueResult = {
  schemaVersion: '1.0.0',
  items: Object.entries(statusByAction).map(([actionId, status]) => ({
    schemaVersion: '1.0.0',
    actionId,
    actionRevision: 4,
    operation: 'UPDATE_REVERSIBLE',
    resourceProjectId: PROJECT,
    effectiveProjectId: PROJECT,
    status,
    aggregateState: 'AVAILABLE',
    capabilities: [],
    riskLevel: 'R4',
    updatedAt: now,
  })),
  nextCursor: undefined,
  capabilities: [],
};

const detailByAction: Record<string, unknown> = Object.fromEntries(
  Object.entries(statusByAction).map(([actionId, status]) => [
    actionId,
    {
      schemaVersion: '1.0.0',
      action: makeAction(actionId, status),
      manifest: makeManifest(actionId),
      riskDecision: makeRisk(actionId),
      attempts: [],
    },
  ]),
);

const requestBody = (route: { request(): { postDataJSON(): Record<string, string> } }) =>
  route.request().postDataJSON();

const stubLifecycleRoutes = async (page: Page, posts: string[]) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(routeGuard) });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-external-action-lifecycle-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/external-action/queue', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(queueResult) });
  });
  await page.route('**/product-api/frontend/external-action/actions/read', async (route) => {
    const body = requestBody(route);
    const actionId = body.actionId ?? 'action-3';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        action: makeAction(actionId, statusByAction[actionId] ?? 'VERIFIED'),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/actions/detail', async (route) => {
    const body = requestBody(route);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(detailByAction[body.actionId ?? 'action-3']),
    });
  });
  await page.route('**/product-api/frontend/external-action/manifests/read', async (route) => {
    const body = requestBody(route);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        manifest: makeManifest(body.actionId ?? 'action-3'),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/risk-decisions/read', async (route) => {
    const body = requestBody(route);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        riskDecision: makeRisk(body.actionId ?? 'action-3'),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/executions/read', async (route) => {
    const body = requestBody(route);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        execution: makeExecution(body.actionId ?? 'action-3'),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/executions/attempts', async (route) => {
    const body = requestBody(route);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        attempts: makeAttempts(body.actionId ?? 'action-3'),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/verifications/read', async (route) => {
    const body = requestBody(route);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        verification: makeVerification(body.actionId ?? 'action-3'),
      }),
    });
  });

  // Governed mutations: local fake results echo the request identity
  // (clientRequestId / idempotencyKey / actionId) so the strict client's
  // command-identity validation passes. Rollback deliberately returns
  // OUTCOME_UNKNOWN so the browser recovery path is exercised.
  await page.route('**/product-api/frontend/external-action/approve', async (route) => {
    const body = requestBody(route);
    posts.push('POST /approve');
    const actionId = body.actionId ?? 'action-3';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        commandSemanticDigest: DIGEST,
        actionId,
        approval: makeApproval(actionId),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/preflight', async (route) => {
    const body = requestBody(route);
    posts.push('POST /preflight');
    const actionId = body.actionId ?? 'action-3';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        commandSemanticDigest: DIGEST,
        actionId,
        preflight: makePreflight(actionId),
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/execute', async (route) => {
    const body = requestBody(route);
    posts.push('POST /execute');
    const actionId = body.actionId ?? 'action-3';
    // The execution attempt echoes the request idempotency key (the strict
    // client asserts `attempt.idempotencyKey === params.idempotencyKey`).
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        commandSemanticDigest: DIGEST,
        actionId,
        execution: makeExecution(actionId),
        attempt: {
          ...makeAttempts(actionId)[0],
          idempotencyKey: body.idempotencyKey ?? 'idem-attempt-action-3',
        },
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/cancel', async (route) => {
    const body = requestBody(route);
    posts.push('POST /cancel');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        commandSemanticDigest: DIGEST,
        actionId: body.actionId,
        status: 'CANCELLING',
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/verify', async (route) => {
    const body = requestBody(route);
    posts.push('POST /verify');
    const actionId = body.actionId ?? 'action-3';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        commandSemanticDigest: DIGEST,
        actionId,
        verification: { ...makeVerification(actionId), executionId: body.executionId ?? '' },
      }),
    });
  });
  await page.route('**/product-api/frontend/external-action/rollback', async (route) => {
    posts.push('POST /rollback');
    await route.fulfill({
      contentType: 'application/json',
      status: 503,
      body: JSON.stringify({
        code: 'ACTION_OUTCOME_UNKNOWN',
        message: 'Rollback outcome is unresolved.',
      }),
    });
  });
  await page.route(
    '**/product-api/frontend/external-action/compensations/prepare',
    async (route) => {
      const body = requestBody(route);
      posts.push('POST /compensations/prepare');
      const sourceActionId = body.sourceActionId ?? 'action-3';
      const sourceExecutionId = body.sourceExecutionId ?? 'execution-action-3';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: body.clientRequestId,
          idempotencyKey: body.idempotencyKey,
          commandSemanticDigest: DIGEST,
          compensation: {
            schemaVersion: '1.0.0',
            compensationId: 'compensation-1',
            actionId: sourceActionId,
            resourceProjectId: PROJECT,
            effectiveProjectId: PROJECT,
            sourceActionId,
            sourceExecutionId,
            candidateRef: {
              schemaVersion: '1.0.0',
              resourceKind: 'candidate',
              resourceId: `candidate-${sourceActionId}`,
            },
            status: 'COMPENSATION_REQUIRED',
            preparedAt: now,
            preparedBy: { schemaVersion: '1.0.0', principalId: 'principal-1', actorId: 'user-1' },
          },
        }),
      });
    },
  );
  await page.route(
    '**/product-api/frontend/external-action/command-outcomes/by-client-request/**',
    async (route) => {
      const url = new URL(route.request().url());
      const clientRequestId = url.pathname.split('/').pop() ?? '';
      const idempotencyKey = url.searchParams.get('idempotencyKey') ?? '';
      posts.push('GET /command-outcomes/resolve');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          originalClientRequestId: clientRequestId,
          originalIdempotencyKey: idempotencyKey,
          completed: {
            commandType: 'frontend.external-action.rollback.v1',
            result: {
              schemaVersion: '1.0.0',
              outcome: 'COMPLETED',
              clientRequestId,
              idempotencyKey,
              commandSemanticDigest: DIGEST,
              actionId: 'action-3',
              rollback: {
                schemaVersion: '1.0.0',
                rollbackId: 'rollback-1',
                actionId: 'action-3',
                resourceProjectId: PROJECT,
                effectiveProjectId: PROJECT,
                status: 'ROLLED_BACK',
                executionRef: {
                  schemaVersion: '1.0.0',
                  resourceKind: 'execution',
                  resourceId: 'execution-action-3',
                },
                updatedAt: now,
              },
            },
          },
        }),
      });
    },
  );
};

const openQueue = async (page: Page) => {
  await page.goto('/external-action');
  await expect(page.getByRole('heading', { name: 'External Actions', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Verified/ })).toBeVisible();
};

const selectAction = async (page: Page, actionId: string) => {
  const statusLabel: Record<string, string> = {
    'action-1': 'Ready to run',
    'action-2': 'Verifying',
    'action-3': 'Verified',
  };
  await page.getByRole('button', { name: new RegExp(statusLabel[actionId] ?? '') }).click();
  await expect(page.getByRole('heading', { name: 'Update an external resource' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '거버넌스 명령' })).toBeVisible();
};

const liveRegion = (page: Page) => page.locator('p.visually-hidden[aria-live="polite"]');

test('full compressed governed lifecycle through the browser: queue → detail → verify → cancel → rollback → recovery → compensation', async ({
  page,
}) => {
  const posts: string[] = [];
  await stubLifecycleRoutes(page, posts);
  await openQueue(page);

  // Queue → Detail (VERIFYING action exposes the Verify governed surface).
  await selectAction(page, 'action-2');
  await expect(page.getByRole('heading', { name: '매니페스트' })).toBeVisible();
  const verify = page.getByRole('button', { name: '검증 실행' });
  await expect(verify).toBeVisible();
  await verify.click();
  // Verify command connects + VERIFIED announcement + focus moves to the
  // verification heading (Review 4865620679 item 6).
  await expect(liveRegion(page)).toContainText('외부 상태가 검증되었습니다.');
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.id))
    .toBe('verification-heading');

  // Cancel (READY_TO_EXECUTE action) — abort request, never rollback.
  await selectAction(page, 'action-1');
  const cancel = page.getByRole('button', { name: '취소 요청' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(liveRegion(page)).toContainText(
    '취소 요청이 기록되었습니다. (외부 상태는 되돌려지지 않습니다)',
  );

  // Rollback (VERIFIED action) → OUTCOME_UNKNOWN → recovery by original
  // identity (never a re-execute).
  await selectAction(page, 'action-3');
  const rollback = page.getByRole('button', { name: '롤백' });
  await expect(rollback).toBeVisible();
  await rollback.click();
  await expect(page.getByRole('button', { name: '원래 요청으로 복구' })).toBeVisible();
  // OUTCOME_UNKNOWN recovery never offers a re-execute surface.
  await expect(page.getByRole('button', { name: /재실행|retry|재시도/i })).toHaveCount(0);
  await page.getByRole('button', { name: '원래 요청으로 복구' }).click();
  await expect(liveRegion(page)).toContainText('외부 액션 상세가 로드되었습니다.');

  // Compensation (VERIFIED action) — independent governed command, never
  // auto-run; a fresh explicit click is required.
  const compensation = page.getByRole('button', { name: '보상 액션 준비' });
  await expect(compensation).toBeVisible();
  await compensation.click();
  await expect(liveRegion(page)).toContainText('보상 액션 준비가 요청되었습니다.');

  // Command separation: the four governed commands hit four distinct
  // endpoints and only the expected ones.
  expect(posts.filter((entry) => entry === 'POST /cancel').length).toBe(1);
  expect(posts.filter((entry) => entry === 'POST /verify').length).toBe(1);
  expect(posts.filter((entry) => entry === 'POST /rollback').length).toBe(1);
  expect(posts.filter((entry) => entry === 'POST /compensations/prepare').length).toBe(1);
  expect(posts.filter((entry) => entry === 'GET /command-outcomes/resolve').length).toBe(1);
});

test('full governed lifecycle mutation routes (Approval → Preflight → Execute) fire in order and exactly once through the browser client', async ({
  page,
}) => {
  const posts: string[] = [];
  await stubLifecycleRoutes(page, posts);
  await openQueue(page);

  // Drive the pre-execution governed lifecycle through the REAL frontend
  // client running in the browser page (E2E test bridge — Review 4869347580).
  // The workspace UI exposes only Verify/Cancel/Rollback/Compensation/Recovery,
  // so Approval → Preflight → Execute is exercised via the browser client and
  // each POST is verified to fire exactly once and in the frozen order.
  await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        __SHOTGUN_EXTERNAL_ACTION_BRIDGE__?: {
          createClient(): {
            approveExternalAction(params: unknown): Promise<unknown>;
            preflightExternalAction(params: unknown): Promise<unknown>;
            executeExternalAction(params: unknown): Promise<unknown>;
          };
        };
      }
    ).__SHOTGUN_EXTERNAL_ACTION_BRIDGE__;
    if (!bridge) throw new Error('external-action E2E bridge is missing');
    const client = bridge.createClient();
    const fresh = (prefix: string) =>
      `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = { schemaVersion: '1.0.0' as const, reason: 'Governed workspace request.' };
    await client.approveExternalAction({
      ...base,
      clientRequestId: fresh('ea-approve'),
      idempotencyKey: fresh('idem-approve'),
      actionId: 'action-3',
      manifestId: 'manifest-action-3',
      manifestRevision: 1,
      expectedTargetRevision: 'rev-3',
      expectedExternalRevision: 'ext-7',
    });
    await client.preflightExternalAction({
      ...base,
      clientRequestId: fresh('ea-preflight'),
      idempotencyKey: fresh('idem-preflight'),
      actionId: 'action-3',
      expectedActionRevision: 4,
      manifestRevision: 1,
      expectedExternalRevision: 'ext-7',
    });
    await client.executeExternalAction({
      ...base,
      clientRequestId: fresh('ea-execute'),
      idempotencyKey: fresh('idem-execute'),
      actionId: 'action-3',
      expectedActionRevision: 4,
      manifestRevision: 1,
      preflightId: 'preflight-action-3',
      expectedExternalRevision: 'ext-7',
    });
  });

  const routeOrder = posts.filter((entry) =>
    ['POST /approve', 'POST /preflight', 'POST /execute'].includes(entry),
  );
  expect(routeOrder).toEqual(['POST /approve', 'POST /preflight', 'POST /execute']);
});

test('OUTCOME_UNKNOWN recovery issues no new external mutation and re-executes nothing', async ({
  page,
}) => {
  const posts: string[] = [];
  await stubLifecycleRoutes(page, posts);
  await openQueue(page);

  await selectAction(page, 'action-3');
  await page.getByRole('button', { name: '롤백' }).click();
  await expect(page.getByRole('button', { name: '원래 요청으로 복구' })).toBeVisible();

  // Recovery is resolve-only: no re-execute button and no second rollback
  // POST, no cancel/verify/execute mutation.
  await expect(page.getByRole('button', { name: /재실행|retry|재시도/i })).toHaveCount(0);
  const rollbackPosts = posts.filter((entry) => entry === 'POST /rollback');
  expect(rollbackPosts.length).toBe(1);
  const mutationsAfterUnknown = posts.filter(
    (entry) =>
      entry === 'POST /cancel' ||
      entry === 'POST /verify' ||
      entry === 'POST /execute' ||
      entry === 'POST /rollback',
  );
  expect(mutationsAfterUnknown).toEqual(['POST /rollback']);

  // The recovery resolve is the ORIGINAL identity (GET by clientRequestId).
  await page.getByRole('button', { name: '원래 요청으로 복구' }).click();
  await expect(page.getByRole('button', { name: '원래 요청으로 복구' })).toHaveCount(0);
  expect(posts.filter((entry) => entry === 'GET /command-outcomes/resolve').length).toBe(1);
});
