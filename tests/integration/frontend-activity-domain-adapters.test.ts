import { describe, expect, it } from 'vitest';

import {
  ASK_SCHEMA_VERSION,
  SOURCES_SCHEMA_VERSION,
  type AskAnswerRunSnapshot,
  type IntakeSubmissionSnapshot,
} from '../../packages/contracts/src/index.js';
import { InMemoryExternalActionStore } from '../../adapters/frontend-external-action-in-memory/src/index.js';
import {
  SourcesActivityAdapter,
  InMemorySourcesActivityRead,
} from '../../adapters/frontend-activity-sources/src/index.js';
import {
  AskActivityAdapter,
  InMemoryAskActivityRead,
} from '../../adapters/frontend-activity-ask/src/index.js';
import { ExternalActionActivityAdapter } from '../../adapters/frontend-activity-external-action/src/index.js';
import type { SourcesActivityAttemptRow } from '../../modules/frontend-activity/src/index.js';

/**
 * FE-P5-S1 WP3 — concrete owning-Domain Activity adapters.
 * Verifies that Sources (IntakeSubmission/items/IntakeAttempt), Ask
 * (AnswerRun/AnswerRunAttempt/AnswerRunEvent) and External Action
 * (Action/Execution/ExecutionAttempt/AuditEvent) are mapped into the common
 * Activity views through the REAL adapters (no mocks), with the ADR-130 root
 * binding (Sources/External Action = JOB, Ask = RUN).
 */

const ADAPTER_SCOPE = {
  principalId: 'principal-1',
  activeProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'private',
  accessScope: ['owner', 'activity:read', 'action:read', 'action:audit:read'],
};

describe('FE-P5-S1 SourcesActivityAdapter (concrete)', () => {
  const submission: IntakeSubmissionSnapshot = {
    schemaVersion: SOURCES_SCHEMA_VERSION,
    submissionId: 'submission-1',
    principalId: 'principal-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    state: 'RUNNING',
    items: [
      {
        itemId: 'item-1',
        manifest: {
          kind: 'DIRECT_TEXT',
          itemId: 'item-1',
          label: 'Note',
          mediaType: 'text/plain',
          sizeBytes: 100,
        },
        state: 'RUNNING',
        validation: [],
        capabilities: ['CANCEL'],
        progress: { completedUnits: 1, totalUnits: 3, unit: 'STEPS' },
      },
      {
        itemId: 'item-2',
        manifest: {
          kind: 'FILE',
          itemId: 'item-2',
          label: 'Report',
          fileName: 'r.pdf',
          mediaType: 'application/pdf',
          sizeBytes: 200,
        },
        state: 'QUEUED',
        validation: [],
        capabilities: ['CANCEL'],
      },
    ],
    capabilities: ['CANCEL'],
    acceptedPolicyContextId: 'policy-1',
    submissionRevision: '1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    stale: false,
  };

  const attempt: SourcesActivityAttemptRow = {
    intakeAttemptId: 'attempt-1',
    projectId: 'project-1',
    submissionId: 'submission-1',
    submissionItemId: 'item-1',
    attemptNumber: 1,
    attemptKind: 'SUBMIT',
    state: 'SUCCEEDED',
    correlationId: 'corr-1',
    createdAt: '2026-08-06T00:00:00.500Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    completedAt: '2026-08-06T00:00:01.000Z',
  };

  const makeAdapter = (): SourcesActivityAdapter => {
    const read = new InMemorySourcesActivityRead();
    read.seedSubmission(submission);
    read.seedAttempt(attempt);
    return new SourcesActivityAdapter(read);
  };

  it('maps the submission queue as a JOB root with lifecycle state', async () => {
    const adapter = makeAdapter();
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item.root.rootKind).toBe('JOB');
    expect(item.root.domainKind).toBe('SOURCES');
    expect(item.root.domainResourceKind).toBe('IntakeSubmission');
    expect(item.root.domainResourceId).toBe('submission-1');
    expect(item.root.jobId).toBe('submission-1');
    expect(item.state).toBe('RUNNING');
    expect(item.updatedAt).toBe('2026-08-06T00:00:01.000Z');
  });

  it('maps the submission detail with item stages and attempt events', async () => {
    const adapter = makeAdapter();
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const detail = await adapter.readDetail(ADAPTER_SCOPE, page.items[0]!.root);
    expect(detail.root.domainResourceId).toBe('submission-1');
    expect(detail.run.state).toBe('RUNNING');
    // Items become stages.
    expect(detail.stages).toHaveLength(2);
    expect(detail.stages[0]?.label).toBe('Note');
    expect(detail.stages[0]?.state).toBe('RUNNING');
    expect(detail.stages[1]?.label).toBe('Report');
    // IntakeAttempt becomes a domain attempt and an event.
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.attemptKind).toBe('SOURCES_INTAKE');
    expect(detail.attempts[0]?.state).toBe('SUCCEEDED');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.category).toBe('SUCCEEDED');
    // WP5 — server-derived available actions from owning-Domain capabilities.
    expect(detail.availableActions).toEqual([{ schemaVersion: '1.0.0', kind: 'CANCEL' }]);
  });

  it('derives RETRY from Sources retry capabilities and omits actions deny-by-default', async () => {
    const retryable = {
      ...submission,
      state: 'FAILED' as const,
      capabilities: ['RETRY_CURRENT_POLICY' as const],
    };
    const noActions = { ...submission, capabilities: [] };
    const read = new InMemorySourcesActivityRead();
    read.seedSubmission(retryable);
    const adapter = new SourcesActivityAdapter(read);
    const retryRoot = {
      schemaVersion: '1.0.0' as const,
      rootKind: 'JOB' as const,
      activityId: 'submission-1',
      domainKind: 'SOURCES' as const,
      domainResourceKind: 'IntakeSubmission' as const,
      domainResourceId: 'submission-1',
      resourceProjectId: 'project-1',
      resourceHref: '/submission-1',
      jobId: 'submission-1',
      runId: 'submission-1',
    };
    expect((await adapter.readDetail(ADAPTER_SCOPE, retryRoot)).availableActions).toEqual([
      { schemaVersion: '1.0.0', kind: 'RETRY', retryMode: 'CURRENT_POLICY' },
    ]);
    // Deny-by-default: no capabilities → no actions.
    const noActionsRead = new InMemorySourcesActivityRead();
    noActionsRead.seedSubmission(noActions);
    const noActionsAdapter = new SourcesActivityAdapter(noActionsRead);
    expect((await noActionsAdapter.readDetail(ADAPTER_SCOPE, retryRoot)).availableActions).toEqual(
      [],
    );
  });
});

