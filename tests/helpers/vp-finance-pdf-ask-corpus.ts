import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';

export type VPFinancePDFAskCorpus = {
  readonly contractVersion: '1.0.0';
  readonly corpusId: 'shotgun-vp-finance-pdf-ask';
  readonly corpusVersion: string;
  readonly labelSetRevision: number;
  readonly corpusDigest: string;
  readonly labelReviewStatus: 'CANDIDATE';
  readonly source: {
    readonly sha256: string;
    readonly pageCount: 10;
    readonly dataClassification: 'USER_PROVIDED';
  };
  readonly questions: readonly {
    readonly id: string;
    readonly page: number;
    readonly question: string;
    readonly expectedAnswerTerms: readonly string[];
    readonly expectedEvidenceTerms: readonly string[];
  }[];
};

const schema = JSON.parse(
  readFileSync(new URL('../fixtures/vp/finance-pdf-ask-corpus.v1.schema.json', import.meta.url), {
    encoding: 'utf8',
  }),
) as object;
const corpus = JSON.parse(
  readFileSync(new URL('../fixtures/vp/finance-pdf-ask-corpus.v1.json', import.meta.url), {
    encoding: 'utf8',
  }),
) as VPFinancePDFAskCorpus;

const validate = new Ajv({ allErrors: true, strict: false }).compile<VPFinancePDFAskCorpus>(schema);
if (!validate(corpus)) {
  throw new Error(`Invalid VP finance PDF Ask corpus: ${JSON.stringify(validate.errors)}`);
}

const { corpusDigest, ...digestPayload } = corpus;
export const vpFinancePDFAskCorpus = corpus;
export const vpFinancePDFAskCorpusComputedDigest = sha256Text(stableJson(digestPayload));
export const vpFinancePDFAskCorpusStoredDigest = corpusDigest;
