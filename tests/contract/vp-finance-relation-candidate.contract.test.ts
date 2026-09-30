import { describe, expect, it } from 'vitest';

import { vpFinancePDFClaimMarkerCorpus } from '../helpers/vp-finance-pdf-claim-markers.js';
import {
  vpFinanceRelationCandidateCorpus,
  vpFinanceRelationCandidateComputedDigest,
  vpFinanceRelationCandidateStoredDigest,
} from '../helpers/vp-finance-relation-candidate.js';

describe('VP finance relation candidate corpus', () => {
  it('pins mixed-source provenance and remains an unapproved candidate set', () => {
    expect(vpFinanceRelationCandidateCorpus).toMatchObject({
      contractVersion: '1.2.0',
      corpusId: 'shotgun-vp-finance-relation-candidate',
      corpusVersion: '1.2.0',
      labelSetRevision: 3,
      labelReviewStatus: 'CANDIDATE',
      dataClassification: 'MIXED_USER_PROVIDED_AND_TEST_AUTHORED',
      source: {
        sha256: vpFinancePDFClaimMarkerCorpus.source.sha256,
        pageCount: vpFinancePDFClaimMarkerCorpus.source.pageCount,
        companionSourceId: 'finance-companion-v1',
      },
    });
    expect(vpFinanceRelationCandidateStoredDigest).toBe(vpFinanceRelationCandidateComputedDigest);
  });

  it('covers exact relations separately from cautious relation envelopes', () => {
    const items = vpFinanceRelationCandidateCorpus.cases;
    expect(items).toHaveLength(14);
    expect(new Set(items.map((item) => item.caseId)).size).toBe(items.length);
    expect(items.filter((item) => item.allowedChoices.length === 1)).toHaveLength(13);
    expect(items.filter((item) => item.allowedChoices.length > 1)).toHaveLength(1);
    expect(items.find((item) => item.caseId === 'finance-profit-cash-coexistence')).toMatchObject({
      allowedChoices: ['SUPPORTS'],
      allowedDirections: ['RIGHT_TO_LEFT'],
    });
    expect(
      items.find((item) => item.caseId === 'finance-complementary-npv-branches')?.allowedChoices,
    ).toEqual(['RELATED']);
    expect(
      items.find((item) => item.caseId === 'finance-beta-complementary-branches')?.allowedChoices,
    ).toEqual(['RELATED']);
  });

  it('pins explicit same-example conflicts as contradictions while keeping unrelated measures cautious', () => {
    expect(
      vpFinanceRelationCandidateCorpus.cases.find(
        (item) => item.caseId === 'finance-npv-numeric-conflict',
      )?.allowedChoices,
    ).toEqual(['CONTRADICTS']);
    expect(
      vpFinanceRelationCandidateCorpus.cases.find(
        (item) => item.caseId === 'finance-current-ratio-same-scope-conflict',
      )?.allowedChoices,
    ).toEqual(['CONTRADICTS']);
    expect(
      vpFinanceRelationCandidateCorpus.cases.find(
        (item) => item.caseId === 'finance-unrelated-measures',
      )?.allowedChoices,
    ).toEqual(['UNRESOLVED', 'RELATED']);
  });
});