describe('FE-P5-S1 AskActivityAdapter (concrete)', () => {
  const run: AskAnswerRunSnapshot = {
    schemaVersion: ASK_SCHEMA_VERSION,
    answerRunId: 'run-1',
    conversationId: 'conv-1',
    branchId: 'branch-1',
    turnId: 'turn-1',
    projectId: 'project-1',
    mode: 'CANONICAL_ONLY',
    state: 'RUNNING',
    question: 'What is the budget?',
    statements: [],
    sourceSelections: [],
    capabilities: [],
    answerRevision: '1',
    conversationRevision: '1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    stale: false,
    attemptNumber: 1,
    attemptId: 'attempt-1',
  };

  const makeAdapter = (): AskActivityAdapter => {
    const read = new InMemoryAskActivityRead();
    read.seedRun(run);
    read.seedEvent({
      schemaVersion: ASK_SCHEMA_VERSION,
      eventId: 'event-1',
      answerRunId: 'run-1',
      attemptId: 'attempt-1',
      projectId: 'project-1',
      ordinal: 1,
      kind: 'STATE',
      state: 'RUNNING',
      answerRevision: '1',
      createdAt: '2026-08-06T00:00:00.500Z',
    });
    return new AskActivityAdapter(read);
  };

  it('maps the answer run as a RUN root (Ask has no durable Job)', async () => {
    const adapter = makeAdapter();
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item.root.rootKind).toBe('RUN');
    expect(item.root.domainKind).toBe('ASK');
    expect(item.root.domainResourceKind).toBe('AnswerRun');
    expect(item.root.domainResourceId).toBe('run-1');
    expect(item.root.jobId).toBeUndefined();
    expect(item.state).toBe('RUNNING');
  });

  it('maps the answer run detail with attempt and bounded events', async () => {
    const adapter = makeAdapter();
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const detail = await adapter.readDetail(ADAPTER_SCOPE, page.items[0]!.root);
    expect(detail.run.runId).toBe('run-1');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.attemptKind).toBe('ASK_ANSWER');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.sequence).toBe(1);
    // WP5 — Ask run exposes no capabilities → no available actions.
    expect(detail.availableActions).toEqual([]);
    const events = await adapter.readEvents(ADAPTER_SCOPE, page.items[0]!.root);
    expect(events.events).toHaveLength(1);
  });
});

