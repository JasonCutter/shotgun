import { describe, expect, it } from 'vitest';

import {
  claimCandidateDigest,
  type AnalysisRevisionV2,
  type ClaimCandidate,
  type SecurityContext,
  sha256Text,
} from '../../packages/contracts/src/index.js';
import {
  createComparisonV2Orchestrator,
  type ComparisonCandidateV2ResolverPort,
  type ComparisonV2OrchestrationRequest,
} from '../../modules/comparison/src/orchestration-v2.js';
import type {
  ComparisonV2Aggregate,
  ComparisonV2BlockedOutcome,
  ComparisonV2BlockedOutcomeRepositoryPort as ComparisonBlockedPort,
  ComparisonV2RepositoryPort,
  ComparisonV2TerminalAnalysisReaderPort,
} from '../../modules/comparison/src/persistence-v2.js';
import type { ComparisonShortlistV2Port } from '../../modules/comparison/src/shortlist-v2.js';
import { ComparisonActivityAdapter } from '../../adapters/frontend-activity-comparison/src/index.js';

const projectId = 'project-245';
const observedAt = '2026-09-09T12:00:00.000Z';
const candidate: ClaimCandidate = {
  candidateId: 'candidate-245',
  batchId: 'batch-245',
  revisionNumber: 1,
  projectId,
  sourceVersionId: 'source-245',
  claimText: 'A source-backed claim.',
  evidenceIds: ['evidence-245'],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status: 'READY',
  providerCall: {} as ClaimCandidate['providerCall'],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: observedAt,
};
const candidateDigest = claimCandidateDigest(candidate);
const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'comparison.issue245',
};
const request: ComparisonV2OrchestrationRequest = {
  projectId,
  candidateId: candidate.candidateId,
  actor: { type: 'user', id: 'owner-245' },
  security,
  k: 2,
  attempt: 1,
};

const blockedKey = (input: {
  readonly projectId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly candidateDigest: string;
  readonly blockedPhase: string;
  readonly reason: string;
  readonly governingInputDigest: string;
}): string =>
  [
    input.projectId,
    input.candidateId,
    input.candidateRevision,
    input.candidateDigest,
    input.blockedPhase,
    input.reason,
    input.governingInputDigest,
  ].join('|');

const memoryBlockedRepository = () => {
  const rows = new Map<string, ComparisonV2BlockedOutcome>();
  let sequence = 0;
  const repository: ComparisonBlockedPort = {
    async recordBlockedOutcome(input) {
      const key = blockedKey(input);
      const existing = rows.get(key);
      if (existing) {
        const updated = {
          ...existing,
          lastObservedAt:
            existing.lastObservedAt > input.observedAt ? existing.lastObservedAt : input.observedAt,
          state: 'ACTIVE' as const,
          resolvedAt: undefined,
          resolutionIdentity: undefined,
        };
        rows.set(key, updated);
        return updated;
      }
      const created: ComparisonV2BlockedOutcome = {
        blockedOutcomeId: `blocked-${++sequence}`,
        ...input,
        state: 'ACTIVE',
        firstObservedAt: input.observedAt,
        lastObservedAt: input.observedAt,
      };
      rows.set(key, created);
      return created;
    },
    async resolveBlockedOutcomes(input) {
      for (const [key, row] of rows) {
        if (
          row.projectId === input.projectId &&
          row.candidateId === input.candidateId &&
          row.candidateRevision === input.candidateRevision &&
          row.candidateDigest === input.candidateDigest &&
          row.state === 'ACTIVE'
        ) {
          rows.set(key, {
            ...row,
            state: input.state,
            resolvedAt: input.resolvedAt,
            resolutionIdentity: input.resolutionIdentity,
            lastObservedAt: input.resolvedAt,
          });
        }
      }
    },
    async findBlockedOutcome(project, id) {
      return [...rows.values()].find(
        (row) => row.projectId === project && row.blockedOutcomeId === id,
      );
    },
    async listBlockedOutcomes(project, state) {
      return [...rows.values()].filter(
        (row) => row.projectId === project && (state === undefined || row.state === state),
      );
    },
    async listActiveBlockedOutcomes(project) {
      return [...rows.values()].filter(
        (row) => row.projectId === project && row.state === 'ACTIVE',
      );
    },
  };
  return { repository, rows };
};

