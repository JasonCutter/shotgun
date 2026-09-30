import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';

export type VPFinancePDFClaimMarkerCorpus = {
  readonly contractVersion: '1.0.0';
  readonly corpusId: 'shotgun-vp-finance-pdf-claim-markers';
  readonly corpusVersion: string;
  readonly labelSetRevision: number;
  readonly corpusDigest: string;
  readonly labelReviewStatus: 'CANDIDATE';
  readonly source: {
    readonly sha256: string;
    readonly pageCount: 10;
    readonly dataClassification: 'USER_PROVIDED';
    readonly note: string;
  };
  readonly markers: readonly {
    readonly id: string;
    readonly page: number;
    readonly text: string;
    readonly requiredText?: string;
    readonly dimension: string;
  }[];
};

const schema = JSON.parse(
  readFileSync(
    new URL('../fixtures/vp/finance-pdf-claim-markers.v1.schema.json', import.meta.url),
    {
      encoding: 'utf8',
    },
  ),
) as object;
const corpus = JSON.parse(
  readFileSync(new URL('../fixtures/vp/finance-pdf-claim-markers.v1.json', import.meta.url), {
    encoding: 'utf8',
  }),
) as VPFinancePDFClaimMarkerCorpus;

const validate = new Ajv({ allErrors: true, strict: false }).compile<VPFinancePDFClaimMarkerCorpus>(
  schema,
);
if (!validate(corpus)) {
  throw new Error(`Invalid VP finance PDF marker corpus: ${JSON.stringify(validate.errors)}`);
}

const { corpusDigest, ...digestPayload } = corpus;
export const vpFinancePDFClaimMarkerCorpus = corpus;
export const vpFinancePDFClaimMarkerCorpusComputedDigest = sha256Text(stableJson(digestPayload));
export const vpFinancePDFClaimMarkerCorpusStoredDigest = corpusDigest;
