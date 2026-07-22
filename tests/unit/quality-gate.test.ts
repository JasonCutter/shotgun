import { describe, expect, it } from 'vitest';

import {
  evaluateQualityGate,
  type QualityEvaluationRun,
  validateCorpus,
  validateEvaluationRun,
  validateQualityGatePolicy,
} from '../../packages/quality-evaluation/src/index.js';
import {
  loadQualityCorpus,
  loadQualityGatePolicy,
  loadQualityRunArtifact,
} from '../helpers/quality-evaluation.js';

const summary = (run: QualityEvaluationRun) => ({
  evaluationKind: run.evaluationKind,
  corpusId: run.corpusId,
  corpusVersion: run.corpusVersion,
  corpusDigest: run.corpusDigest,
  labelSetRevision: run.labelSetRevision,
  metricImplementationVersion: run.metricImplementationVersion,
  runDigest: run.runDigest,
  aggregateResults: run.aggregateResults,
});

const regressMetric = (
  run: QualityEvaluationRun,
  metric: string,
  value: number,
): QualityEvaluationRun => ({
  ...run,
  aggregateResults: {
    ...run.aggregateResults,
    metrics: {
      ...run.aggregateResults.metrics,
      [metric]: { ...run.aggregateResults.metrics[metric]!, value },
    },
  },
});

describe('Quality Gate v1', () => {
  it('passes the approved Claim and Search baseline artifacts', async () => {
    const corpus = await loadQualityCorpus();
    const policy = await loadQualityGatePolicy();
    const claim = await loadQualityRunArtifact('claim-extraction-baseline.v1.json');
    const search = await loadQualityRunArtifact('search-baseline.v1.json');
    validateCorpus(corpus, 'gate');
    validateQualityGatePolicy(policy);
    validateEvaluationRun(claim);
    validateEvaluationRun(search);

    expect(evaluateQualityGate(policy, summary(claim), summary(search)).passed).toBe(true);
  });

  it('fails a Claim metric regression', async () => {
    const policy = await loadQualityGatePolicy();
    const claim = regressMetric(
      await loadQualityRunArtifact('claim-extraction-baseline.v1.json'),
      'precision',
      0.545454,
    );
    const search = await loadQualityRunArtifact('search-baseline.v1.json');
    const result = evaluateQualityGate(policy, summary(claim), summary(search));
    expect(result.passed).toBe(false);
    expect(result.comparisons).toContainEqual(
      expect.objectContaining({ metric: 'precision', passed: false }),
    );
  });

  it.each(['precisionAt1', 'citationCorrectness', 'staleResultRejectionRate'])(
    'fails a Search %s regression',
    async (metric) => {
      const policy = await loadQualityGatePolicy();
      const claim = await loadQualityRunArtifact('claim-extraction-baseline.v1.json');
      const search = regressMetric(
        await loadQualityRunArtifact('search-baseline.v1.json'),
        metric,
        0.799999,
      );
      const result = evaluateQualityGate(policy, summary(claim), summary(search));
      expect(result.passed).toBe(false);
      expect(result.comparisons).toContainEqual(expect.objectContaining({ metric, passed: false }));
    },
  );
});