const baseRepository = (blockedOutcomes?: ComparisonBlockedPort): ComparisonV2RepositoryPort => ({
  ...(blockedOutcomes === undefined ? {} : { blockedOutcomes }),
  async saveAnalysisRevision({ revision }) {
    return revision;
  },
  async transitionAnalysisRevision() {
    throw new Error('not used');
  },
  async findAnalysisRevision() {
    return undefined;
  },
  async findAnalysisRevisionByInput() {
    return undefined;
  },
  async saveCompletedAggregate(aggregate) {
    return aggregate;
  },
  async findComparisonById() {
    return undefined;
  },
  async findComparisonByIdentity() {
    return undefined;
  },
});

const blockedShortlist = (
  reason: 'LEXICAL_UNAVAILABLE' | 'POLICY_DENIED' = 'LEXICAL_UNAVAILABLE',
) => ({
  async build() {
    return {
      status: 'BLOCKED' as const,
      reason,
      readiness: { lexicalStatus: 'DEGRADED' as const, semanticStatus: 'READY' as const },
    };
  },
});

const exactShortlist = {
  async build() {
    return {
      status: 'EXACT_DUPLICATE' as const,
      exactDuplicateTarget: {
        resourceType: 'CLAIM' as const,
        resourceId: 'claim-1',
        resourceRevision: 1,
        canonicalSnapshot: {
          id: 'snapshot-245',
          version: 1,
          digest: sha256Text('snapshot-245'),
        },
      },
    };
  },
};

const orchestrator = (
  shortlist: ComparisonShortlistV2Port,
  blockedOutcomes: ComparisonBlockedPort,
  candidateResolver: ComparisonCandidateV2ResolverPort = { findById: async () => candidate },
) =>
  createComparisonV2Orchestrator({
    candidate: candidateResolver,
    shortlist,
    semanticAnalysis: {
      async analyze() {
        throw new Error('semantic provider must not run in this test');
      },
    },
    repository: baseRepository(blockedOutcomes),
    now: () => observedAt,
    randomId: () => 'comparison-245',
  });

