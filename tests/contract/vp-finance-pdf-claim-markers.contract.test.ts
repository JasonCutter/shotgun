import { describe, expect, it } from 'vitest';

import {
  vpFinancePDFClaimMarkerCorpus,
  vpFinancePDFClaimMarkerCorpusComputedDigest,
  vpFinancePDFClaimMarkerCorpusStoredDigest,
} from '../helpers/vp-finance-pdf-claim-markers.js';

describe('VP finance PDF claim marker corpus', () => {
  it('keeps the source identity and candidate marker set versioned', () => {
    expect(vpFinancePDFClaimMarkerCorpus).toMatchObject({
      contractVersion: '1.0.0',
      corpusId: 'shotgun-vp-finance-pdf-claim-markers',
      corpusVersion: '1.7.0',
      labelSetRevision: 8,
      labelReviewStatus: 'CANDIDATE',
      source: {
        sha256: 'bb413ea6a4864f4a0e21b8979b3f8eef1a9b99b42198eb1a8eef79e156b90d01',
        pageCount: 10,
        dataClassification: 'USER_PROVIDED',
      },
    });
    expect(vpFinancePDFClaimMarkerCorpus.markers).toHaveLength(24);
    expect(vpFinancePDFClaimMarkerCorpus.nonClaims).toHaveLength(6);
    expect(
      vpFinancePDFClaimMarkerCorpus.markers.find((marker) => marker.id === 'irr-example')?.page,
    ).toBe(7);
    expect(vpFinancePDFClaimMarkerCorpusStoredDigest).toBe(
      vpFinancePDFClaimMarkerCorpusComputedDigest,
    );
  });

  it('records distinct numeric, condition, definition, and limitation checks', () => {
    const dimensions = new Set(
      vpFinancePDFClaimMarkerCorpus.markers.map((marker) => marker.dimension),
    );
    expect(dimensions).toEqual(
      new Set([
        'numeric-equation',
        'numeric-ratio',
        'numeric-result',
        'numeric-time-value',
        'numeric-investment-value',
        'numeric-return-rate',
        'numeric-market-sensitivity',
        'accounting-identity',
        'qualification',
        'cash-flow-category',
        'directional-condition',
        'sign-condition',
        'definition',
        'threshold-condition',
        'limitation',
        'finance-decision',
      ]),
    );
    expect(
      new Set(vpFinancePDFClaimMarkerCorpus.nonClaims.map((nonClaim) => nonClaim.dimension)),
    ).toEqual(
      new Set([
        'incomplete-list-fragment',
        'incomplete-formula-fragment',
        'incomplete-sentence-continuation',
      ]),
    );
  });
});
