import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';

export type VPRelationChoice =
  'EQUIVALENT' | 'SUPPORTS' | 'QUALIFIES' | 'CONTRADICTS' | 'RELATED' | 'UNRESOLVED';

export type VPRelationDecisionCorpus = {
  readonly contractVersion: '1.1.0';
  readonly corpusId: 'shotgun-vp-relation-synthetic';
  readonly corpusVersion: string;
  readonly labelSetRevision: number;
  readonly corpusDigest: string;
  readonly labelReviewStatus: 'CANDIDATE' | 'REVIEWED' | 'APPROVED' | 'RETIRED';
  readonly dataClassification: 'SYNTHETIC';
  readonly licenseSummary: string;
  readonly cases: readonly {
    readonly caseId: string;
    readonly left: string;
    readonly right: string;
    readonly allowedChoices: readonly VPRelationChoice[];
    readonly allowedDirections?: readonly ('LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT')[];
    readonly dimension: string;
    readonly rationale: string;
  }[];
};

const schema = JSON.parse(
  readFileSync(
    new URL('../fixtures/vp/relation-decision-corpus.v1.2.schema.json', import.meta.url),
    {
      encoding: 'utf8',
    },
  ),
) as object;
const corpus = JSON.parse(
  readFileSync(new URL('../fixtures/vp/relation-decision-corpus.v1.2.json', import.meta.url), {
    encoding: 'utf8',
  }),
) as VPRelationDecisionCorpus;

const validate = new Ajv({ allErrors: true, strict: false }).compile<VPRelationDecisionCorpus>(
  schema,
);
if (!validate(corpus)) {
  throw new Error(`Invalid VP relation corpus: ${JSON.stringify(validate.errors)}`);
}

const { corpusDigest, ...digestPayload } = corpus;
export const vpRelationDecisionCorpus = corpus;
export const vpRelationDecisionCorpusComputedDigest = sha256Text(stableJson(digestPayload));
export const vpRelationDecisionCorpusStoredDigest = corpusDigest;
