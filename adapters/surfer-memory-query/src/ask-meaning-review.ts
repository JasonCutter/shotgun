import type {
  SurferAskMeaningReview,
  SurferAskMeaningScopeInput,
  SurferAskCrossReviewPin,
} from '../../../packages/contracts/src/surfer-ask-adoption.js';
import {
  assertSurferAskMeaningReview,
  assertSurferAskMeaningScopeInput,
} from '../../../packages/contracts/src/surfer-ask-adoption.js';
import type { SurferAskRule } from '../../../packages/contracts/src/surfer-ask-memory.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeSlice } from '../../../packages/contracts/src/document-evidence.js';
import {
  groundSurferAskResolvedMeanings,
  groundSurferAskRuleMeanings,
  readSurferRuleFieldLexicon,
  type SurferAskMeaningSource,
} from './ask-rule-meaning.js';
import type { SurferGuidedRuleCatalog } from '../../../packages/contracts/src/surfer-guided-rule.js';
type Fields = SurferGuidedRuleCatalog['items'][number]['fields'];
/** Closed whole-document declarations only. No universal synonym, fact, subject or time inference. */
export function readSurferTypedMeaningDeclaration(quote: string) {
  if (quote.length > 4096) return null;
  const m =
    /^([^\r\n]{1,256}) 분야에서 ([\p{L}\p{N}][\p{L}\p{N}_ -]{0,63})[은는] ([A-Za-z][A-Za-z0-9_]{0,63})[와과] (같은|다른) (NUMBER|BOOLEAN|TEXT) (?:값이며|값을 의미하며|값을 가리키며) 단위는 ([^\s]{1,64})이다\.?$/u.exec(
      quote.trim(),
    );
  if (
    !m ||
    m[1]!.trim() !== m[1] ||
    m[2]!.trim() !== m[2] ||
    Object.hasOwn(Object.prototype, m[2]!) ||
    Object.hasOwn(Object.prototype, m[3]!) ||
    ['constructor', 'prototype', '__proto__'].includes(m[3]!)
  )
    return null;
  const type = m[5] as 'NUMBER' | 'BOOLEAN' | 'TEXT',
    unit = m[6] === '없음' ? null : m[6]!;
  if ((type === 'NUMBER') === (unit === null)) return null;
  return { domain: m[1]!, label: m[2]!, field: m[3]!, equivalent: m[4] === '같은', type, unit };
}
export function reviewSurferMeaningProposal(input: {
  proposal: SurferAskMeaningReview['proposal'];
  candidate: SurferAskMeaningReview['candidate'];
  domain: string;
  fields: Fields;
  documents: readonly SurferAskMeaningSource[];
  scope?: SurferAskMeaningScopeInput;
  crossReview?: SurferAskCrossReviewPin;
}): SurferAskMeaningReview {
  const c = input.candidate,
    field = input.fields.find((f) => f.name === c.field),
    sources = input.documents
      .filter((d) => d.quote.includes(c.label))
      .sort((a, b) => {
        const x = [a.sourceId, a.evidenceId, a.revisionId].join(':'),
          y = [b.sourceId, b.evidenceId, b.revisionId].join(':');
        return x < y ? -1 : x > y ? 1 : 0;
      });
  if (sources.length > 12)
    throw surferFailure(
      'Related declarations exceed the review bound; none may be silently omitted.',
    );
  const origin = sources.find(
      (d) =>
        d.sourceId === c.source.sourceId &&
        d.sourceVersionId === c.source.sourceVersionId &&
        d.evidenceId === c.source.evidenceId &&
        d.revisionId === c.source.revisionId,
    ),
    original = origin && readSurferTypedMeaningDeclaration(origin.quote);
  let assessment: SurferAskMeaningReview['assessment'] = 'INSUFFICIENT_EVIDENCE';
  const relations = sources.map((source) => ({
    source,
    definition: readSurferTypedMeaningDeclaration(source.quote),
    lexicon: readSurferRuleFieldLexicon(source.quote),
  }));
  const relevant = relations.flatMap(({ source, definition: d, lexicon: l }) =>
    d && d.domain === input.domain && d.label === c.label
      ? [{ source, field: d.field, equivalent: d.equivalent, type: d.type, unit: d.unit }]
      : l && l.domain === input.domain && l.subject === null && l.time === null
        ? l.fields
            .filter((f) => f.aliases.includes(c.label))
            .map((f) => ({ source, field: f.name, equivalent: true, type: f.type, unit: f.unit }))
        : [],
  );
  const unknown = relations.some(
    (r) =>
      (!r.definition && !r.lexicon) ||
      (r.definition && r.definition.domain !== input.domain) ||
      (r.lexicon &&
        (r.lexicon.domain !== input.domain ||
          r.lexicon.subject !== null ||
          r.lexicon.time !== null)),
  );
  if (
    !field ||
    !origin ||
    !original ||
    original.domain !== input.domain ||
    original.label !== c.label ||
    unicodeSlice(origin.quote, c.sourceSpan.start, c.sourceSpan.end) !== c.sourceSpan.quote
  )
    assessment = 'UNSUPPORTED';
  else if (
    relevant.some(
      (r) => r.field !== c.field || !r.equivalent || r.type !== field.type || r.unit !== field.unit,
    )
  )
    assessment = 'CONTRADICTED';
  else if (unknown) assessment = 'UNSUPPORTED';
  else if (
    relevant.some(
      (r) =>
        r.source.sourceId !== origin.sourceId &&
        surferDigest(r.source.quote.replace(/\s+/gu, ' ').trim().replace(/\.$/u, '')) !==
          surferDigest(origin.quote.replace(/\s+/gu, ' ').trim().replace(/\.$/u, '')),
    )
  )
    assessment = 'SOURCE_CORROBORATED_DECLARATION_ONLY';
  let scopeAssessment: 'TYPED_DECLARATIONS_ONLY' | 'UNVERIFIED_SCOPE' = 'UNVERIFIED_SCOPE';
  if (input.scope) {
    assertSurferAskMeaningScopeInput(input.scope, c, input.proposal.candidateIndex);
    const s = input.scope,
      f = s.frame;
    // Null facets never establish universal scope. Only independently parsed
    // whole-document typed declarations can establish this bounded profile.
    const unresolved =
      s.hasRejections ||
      ['INVALID_OUTPUT', 'EVIDENCE_REJECTED'].includes(s.sourceAssessment) ||
      (f !== null &&
        (f.relation !== 'EQUIVALENT' ||
          f.documentRole !== 'DEFINITION' ||
          Object.values(f.facets).some((v) => v !== null)));
    if ((unresolved || input.crossReview?.state === 'WITHHELD') && assessment !== 'CONTRADICTED')
      assessment = 'UNSUPPORTED';
    if (assessment === 'SOURCE_CORROBORATED_DECLARATION_ONLY')
      scopeAssessment = 'TYPED_DECLARATIONS_ONLY';
  }
  const body = {
    ...(input.scope
      ? {
          ...(input.crossReview
            ? {
                revision: 'surfer.ask-meaning-review.v3' as const,
                profile: 'EXPLICIT_TYPED_DOMAIN_WITH_CROSS_REVIEW_V1' as const,
                crossReview: input.crossReview,
              }
            : {
                revision: 'surfer.ask-meaning-review.v2' as const,
                profile: 'EXPLICIT_TYPED_DOMAIN_AND_SCOPE_V1' as const,
              }),
          scope: input.scope,
          scopeAssessment,
        }
      : {
          revision: 'surfer.ask-meaning-review.v1' as const,
          profile: 'EXPLICIT_TYPED_DOMAIN_DECLARATION_V1' as const,
        }),
    proposal: input.proposal,
    candidate: c,
    assessment,
    sources,
  };
  const result = { ...body, digest: surferDigest(body) };
  assertSurferAskMeaningReview(result);
  return result;
}
export function groundSurferAskReviewedMeanings(
  question: string,
  fields: Fields,
  domain: string,
  documents: readonly SurferAskMeaningSource[],
  reviews: readonly SurferAskMeaningReview[],
) {
  const sources: SurferAskMeaningSource[] = [],
    aliases: NonNullable<SurferAskRule['grounding']>['aliases'] = [];
  const declared = groundSurferAskRuleMeanings(question, fields, domain, documents);
  if (declared.grounding.revision === 'surfer.ask-source-field-meanings.v1') {
    sources.push(...declared.grounding.sources!);
    aliases.push(...declared.grounding.aliases!);
  }
  for (const r of reviews) {
    assertSurferAskMeaningReview(r);
    const checked = reviewSurferMeaningProposal({
      proposal: r.proposal,
      candidate: r.candidate,
      domain,
      fields,
      documents,
      ...(r.revision !== 'surfer.ask-meaning-review.v1' ? { scope: r.scope } : {}),
      ...(r.revision === 'surfer.ask-meaning-review.v3' ? { crossReview: r.crossReview } : {}),
    });
    if (checked.digest !== r.digest)
      throw surferFailure('Meaning review differs from current Source declarations.');
    for (const source of r.sources)
      if (!sources.some((x) => surferDigest(x) === surferDigest(source))) sources.push(source);
    const i = sources.findIndex(
      (s) =>
        s.sourceId === r.candidate.source.sourceId &&
        s.evidenceId === r.candidate.source.evidenceId &&
        s.sourceVersionId === r.candidate.source.sourceVersionId,
    );
    if (i < 0) throw surferFailure('Reviewed candidate origin is absent.');
    aliases.push({
      field: r.candidate.field,
      term: r.candidate.label,
      sourceIndex: i,
      lexiconDigest: r.digest,
      status:
        r.assessment === 'SOURCE_CORROBORATED_DECLARATION_ONLY'
          ? 'SOURCE_DECLARED'
          : 'PROPOSAL_REJECTED',
    });
  }
  const result = groundSurferAskResolvedMeanings(question, fields, sources, aliases);
  return {
    ...result,
    grounding: {
      ...result.grounding,
      revision: 'surfer.ask-reviewed-proposal-meanings.v1' as const,
      reviews: [...reviews],
    },
  };
}
export function assertSurferAskReviewedRule(question: string, rule: SurferAskRule) {
  const g = rule.grounding;
  if (g?.revision !== 'surfer.ask-reviewed-proposal-meanings.v1' || !g.reviews?.length)
    throw surferFailure('Missing reviewed proposal grounding.');
  const fields = rule.fields.map((f) => ({
    ...f,
    values: rule.premises.filter((p) => p.name === f.name).map((p) => p.value),
  }));
  const checked = groundSurferAskReviewedMeanings(
    question,
    fields,
    rule.domain,
    g.sources!,
    g.reviews,
  );
  if (
    surferDigest(checked.grounding) !== surferDigest(g) ||
    surferDigest(checked.features) !==
      surferDigest(
        Object.fromEntries(
          rule.premises.map((p) => [
            p.name,
            { value: p.value, ...(p.unit === null ? {} : { unit: p.unit }) },
          ]),
        ),
      )
  )
    throw surferFailure('Reviewed meaning or caller value changed.');
}
