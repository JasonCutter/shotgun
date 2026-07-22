import { describe, expect, it } from 'vitest';

import {
  assertProviderBoundary,
  createEvaluationRun,
  evaluateClaimPredictions,
  type GoldenCorpus,
  validateCorpus,
  validateEvaluationRun,
  validateRecordedPredictionSet,
  withCorpusDigest,
} from '../../packages/quality-evaluation/src/index.js';
import { loadMetricCalculatorFixture, loadQualityCorpus } from '../helpers/quality-evaluation.js';

describe('Quality Evaluation contract', () => {
  it('validates schema, source hashes, closed qrels, and immutable digests', async () => {
    const corpus = await loadQualityCorpus();
    const predictions = await loadMetricCalculatorFixture();
    expect(() => validateCorpus(corpus, 'baseline')).not.toThrow();
    expect(() => validateRecordedPredictionSet(corpus, predictions)).not.toThrow();

    const tampered = {
      ...corpus,
      cases: corpus.cases.map((entry, index) =>
        index === 0 ? { ...entry, sourceContent: `${entry.sourceContent} tampered` } : entry,
      ),
    };
    expect(() => validateCorpus(tampered, 'baseline')).toThrow('sourceContentHash');
  });

  it('allows only APPROVED labels in Gate runs', async () => {
    const corpus = await loadQualityCorpus();
    expect(() => validateCorpus(corpus, 'gate')).not.toThrow();

    const reviewed = withCorpusDigest({
      ...corpus,
      cases: corpus.cases.map((entry) => ({ ...entry, labelReviewStatus: 'REVIEWED' as const })),
    });
    expect(() => validateCorpus(reviewed, 'baseline')).not.toThrow();
    expect(() => validateCorpus(reviewed, 'gate')).toThrow("label status 'REVIEWED'");

    const candidate = withCorpusDigest({
      ...corpus,
      cases: corpus.cases.map((entry, index) =>
        index === 0 ? { ...entry, labelReviewStatus: 'CANDIDATE' as const } : entry,
      ),
    });
    expect(() => validateCorpus(candidate, 'baseline')).toThrow("label status 'CANDIDATE'");
  });

  it('keeps recorded and live Provider lanes separate', async () => {
    const predictions = await loadMetricCalculatorFixture();
    expect(() => assertProviderBoundary('deterministic-recorded', predictions)).not.toThrow();
    expect(() => assertProviderBoundary('live-provider', predictions)).toThrow('cannot execute');
    expect(() =>
      assertProviderBoundary('deterministic-recorded', {
        runMode: 'live-provider',
        providerName: 'external-provider',
        providerAdapterVersion: '1.0.0',
        providerModel: 'live-model',
        providerModelVersion: '2026-07-22',
        promptVersion: 'v1',
        policyVersion: 'v1',
      }),
    ).toThrow('cannot execute');
  });

  it('validates versioned result artifacts and rejects run digest drift', async () => {
    const corpus = await loadQualityCorpus();
    const predictions = await loadMetricCalculatorFixture();
    validateCorpus(corpus, 'baseline');
    validateRecordedPredictionSet(corpus, predictions);
    const results = evaluateClaimPredictions(corpus, predictions);
    const run = createEvaluationRun(corpus.manifest, results, {
      runId: 'claim-baseline-contract-test',
      runMode: 'deterministic-recorded',
      evaluationKind: 'CLAIM_EXTRACTION',
      applicationCommitSha: 'WORKTREE',
      startedAt: corpus.manifest.updatedAt,
      completedAt: corpus.manifest.updatedAt,
      provider: predictions,
      deterministicSettings: 'recorded-output; ordered-by-stable-id',
      environmentSummary: { runtime: 'vitest' },
    });
    expect(() => validateEvaluationRun(run)).not.toThrow();
    expect(() =>
      validateEvaluationRun({
        ...run,
        environmentSummary: { ...run.environmentSummary, tampered: 'true' },
      }),
    ).toThrow('Run digest mismatch');
  });

  it('rejects an incomplete closed-corpus relevance judgment set', async () => {
    const corpus = await loadQualityCorpus();
    const firstQueryCase = corpus.cases.find((entry) => entry.queries.length > 0)!;
    const incomplete: GoldenCorpus = withCorpusDigest({
      ...corpus,
      cases: corpus.cases.map((entry) =>
        entry.caseId === firstQueryCase.caseId
          ? {
              ...entry,
              queries: entry.queries.map((query, index) =>
                index === 0 ? { ...query, judgments: query.judgments.slice(1) } : query,
              ),
            }
          : entry,
      ),
    });
    expect(() => validateCorpus(incomplete, 'baseline')).toThrow('complete closed set');
  });
});