describe('Issue #245 durable Stage 5 blocked observability', () => {
  it('persists a safe readiness block and keeps raw operational data out', async () => {
    const memory = memoryBlockedRepository();
    const result = await orchestrator(blockedShortlist(), memory.repository).compare(request);
    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'SHORTLIST_BLOCKED' });
    const [row] = [...memory.rows.values()];
    expect(row).toMatchObject({
      blockedPhase: 'SHORTLIST',
      safeCode: 'SHORTLIST_BLOCKED',
      state: 'ACTIVE',
    });
    expect(JSON.stringify(row)).not.toContain(candidate.claimText);
  });

  it('does not persist policy or invalid-request blocks as owner Attention', async () => {
    const policyMemory = memoryBlockedRepository();
    await orchestrator(blockedShortlist('POLICY_DENIED'), policyMemory.repository).compare(request);
    expect(policyMemory.rows.size).toBe(0);
    const invalidMemory = memoryBlockedRepository();
    await orchestrator(blockedShortlist(), invalidMemory.repository).compare({ ...request, k: 0 });
    expect(invalidMemory.rows.size).toBe(0);
    const resolutionMemory = memoryBlockedRepository();
    const resolution = await orchestrator(blockedShortlist(), resolutionMemory.repository, {
      async findById() {
        throw new Error('candidate store unavailable');
      },
    }).compare(request);
    expect(resolution).toEqual({ status: 'BLOCKED', reason: 'CANDIDATE_RESOLUTION_FAILED' });
    expect(resolutionMemory.rows.size).toBe(0);
  });

  it('replay of the same governed block is idempotent', async () => {
    const memory = memoryBlockedRepository();
    const comparison = orchestrator(blockedShortlist(), memory.repository);
    await comparison.compare(request);
    await comparison.compare({ ...request, attempt: 2 });
    expect(memory.rows.size).toBe(1);
  });

  it('uses a distinct identity when the governing detail changes', async () => {
    const memory = memoryBlockedRepository();
    const first = await memory.repository.recordBlockedOutcome({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      candidateDigest,
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest: sha256Text('one'),
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: observedAt,
    });
    const second = await memory.repository.recordBlockedOutcome({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 2,
      candidateDigest: sha256Text('revision-2'),
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest: sha256Text('one'),
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: observedAt,
    });
    expect(second.blockedOutcomeId).not.toBe(first.blockedOutcomeId);
    expect(memory.rows.size).toBe(2);
  });

  it('resolves the active block after a terminal comparison is persisted', async () => {
    const memory = memoryBlockedRepository();
    let ready = false;
    const shortlist = {
      async build() {
        if (!ready) return await blockedShortlist().build();
        return await exactShortlist.build();
      },
    };
    const comparison = orchestrator(shortlist, memory.repository);
    await comparison.compare(request);
    ready = true;
    const result = await comparison.compare(request);
    expect(result.status).toBe('COMPLETED');
    expect([...memory.rows.values()]).toEqual([
      expect.objectContaining({ state: 'RESOLVED', resolutionIdentity: 'comparison-245' }),
    ]);
  });

  it('reactivates the same durable block after it was resolved', async () => {
    const memory = memoryBlockedRepository();
    const comparison = orchestrator(blockedShortlist(), memory.repository);
    await comparison.compare(request);
    await memory.repository.resolveBlockedOutcomes({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: candidate.revisionNumber,
      candidateDigest,
      resolutionIdentity: 'comparison-resolved-245',
      resolvedAt: '2026-09-09T12:01:00.000Z',
      state: 'RESOLVED',
    });
    await comparison.compare({ ...request, attempt: 2 });
    const rows = [...memory.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'ACTIVE',
      resolvedAt: undefined,
      resolutionIdentity: undefined,
    });
    const adapter = new ComparisonActivityAdapter(memory.repository);
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.dimensions.attention).toBe('NEEDS_ATTENTION');
  });

  it('does not create a blocked row when candidate access is denied', async () => {
    const memory = memoryBlockedRepository();
    const result = await orchestrator(blockedShortlist(), memory.repository).compare({
      ...request,
      security: { ...security, accessScope: ['other'] },
    });
    expect(result).toEqual({ status: 'BLOCKED', reason: 'CANDIDATE_ACCESS_DENIED' });
    expect(memory.rows.size).toBe(0);
  });

  it('maps an active block to Activity Attention without a generic action', async () => {
    const memory = memoryBlockedRepository();
    const outcome = await memory.repository.recordBlockedOutcome({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      candidateDigest,
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest: sha256Text('activity'),
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: observedAt,
    });
    const adapter = new ComparisonActivityAdapter(memory.repository);
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items[0]).toMatchObject({
      state: 'FAILED',
      dimensions: { attention: 'NEEDS_ATTENTION' },
    });
    const detail = await adapter.readDetail(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      page.items[0]!.root,
    );
    expect(detail.availableActions).toEqual([]);
    expect(detail.root.domainResourceId).toBe(outcome.blockedOutcomeId);
  });

  it('filters Activity access by scope and sensitivity', async () => {
    const memory = memoryBlockedRepository();
    const outcome = await memory.repository.recordBlockedOutcome({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      candidateDigest,
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest: sha256Text('security'),
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: observedAt,
    });
    const adapter = new ComparisonActivityAdapter(memory.repository);
    const root = {
      schemaVersion: '1.0.0' as const,
      rootKind: 'JOB' as const,
      activityId: outcome.blockedOutcomeId,
      domainKind: 'COMPARISON' as const,
      domainResourceKind: 'ComparisonBlockedOutcome',
      domainResourceId: outcome.blockedOutcomeId,
      resourceProjectId: projectId,
      resourceHref: '/activity',
      jobId: outcome.blockedOutcomeId,
      runId: `stage5-blocked:${outcome.blockedOutcomeId}`,
    };
    expect(
      await adapter.canAccess(
        {
          principalId: 'other',
          activeProjectId: projectId,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
          accessScope: ['other'],
          sensitivityClearance: 'private',
        },
        root,
      ),
    ).toBe(false);
    expect(
      await adapter.canAccess(
        {
          principalId: 'owner-245',
          activeProjectId: projectId,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
          accessScope: ['owner'],
          sensitivityClearance: 'public',
        },
        root,
      ),
    ).toBe(false);
  });

  it('preserves resolved state as a non-attention Activity result', async () => {
    const memory = memoryBlockedRepository();
    const outcome = await memory.repository.recordBlockedOutcome({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      candidateDigest,
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest: sha256Text('resolved'),
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: observedAt,
    });
    await memory.repository.resolveBlockedOutcomes({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      candidateDigest,
      resolutionIdentity: 'comparison-245',
      resolvedAt: '2026-09-09T12:01:00.000Z',
      state: 'RESOLVED',
    });
    const adapter = new ComparisonActivityAdapter(memory.repository);
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items[0]).toMatchObject({
      state: 'SUCCEEDED',
      dimensions: { attention: 'RESOLVED' },
    });
    expect(page.items[0]!.root.domainResourceId).toBe(outcome.blockedOutcomeId);
  });

  it('keeps provider execution out of a pre-terminal shortlist block', async () => {
    const memory = memoryBlockedRepository();
    let providerCalls = 0;
    const result = await createComparisonV2Orchestrator({
      candidate: { findById: async () => candidate },
      shortlist: blockedShortlist(),
      semanticAnalysis: {
        async analyze() {
          providerCalls += 1;
          throw new Error('must not execute');
        },
      },
      repository: baseRepository(memory.repository),
      now: () => observedAt,
    }).compare(request);
    expect(result.status).toBe('BLOCKED');
    expect(providerCalls).toBe(0);
  });

  it('keeps raw failure detail out of the persisted governing identity', async () => {
    const memory = memoryBlockedRepository();
    await orchestrator(blockedShortlist(), memory.repository).compare(request);
    const row = [...memory.rows.values()][0]!;
    expect(row.governingInputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(row.governingInputDigest).not.toContain('SEMANTIC_DEGRADED');
  });

  it('exposes only the Comparison Activity domain and Stage 5 attempt kind', async () => {
    const memory = memoryBlockedRepository();
    await memory.repository.recordBlockedOutcome({
      projectId,
      candidateId: candidate.candidateId,
      candidateRevision: 1,
      candidateDigest,
      blockedPhase: 'SHORTLIST',
      reason: 'SHORTLIST_BLOCKED',
      safeCode: 'SHORTLIST_BLOCKED',
      governingInputDigest: sha256Text('contract'),
      accessScope: ['owner'],
      sensitivity: 'private',
      observedAt: observedAt,
    });
    const terminalAnalysis = {
      analysisRevisionId: 'analysis-245',
      candidate: {
        id: candidate.candidateId,
        revision: candidate.revisionNumber,
        digest: candidateDigest,
        sourceVersionId: candidate.sourceVersionId,
        evidenceIds: [...candidate.evidenceIds],
      },
      state: 'FAILED_TERMINAL',
      safeFailureCode: 'TERMINAL_FAILURE',
      startedAt: observedAt,
      completedAt: observedAt,
      createdAt: observedAt,
    } as unknown as AnalysisRevisionV2;
    const terminal: ComparisonV2TerminalAnalysisReaderPort = {
      async listTerminalAnalysisRevisions() {
        return [terminalAnalysis];
      },
    };
    const adapter = new ComparisonActivityAdapter(memory.repository, terminal, {
      findById: async () => candidate,
    });
    expect(adapter.domainKind).toBe('COMPARISON');
    expect(adapter.domainKinds).toEqual(['COMPARISON']);
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items[0]!.root.rootKind).toBe('JOB');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.root.domainResourceKind).toBe('ComparisonAnalysisRevision');
    expect(page.items[0]!.dimensions.attention).toBe('NEEDS_ATTENTION');
  });

  it('does not resurrect an older retryable failure after a newer completion', async () => {
    const memory = memoryBlockedRepository();
    const baseAnalysis = {
      analysisRevisionId: 'analysis-245-retryable',
      candidate: {
        id: candidate.candidateId,
        revision: candidate.revisionNumber,
        digest: candidateDigest,
        sourceVersionId: candidate.sourceVersionId,
        evidenceIds: [...candidate.evidenceIds],
      },
      startedAt: observedAt,
      createdAt: observedAt,
    } as const;
    const terminal: ComparisonV2TerminalAnalysisReaderPort = {
      async listTerminalAnalysisRevisions() {
        return [
          {
            ...baseAnalysis,
            state: 'FAILED_RETRYABLE',
            safeFailureCode: 'RETRYABLE_DEPENDENCY',
            attempt: 1,
            completedAt: observedAt,
          },
          {
            ...baseAnalysis,
            analysisRevisionId: 'analysis-245-completed',
            state: 'COMPLETED',
            attempt: 2,
            createdAt: '2026-09-09T12:01:00.000Z',
            completedAt: '2026-09-09T12:01:00.000Z',
          },
        ] as unknown as AnalysisRevisionV2[];
      },
    };
    const adapter = new ComparisonActivityAdapter(memory.repository, terminal, {
      findById: async () => candidate,
    });
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items).toHaveLength(0);
  });

  it('does not resurrect an older terminal failure after a newer policy block', async () => {
    const memory = memoryBlockedRepository();
    const baseAnalysis = {
      analysisRevisionId: 'analysis-245-terminal',
      candidate: {
        id: candidate.candidateId,
        revision: candidate.revisionNumber,
        digest: candidateDigest,
        sourceVersionId: candidate.sourceVersionId,
        evidenceIds: [...candidate.evidenceIds],
      },
      startedAt: observedAt,
      createdAt: observedAt,
    } as const;
    const terminal: ComparisonV2TerminalAnalysisReaderPort = {
      async listTerminalAnalysisRevisions() {
        return [
          {
            ...baseAnalysis,
            state: 'FAILED_TERMINAL',
            safeFailureCode: 'TERMINAL_FAILURE',
            attempt: 1,
            completedAt: observedAt,
          },
          {
            ...baseAnalysis,
            analysisRevisionId: 'analysis-245-policy',
            state: 'POLICY_BLOCKED',
            attempt: 2,
            createdAt: '2026-09-09T12:01:00.000Z',
            completedAt: '2026-09-09T12:01:00.000Z',
          },
        ] as unknown as AnalysisRevisionV2[];
      },
    };
    const adapter = new ComparisonActivityAdapter(memory.repository, terminal, {
      findById: async () => candidate,
    });
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items).toHaveLength(0);
  });

  it('uses execution chronology across different governing inputs instead of attempt', async () => {
    const memory = memoryBlockedRepository();
    const baseAnalysis = {
      candidate: {
        id: candidate.candidateId,
        revision: candidate.revisionNumber,
        digest: candidateDigest,
        sourceVersionId: candidate.sourceVersionId,
        evidenceIds: [...candidate.evidenceIds],
      },
      startedAt: observedAt,
      canonicalSnapshot: {
        id: 'snapshot-245',
        version: 1,
        digest: 'sha256:snapshot-245',
      },
    } as const;
    const terminal: ComparisonV2TerminalAnalysisReaderPort = {
      async listTerminalAnalysisRevisions() {
        return [
          {
            ...baseAnalysis,
            analysisRevisionId: 'analysis-245-input-a',
            inputDigest: 'sha256:input-a',
            state: 'FAILED_RETRYABLE',
            safeFailureCode: 'RETRYABLE_DEPENDENCY',
            attempt: 5,
            createdAt: '2026-09-09T12:00:00.000Z',
            completedAt: '2026-09-09T12:00:00.000Z',
          },
          {
            ...baseAnalysis,
            analysisRevisionId: 'analysis-245-input-b',
            inputDigest: 'sha256:input-b',
            state: 'COMPLETED',
            attempt: 1,
            createdAt: '2026-09-09T12:01:00.000Z',
            completedAt: '2026-09-09T12:01:00.000Z',
          },
        ] as unknown as AnalysisRevisionV2[];
      },
    };
    const adapter = new ComparisonActivityAdapter(memory.repository, terminal, {
      findById: async () => candidate,
    });
    const page = await adapter.readQueue(
      {
        principalId: 'owner-245',
        activeProjectId: projectId,
        accessRevision: 'access-1',
        policyContextRevision: 'policy-1',
        accessScope: ['owner'],
        sensitivityClearance: 'private',
      },
      {},
    );
    expect(page.items).toHaveLength(0);
  });

  it('retains no aggregate or review side effect for a blocked outcome', async () => {
    const memory = memoryBlockedRepository();
    const stored: ComparisonV2Aggregate[] = [];
    const repo: ComparisonV2RepositoryPort = {
      ...baseRepository(memory.repository),
      async saveCompletedAggregate(aggregate) {
        stored.push(aggregate);
        return aggregate;
      },
    };
    const result = await createComparisonV2Orchestrator({
      candidate: { findById: async () => candidate },
      shortlist: blockedShortlist(),
      semanticAnalysis: {
        async analyze() {
          throw new Error('must not run');
        },
      },
      repository: repo,
      now: () => observedAt,
    }).compare(request);
    expect(result.status).toBe('BLOCKED');
    expect(stored).toHaveLength(0);
    expect(memory.rows.size).toBe(1);
  });
});
