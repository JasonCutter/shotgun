import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';
import { vpFinancePDFClaimMarkerCorpus } from './vp-finance-pdf-claim-markers.js';

export type VPFinanceRelationCandidateCorpus = {
  readonly contractVersion: '1.2.0';
  readonly corpusId: 'shotgun-vp-finance-relation-candidate';
  readonly corpusVersion: string;
  readonly labelSetRevision: number;
  readonly corpusDigest: string;
  readonly labelReviewStatus: 'CANDIDATE' | 'REVIEWED' | 'APPROVED' | 'RETIRED';
  readonly dataClassification: 'MIXED_USER_PROVIDED_AND_TEST_AUTHORED';
  readonly licenseSummary: string;
  readonly source: {
    readonly sha256: string;
    readonly pageCount: number;
    readonly companionSourceId: string;
    readonly companionFile: string;
  };
  readonly cases: readonly {
    readonly caseId: string;
    readonly left: string;
    readonly right: string;
    readonly allowedChoices: readonly (
      'EQUIVALENT' | 'SUPPORTS' | 'QUALIFIES' | 'CONTRADICTS' | 'RELATED' | 'UNRESOLVED'
    )[];
    readonly allowedDirections?: readonly ('LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT')[];
    readonly dimension: string;
    readonly rationale: string;
    readonly leftProvenance: { readonly page: number; readonly markerId: string };
    readonly rightProvenance:
      | { readonly page: number; readonly markerId: string }
      | { readonly sourceId: string; readonly claimId: string };
  }[];
};

const schema = JSON.parse(
  readFileSync(
    new URL('../fixtures/vp/finance-relation-candidate.v1.2.schema.json', import.meta.url),
    'utf8',
  ),
) as object;
const corpus = JSON.parse(
  readFileSync(
    new URL('../fixtures/vp/finance-relation-candidate.v1.2.json', import.meta.url),
    'utf8',
  ),
) as VPFinanceRelationCandidateCorpus;
const validate = new Ajv({
  allErrors: true,
  strict: false,
}).compile<VPFinanceRelationCandidateCorpus>(schema);
if (!validate(corpus)) {
  throw new Error(`Invalid VP finance relation corpus: ${JSON.stringify(validate.errors)}`);
}

const { corpusDigest, ...digestPayload } = corpus;
const markerById = new Map(
  vpFinancePDFClaimMarkerCorpus.markers.map((marker) => [marker.id, marker]),
);
if (corpus.source.sha256 !== vpFinancePDFClaimMarkerCorpus.source.sha256) {
  throw new Error('VP finance relation corpus points at a different PDF than its marker corpus.');
}
const companionMarkdown = readFileSync(
  new URL(`../fixtures/vp/${corpus.source.companionFile}`, import.meta.url),
  'utf8',
);
const companionSections = companionMarkdown.split(/^## ([a-z0-9-]+)\r?$/gmu);
const companionClaims = new Map<string, string>();
for (let index = 1; index < companionSections.length; index += 2) {
  companionClaims.set(companionSections[index]!, companionSections[index + 1]!.trim());
}
const normalizeText = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, '');
for (const item of corpus.cases) {
  for (const { provenance, text } of [
    { provenance: item.leftProvenance, text: item.left },
    { provenance: item.rightProvenance, text: item.right },
  ]) {
    if ('markerId' in provenance) {
      const marker = markerById.get(provenance.markerId);
      if (!marker || marker.page !== provenance.page) {
        throw new Error(
          `Unknown PDF marker provenance in VP finance relation case '${item.caseId}'.`,
        );
      }
      if (!normalizeText(text).includes(normalizeText(marker.text))) {
        throw new Error(
          `PDF marker text is not represented in VP finance relation case '${item.caseId}'.`,
        );
      }
    } else if (
      provenance.sourceId !== corpus.source.companionSourceId ||
      companionClaims.get(provenance.claimId) !== text
    ) {
      throw new Error(`Unknown companion provenance in VP finance relation case '${item.caseId}'.`);
    }
  }
}

export const vpFinanceRelationCandidateCorpus = corpus;
export const vpFinanceRelationCandidateComputedDigest = sha256Text(stableJson(digestPayload));
export const vpFinanceRelationCandidateStoredDigest = corpusDigest;
