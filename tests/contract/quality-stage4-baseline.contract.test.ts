import { describe, expect, it } from 'vitest';

import {
  validateCorpus,
  validateRecordedPredictionSet,
} from '../../packages/quality-evaluation/src/index.js';
import { loadQualityCorpus } from '../helpers/quality-evaluation.js';
import { executeStage4ClaimBaseline } from '../helpers/quality-stage4.js';

describe('Quality Claim Baseline Stage 4 execution', () => {
  it('runs every Golden case through generation and Validation before metric conversion', async () => {
    const corpus = await loadQualityCorpus();
    validateCorpus(corpus, 'baseline');

    const first = await executeStage4ClaimBaseline(corpus);
    const second = await executeStage4ClaimBaseline(corpus);

    expect(first.trace).toMatchObject({
      commandCount: corpus.cases.length,
      providerCallCount: corpus.cases.length,
      validationCount: first.trace.candidateCount,
      rejectedCandidateCount: 0,
    });
    expect(first.trace.readyCandidateCount).toBe(first.trace.candidateCount);
    expect(first.predictions).toMatchObject({
      recordingSource: 'stage4-runtime',
      providerName: 'fake',
      providerModel: 'shotgun-direct-copy',
      promptVersion: 'direct-claim-v1',
      policyVersion: 'direct-only-v1',
    });
    expect(first.predictions.outputDigest).toBe(second.predictions.outputDigest);
    expect(first.predictions.cases).toEqual(second.predictions.cases);
    expect(() => validateRecordedPredictionSet(corpus, first.predictions)).not.toThrow();
  });
});
