import { describe, expect, it } from 'vitest';

import {
  vpFinancePDFAskCorpus,
  vpFinancePDFAskCorpusComputedDigest,
  vpFinancePDFAskCorpusStoredDigest,
} from '../helpers/vp-finance-pdf-ask-corpus.js';
import { vpFinancePDFClaimMarkerCorpus } from '../helpers/vp-finance-pdf-claim-markers.js';

describe('VP finance PDF Ask corpus', () => {
  it('keeps the candidate questions tied to the reviewed source and fixed page markers', () => {
    expect(vpFinancePDFAskCorpusComputedDigest).toBe(vpFinancePDFAskCorpusStoredDigest);
    expect(vpFinancePDFAskCorpus.source.sha256).toBe(vpFinancePDFClaimMarkerCorpus.source.sha256);
    expect(vpFinancePDFAskCorpus.labelReviewStatus).toBe('CANDIDATE');
    expect(vpFinancePDFAskCorpus.questions).toHaveLength(4);
    expect(vpFinancePDFAskCorpus.questions.map(({ page }) => page)).toEqual([2, 3, 5, 9]);
    expect(
      vpFinancePDFAskCorpus.questions.every((scenario) =>
        vpFinancePDFClaimMarkerCorpus.markers.some((marker) => marker.page === scenario.page),
      ),
    ).toBe(true);
  });
});
