import { describe, expect, it, vi } from 'vitest';

import {
  VPRelationJobWorker,
  type VPRelationJob,
  type VPRelationJobStorePort,
} from '../../modules/vp-knowledge-ledger/src/index.js';
import {
  VPRelationDecisionRouter,
  type VPDecisionProviderPort,
} from '../../modules/vp-decision/src/index.js';

const job: VPRelationJob = {
  jobId: 'job-1',
  leaseToken: 'lease-1',
  projectId: 'project-1',
  left: {
    assertionId: 'a',
    projectId: 'project-1',
    sourceId: 'source-a',
    sourceVersionId: 'version-a',
    evidenceId: 'evidence-a',
    claimText: 'The limit is 100.',
    accessScope: ['owner'],
    sensitivity: 'private',
  },
  right: {
    assertionId: 'b',
    projectId: 'project-1',
    sourceId: 'source-b',
    sourceVersionId: 'version-b',
    evidenceId: 'evidence-b',
    claimText: 'The limit is 200.',
    accessScope: ['owner'],
    sensitivity: 'private',
  },
  attemptCount: 1,
};

const jobs = (): VPRelationJobStorePort => ({
  enqueueCurrentPairs: vi.fn(async () => 1),
  claimNext: vi.fn(async () => job),
  completeDecision: vi.fn(async () => true),
  readDecisionOutcome: vi.fn(async () => 'NOT_ACTIVE' as const),
  completeUnresolved: vi.fn(async () => true),
  retry: vi.fn(async () => 'RETRYABLE' as const),
});

const policy = {
  revision: 'vp-test-policy',
  minimumChoiceProbability: 0.75,
  maximumDeepAnalysisScore: 0.2,
  maximumInputTokens: 1000,
  maximumOutputTokens: 200,
};

