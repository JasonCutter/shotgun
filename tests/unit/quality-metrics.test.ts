import { describe, expect, it } from 'vitest';

import {
  evaluateClaimPredictions,
  evaluateSearchObservations,
  ratio,
  validateCorpus,
  validateRecordedPredictionSet,
} from '../../packages/quality-evaluation/src/index.js';
import { loadQualityCorpus, loadRecordedClaimPredictions } from '../helpers/quality-evaluation.js';

describe('Quality metric calculators', () => {
  it('matches the hand-calculated Claim fixture', async () => {
    const corpus = await loadQualityCorpus();
    const predictions = await loadRecordedClaimPredictions();
    validateCorpus(corpus, 'baseline');
    validateRecordedPredictionSet(corpus, predictions);
    const result = evaluateClaimPredictions(corpus, predictions);

    expect(result.aggregateResults.counts).toMatchObject({
      cases: 9,
      expected: 8,
      predicted: 9,
      tp: 6,
      fp: 3,
      fn: 2,
      unsupported: 2,
      duplicates: 1,
      exactCases: 5,
      noClaimCases: 2,
      correctNoClaimCases: 1,
    });
    expect(result.aggregateResults.metrics).toMatchObject({
      precision: ratio(6, 9),
      recall: ratio(6, 8),
      exactClaimMatch: ratio(5, 9),
      unsupportedClaimRate: ratio(2, 9),
      duplicateClaimRate: ratio(1, 9),
      evidenceExactMatch: ratio(6, 7),
      evidenceCoverage: ratio(6, 8),
      noClaimAccuracy: ratio(1, 2),
    });
    expect(result.aggregateResults.metrics.f1!.value).toBe(0.705882352941);
  });

  it('matches hand-calculated ranking metrics and excludes no-result queries from MRR', async () => {
    const corpus = await loadQualityCorpus();
    const queries = corpus.cases.flatMap((entry) => entry.queries);
    const targetByQuery = new Map(
      queries.map((query) => [
        query.queryId,
        query.judgments.find((judgment) => judgment.relevance >= 1)?.goldenClaimId,
      ]),
    );
    const observations = queries.map((query, index) => ({
      queryId: query.queryId,
      results: query.expectedNoResult
        ? []
        : [
            { goldenClaimId: 'c-system-status', citationCorrect: true },
            { goldenClaimId: targetByQuery.get(query.queryId)!, citationCorrect: true },
          ].slice(index === 0 ? 1 : 0),
    }));
    const result = evaluateSearchObservations(corpus, observations, [
      { trialId: 'stale', readinessStatus: 'STALE', resultCount: 0 },
      { trialId: 'degraded', readinessStatus: 'DEGRADED', resultCount: 0 },
    ]);

    expect(result.aggregateResults.metrics.noResultAccuracy).toEqual(ratio(1, 1));
    expect(result.aggregateResults.metrics.staleResultRejectionRate).toEqual(ratio(2, 2));
    expect(result.aggregateResults.metrics.citationCorrectness!.value).toBe(1);
    expect(result.caseResults).toHaveLength(6);
  });
});