describe('FE-P5-S1 ExternalActionActivityAdapter (concrete)', () => {
  const makeStoreAndAdapter = async (): Promise<{
    store: InMemoryExternalActionStore;
    adapter: ExternalActionActivityAdapter;
  }> => {
    const store = new InMemoryExternalActionStore();
    const action = {
      schemaVersion: '1.0.0' as const,
      actionId: 'action-1',
      actionRevision: 1,
      operation: 'UPDATE_REVERSIBLE' as const,
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      status: 'EXECUTING' as const,
      aggregateState: 'AVAILABLE' as const,
      accessMasking: 'VISIBLE' as const,
      maskedFields: [],
      capabilities: ['READ_EXTERNAL_ACTION' as const],
      updatedAt: '2026-08-06T00:00:02.000Z',
      createdAt: '2026-08-06T00:00:00.000Z',
      latestExecutionRef: {
        schemaVersion: '1.0.0' as const,
        resourceKind: 'execution' as const,
        resourceId: 'execution-1',
      },
    };
    const execution = {
      schemaVersion: '1.0.0' as const,
      executionId: 'execution-1',
      concreteKind: 'EXECUTION' as const,
      actionId: 'action-1',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      manifestRevision: 1,
      status: 'IN_PROGRESS' as const,
      attemptCount: 1,
      startedAt: '2026-08-06T00:00:01.000Z',
    };
    const attempt = {
      schemaVersion: '1.0.0' as const,
      attemptId: 'attempt-1',
      attemptNumber: 1,
      executionId: 'execution-1',
      actionId: 'action-1',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      idempotencyKey: 'idem-1',
      status: 'IN_PROGRESS' as const,
      policyContextRevision: 'policy-1',
      externalRevision: 'ext-1',
      correlationId: 'corr-1',
      startedAt: '2026-08-06T00:00:01.000Z',
    };
    const audit = {
      schemaVersion: '1.0.0' as const,
      auditEventId: 'audit-1',
      actionId: 'action-1',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      sequence: 1,
      category: 'ACTION_EXECUTED' as const,
      eventData: { schemaVersion: '1.0.0' as const, message: 'executed', refs: [] },
      occurredAt: '2026-08-06T00:00:01.500Z',
    };
    await store.transaction(async (repos) => {
      await repos.aggregates.insert(action);
      await repos.executions.insert(execution);
      await repos.attempts.insert(attempt);
      await repos.audit.append(audit);
    });
    return { store, adapter: new ExternalActionActivityAdapter(store) };
  };

  it('maps the action aggregate as a JOB root with lifecycle state', async () => {
    const { adapter } = await makeStoreAndAdapter();
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item.root.rootKind).toBe('JOB');
    expect(item.root.domainKind).toBe('EXTERNAL_ACTION');
    expect(item.root.domainResourceKind).toBe('ExternalAction');
    expect(item.root.domainResourceId).toBe('action-1');
    expect(item.root.jobId).toBe('action-1');
    expect(item.state).toBe('RUNNING');
  });

  it('maps the action detail with execution attempts and audit events', async () => {
    const { adapter } = await makeStoreAndAdapter();
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const detail = await adapter.readDetail(ADAPTER_SCOPE, page.items[0]!.root);
    expect(detail.run.runId).toBe('execution-1');
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.attemptKind).toBe('EXTERNAL_ACTION_EXECUTION');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]?.category).toBe('SUCCEEDED');
    // WP5 — only READ capability → no available actions (deny by default).
    expect(detail.availableActions).toEqual([]);
    const stages = await adapter.readStages(ADAPTER_SCOPE, page.items[0]!.root);
    expect(stages.stages).toHaveLength(1);
  });

  it('carries the External Action command context in the available action descriptors', async () => {
    const store = new InMemoryExternalActionStore();
    const action = {
      schemaVersion: '1.0.0' as const,
      actionId: 'action-1',
      actionRevision: 4,
      operation: 'UPDATE_REVERSIBLE' as const,
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      status: 'FAILED' as const,
      aggregateState: 'AVAILABLE' as const,
      accessMasking: 'VISIBLE' as const,
      maskedFields: [],
      capabilities: [
        'READ_EXTERNAL_ACTION' as const,
        'CANCEL_EXTERNAL_ACTION' as const,
        'RETRY_EXECUTION_ATTEMPT' as const,
      ],
      updatedAt: '2026-08-06T00:00:02.000Z',
      createdAt: '2026-08-06T00:00:00.000Z',
      latestExecutionRef: {
        schemaVersion: '1.0.0' as const,
        resourceKind: 'execution' as const,
        resourceId: 'execution-1',
      },
    };
    const execution = {
      schemaVersion: '1.0.0' as const,
      executionId: 'execution-1',
      concreteKind: 'EXECUTION' as const,
      actionId: 'action-1',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      manifestRevision: 1,
      status: 'FAILED' as const,
      attemptCount: 1,
      startedAt: '2026-08-06T00:00:01.000Z',
    };
    const failedAttempt = {
      schemaVersion: '1.0.0' as const,
      attemptId: 'attempt-1',
      attemptNumber: 1,
      executionId: 'execution-1',
      actionId: 'action-1',
      resourceProjectId: 'project-1',
      effectiveProjectId: 'project-1',
      idempotencyKey: 'idem-1',
      status: 'FAILED' as const,
      policyContextRevision: 'policy-1',
      externalRevision: 'ext-1',
      correlationId: 'corr-1',
      startedAt: '2026-08-06T00:00:01.000Z',
    };
    await store.transaction(async (repos) => {
      await repos.aggregates.insert(action);
      await repos.executions.insert(execution);
      await repos.attempts.insert(failedAttempt);
    });
    const adapter = new ExternalActionActivityAdapter(store);
    const page = await adapter.readQueue(ADAPTER_SCOPE, { limit: 10 });
    const detail = await adapter.readDetail(ADAPTER_SCOPE, page.items[0]!.root);
    expect(detail.availableActions).toEqual([
      { schemaVersion: '1.0.0', kind: 'CANCEL', actionRevision: 4 },
      {
        schemaVersion: '1.0.0',
        kind: 'RETRY',
        executionId: 'execution-1',
        sourceAttemptId: 'attempt-1',
        causationId: 'corr-1',
      },
    ]);
  });
});
