import type { SurferAskMemoryContext } from '../../../packages/contracts/src/surfer-ask-memory.js';
import {
  decodeSurferAskMeaningProposalReceipt,
  type SurferAskMeaningProposalReceipt,
} from '../../../packages/contracts/src/surfer-ask-discovery.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeLength, unicodeSlice } from '../../../packages/contracts/src/document-evidence.js';
import { askMeaningScopeSchema, buildAskMeaningScopes } from './ask-meaning-scope.js';
type Evidence = {
  evidenceId: string;
  sourceId: string;
  sourceVersionId: string;
  exactQuote: string;
};
export const discoverableAskRules = (c: SurferAskMemoryContext) =>
  (c.packet?.rules ?? [])
    .map((r, i) => ({ ruleRef: 'R' + (i + 1), rule: r }))
    .filter(
      ({ rule: r }) =>
        r.state === 'ACTIVE' &&
        r.outcome === 'UNKNOWN' &&
        r.reasons.some((x) => x.startsWith('MISSING_PREMISE:')),
    );
export function askMeaningDiscoverySchema(
  context: SurferAskMemoryContext,
  refs: { evidenceId: string; citationRef: string }[],
) {
  const text = { type: 'string', minLength: 1, maxLength: 1024 };
  const scopes = context.packet?.discovery?.revision === 'surfer.ask-meaning-discovery.v2';
  return {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'reason', 'candidates', ...(scopes ? ['semanticScopes'] : [])],
    properties: {
      ...(scopes ? { semanticScopes: askMeaningScopeSchema() } : {}),
      state: { enum: ['PROPOSED', 'MISSING', 'AMBIGUOUS', 'UNMODELED'] },
      reason: { ...text, maxLength: 256 },
      candidates: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'ruleRef',
            'field',
            'label',
            'evidenceRef',
            'sourceQuote',
            'questionQuote',
            'scope',
          ],
          properties: {
            ruleRef: { enum: discoverableAskRules(context).map((r) => r.ruleRef) },
            field: { type: 'string', minLength: 1, maxLength: 64 },
            label: { type: 'string', minLength: 1, maxLength: 64 },
            evidenceRef: {
              enum: refs
                .filter((r) =>
                  context.packet?.discovery?.evidence.some((e) => e.evidenceId === r.evidenceId),
                )
                .map((r) => r.citationRef),
            },
            sourceQuote: text,
            questionQuote: { ...text, maxLength: 64 },
            scope: { const: 'UNVERIFIED' },
          },
        },
      },
    },
  };
}
const exact = (v: object, k: string) => Object.keys(v).sort().join(',') === k;
const text = (v: unknown, n: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= n;
// PostgreSQL JSONB cannot represent NUL or unpaired surrogates. Keep the response digest,
// reject such metadata, and preserve a separately valid answer instead of failing its INSERT.
const scopeWireStorable = (v: unknown): boolean =>
  typeof v === 'string'
    ? !v.includes('\u0000') && !/[\uD800-\uDFFF]/u.test(v)
    : Array.isArray(v)
      ? v.every(scopeWireStorable)
      : v !== null && typeof v === 'object'
        ? Object.entries(v).every(([k, x]) => scopeWireStorable(k) && scopeWireStorable(x))
        : true;
const span = (text: string, quote: string) => {
  const i = text.indexOf(quote);
  if (i < 0 || text.indexOf(quote, i + 1) >= 0) return null;
  return {
    start: unicodeLength(text.slice(0, i)),
    end: unicodeLength(text.slice(0, i)) + unicodeLength(quote),
    quote,
  };
};
/** Anchor checks alone never establish semantic equivalence, scope, or rule applicability. */
export function buildAskMeaningProposalReceipt(input: {
  context: SurferAskMemoryContext;
  question: string;
  evidence: readonly Evidence[];
  wire: unknown;
  producer: SurferAskMeaningProposalReceipt['producer'];
  responseDigest: string;
}): SurferAskMeaningProposalReceipt {
  if (!input.context.packet?.discovery) throw surferFailure('No pinned meaning discovery request.');
  const scopes = input.context.packet.discovery.revision === 'surfer.ask-meaning-discovery.v2';
  const mapping = new Map<number, number>();
  let wire: unknown | null = null;
  try {
    if (JSON.stringify(input.wire)?.length <= (scopes ? 12000 : 16384)) {
      const copy: unknown = JSON.parse(JSON.stringify(input.wire));
      assertSurferJson({ wire: copy });
      if (scopes && !scopeWireStorable(copy))
        throw surferFailure('Unrepresentable semantic scope metadata.');
      wire = copy;
    }
  } catch {
    /* invalid output is recorded without adopting it */
  }
  const body: Omit<SurferAskMeaningProposalReceipt, 'digest'> = {
    revision: scopes ? 'surfer.ask-meaning-proposal.v2' : 'surfer.ask-meaning-proposal.v1',
    contextDigest: input.context.digest,
    questionDigest: surferDigest(input.question),
    responseDigest: input.responseDigest,
    producer: input.producer,
    wire,
    assessment: 'INVALID_OUTPUT',
    candidates: [],
    rejected: [],
    semanticAssessment: 'NOT_EVALUATED',
    effect: 'NO_RULE_OR_KNOWLEDGE_CHANGE',
  };
  const raw = wire as {
    state: string;
    reason: string;
    candidates: unknown[];
    semanticScopes?: unknown;
  } | null;
  const value =
    scopes &&
    raw &&
    (exact(raw, 'candidates,reason,semanticScopes,state') || exact(raw, 'candidates,reason,state'))
      ? { state: raw.state, reason: raw.reason, candidates: raw.candidates }
      : raw;
  if (
    value &&
    exact(value, 'candidates,reason,state') &&
    ['PROPOSED', 'MISSING', 'AMBIGUOUS', 'UNMODELED'].includes(value.state) &&
    text(value.reason, 256) &&
    Array.isArray(value.candidates) &&
    value.candidates.length <= 8 &&
    (value.state === 'PROPOSED' ? value.candidates.length > 0 : value.candidates.length === 0)
  ) {
    body.assessment = 'NO_CANDIDATE';
    for (const [index, raw] of value.candidates.entries()) {
      let reason = 'INVALID_CANDIDATE';
      const c = raw as Record<string, unknown> | null;
      if (
        c &&
        exact(c, 'evidenceRef,field,label,questionQuote,ruleRef,scope,sourceQuote') &&
        text(c.ruleRef, 4) &&
        text(c.field, 64) &&
        text(c.label, 64) &&
        text(c.evidenceRef, 4) &&
        text(c.sourceQuote, 1024) &&
        text(c.questionQuote, 64) &&
        c.scope === 'UNVERIFIED' &&
        c.label === c.questionQuote &&
        /^[\p{L}\p{N}][\p{L}\p{N}_ -]*$/u.test(c.label)
      ) {
        const target = discoverableAskRules(input.context).find((x) => x.ruleRef === c.ruleRef),
          evidence = input.evidence[Number(c.evidenceRef.slice(1)) - 1],
          pin =
            evidence &&
            input.context.packet.discovery.evidence.find(
              (p) => p.evidenceId === evidence.evidenceId,
            );
        if (!target || !target.rule.fields.some((f) => f.name === c.field))
          reason = 'INVALID_RULE_FIELD';
        else if (
          !/^E[1-9][0-9]*$/.test(c.evidenceRef) ||
          !evidence ||
          !pin ||
          pin.sourceId !== evidence.sourceId ||
          pin.sourceVersionId !== evidence.sourceVersionId ||
          pin.quoteDigest !== surferDigest(evidence.exactQuote)
        )
          reason = 'UNPINNED_EVIDENCE';
        else {
          const s = span(evidence.exactQuote, c.sourceQuote),
            q = span(input.question, c.questionQuote);
          if (
            !s ||
            !q ||
            (scopes &&
              (unicodeSlice(evidence.exactQuote, s.start, s.end) !== s.quote ||
                unicodeSlice(input.question, q.start, q.end) !== q.quote))
          )
            reason = 'NON_UNIQUE_OR_MISSING_QUOTE';
          else if (!c.sourceQuote.includes(c.field) || !c.sourceQuote.includes(c.label))
            reason = 'FIELD_OR_LABEL_ABSENT_FROM_SOURCE_QUOTE';
          else if (
            body.candidates.some(
              (x) => x.rule.artifactId === target.rule.memory.artifactId && x.field === c.field,
            )
          )
            reason = 'DUPLICATE_RULE_FIELD';
          else {
            mapping.set(index, body.candidates.length);
            body.candidates.push({
              rule: target.rule.memory,
              field: c.field,
              label: c.label,
              source: {
                evidenceId: pin.evidenceId,
                sourceId: pin.sourceId,
                sourceVersionId: pin.sourceVersionId,
                revisionId: pin.revisionId,
              },
              sourceSpan: s,
              questionSpan: q,
              assessment: 'ANCHORED_UNVERIFIED',
              uncertainties: ['SEMANTIC_EQUIVALENCE_UNVERIFIED', 'SUBJECT_TIME_UNVERIFIED'],
            });
            continue;
          }
        }
      }
      body.rejected.push({ index, reason });
    }
    if (value.candidates.length)
      body.assessment = body.candidates.length
        ? 'ANCHORED_CANDIDATES_UNVERIFIED'
        : 'EVIDENCE_REJECTED';
  }
  if (scopes)
    body.semanticScopes = buildAskMeaningScopes(raw?.semanticScopes, body.candidates, mapping);
  return decodeSurferAskMeaningProposalReceipt({ ...body, digest: surferDigest(body) });
}
export function assertAskMeaningProposalReceipt(
  input: Parameters<typeof buildAskMeaningProposalReceipt>[0],
  receipt: SurferAskMeaningProposalReceipt,
) {
  const decoded = decodeSurferAskMeaningProposalReceipt(receipt),
    expected = buildAskMeaningProposalReceipt({ ...input, wire: decoded.wire });
  if (surferDigest(expected) !== surferDigest(decoded))
    throw surferFailure(
      'Meaning proposal differs from the pinned context, Source, or caller question.',
    );
}
