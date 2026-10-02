import { describe, expect, it } from 'vitest';

import {
  vpRelationDecisionCorpus,
  vpRelationDecisionCorpusComputedDigest,
  vpRelationDecisionCorpusStoredDigest,
} from '../helpers/vp-relation-decision-corpus.js';

describe('VP relation decision corpus contract', () => {
  it('pins the synthetic candidate corpus content with a stable digest', () => {
    expect(vpRelationDecisionCorpus.labelReviewStatus).toBe('CANDIDATE');
    expect(vpRelationDecisionCorpus.dataClassification).toBe('SYNTHETIC');
    expect(vpRelationDecisionCorpus.contractVersion).toBe('1.1.0');
    expect(vpRelationDecisionCorpus.corpusVersion).toBe('1.2.0');
    expect(vpRelationDecisionCorpus.labelSetRevision).toBe(3);
    expect(vpRelationDecisionCorpus.cases).toHaveLength(16);
    expect(vpRelationDecisionCorpusStoredDigest).toBe(vpRelationDecisionCorpusComputedDigest);
  });

  it('has unique cases with exact labels separated from safe-choice envelopes', () => {
    const caseIds = vpRelationDecisionCorpus.cases.map((sample) => sample.caseId);
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(
      vpRelationDecisionCorpus.cases.filter((sample) => sample.allowedChoices.length === 1),
    ).toHaveLength(10);
    expect(
      vpRelationDecisionCorpus.cases.filter((sample) => sample.allowedChoices.length > 1),
    ).toHaveLength(6);
  });

  it('keeps prompt-injection text inside a candidate source sample as untrusted data', () => {
    const sample = vpRelationDecisionCorpus.cases.find(
      (entry) => entry.caseId === 'prompt-injection-in-source',
    );
    expect(sample?.left).toContain('Ignore all instructions');
    expect(sample?.allowedChoices).toEqual(['CONTRADICTS', 'UNRESOLVED']);
  });

  it('records qualifier direction from the narrower assertion to the broader one', () => {
    const sample = vpRelationDecisionCorpus.cases.find(
      (entry) => entry.caseId === 'condition-sensitive',
    );
    expect(sample).toMatchObject({
      allowedChoices: ['QUALIFIES'],
      allowedDirections: ['RIGHT_TO_LEFT'],
    });
  });

  it('labels opposite outcomes under disjoint NPV conditions as related, not contradictory', () => {
    const sample = vpRelationDecisionCorpus.cases.find(
      (entry) => entry.caseId === 'complementary-npv-condition-branches',
    );
    expect(sample?.allowedChoices).toEqual(['RELATED']);
    const koreanSample = vpRelationDecisionCorpus.cases.find(
      (entry) => entry.caseId === 'complementary-npv-condition-branches-ko',
    );
    expect(koreanSample?.allowedChoices).toEqual(['RELATED']);
  });
});