describe('VP relation job worker', () => {
  it('records a provider decision with provenance and no human review', async () => {
    const store = jobs();
    const provider: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'CONTRADICTS' as const,
        confidence: 0.98,
        probabilities: {
          EQUIVALENT: 0.01,
          SUPPORTS: 0,
          QUALIFIES: 0,
          CONTRADICTS: 0.98,
          RELATED: 0.01,
          UNRESOLVED: 0,
        },
        deepAnalysisScore: 0.05,
        model: 'jev-test',
        inputTokens: 30,
        outputTokens: 5,
      })),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(provider, undefined, policy),
      async () => true,
      policy.revision,
    );
    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(store.completeDecision).toHaveBeenCalledWith({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
      provider: 'JEV',
      choice: 'CONTRADICTS',
      direction: 'UNDIRECTED',
      confidence: 0.98,
      model: 'jev-test',
      inputTokens: 30,
      outputTokens: 5,
    });
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('keeps private evidence local when external egress is denied', async () => {
    const store = jobs();
    const provider: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => {
        throw new Error('provider must not receive private evidence');
      }),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(provider, provider, policy),
      async () => false,
      policy.revision,
    );
    expect(await worker.dispatchOnce()).toBe('RETRYING');
    expect(provider.decideRelation).not.toHaveBeenCalled();
    expect(store.completeDecision).not.toHaveBeenCalled();
    expect(store.retry).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_AUTHORIZED_PROVIDER' }),
    );
  });

  it('uses only the configured DeepSeek path while Jev is unavailable', async () => {
    const store = jobs();
    const deepseek: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'CONTRADICTS' as const,
        confidence: 0.96,
        probabilities: {
          EQUIVALENT: 0.01,
          SUPPORTS: 0,
          QUALIFIES: 0.01,
          CONTRADICTS: 0.96,
          RELATED: 0.01,
          UNRESOLVED: 0.01,
        },
        deepAnalysisScore: 0,
        model: 'deepseek/pinned-model',
        inputTokens: 200,
        outputTokens: 40,
      })),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(undefined, deepseek, {
        ...policy,
        minimumChoiceProbability: 0.9,
      }),
      async () => true,
      policy.revision,
    );
    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(deepseek.decideRelation).toHaveBeenCalledOnce();
    expect(store.completeDecision).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'GENERAL_AI', model: 'deepseek/pinned-model' }),
    );
  });

  it('stores a directed qualification and retains which assertion is narrower', async () => {
    const store = jobs();
    const deepseek: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'QUALIFIES' as const,
        direction: 'RIGHT_TO_LEFT' as const,
        confidence: 0.99,
        probabilities: {
          EQUIVALENT: 0,
          SUPPORTS: 0,
          QUALIFIES: 0.99,
          CONTRADICTS: 0,
          RELATED: 0.01,
          UNRESOLVED: 0,
        },
        deepAnalysisScore: 0,
        model: 'deepseek/pinned-model',
        inputTokens: 180,
        outputTokens: 25,
      })),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(undefined, deepseek, policy),
      async () => true,
      policy.revision,
    );
    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(store.completeDecision).toHaveBeenCalledWith(
      expect.objectContaining({ choice: 'QUALIFIES', direction: 'RIGHT_TO_LEFT' }),
    );
    expect(store.completeUnresolved).not.toHaveBeenCalled();
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('resolves a lost commit acknowledgement by reading the durable decision', async () => {
    const store = jobs();
    vi.mocked(store.completeDecision).mockRejectedValue(
      Object.assign(new Error('commit acknowledgement lost'), { code: 'OUTCOME_UNKNOWN' }),
    );
    vi.mocked(store.readDecisionOutcome).mockResolvedValue('COMPLETED');
    const provider: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'CONTRADICTS' as const,
        confidence: 0.98,
        probabilities: {
          EQUIVALENT: 0.01,
          SUPPORTS: 0,
          QUALIFIES: 0,
          CONTRADICTS: 0.98,
          RELATED: 0.01,
          UNRESOLVED: 0,
        },
        deepAnalysisScore: 0,
        model: 'deepseek/pinned-model',
        inputTokens: 24,
        outputTokens: 8,
      })),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(undefined, provider, policy),
      async () => true,
      policy.revision,
    );

    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(provider.decideRelation).toHaveBeenCalledOnce();
    expect(store.readDecisionOutcome).toHaveBeenCalledWith({
      jobId: job.jobId,
      leaseToken: job.leaseToken,
    });
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('reuses the received decision while the same lease is still active', async () => {
    const store = jobs();
    vi.mocked(store.completeDecision)
      .mockRejectedValueOnce(
        Object.assign(new Error('commit acknowledgement lost'), { code: 'OUTCOME_UNKNOWN' }),
      )
      .mockResolvedValueOnce(true);
    vi.mocked(store.readDecisionOutcome)
      .mockResolvedValueOnce('LEASE_ACTIVE')
      .mockResolvedValueOnce('COMPLETED');
    const provider: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'CONTRADICTS' as const,
        confidence: 0.98,
        probabilities: {
          EQUIVALENT: 0.01,
          SUPPORTS: 0,
          QUALIFIES: 0,
          CONTRADICTS: 0.98,
          RELATED: 0.01,
          UNRESOLVED: 0,
        },
        deepAnalysisScore: 0,
        model: 'deepseek/pinned-model',
        inputTokens: 24,
        outputTokens: 8,
      })),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(undefined, provider, policy),
      async () => true,
      policy.revision,
    );

    expect(await worker.dispatchOnce()).toBe('DECIDED');
    expect(provider.decideRelation).toHaveBeenCalledOnce();
    expect(store.completeDecision).toHaveBeenCalledTimes(2);
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('leaves an unconfirmed commit outcome unresolved without retrying the provider', async () => {
    const store = jobs();
    vi.mocked(store.completeDecision).mockRejectedValue(
      Object.assign(new Error('commit acknowledgement lost'), { code: 'OUTCOME_UNKNOWN' }),
    );
    vi.mocked(store.readDecisionOutcome).mockResolvedValue('NOT_ACTIVE');
    const provider: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'CONTRADICTS' as const,
        confidence: 0.98,
        probabilities: {
          EQUIVALENT: 0.01,
          SUPPORTS: 0,
          QUALIFIES: 0,
          CONTRADICTS: 0.98,
          RELATED: 0.01,
          UNRESOLVED: 0,
        },
        deepAnalysisScore: 0,
        model: 'deepseek/pinned-model',
        inputTokens: 24,
        outputTokens: 8,
      })),
    };
    const worker = new VPRelationJobWorker(
      store,
      new VPRelationDecisionRouter(undefined, provider, policy),
      async () => true,
      policy.revision,
    );

    expect(await worker.dispatchOnce()).toBe('OUTCOME_UNKNOWN');
    expect(provider.decideRelation).toHaveBeenCalledOnce();
    expect(store.retry).not.toHaveBeenCalled();
  });

  it('reports a durable terminal failure when the retry cap is reached', async () => {
    const store = jobs();
    vi.mocked(store.retry).mockResolvedValue('FAILED');
    const router = {
      resolve: vi.fn(async () => ({
        status: 'UNRESOLVED' as const,
        reason: 'PROVIDER_FAILED' as const,
      })),
    };
    const worker = new VPRelationJobWorker(store, router, async () => true, policy.revision);

    expect(await worker.dispatchOnce()).toBe('FAILED');
    expect(store.retry).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROVIDER_FAILED' }));
  });
});
