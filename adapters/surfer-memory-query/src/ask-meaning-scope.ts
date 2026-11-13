import {
  SURFER_SCOPE_FACETS,
  assertSurferAskScopeFrames,
  type SurferAskScopeFrames,
} from '../../../packages/contracts/src/surfer-ask-scope.js';
import { unicodeLength, unicodeSlice } from '../../../packages/contracts/src/document-evidence.js';
type Candidate = { sourceSpan: { start: number; end: number; quote: string } };
export function askMeaningScopeSchema() {
  const obj = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  return {
    type: 'array',
    maxItems: 4,
    items: obj({
      candidateIndex: { type: 'integer', minimum: 0, maximum: 7 },
      relation: { enum: ['EQUIVALENT', 'DISTINCT', 'RELATED', 'UNRESOLVED'] },
      documentRole: { enum: ['NORMATIVE', 'OBSERVATION', 'DEFINITION', 'EXAMPLE', 'UNRESOLVED'] },
      facets: obj(
        Object.fromEntries(
          SURFER_SCOPE_FACETS.map((k) => [
            k,
            { anyOf: [{ type: 'string', minLength: 1, maxLength: 128 }, { type: 'null' }] },
          ]),
        ),
      ),
    }),
  };
}
/** A quoted facet is a model hypothesis about scope, never a verified interpretation. */
export function buildAskMeaningScopes(
  wire: unknown,
  candidates: readonly Candidate[],
  mapping: ReadonlyMap<number, number>,
): SurferAskScopeFrames {
  const result: SurferAskScopeFrames = {
    revision: 'surfer.ask-semantic-scopes.v1',
    assessment: 'INVALID_OUTPUT',
    frames: [],
    rejected: [],
  };
  const keys = (v: object, k: string) => Object.keys(v).sort().join(',') === k;
  if (Array.isArray(wire) && wire.length <= 4) {
    result.assessment = 'NO_FRAME';
    for (const [index, raw] of wire.entries()) {
      const f = raw as {
        candidateIndex: number;
        relation: string;
        documentRole: string;
        facets: Record<string, unknown>;
      } | null;
      let reason = 'INVALID_FRAME';
      if (
        f &&
        keys(f, 'candidateIndex,documentRole,facets,relation') &&
        Number.isSafeInteger(f.candidateIndex) &&
        f.candidateIndex >= 0 &&
        f.candidateIndex < 8 &&
        ['EQUIVALENT', 'DISTINCT', 'RELATED', 'UNRESOLVED'].includes(f.relation) &&
        ['NORMATIVE', 'OBSERVATION', 'DEFINITION', 'EXAMPLE', 'UNRESOLVED'].includes(
          f.documentRole,
        ) &&
        f.facets &&
        keys(f.facets, 'condition,exception,subject,time') &&
        SURFER_SCOPE_FACETS.every(
          (k) =>
            f.facets[k] === null ||
            (typeof f.facets[k] === 'string' &&
              (f.facets[k] as string).length > 0 &&
              (f.facets[k] as string).length <= 128),
        )
      ) {
        const candidateIndex = mapping.get(f.candidateIndex),
          parent =
            candidateIndex === undefined ? undefined : candidates[candidateIndex]?.sourceSpan;
        if (!parent) reason = 'REJECTED_OR_MISSING_CANDIDATE';
        else if (result.frames.some((x) => x.candidateIndex === candidateIndex))
          reason = 'DUPLICATE_CANDIDATE_SCOPE';
        else {
          const facets = {} as SurferAskScopeFrames['frames'][number]['facets'];
          let valid = true;
          for (const k of SURFER_SCOPE_FACETS) {
            const q = f.facets[k];
            if (q === null) {
              facets[k] = null;
              continue;
            }
            const quote = q as string,
              i = parent.quote.indexOf(quote);
            if (i < 0 || parent.quote.indexOf(quote, i + 1) >= 0) {
              valid = false;
              break;
            }
            const start = parent.start + unicodeLength(parent.quote.slice(0, i));
            if (
              unicodeSlice(
                parent.quote,
                start - parent.start,
                start - parent.start + unicodeLength(quote),
              ) !== quote
            ) {
              valid = false;
              break;
            }
            facets[k] = { start, end: start + unicodeLength(quote), quote };
          }
          if (!valid) reason = 'NON_UNIQUE_OR_OUTSIDE_CANDIDATE_QUOTE';
          else {
            result.frames.push({
              candidateIndex: candidateIndex!,
              relation: f.relation as SurferAskScopeFrames['frames'][number]['relation'],
              documentRole:
                f.documentRole as SurferAskScopeFrames['frames'][number]['documentRole'],
              facets,
              assessment: 'ANCHORED_SCOPE_UNVERIFIED',
              uncertainties: [
                'RELATION_INTERPRETATION_UNVERIFIED',
                'SCOPE_INTERPRETATION_UNVERIFIED',
                'NULL_FACETS_NOT_UNIVERSAL',
              ],
            });
            continue;
          }
        }
      }
      result.rejected.push({ index, reason });
    }
    if (wire.length)
      result.assessment = result.frames.length ? 'ANCHORED_SCOPES_UNVERIFIED' : 'EVIDENCE_REJECTED';
  }
  if (JSON.stringify(result).length > 4096) {
    result.assessment = 'INVALID_OUTPUT';
    result.frames = [];
    result.rejected = [];
  }
  assertSurferAskScopeFrames(result, candidates);
  return result;
}
