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
  completeUnresolved: vi.fn(async () => true),
  retry: vi.fn(async () => undefined),
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

  it('does not store an undirected qualification as settled knowledge', async () => {
    const store = jobs();
    const deepseek: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        choice: 'QUALIFIES' as const,
        confidence: 0.99,
        probabilities: {
          EQUIVALENT: 0,
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
    expect(await worker.dispatchOnce()).toBe('UNRESOLVED');
    expect(store.completeDecision).not.toHaveBeenCalled();
    expect(store.completeUnresolved).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'QUALIFIER_NOT_MODELED' }),
    );
    expect(store.retry).not.toHaveBeenCalled();
  });
});
