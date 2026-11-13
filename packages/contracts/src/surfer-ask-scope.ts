import type { SurferClauseWire } from './surfer-clause.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';
import { unicodeSlice } from './document-evidence.js';
type DocumentRole =
  Extract<SurferClauseWire['interpretation'], { state: 'RESOLVED' }>['documentRole'] | 'UNRESOLVED';
export type SurferAskScopeFrames = {
  revision: 'surfer.ask-semantic-scopes.v1';
  assessment: 'NO_FRAME' | 'INVALID_OUTPUT' | 'EVIDENCE_REJECTED' | 'ANCHORED_SCOPES_UNVERIFIED';
  frames: {
    candidateIndex: number;
    relation: 'EQUIVALENT' | 'DISTINCT' | 'RELATED' | 'UNRESOLVED';
    documentRole: DocumentRole;
    facets: Record<
      'subject' | 'time' | 'condition' | 'exception',
      null | { start: number; end: number; quote: string }
    >;
    assessment: 'ANCHORED_SCOPE_UNVERIFIED';
    uncertainties: [
      'RELATION_INTERPRETATION_UNVERIFIED',
      'SCOPE_INTERPRETATION_UNVERIFIED',
      'NULL_FACETS_NOT_UNIVERSAL',
    ];
  }[];
  rejected: { index: number; reason: string }[];
};
export const SURFER_SCOPE_FACETS = ['subject', 'time', 'condition', 'exception'] as const;
export function assertSurferAskScopeFrames(
  value: unknown,
  candidates: readonly { sourceSpan: { start: number; end: number; quote: string } }[],
): asserts value is SurferAskScopeFrames {
  assertSurferJson(value);
  const s = value as SurferAskScopeFrames,
    keys = (v: object, k: string) => Object.keys(v).sort().join(',') === k;
  if (
    !s ||
    !keys(s, 'assessment,frames,rejected,revision') ||
    s.revision !== 'surfer.ask-semantic-scopes.v1' ||
    !['NO_FRAME', 'INVALID_OUTPUT', 'EVIDENCE_REJECTED', 'ANCHORED_SCOPES_UNVERIFIED'].includes(
      s.assessment,
    ) ||
    !Array.isArray(s.frames) ||
    s.frames.length > 4 ||
    !Array.isArray(s.rejected) ||
    s.rejected.length > 4 ||
    JSON.stringify(s).length > 4096
  )
    throw surferFailure('Invalid bounded Ask scope frames.');
  const seen = new Set<number>();
  for (const f of s.frames) {
    if (
      !f ||
      !keys(f, 'assessment,candidateIndex,documentRole,facets,relation,uncertainties') ||
      !Number.isSafeInteger(f.candidateIndex) ||
      !candidates[f.candidateIndex] ||
      seen.has(f.candidateIndex) ||
      !['EQUIVALENT', 'DISTINCT', 'RELATED', 'UNRESOLVED'].includes(f.relation) ||
      !['NORMATIVE', 'OBSERVATION', 'DEFINITION', 'EXAMPLE', 'UNRESOLVED'].includes(
        f.documentRole,
      ) ||
      f.assessment !== 'ANCHORED_SCOPE_UNVERIFIED' ||
      JSON.stringify(f.uncertainties) !==
        '["RELATION_INTERPRETATION_UNVERIFIED","SCOPE_INTERPRETATION_UNVERIFIED","NULL_FACETS_NOT_UNIVERSAL"]' ||
      !f.facets ||
      !keys(f.facets, 'condition,exception,subject,time')
    )
      throw surferFailure('Invalid unverified scope frame.');
    seen.add(f.candidateIndex);
    const parent = candidates[f.candidateIndex]!.sourceSpan;
    for (const k of SURFER_SCOPE_FACETS) {
      const a = f.facets[k];
      if (a === null) continue;
      if (
        !a ||
        !keys(a, 'end,quote,start') ||
        typeof a.quote !== 'string' ||
        !a.quote.length ||
        a.quote.length > 128 ||
        !Number.isSafeInteger(a.start) ||
        !Number.isSafeInteger(a.end) ||
        a.start < parent.start ||
        a.end > parent.end ||
        a.end <= a.start ||
        unicodeSlice(parent.quote, a.start - parent.start, a.end - parent.start) !== a.quote
      )
        throw surferFailure('Scope facet differs from its candidate Source span.');
    }
  }
  for (const r of s.rejected)
    if (
      !r ||
      !keys(r, 'index,reason') ||
      !Number.isSafeInteger(r.index) ||
      r.index < 0 ||
      r.index > 3 ||
      typeof r.reason !== 'string' ||
      !r.reason.length ||
      r.reason.length > 80
    )
      throw surferFailure('Invalid scope rejection.');
  if (
    s.assessment === 'ANCHORED_SCOPES_UNVERIFIED'
      ? !s.frames.length
      : s.frames.length > 0 ||
        (s.assessment === 'EVIDENCE_REJECTED' ? !s.rejected.length : s.rejected.length > 0)
  )
    throw surferFailure('Scope assessment differs from the recorded frames.');
}
