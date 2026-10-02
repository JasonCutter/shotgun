import { describe, expect, it } from 'vitest';

import {
  vpRelationPruningStressCorpus,
  vpRelationPruningStressCorpusComputedDigest,
} from '../helpers/vp-relation-pruning-stress-corpus.js';

describe('VP relation pruning stress corpus', () => {
  it('pins a generated synthetic corpus without promoting candidate labels', () => {
    expect(vpRelationPruningStressCorpus).toMatchObject({
      corpusId: 'shotgun-vp-relation-pruning-stress',
      corpusVersion: '1.0.0',
      labelReviewStatus: 'CANDIDATE',
      dataClassification: 'SYNTHETIC',
    });
    expect(vpRelationPruningStressCorpus.cases).toHaveLength(64);
    expect(new Set(vpRelationPruningStressCorpus.cases.map((sample) => sample.caseId)).size).toBe(
      64,
    );
    expect(
      vpRelationPruningStressCorpus.cases.filter(
        (sample) => sample.allowedChoices.length === 1 && sample.allowedChoices[0] !== 'UNRESOLVED',
      ),
    ).toHaveLength(56);
    expect(vpRelationPruningStressCorpus.corpusDigest).toBe(
      'sha256:1008853d144c33b4592cf9473ff4117ed7337d3321f3fc12b853d9da998a735a',
    );
    expect(vpRelationPruningStressCorpus.corpusDigest).toBe(
      vpRelationPruningStressCorpusComputedDigest,
    );
  });

  it('keeps cross-language paraphrases and non-overlapping NPV conditions in the set', () => {
    expect(
      vpRelationPruningStressCorpus.cases.filter(
        (sample) => sample.dimension === 'generated-cross-language-equivalence',
      ),
    ).toHaveLength(8);
    expect(
      vpRelationPruningStressCorpus.cases.filter(
        (sample) =>
          sample.dimension === 'generated-disjoint-conditions' &&
          sample.allowedChoices[0] === 'RELATED',
      ),
    ).toHaveLength(8);
  });
});
