import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * FE-P4-S2 WP6 — External Action Governance Workspace browser accessibility
 * evidence (AC-19).
 *
 * WP5 already proves the workspace behaviour (route selection, deep-link
 * restore, restricted shell, OUTCOME_UNKNOWN recovery, governed surfaces) at
 * the unit level. WP6 adds ONLY the browser-level AC-19 evidence the frozen
 * criterion requires and that unit tests cannot provide: axe zero-critical,
 * keyboard-only navigation, frozen announcements in the live region, non-color
 * aggregate cues, 200% zoom, and prefers-reduced-motion.
 *
 * The browser fixture backend serves the real session + global shell; the
 * route guard, CSRF token and every external-action read are stubbed with the
 * strict-decoder-valid fixtures below (project `shotgun` matches the browser
 * fixture default project). No governed write is exercised here — the AC-16 /
 * AC-20 write-boundary proofs already exist at the client/integration level.
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

const queueResult = {
  schemaVersion: '1.0.0',
  items: [
    {
      schemaVersion: '1.0.0',
      actionId: 'action-1',
      actionRevision: 4,
      operation: 'UPDATE_REVERSIBLE',
      resourceProjectId: PROJECT,
      effectiveProjectId: PROJECT,
      status: 'VERIFIED',
      aggregateState: 'AVAILABLE',
      capabilities: [],
      riskLevel: 'R4',
      updatedAt: now,
    },
  ],
  nextCursor: undefined,
  capabilities: [],
};

const manifest = {
  schemaVersion: '1.0.0',
  manifestId: 'manifest-1',
  manifestRevision: 1,
  actionId: 'action-1',
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
  // Server-computed manifest digest over the exact payload above (AC-03).
  manifestDigest: 'sha256:2722cecb162fa732a58d8865cce6c60770112e577cd8f64a5394fa3d7ceb092c',
  expiresAt: '2026-09-01T00:00:00.000Z',
  createdAt: now,
  createdBy: {
    schemaVersion: '1.0.0',
    principalId: 'principal-1',
    actorId: 'user-1',
  },
};

const riskDecision = {
  schemaVersion: '1.0.0',
  riskDecisionId: 'risk-1',
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  riskLevel: 'R4',
  policyVersion: 'stage11.action-risk.v1',
  requiresUserApproval: true,
  reasons: ['High impact'],
  decidedAt: now,
};

const action = {
  schemaVersion: '1.0.0',
  actionId: 'action-1',
  actionRevision: 4,
  operation: 'UPDATE_REVERSIBLE',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  status: 'VERIFIED',
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
  manifestRef: { schemaVersion: '1.0.0', resourceKind: 'manifest', resourceId: 'manifest-1' },
  riskDecisionRef: { schemaVersion: '1.0.0', resourceKind: 'riskDecision', resourceId: 'risk-1' },
  latestExecutionRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'execution',
    resourceId: 'execution-1',
  },
};

const detailResult = {
  schemaVersion: '1.0.0',
  action,
  manifest,
  riskDecision,
  attempts: [],
};

const execution = {
  schemaVersion: '1.0.0',
  executionId: 'execution-1',
  concreteKind: 'EXECUTION',
  actionId: 'action-1',
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
    resourceId: 'attempt-1',
  },
};

const attemptsList = [
  {
    schemaVersion: '1.0.0',
    attemptId: 'attempt-1',
    attemptNumber: 1,
    executionId: 'execution-1',
    actionId: 'action-1',
    resourceProjectId: PROJECT,
    effectiveProjectId: PROJECT,
    idempotencyKey: 'idem-attempt-1',
    status: 'SUCCEEDED',
    policyContextRevision: 'policy-1',
    externalRevision: 'ext-7',
    correlationId: 'corr-1',
    startedAt: now,
    completedAt: now,
  },
];

const verification = {
  schemaVersion: '1.0.0',
  verificationId: 'verification-1',
  concreteKind: 'VERIFICATION',
  actionId: 'action-1',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  executionId: 'execution-1',
  targetRevision: 'rev-3',
  targetDigest: `sha256:${'a'.repeat(64)}`,
  externalRevision: 'ext-7',
  status: 'APPLIED',
  observedDigest: `sha256:${'a'.repeat(64)}`,
  verifiedAt: now,
};

// Stub the route guard (ALLOW for /external-action), CSRF token and every
// external-action READ. The real shell from the browser fixture backend
// already exposes the external-action navigation + Home navigate-only entry.
const stubExternalActionReads = async (page: Page) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(routeGuard),
    });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-external-action-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/external-action/queue', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(queueResult),
    });
  });
  await page.route('**/product-api/frontend/external-action/actions/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', action }),
    });
  });
  await page.route('**/product-api/frontend/external-action/actions/detail', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(detailResult),
    });
  });
  await page.route('**/product-api/frontend/external-action/manifests/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', manifest }),
    });
  });
  await page.route('**/product-api/frontend/external-action/risk-decisions/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', riskDecision }),
    });
  });
  await page.route('**/product-api/frontend/external-action/executions/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', execution }),
    });
  });
  await page.route('**/product-api/frontend/external-action/executions/attempts', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', attempts: attemptsList }),
    });
  });
  await page.route('**/product-api/frontend/external-action/verifications/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', verification }),
    });
  });
};

// Select the action from the queue and wait for the full workspace: detail +
// child sections + the governed (non-automatic) surfaces.
const openWorkspace = async (page: Page) => {
  await page.goto('/external-action');
  await expect(page.getByRole('heading', { name: 'External Actions', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Update an external resource/ }).click();
  await expect(page.getByRole('heading', { name: 'Update an external resource' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '거버넌스 명령' })).toBeVisible();
  await expect(page.getByRole('button', { name: '롤백' })).toBeVisible();
  await expect(page.getByRole('button', { name: '보상 액션 준비' })).toBeVisible();
};

test('External Action Workspace renders the queue, detail and governed surfaces with frozen announcements (AC-19)', async ({
  page,
}) => {
  await stubExternalActionReads(page);
  await openWorkspace(page);

  // Child sections render from the authoritative reads.
  await expect(page.getByRole('heading', { name: '위험 결정' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '매니페스트' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '실행', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '실행 시도' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '검증' })).toBeVisible();

  // Non-color aggregate cue and semantic status text are both present.
  await expect(page.getByText('완료').first()).toBeVisible();
  await expect(page.getByText('Verified').first()).toBeVisible();

  // The frozen announcement is delivered to the polite live region
  // (EXTERNAL_ACTION_ANNOUNCEMENTS.DETAIL_READY).
  const liveRegion = page.locator('p.visually-hidden[aria-live="polite"]');
  await expect(liveRegion).toContainText('외부 액션 상세가 로드되었습니다.');
});

test('External Action Workspace supports keyboard-only selection and restores deep-link focus (AC-19)', async ({
  page,
}) => {
  await stubExternalActionReads(page);
  await page.goto('/external-action');
  await expect(page.getByRole('heading', { name: 'External Actions', level: 1 })).toBeVisible();

  // Tab until the queue item is focused (keyboard-only), then activate with
  // Enter — no pointer required.
  const queueButton = page.getByRole('button', { name: /Update an external resource/ });
  let focused = false;
  for (let i = 0; i < 30 && !focused; i += 1) {
    await page.keyboard.press('Tab');
    focused = await queueButton.evaluate((element) => element === document.activeElement);
  }
  expect(focused, 'queue item reached by Tab').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Update an external resource' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '거버넌스 명령' })).toBeVisible();

  // Deep-link restore preserves focus on the named target (contract §10.5).
  await page.goto('/external-action?action=action-1&focus=manifest-heading');
  await expect(page.getByRole('heading', { name: '매니페스트' })).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.id))
    .toBe('manifest-heading');
});

test('External Action Workspace has zero axe critical violations (AC-19)', async ({ page }) => {
  await stubExternalActionReads(page);
  await openWorkspace(page);

  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((violation) => violation.impact === 'critical');
  expect(critical, `critical violations: ${critical.map((v) => v.id).join(', ')}`).toHaveLength(0);
});

test('External Action Workspace stays usable at 200% zoom (AC-19)', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await stubExternalActionReads(page);
  await openWorkspace(page);

  // No document-level horizontal overflow at 200% zoom.
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  // Primary content is still present and visible.
  await expect(page.getByRole('heading', { name: 'Update an external resource' })).toBeVisible();
  await expect(page.getByRole('button', { name: '롤백' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '거버넌스 명령' })).toBeVisible();
});

test('External Action Workspace renders under prefers-reduced-motion (AC-19)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubExternalActionReads(page);
  await openWorkspace(page);

  // All essential state is conveyed without animation: the detail, the
  // non-color cue text and the governed surfaces remain present.
  await expect(page.getByText('완료').first()).toBeVisible();
  await expect(page.getByText('Verified').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '롤백' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '매니페스트' })).toBeVisible();
});
