import type { SurferAskMeaningProposalReceipt } from './surfer-ask-discovery.js';
import { assertSurferSourceBasisV2, type SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import {
  decodeSurferObservationSelections,
  type SurferCognitiveView,
  type SurferObservationSelection,
} from './surfer-cognition.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import { unicodeLength, unicodeSlice } from './document-evidence.js';

export const SURFER_MEANING_VERIFIER_REVISION = 'surfer-meaning-cross-review-v1';
export const SURFER_MEANING_VERIFIER_REVISION_V2 = 'surfer-meaning-cross-review-v2';
export const SURFER_MEANING_VERIFIER_REVISION_V3 = 'surfer-meaning-cross-review-v3';
export const SURFER_MEANING_VERIFIER_REVISION_V4 = 'surfer-meaning-cross-review-v4';
export const SURFER_MEANING_VERIFIER_REVISION_V5 = 'surfer-meaning-cross-review-v5';
export const SURFER_MEANING_VERIFIER_REVISION_V6 = 'surfer-meaning-cross-review-v6';
export const SURFER_MEANING_VERIFIER_REVISION_V7 = 'surfer-meaning-cross-review-v7';
export const SURFER_MEANING_VERIFIER_REVISION_V8 = 'surfer-meaning-cross-review-v8';
export const SURFER_MEANING_VERIFIER_REVISION_V9 = 'surfer-meaning-cross-review-v9';
export const SURFER_MEANING_VERIFIER_REVISION_V10 = 'surfer-meaning-cross-review-v10';
export const SURFER_MEANING_VERIFIER_REVISION_V11 = 'surfer-meaning-cross-review-v11';
export const SURFER_MEANING_VERIFIER_REVISION_V12 = 'surfer-meaning-cross-review-v12';
const MAX_V12_SCOPE_QUOTES = 8;
export function isSurferMeaningVerifierRevision(value: string) {
  return (
    value === SURFER_MEANING_VERIFIER_REVISION ||
    value === SURFER_MEANING_VERIFIER_REVISION_V2 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V3 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V4 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V5 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V6 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V7 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V8 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V9 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V10 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V11 ||
    value === SURFER_MEANING_VERIFIER_REVISION_V12
  );
}
export type SurferMeaningVerificationWork = {
  revision: 'surfer.meaning-verification-work.v1';
  proposal: {
    attemptId: string;
    receiptDigest: string;
    contextDigest: string;
    candidateIndex: number;
  };
  candidate: SurferAskMeaningProposalReceipt['candidates'][number];
  target: {
    domain: string;
    description: string;
    field: { name: string; type: 'NUMBER' | 'BOOLEAN' | 'TEXT'; unit: string | null };
  };
  proposer: SurferAskMeaningProposalReceipt['producer'];
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
  viewDigest: string;
  profileDigest: string;
  digest: string;
};
const keys = (v: object, s: string) => Object.keys(v).sort().join(',') === s;
const hash = (v: unknown): v is string => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 256): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= max &&
  !v.includes('\u0000') &&
  !/[\uD800-\uDFFF]/u.test(v);
export function decodeSurferMeaningVerificationWork(value: unknown): SurferMeaningVerificationWork {
  assertSurferJson(value);
  const w = value as SurferMeaningVerificationWork;
  if (
    !w ||
    !keys(
      w,
      'basis,candidate,digest,profileDigest,proposal,proposer,revision,selections,target,viewDigest',
    ) ||
    w.revision !== 'surfer.meaning-verification-work.v1' ||
    !w.proposal ||
    !keys(w.proposal, 'attemptId,candidateIndex,contextDigest,receiptDigest') ||
    !text(w.proposal.attemptId) ||
    !hash(w.proposal.receiptDigest) ||
    !hash(w.proposal.contextDigest) ||
    !Number.isSafeInteger(w.proposal.candidateIndex) ||
    w.proposal.candidateIndex < 0 ||
    w.proposal.candidateIndex > 7 ||
    !w.target ||
    !keys(w.target, 'description,domain,field') ||
    !text(w.target.domain) ||
    !text(w.target.description, 4096) ||
    !w.target.field ||
    !keys(w.target.field, 'name,type,unit') ||
    !text(w.target.field.name, 64) ||
    !['NUMBER', 'BOOLEAN', 'TEXT'].includes(w.target.field.type) ||
    !(w.target.field.unit === null || text(w.target.field.unit, 64)) ||
    !w.candidate ||
    !w.proposer ||
    !text(w.proposer.provider) ||
    !text(w.proposer.model) ||
    !hash(w.viewDigest) ||
    !hash(w.profileDigest) ||
    !hash(w.digest) ||
    JSON.stringify(w).length > 32768
  )
    throw surferFailure('Invalid bounded meaning verification work.');
  const c = w.candidate;
  const span = (s: typeof c.sourceSpan, maximum: number) =>
    !!s &&
    keys(s, 'end,quote,start') &&
    text(s.quote, maximum) &&
    Number.isSafeInteger(s.start) &&
    s.start >= 0 &&
    Number.isSafeInteger(s.end) &&
    s.end > s.start &&
    s.end - s.start === unicodeLength(s.quote);
  if (
    !keys(c, 'assessment,field,label,questionSpan,rule,source,sourceSpan,uncertainties') ||
    !text(c.label, 64) ||
    c.field !== w.target.field.name ||
    !c.rule ||
    !keys(c.rule, 'artifactId,digest,revision') ||
    !text(c.rule.artifactId) ||
    !hash(c.rule.digest) ||
    !Number.isSafeInteger(c.rule.revision) ||
    c.rule.revision < 1 ||
    !c.source ||
    !keys(c.source, 'evidenceId,revisionId,sourceId,sourceVersionId') ||
    Object.values(c.source).some((v) => !text(v)) ||
    !span(c.sourceSpan, 1024) ||
    !span(c.questionSpan, 64) ||
    c.assessment !== 'ANCHORED_UNVERIFIED' ||
    JSON.stringify(c.uncertainties) !==
      '["SEMANTIC_EQUIVALENCE_UNVERIFIED","SUBJECT_TIME_UNVERIFIED"]' ||
    !keys(
      w.proposer,
      Object.hasOwn(w.proposer, 'adapterVersion')
        ? 'adapterVersion,model,provider'
        : 'model,provider',
    ) ||
    (Object.hasOwn(w.proposer, 'adapterVersion') && !text(w.proposer.adapterVersion))
  )
    throw surferFailure('Invalid fixed meaning candidate or producer.');
  assertSurferSourceBasisV2(w.basis);
  const selected = decodeSurferObservationSelections({
    schemaVersion: '1.0.0',
    selections: w.selections,
  });
  if (
    selected.selections.length < 2 ||
    selected.selections.length > 8 ||
    new Set(selected.selections.map((s) => s.sourceId)).size < 2
  )
    throw surferFailure('Meaning verification requires bounded separate passages.');
  const { digest, ...body } = w;
  if (surferDigest(body) !== digest) throw surferFailure('Meaning verification work changed.');
  return structuredClone(w);
}
type Citation = {
  sourceId: string;
  sourceVersionId: string;
  evidenceId: string;
  revisionId: string;
  anchorDigest: string;
  start: number;
  end: number;
  quote: string;
};
type ScopedDatum = {
  stationId: string;
  valueLiteral: string;
  unit: string;
  scopeCitation: Citation;
  valueCitation: Citation;
  unitCitation: Citation;
};
type ScopedDatumComparison = {
  reportedRelation: SurferMeaningVerificationFindings['relation'];
  observations: readonly ScopedDatum[];
};
export type SurferMeaningVerificationFindings = {
  relation: 'EQUIVALENT' | 'DISTINCT' | 'RELATED' | 'UNRESOLVED';
  typeAssessment: 'MATCH' | 'MISMATCH' | 'UNRESOLVED';
  unitAssessment: 'MATCH' | 'MISMATCH' | 'UNRESOLVED';
  documentRole: 'DEFINITION' | 'NORMATIVE' | 'OBSERVATION' | 'EXAMPLE' | 'UNRESOLVED';
  roleCitations: Citation[];
  facets: Record<
    'subject' | 'time' | 'condition' | 'exception',
    { state: 'STATED' | 'UNSTATED' | 'AMBIGUOUS'; reason: string; quotes: Citation[] }
  >;
  support: Citation[];
  counter: Citation[];
  reason: string;
};
export type SurferMeaningVerificationFindingsV2 = SurferMeaningVerificationFindings & {
  relationBasis:
    | 'EXPLICIT_TERM_RELATION'
    | 'OBSERVATION_ONLY'
    | 'COOCCURRENCE_ONLY'
    | 'NAME_INFERENCE_ONLY'
    | 'UNRESOLVED';
  typeCitations: Citation[];
  unitCitations: Citation[];
  counterKinds: ('SEMANTIC_CONTRADICTION' | 'SCOPE_LIMITATION' | 'UNRESOLVED')[];
};
type ScopedTableObservation = {
  scopeLiteral: string;
  valueLiteral: string;
  unit: string;
  rowCitation: Citation;
};
type MeaningScopeEvidence = {
  state: 'SAME_SCOPE' | 'DIFFERENT_SCOPE' | 'NOT_ESTABLISHED';
  basis: 'MODEL_CITATIONS' | 'EXACT_TABLE_ROWS' | 'EXACT_OPERATING_CLAUSES';
  quotes: Citation[];
};
export type SurferMeaningVerificationResult = {
  workDigest: string;
  proposal: SurferMeaningVerificationWork['proposal'];
  viewDigest: string;
  assessment: 'MODEL_SUPPORTED_UNVERIFIED' | 'MODEL_CONTRADICTED_UNVERIFIED' | 'MODEL_UNRESOLVED';
  producer: { provider: string; model: string; promptRevision: string; executionRef: string };
  reviewerSeparation: 'SAME_CONFIGURED_MODEL' | 'DIFFERENT_CONFIGURED_MODEL';
  semanticAssessment: 'MODEL_REVIEW_NOT_TRUTH_VALIDATED';
  evidenceCoverage: 'SELECTED_PASSAGES_ONLY';
  ruleCurrentness: 'NOT_ASSESSED_NO_APPLICATION';
  effect: 'NO_RULE_OR_KNOWLEDGE_CHANGE';
  responseDigest: string;
  digest: string;
} & (
  | { revision: 'surfer.meaning-cross-review.v1'; findings: SurferMeaningVerificationFindings }
  | {
      revision: 'surfer.meaning-cross-review.v2';
      findings: SurferMeaningVerificationFindingsV2;
      interpretationLimits: string[];
      scopedDatumComparison?: ScopedDatumComparison;
      scopeEvidence?: MeaningScopeEvidence;
      reportedCounterKinds?: SurferMeaningVerificationFindingsV2['counterKinds'];
      scopedTableObservations?: ScopedTableObservation[];
    }
);
export function surferMeaningVerificationSchema(revision = SURFER_MEANING_VERIFIER_REVISION) {
  if (!isSurferMeaningVerifierRevision(revision))
    throw surferFailure('Unknown meaning review revision.');
  const obj = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  const quote = obj({
    passageRef: { type: 'string', pattern: '^P[1-8]$' },
    quote: { type: 'string', minLength: 1, maxLength: 512 },
  });
  const citations = { type: 'array', maxItems: 4, items: quote };
  const schema = obj({
    relation: { enum: ['EQUIVALENT', 'DISTINCT', 'RELATED', 'UNRESOLVED'] },
    typeAssessment: { enum: ['MATCH', 'MISMATCH', 'UNRESOLVED'] },
    unitAssessment: { enum: ['MATCH', 'MISMATCH', 'UNRESOLVED'] },
    documentRole: { enum: ['DEFINITION', 'NORMATIVE', 'OBSERVATION', 'EXAMPLE', 'UNRESOLVED'] },
    roleCitations: citations,
    facets: obj(
      Object.fromEntries(
        ['subject', 'time', 'condition', 'exception'].map((k) => [
          k,
          obj({
            state: { enum: ['STATED', 'UNSTATED', 'AMBIGUOUS'] },
            reason: { type: 'string', minLength: 1, maxLength: 256 },
            quotes: citations,
          }),
        ]),
      ),
    ),
    support: citations,
    counter: citations,
    reason: { type: 'string', minLength: 1, maxLength: 512 },
  });
  if (revision !== SURFER_MEANING_VERIFIER_REVISION) {
    Object.assign(schema.properties, {
      relationBasis: {
        enum: [
          'EXPLICIT_TERM_RELATION',
          'OBSERVATION_ONLY',
          'COOCCURRENCE_ONLY',
          'NAME_INFERENCE_ONLY',
          'UNRESOLVED',
        ],
      },
      typeCitations: citations,
      unitCitations: citations,
      counter: {
        type: 'array',
        maxItems: 4,
        items: obj({
          ...quote.properties,
          kind: { enum: ['SEMANTIC_CONTRADICTION', 'SCOPE_LIMITATION', 'UNRESOLVED'] },
        }),
      },
    });
    schema.required = Object.keys(schema.properties);
  }
  if (
    revision === SURFER_MEANING_VERIFIER_REVISION_V4 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V5 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V6 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V7 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V8 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V9 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V10 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V11 ||
    revision === SURFER_MEANING_VERIFIER_REVISION_V12
  ) {
    Object.assign(schema.properties, {
      scopeComparison: obj({
        state: { enum: ['SAME_SCOPE', 'DIFFERENT_SCOPE', 'NOT_ESTABLISHED'] },
        quotes:
          revision === SURFER_MEANING_VERIFIER_REVISION_V12
            ? { ...citations, maxItems: MAX_V12_SCOPE_QUOTES }
            : citations,
      }),
    });
    schema.required = Object.keys(schema.properties);
  }
  return schema;
}

/** Recognizes only the selected, exact two-record NOAA datum projection. No URL is dereferenced. */
export function scopedDatumObservations(
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): ScopedDatum[] {
  if (
    target.field.type !== 'NUMBER' ||
    target.field.unit === null ||
    view.anchors.length !== 2 ||
    view.anchors[0]!.source.sourceId === view.anchors[1]!.source.sourceId
  )
    return [];

  const records: ScopedDatum[] = [];
  for (const [index, anchor] of view.anchors.entries()) {
    const lines = anchor.rawLiteral.split('\n');
    if (lines.length !== 5) return [];
    const [unitLine, nameLine, descriptionLine, valueLine, scopeLine] = lines as [
      string,
      string,
      string,
      string,
      string,
    ];
    const stationId =
      /^"self": "https:\/\/api\.tidesandcurrents\.noaa\.gov\/mdapi\/prod\/webapi\/stations\/([0-9]{7})\/datums\.json"$/u.exec(
        scopeLine,
      )?.[1];
    const value = /^"value": (-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)$/u.exec(valueLine)?.[1];
    if (
      !stationId ||
      value === undefined ||
      value.length > 64 ||
      unitLine !== '"units": ' + JSON.stringify(target.field.unit) ||
      nameLine !== '"name": ' + JSON.stringify(label) + ',' ||
      descriptionLine !== '"description": ' + JSON.stringify(target.field.name) + ','
    )
      return [];
    const [scopeCitation, valueCitation, unitCitation] = groundMeaningQuotes(
      [scopeLine, valueLine, unitLine].map((quote) => ({ passageRef: 'P' + (index + 1), quote })),
      view,
    );
    records.push({
      stationId,
      valueLiteral: value,
      unit: target.field.unit,
      scopeCitation: scopeCitation!,
      valueCitation: valueCitation!,
      unitCitation: unitCitation!,
    });
  }
  return records[0]!.stationId === records[1]!.stationId ? [] : records;
}
/** Recognizes one unquoted facility/setpoint row in each of two selected Sources. */
export function scopedTableObservations(
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): ScopedTableObservation[] {
  const field = target.field;
  if (
    field.type !== 'NUMBER' ||
    !field.unit ||
    view.anchors.length !== 2 ||
    view.anchors[0]!.source.sourceId === view.anchors[1]!.source.sourceId
  )
    return [];
  const records: ScopedTableObservation[] = [];
  for (const [index, anchor] of view.anchors.entries()) {
    const [header, row, ...remaining] = anchor.rawLiteral.split(/\r?\n/u);
    if (
      header !== 'Facility,Parameter,Setpoint,Unit' ||
      !row ||
      row.length > 512 ||
      remaining.length
    )
      return [];
    const [scope, parameter, value, unit, ...extra] = row.split(',');
    if (
      !scope ||
      scope.length > 120 ||
      scope.trim() !== scope ||
      /["\p{C}]/u.test(scope) ||
      !(
        parameter?.toLowerCase() === field.name.toLowerCase() ||
        (parameter?.toLowerCase() === label.toLowerCase() &&
          field.name.toLowerCase() === label.toLowerCase() + ' setpoint')
      ) ||
      !value ||
      value.length > 64 ||
      !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) ||
      unit !== field.unit ||
      extra.length
    )
      return [];
    const [rowCitation] = groundMeaningQuotes(
      [{ passageRef: 'P' + (index + 1), quote: row }],
      view,
    );
    records.push({ scopeLiteral: scope, valueLiteral: value, unit, rowCitation: rowCitation! });
  }
  const scopeKey = (record: ScopedTableObservation) =>
    record.scopeLiteral.normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
  return scopeKey(records[0]!) === scopeKey(records[1]!) ? [] : records;
}
function groundMeaningQuotes(input: unknown, view: SurferCognitiveView, maximum = 4): Citation[] {
  if (!Array.isArray(input) || input.length > maximum)
    throw surferFailure('Invalid bounded review citations.');
  const seen = new Set<string>();
  return input.map((raw) => {
    const q = raw as { passageRef: string; quote: string };
    if (
      !q ||
      !keys(q, 'passageRef,quote') ||
      !/^P[1-8]$/.test(q.passageRef) ||
      !text(q.quote, 512) ||
      q.quote.includes('\u0000') ||
      /[\uD800-\uDFFF]/u.test(q.quote)
    )
      throw surferFailure('Invalid meaning review quote.');
    const a = view.anchors[Number(q.passageRef.slice(1)) - 1],
      i = a?.rawLiteral.indexOf(q.quote) ?? -1;
    if (!a || i < 0 || a.rawLiteral.indexOf(q.quote, i + 1) >= 0)
      throw surferFailure('Review quote is absent or ambiguous.');
    const start = a.position.start + unicodeLength(a.rawLiteral.slice(0, i)),
      end = start + unicodeLength(q.quote);
    if (unicodeSlice(a.rawLiteral, start - a.position.start, end - a.position.start) !== q.quote)
      throw surferFailure('Review quote splits Unicode.');
    const id = [a.anchorId, start, end].join(':');
    if (seen.has(id)) throw surferFailure('Repeated review quote.');
    seen.add(id);
    return {
      sourceId: a.source.sourceId,
      sourceVersionId: a.source.sourceVersionId,
      evidenceId: a.source.evidenceId,
      revisionId: a.source.revisionId,
      anchorDigest: a.digest,
      start,
      end,
      quote: q.quote,
    };
  });
}

/** Verifies only quoted Source positions and output shape, never semantic correctness. */
export function groundSurferMeaningVerification(
  value: unknown,
  view: SurferCognitiveView,
): SurferMeaningVerificationFindings {
  assertSurferJson(value);
  const w = value as Record<string, unknown>;
  if (
    !w ||
    !keys(
      w,
      'counter,documentRole,facets,reason,relation,roleCitations,support,typeAssessment,unitAssessment',
    ) ||
    JSON.stringify(w).length > 12000 ||
    !['EQUIVALENT', 'DISTINCT', 'RELATED', 'UNRESOLVED'].includes(w.relation as string) ||
    !['MATCH', 'MISMATCH', 'UNRESOLVED'].includes(w.typeAssessment as string) ||
    !['MATCH', 'MISMATCH', 'UNRESOLVED'].includes(w.unitAssessment as string) ||
    !['DEFINITION', 'NORMATIVE', 'OBSERVATION', 'EXAMPLE', 'UNRESOLVED'].includes(
      w.documentRole as string,
    ) ||
    !text(w.reason, 512) ||
    !w.facets ||
    typeof w.facets !== 'object' ||
    !keys(w.facets, 'condition,exception,subject,time')
  )
    throw surferFailure('Invalid meaning verification findings.');
  const quotes = (input: unknown) => groundMeaningQuotes(input, view);
  const facets = {} as SurferMeaningVerificationFindings['facets'];
  for (const k of ['subject', 'time', 'condition', 'exception'] as const) {
    const f = (w.facets as Record<string, { state: string; reason: string; quotes: unknown }>)[k];
    if (
      !f ||
      !keys(f, 'quotes,reason,state') ||
      !['STATED', 'UNSTATED', 'AMBIGUOUS'].includes(f.state) ||
      !text(f.reason)
    )
      throw surferFailure('Invalid meaning scope finding.');
    const cited = quotes(f.quotes);
    if (f.state === 'STATED' ? !cited.length : f.state === 'UNSTATED' && cited.length > 0)
      throw surferFailure('Scope state differs from its quotes.');
    facets[k] = {
      state: f.state as 'STATED' | 'UNSTATED' | 'AMBIGUOUS',
      reason: f.reason,
      quotes: cited,
    };
  }
  const support = quotes(w.support),
    counter = quotes(w.counter),
    roleCitations = quotes(w.roleCitations);
  if (
    (w.documentRole !== 'UNRESOLVED' && !roleCitations.length) ||
    (w.relation === 'DISTINCT' && !counter.length) ||
    (w.relation === 'EQUIVALENT' &&
      (!support.length ||
        new Set(support.map((s) => s.sourceId)).size < 2 ||
        new Set(
          support.map((s) =>
            s.quote
              .normalize('NFKC')
              .replace(/\s+/gu, ' ')
              .trim()
              .replace(/[.!。]$/u, ''),
          ),
        ).size < 2))
  )
    throw surferFailure('Meaning review lacks separately quoted support or counterevidence.');
  return {
    relation: w.relation as SurferMeaningVerificationFindings['relation'],
    typeAssessment: w.typeAssessment as 'MATCH' | 'MISMATCH' | 'UNRESOLVED',
    unitAssessment: w.unitAssessment as 'MATCH' | 'MISMATCH' | 'UNRESOLVED',
    documentRole: w.documentRole as SurferMeaningVerificationFindings['documentRole'],
    roleCitations,
    facets,
    support,
    counter,
    reason: w.reason,
  };
}

/** Anchors model-declared evidence categories; does not certify their semantics. */
export function groundSurferMeaningVerificationV2(
  value: unknown,
  view: SurferCognitiveView,
): SurferMeaningVerificationFindingsV2 {
  assertSurferJson(value);
  const w = value as Record<string, unknown>;
  if (
    !w ||
    !keys(
      w,
      'counter,documentRole,facets,reason,relation,relationBasis,roleCitations,support,typeAssessment,typeCitations,unitAssessment,unitCitations',
    ) ||
    JSON.stringify(w).length > 12000 ||
    ![
      'EXPLICIT_TERM_RELATION',
      'OBSERVATION_ONLY',
      'COOCCURRENCE_ONLY',
      'NAME_INFERENCE_ONLY',
      'UNRESOLVED',
    ].includes(w.relationBasis as string) ||
    !Array.isArray(w.counter) ||
    w.counter.length > 4
  )
    throw surferFailure('Invalid v2 meaning review evidence categories.');
  const counterKinds: SurferMeaningVerificationFindingsV2['counterKinds'] = [];
  const counter = w.counter.map((raw: unknown) => {
    const q = raw as {
      passageRef: string;
      quote: string;
      kind: SurferMeaningVerificationFindingsV2['counterKinds'][number];
    };
    if (
      !q ||
      !keys(q, 'kind,passageRef,quote') ||
      !['SEMANTIC_CONTRADICTION', 'SCOPE_LIMITATION', 'UNRESOLVED'].includes(q.kind)
    )
      throw surferFailure('Invalid v2 counter classification.');
    counterKinds.push(q.kind);
    return { passageRef: q.passageRef, quote: q.quote };
  });
  const { relationBasis, typeCitations, unitCitations, ...legacy } = w;
  const findings = groundSurferMeaningVerification({ ...legacy, counter }, view),
    types = groundMeaningQuotes(typeCitations, view),
    units = groundMeaningQuotes(unitCitations, view);
  if (
    (findings.typeAssessment !== 'UNRESOLVED' && !types.length) ||
    (findings.unitAssessment !== 'UNRESOLVED' && !units.length)
  )
    throw surferFailure('Type/unit assessment has no quoted Source basis.');
  return {
    ...findings,
    relationBasis: relationBasis as SurferMeaningVerificationFindingsV2['relationBasis'],
    typeCitations: types,
    unitCitations: units,
    counterKinds,
  };
}

/** Consistency limits only. Original model findings remain unchanged in the receipt. */
export function assessSurferMeaningVerificationV2(findings: SurferMeaningVerificationFindingsV2): {
  assessment: SurferMeaningVerificationResult['assessment'];
  interpretationLimits: string[];
} {
  const interpretationLimits: string[] = [];
  if (findings.relationBasis !== 'EXPLICIT_TERM_RELATION')
    interpretationLimits.push('RELATION_NOT_EXPLICITLY_ESTABLISHED');
  if (!['DEFINITION', 'NORMATIVE'].includes(findings.documentRole))
    interpretationLimits.push('ROLE_NOT_TERM_AUTHORITY');
  if (findings.counterKinds.includes('UNRESOLVED'))
    interpretationLimits.push('UNRESOLVED_COUNTER_KIND');
  const scopeQuotes = Object.values(findings.facets).flatMap((f) =>
    f.state === 'STATED' ? f.quotes : [],
  );
  if (
    findings.counter.some(
      (q, i) =>
        findings.counterKinds[i] === 'SCOPE_LIMITATION' &&
        !scopeQuotes.some(
          (s) => s.anchorDigest === q.anchorDigest && s.start === q.start && s.end === q.end,
        ),
    )
  )
    interpretationLimits.push('SCOPE_COUNTER_NOT_BOUND_TO_STATED_FACET');
  const semanticCounter = findings.counterKinds.includes('SEMANTIC_CONTRADICTION');
  if (findings.relation === 'DISTINCT' && !semanticCounter)
    interpretationLimits.push('DISTINCTION_WITHOUT_SEMANTIC_COUNTER');
  if (
    findings.typeAssessment === 'MISMATCH' ||
    findings.unitAssessment === 'MISMATCH' ||
    semanticCounter
  )
    return { assessment: 'MODEL_CONTRADICTED_UNVERIFIED', interpretationLimits };
  return {
    assessment:
      !interpretationLimits.length &&
      findings.relation === 'EQUIVALENT' &&
      findings.typeAssessment === 'MATCH' &&
      findings.unitAssessment === 'MATCH' &&
      !Object.values(findings.facets).some((f) => f.state === 'AMBIGUOUS')
        ? 'MODEL_SUPPORTED_UNVERIFIED'
        : 'MODEL_UNRESOLVED',
    interpretationLimits,
  };
}

/** V4 withholds an unsupported axis without discarding the rest of the exact Source review. */
export function groundSurferMeaningVerificationV4(
  value: unknown,
  view: SurferCognitiveView,
  targetUnit: string | null,
) {
  return groundMeaningScopeReview(value, view, targetUnit, false);
}

/** Combines exact spans in one anchor, with an optional attached Korean topic particle. */
function hasCompositeFacetCoverage(
  scope: Citation,
  facets: SurferMeaningVerificationFindings['facets'],
  allowTopicParticle: boolean,
): boolean {
  const parts = Object.entries(facets).flatMap(([kind, facet]) =>
    facet.state === 'STATED'
      ? facet.quotes
          .filter(
            (q) =>
              q.anchorDigest === scope.anchorDigest && q.start >= scope.start && q.end <= scope.end,
          )
          .map((q) => ({ kind, start: q.start, end: q.end }))
      : [],
  );
  if (new Set(parts.map((q) => q.kind)).size < 2) return false;
  const span = (start: number, end: number) =>
    unicodeSlice(scope.quote, start - scope.start, end - scope.start);
  const separators = /^[\s(),:;]*$/u;
  const subjectsEndAt = new Set(
    parts.filter((part) => part.kind === 'subject').map((part) => part.end),
  );
  const conditionsStartAt = new Set(
    parts.filter((part) => part.kind === 'condition').map((part) => part.start),
  );
  let end = scope.start;
  let usedTopicParticle = false;
  for (const part of parts.sort((a, b) => a.start - b.start)) {
    if (part.start > end) {
      const gap = span(end, part.start);
      if (!separators.test(gap)) {
        if (
          !allowTopicParticle ||
          usedTopicParticle ||
          !subjectsEndAt.has(end) ||
          !conditionsStartAt.has(part.start) ||
          !/^[은는][ \t]+$/u.test(gap)
        )
          return false;
        const subjectLastSyllable = span(end - 1, end).charCodeAt(0);
        const firstHangulSyllable = '가'.charCodeAt(0);
        if (
          subjectLastSyllable < firstHangulSyllable ||
          subjectLastSyllable > '힣'.charCodeAt(0) ||
          gap[0] !== ((subjectLastSyllable - firstHangulSyllable) % 28 === 0 ? '는' : '은') ||
          !/^[가-힣]$/u.test(span(part.start, part.start + 1))
        )
          return false;
        usedTopicParticle = true;
      }
    }
    end = Math.max(end, part.end);
  }
  return separators.test(span(end, scope.end));
}

/** Pairs identical facet text within each of the two anchors being compared. */
function hasPairedScopeFacets(
  scopeQuotes: Citation[],
  facets: SurferMeaningVerificationFindings['facets'],
): boolean {
  const anchors = new Set(scopeQuotes.map((quote) => quote.anchorDigest));
  if (anchors.size !== 2 || new Set(scopeQuotes.map((quote) => quote.sourceId)).size !== 2)
    return false;
  return Object.values(facets).every(
    (facet) =>
      facet.state !== 'AMBIGUOUS' &&
      facet.quotes.every(
        (quote) =>
          anchors.has(quote.anchorDigest) &&
          facet.quotes.some(
            (other) =>
              other.sourceId !== quote.sourceId &&
              anchors.has(other.anchorDigest) &&
              other.quote === quote.quote,
          ),
      ),
  );
}

type NumericMeaningTarget = {
  label: string;
  field: SurferMeaningVerificationWork['target']['field'];
  completeEvidence?: boolean;
};

function numericValueStatements(
  findings: SurferMeaningVerificationFindingsV2,
  target: NumericMeaningTarget,
  allowScopeReference = false,
): { statement: Citation; valueAndUnit: string }[] {
  if (target.field.type !== 'NUMBER' || !target.field.unit || findings.documentRole !== 'NORMATIVE')
    return [];
  const escape = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const valueStatement = new RegExp(
    (allowScopeReference ? '^(?:위 조건의 )?' : '^') +
      `(?:${escape(target.label)}|${escape(target.field.name)})(?:은|는|을|를)[ \\t]+` +
      `([+-]?\\d+(?:\\.\\d+)?[ \\t]+${escape(target.field.unit)})` +
      '(?:이다|(?:으)?로[ \\t]+(?:유지한다|설정한다|맞춘다))' +
      (allowScopeReference ? '\\.?(?![\\s\\S])' : '$'),
    'u',
  );
  return findings.roleCitations.flatMap((statement) => {
    if (
      !findings.support.some(
        (quote) => citationContains(quote, statement) && citationContains(statement, quote),
      )
    )
      return [];
    const valueAndUnit = valueStatement.exec(statement.quote)?.[1];
    return valueAndUnit ? [{ statement, valueAndUnit }] : [];
  });
}

/** Separates a bounded value statement only when exact stated facets cover the remaining words. */
function splitValueAndScope(
  scope: Citation,
  facets: SurferMeaningVerificationFindings['facets'],
  statements: ReturnType<typeof numericValueStatements>,
): { qualifiers: Citation[]; statement: Citation; valueAndUnit: string } | undefined {
  const qualifiers = Object.values(facets).flatMap((facet) =>
    facet.state === 'STATED' ? facet.quotes.filter((quote) => citationContains(scope, quote)) : [],
  );
  if (!qualifiers.length) return;
  const candidates = statements.filter(
    ({ statement }) =>
      citationContains(scope, statement) &&
      !qualifiers.some((quote) => quote.start < statement.end && statement.start < quote.end),
  );
  if (candidates.length !== 1) return;
  const candidate = candidates[0]!;
  const parts = [...qualifiers, candidate.statement].sort((a, b) => a.start - b.start);
  let end = scope.start;
  const separatorOnly = (start: number, finish: number) =>
    /^[\s(),:;.]*$/u.test(unicodeSlice(scope.quote, start - scope.start, finish - scope.start));
  for (const part of parts) {
    if (part.start > end && !separatorOnly(end, part.start)) return;
    end = Math.max(end, part.end);
  }
  if (separatorOnly(end, scope.end)) return { qualifiers, ...candidate };
}

function groundRepeatedUnit(
  input: unknown,
  view: SurferCognitiveView,
  candidates: ReturnType<typeof numericValueStatements>,
): Citation[] | undefined {
  if (!Array.isArray(input) || !input.length || input.length > 4) return;
  const quotes = input.map((raw: unknown) => {
    const q = raw as { passageRef: string; quote: string };
    if (
      !q ||
      !keys(q, 'passageRef,quote') ||
      typeof q.passageRef !== 'string' ||
      !/^P[1-8]$/.test(q.passageRef) ||
      !text(q.quote, 512)
    )
      return raw;
    const anchor = view.anchors[Number(q.passageRef.slice(1)) - 1];
    if (!anchor) return raw;
    const start = anchor.rawLiteral.indexOf(q.quote);
    if (start < 0 || anchor.rawLiteral.indexOf(q.quote, start + 1) < 0) return raw;
    const statements = new Set(
      candidates
        .filter(
          ({ statement, valueAndUnit }) =>
            statement.anchorDigest === anchor.digest && valueAndUnit === q.quote,
        )
        .map(({ statement }) => statement.quote),
    );
    return statements.size === 1 ? { ...q, quote: [...statements][0] } : raw;
  });
  try {
    return groundMeaningQuotes(quotes, view);
  } catch {
    return undefined;
  }
}

function separateScopeUnits(
  statements: ReturnType<typeof numericValueStatements>,
  findings: SurferMeaningVerificationFindingsV2,
  scope: Citation[],
  view: SurferCognitiveView,
): ReturnType<typeof numericValueStatements> {
  const { condition, exception } = findings.facets;
  if (condition.state !== 'STATED') return [];
  return statements.filter(({ statement }) => {
    if (
      !scope.some((quote) => quote.anchorDigest === statement.anchorDigest) ||
      exception.state === 'AMBIGUOUS' ||
      exception.quotes.some(
        (quote) =>
          quote.anchorDigest === statement.anchorDigest &&
          quote.start < statement.end &&
          statement.start < quote.end,
      )
    )
      return false;
    const anchor = view.anchors.find((item) => item.digest === statement.anchorDigest);
    if (!anchor) return false;
    const offset = anchor.position.start;
    const following = unicodeSlice(
      anchor.rawLiteral,
      statement.end - offset,
      unicodeLength(anchor.rawLiteral),
    );
    return (
      (!following || /^\.(?:\s|$)/u.test(following)) &&
      condition.quotes.some(
        (quote) =>
          quote.anchorDigest === statement.anchorDigest &&
          quote.end <= statement.start &&
          scope.some((comparison) => citationContains(comparison, quote)) &&
          /^[ \t]+$/u.test(
            unicodeSlice(anchor.rawLiteral, quote.end - offset, statement.start - offset),
          ),
      )
    );
  });
}

/** Recovers the equipment name from an exact condition explicitly referenced by the value. */
function pairedValueSubjects(
  findings: SurferMeaningVerificationFindingsV2,
  scope: Citation[],
  target: NumericMeaningTarget,
  view: SurferCognitiveView,
): Citation[] | undefined {
  const { subject, condition } = findings.facets;
  if (subject.state !== 'STATED' || subject.quotes.length !== 2 || condition.state !== 'STATED')
    return;
  const statements = numericValueStatements(findings, target, true);
  const names = subject.quotes.flatMap((quote) => {
    const value = statements.find(({ statement }) => citationContains(statement, quote))?.statement;
    const prefix = '위 조건의 ';
    if (!value?.quote.startsWith(prefix)) return [];
    const name = [target.field.name, target.label].find(
      (label) =>
        /^[은는을를][ \t]/u.test(value.quote.slice(prefix.length + label.length)) &&
        value.quote.startsWith(prefix + label),
    );
    const labelStart = value.start + unicodeLength(prefix);
    if (!name || quote.start > labelStart || quote.end < labelStart + unicodeLength(name))
      return [];
    const anchor = view.anchors.find((item) => item.digest === value.anchorDigest);
    if (!anchor) return [];
    const offset = anchor.position.start;
    const candidates = condition.quotes.flatMap((part) => {
      if (
        part.anchorDigest !== quote.anchorDigest ||
        part.end > value.start ||
        !scope.some((comparison) => citationContains(comparison, part))
      )
        return [];
      const equipment = /^([가-힣]+ [A-Za-z][A-Za-z0-9]*-[0-9]+),/u.exec(part.quote)?.[1];
      if (!equipment) return [];
      const exception = findings.facets.exception;
      const intervening =
        exception.state === 'STATED'
          ? exception.quotes
              .filter(
                (item) =>
                  item.anchorDigest === quote.anchorDigest &&
                  item.start >= part.end &&
                  item.end <= value.start,
              )
              .sort((a, b) => a.start - b.start)
          : [];
      let end = part.end;
      const separators = (start: number, finish: number) =>
        /^[\s.-]*$/u.test(unicodeSlice(anchor.rawLiteral, start - offset, finish - offset));
      for (const item of intervening) {
        if (item.start > end && !separators(end, item.start)) return [];
        end = Math.max(end, item.end);
      }
      if (!separators(end, value.start)) return [];
      return [{ ...part, end: part.start + unicodeLength(equipment), quote: equipment }];
    });
    return candidates.length === 1 ? candidates : [];
  });
  if (
    names.length === 2 &&
    names[0]!.quote === names[1]!.quote &&
    names[0]!.sourceId !== names[1]!.sourceId
  )
    return names;
}

function groundMeaningScopeReview(
  value: unknown,
  view: SurferCognitiveView,
  targetUnit: string | null,
  composite: boolean,
  allowTopicParticle = false,
  completeSameScope = false,
  numericTarget?: NumericMeaningTarget,
  maximumScopeQuotes = numericTarget?.completeEvidence ? MAX_V12_SCOPE_QUOTES : 4,
): {
  findings: SurferMeaningVerificationFindingsV2;
  assessment: SurferMeaningVerificationResult['assessment'];
  interpretationLimits: string[];
  scopeEvidence?: MeaningScopeEvidence;
} {
  assertSurferJson(value);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(value).length > 12000
  )
    throw surferFailure('Invalid v4 meaning review.');
  const { scopeComparison, ...wire } = value as Record<string, unknown>;
  const scope = scopeComparison as { state: MeaningScopeEvidence['state']; quotes: unknown } | null;
  if (
    !scope ||
    !keys(scope, 'quotes,state') ||
    !['SAME_SCOPE', 'DIFFERENT_SCOPE', 'NOT_ESTABLISHED'].includes(scope.state)
  )
    throw surferFailure('Invalid v4 scope comparison.');
  const completeEvidence = numericTarget?.completeEvidence === true;
  const scopeQuotes = groundMeaningQuotes(scope.quotes, view, maximumScopeQuotes);
  if (
    scope.state === 'NOT_ESTABLISHED'
      ? scopeQuotes.length !== 0
      : new Set(scopeQuotes.map((quote) => quote.sourceId)).size < 2
  )
    throw surferFailure('Scope comparison needs exact citations from both sources.');

  const limits: string[] = [];
  const reportedUnit = wire.unitAssessment;
  const reportedUnitCitations = wire.unitCitations;
  const withholdAxis = (axis: 'type' | 'unit') => {
    const assessmentKey = axis === 'type' ? 'typeAssessment' : 'unitAssessment';
    const citationKey = axis === 'type' ? 'typeCitations' : 'unitCitations';
    const claim = wire[assessmentKey];
    if (!['MATCH', 'MISMATCH', 'UNRESOLVED'].includes(claim as string))
      throw surferFailure('Unknown v4 type or unit assessment.');
    let citations: Citation[];
    try {
      citations = groundMeaningQuotes(wire[citationKey], view);
    } catch {
      citations = [];
      limits.push(axis === 'type' ? 'TYPE_CITATION_UNGROUNDED' : 'UNIT_CITATION_UNGROUNDED');
      wire[citationKey] = [];
    }
    if (claim === 'UNRESOLVED') return;
    if (axis === 'unit' && targetUnit === null) {
      limits.push('TARGET_UNIT_UNSPECIFIED');
      wire[assessmentKey] = 'UNRESOLVED';
    } else if (!citations.length) {
      const code = axis === 'type' ? 'TYPE_CITATION_UNGROUNDED' : 'UNIT_CITATION_UNGROUNDED';
      if (!limits.includes(code)) limits.push(code);
      wire[assessmentKey] = 'UNRESOLVED';
    }
  };
  withholdAxis('type');
  withholdAxis('unit');
  const findings = groundSurferMeaningVerificationV2(wire, view);
  const statements = numericTarget ? numericValueStatements(findings, numericTarget) : [];
  const facets = Object.values(findings.facets).flatMap((facet) =>
    facet.state === 'STATED' ? facet.quotes : [],
  );
  const splits: NonNullable<ReturnType<typeof splitValueAndScope>>[] = [];
  const comparisonQuotes = scopeQuotes.flatMap((scopeQuote) => {
    if (
      (composite &&
        hasCompositeFacetCoverage(
          scopeQuote,
          findings.facets,
          allowTopicParticle && scope.state === 'SAME_SCOPE',
        )) ||
      facets.some((facet) => citationContains(facet, scopeQuote))
    )
      return [scopeQuote];
    const split =
      numericTarget && scope.state === 'DIFFERENT_SCOPE'
        ? splitValueAndScope(scopeQuote, findings.facets, statements)
        : undefined;
    if (!split) throw surferFailure('Scope comparison citation does not belong to a stated facet.');
    splits.push(split);
    return split.qualifiers;
  });
  if (splits.length) {
    const distinctQualifier = (['time', 'condition', 'exception'] as const).some((key) => {
      const facet = findings.facets[key];
      if (facet.state !== 'STATED') return false;
      const quotes = facet.quotes.filter((quote) =>
        comparisonQuotes.some((comparison) => citationContains(comparison, quote)),
      );
      return quotes.some((quote) => {
        const others = quotes.filter((other) => other.sourceId !== quote.sourceId);
        return others.length > 0 && others.every((other) => other.quote !== quote.quote);
      });
    });
    if (!distinctQualifier)
      throw surferFailure('Different scopes need a distinguishing qualifier.');
  }
  const unitLimit = limits.indexOf('UNIT_CITATION_UNGROUNDED');
  if (reportedUnit === 'MATCH' && unitLimit >= 0) {
    const candidates = completeEvidence
      ? [...splits, ...separateScopeUnits(statements, findings, comparisonQuotes, view)]
      : splits;
    const citations = candidates.length
      ? groundRepeatedUnit(reportedUnitCitations, view, candidates)
      : undefined;
    if (citations?.length) {
      findings.unitAssessment = 'MATCH';
      findings.unitCitations = citations;
      limits.splice(unitLimit, 1);
    }
  }
  const scopedSources = new Set(facets.map((quote) => quote.sourceId));
  const semanticCounter = findings.counterKinds.includes('SEMANTIC_CONTRADICTION');
  const identicalComparison =
    scope.state === 'SAME_SCOPE' &&
    scopeQuotes.every((quote) =>
      scopeQuotes.some((other) => other.sourceId !== quote.sourceId && other.quote === quote.quote),
    );
  const subjectNames =
    completeEvidence && identicalComparison && numericTarget
      ? pairedValueSubjects(findings, comparisonQuotes, numericTarget, view)
      : undefined;
  const pairedScopeFacets = subjectNames
    ? { ...findings.facets, subject: { ...findings.facets.subject, quotes: subjectNames } }
    : findings.facets;
  const pairedFacets =
    !completeSameScope ||
    (identicalComparison && hasPairedScopeFacets(scopeQuotes, pairedScopeFacets));
  if (completeSameScope && pairedFacets) {
    for (const key of ['time', 'exception'] as const) {
      for (const quote of findings.facets[key].quotes) {
        if (!comparisonQuotes.some((existing) => citationContains(existing, quote)))
          comparisonQuotes.push(quote);
      }
    }
  }
  const sharedScope =
    identicalComparison &&
    pairedFacets &&
    (!composite ||
      facets.every(
        (facet) =>
          (subjectNames && findings.facets.subject.quotes.includes(facet)) ||
          comparisonQuotes.some((quote) => citationContains(quote, facet)),
      ));
  if (sharedScope && subjectNames) {
    findings.facets = pairedScopeFacets;
    limits.push('SUBJECT_FROM_SCOPE_REFERENCED_VALUE');
  }
  const crossScope =
    scope.state === 'DIFFERENT_SCOPE' ||
    (!sharedScope &&
      (scope.state === 'SAME_SCOPE' ||
        ((composite || scopedSources.size >= 2) && semanticCounter)));
  if (crossScope)
    limits.push(
      scope.state === 'DIFFERENT_SCOPE'
        ? 'DIFFERENT_SOURCE_SCOPES'
        : 'COUNTER_SAME_SCOPE_UNESTABLISHED',
    );
  const assessed = assessSurferMeaningVerificationV2(findings);
  return {
    findings,
    assessment:
      crossScope || (limits.length > 0 && assessed.assessment === 'MODEL_SUPPORTED_UNVERIFIED')
        ? 'MODEL_UNRESOLVED'
        : assessed.assessment,
    interpretationLimits: [...assessed.interpretationLimits, ...limits],
    ...(composite
      ? {
          scopeEvidence: {
            state: scope.state === 'SAME_SCOPE' && !sharedScope ? 'NOT_ESTABLISHED' : scope.state,
            basis: 'MODEL_CITATIONS' as const,
            quotes: scope.state === 'SAME_SCOPE' && !sharedScope ? [] : comparisonQuotes,
          },
        }
      : {}),
  };
}

/** Same-name values tied to distinct station records are retained as separate observations. */
export function groundSurferMeaningVerificationV5(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
  maximumScopeQuotes = 4,
): ReturnType<typeof groundSurferMeaningVerificationV4> & {
  scopedDatumComparison?: ScopedDatumComparison;
} {
  const observations = scopedDatumObservations(view, target, label);
  if (!observations.length)
    return groundSurferMeaningVerificationV4(value, view, target.field.unit);
  assertSurferJson(value);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw surferFailure('Invalid scoped datum review.');
  const wire = value as Record<string, unknown>;
  const reportedRelation = wire.relation as SurferMeaningVerificationFindings['relation'];
  if (!['EQUIVALENT', 'DISTINCT', 'RELATED', 'UNRESOLVED'].includes(reportedRelation))
    throw surferFailure('Invalid scoped datum relation.');
  const grounded = groundMeaningScopeReview(
    { ...wire, relation: 'UNRESOLVED' },
    view,
    target.field.unit,
    false,
    false,
    false,
    undefined,
    maximumScopeQuotes,
  );
  return {
    ...grounded,
    assessment: 'MODEL_UNRESOLVED',
    interpretationLimits: [...grounded.interpretationLimits, 'DISTINCT_STATION_DATUM_SCOPES'],
    scopedDatumComparison: { reportedRelation, observations },
  };
}

/** Grounds composite scope and stores exact table rows without promoting them to knowledge. */
export function groundSurferMeaningVerificationV6(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): ReturnType<typeof groundSurferMeaningVerificationV5> & {
  scopedTableObservations?: ScopedTableObservation[];
} {
  return groundScopeWithTable(value, view, target, label, false);
}

function groundScopeWithTable(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
  allowTopicParticle: boolean,
  completeSameScope = false,
  numericTarget?: NumericMeaningTarget,
): ReturnType<typeof groundSurferMeaningVerificationV6> {
  if (scopedDatumObservations(view, target, label).length)
    return groundSurferMeaningVerificationV5(
      value,
      view,
      target,
      label,
      numericTarget?.completeEvidence ? MAX_V12_SCOPE_QUOTES : 4,
    );
  const grounded = groundMeaningScopeReview(
    value,
    view,
    target.field.unit,
    true,
    allowTopicParticle,
    completeSameScope,
    numericTarget,
  );
  const records = scopedTableObservations(view, target, label);
  if (!records.length) return grounded;
  return {
    ...grounded,
    assessment: 'MODEL_UNRESOLVED',
    interpretationLimits: [...grounded.interpretationLimits, 'DISTINCT_TABLE_ROW_SCOPES'],
    scopeEvidence: {
      state: 'DIFFERENT_SCOPE',
      basis: 'EXACT_TABLE_ROWS',
      quotes: records.map((record) => record.rowCitation),
    },
    scopedTableObservations: records,
  };
}

/** Restores the exact operating phase attached to a grounded valve condition. */
export function groundSurferMeaningVerificationV7(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): ReturnType<typeof groundSurferMeaningVerificationV6> {
  return groundOperatingScope(value, view, target, label, false);
}

export function groundSurferMeaningVerificationV8(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): ReturnType<typeof groundSurferMeaningVerificationV6> {
  return groundOperatingScope(value, view, target, label, true);
}

function groundOperatingScope(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
  allowTopicParticle: boolean,
  completeSameScope = false,
  numericTarget?: NumericMeaningTarget,
): ReturnType<typeof groundSurferMeaningVerificationV6> {
  const grounded = groundScopeWithTable(
    value,
    view,
    target,
    label,
    allowTopicParticle,
    completeSameScope,
    numericTarget,
  );
  const scope = grounded.scopeEvidence;
  if (
    scope?.basis !== 'MODEL_CITATIONS' ||
    scope.state !== 'DIFFERENT_SCOPE' ||
    scope.quotes.length !== 2 ||
    view.anchors.length !== 2 ||
    view.anchors[0]!.source.sourceId === view.anchors[1]!.source.sourceId ||
    target.field.type !== 'NUMBER' ||
    !target.field.unit ||
    target.field.name !== label
  )
    return grounded;

  const statement =
    /^(?<clause>(?<phase>[가-힣]+(?: [가-힣]+){0,3}) 단계에서 (?<condition>우회 밸브가 (?:열린|닫힌) 경우)) (?<pump>펌프 [A-Za-z0-9-]{1,32})의 (?<term>[\p{L}\p{N}_ -]{1,64}?)(?:은|는) -?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,18})? (?<unit>[^\s]{1,32}?)(?:으로|로) 설정한다\.$/u;
  const [first, second] = view.anchors.map((anchor) => statement.exec(anchor.rawLiteral)?.groups);
  if (
    !first ||
    !second ||
    first.pump !== second.pump ||
    first.phase === second.phase ||
    first.condition === second.condition ||
    [first, second].some((part) => part.term !== label || part.unit !== target.field.unit)
  )
    return grounded;

  const clauses = [first, second];
  const modelQuotes = view.anchors.map((anchor) =>
    scope.quotes.find((quote) => quote.anchorDigest === anchor.digest),
  );
  if (
    !modelQuotes.every(
      (quote, index) =>
        quote && [clauses[index]!.condition, clauses[index]!.clause].includes(quote.quote),
    ) ||
    modelQuotes.every((quote, index) => quote?.quote === clauses[index]!.clause)
  )
    return grounded;

  const quotes = groundMeaningQuotes(
    clauses.map((part, index) => ({ passageRef: 'P' + (index + 1), quote: part.clause })),
    view,
  );
  return {
    ...grounded,
    scopeEvidence: { ...scope, basis: 'EXACT_OPERATING_CLAUSES', quotes },
    interpretationLimits: [...grounded.interpretationLimits, 'OPERATING_PHASE_FROM_SOURCE'],
  };
}

function citationContains(outer: Citation, inner: Citation): boolean {
  return (
    outer.anchorDigest === inner.anchorDigest &&
    outer.start <= inner.start &&
    outer.end >= inner.end
  );
}

/** Preserves anchored qualifiers and distinguishes scope limits from unresolved counter evidence. */
type GroundedScopeReview = ReturnType<typeof groundSurferMeaningVerificationV8> & {
  reportedCounterKinds?: SurferMeaningVerificationFindingsV2['counterKinds'];
};

export function groundSurferMeaningVerificationV9(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): GroundedScopeReview {
  return groundDifferentScopeCounters(
    groundSurferMeaningVerificationV8(value, view, target, label),
  );
}

export function groundSurferMeaningVerificationV10(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): GroundedScopeReview {
  return groundPairedScopeCounters(groundOperatingScope(value, view, target, label, true, true));
}

export function groundSurferMeaningVerificationV11(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): GroundedScopeReview {
  return checkStoredScopeCount(
    groundPairedScopeCounters(
      groundOperatingScope(value, view, target, label, true, true, { field: target.field, label }),
    ),
  );
}

export function groundSurferMeaningVerificationV12(
  value: unknown,
  view: SurferCognitiveView,
  target: SurferMeaningVerificationWork['target'],
  label: string,
): GroundedScopeReview {
  return checkStoredScopeCount(
    groundPairedScopeCounters(
      groundOperatingScope(value, view, target, label, true, true, {
        field: target.field,
        label,
        completeEvidence: true,
      }),
      true,
    ),
  );
}

function checkStoredScopeCount(grounded: GroundedScopeReview): GroundedScopeReview {
  if (
    grounded.scopeEvidence?.basis === 'MODEL_CITATIONS' &&
    grounded.scopeEvidence.quotes.length > 12
  )
    throw surferFailure('Too many grounded scope citations.');
  return grounded;
}

function groundPairedScopeCounters(
  review: GroundedScopeReview,
  includeExceptions = false,
): GroundedScopeReview {
  const grounded = groundDifferentScopeCounters(review, includeExceptions);
  if (grounded.scopeEvidence?.state !== 'NOT_ESTABLISHED') return grounded;
  return recordCounterKinds(
    grounded,
    grounded.findings.counterKinds.map((kind) =>
      kind === 'SEMANTIC_CONTRADICTION' ? 'UNRESOLVED' : kind,
    ),
  );
}

function groundDifferentScopeCounters(
  grounded: GroundedScopeReview,
  includeExceptions = false,
): GroundedScopeReview {
  const scope = grounded.scopeEvidence;
  if (scope?.state !== 'DIFFERENT_SCOPE') return grounded;

  const { findings } = grounded;
  const statedQuotes = (facet: 'time' | 'condition' | 'exception') =>
    findings.facets[facet].state === 'STATED' ? findings.facets[facet].quotes : [];
  const qualifiers = [...statedQuotes('time'), ...statedQuotes('condition')];
  const allQualifiers = [...qualifiers, ...statedQuotes('exception')];
  const comparedAnchors = new Set(scope.quotes.map((quote) => quote.anchorDigest));
  const combined =
    scope.basis === 'MODEL_CITATIONS'
      ? [
          ...scope.quotes,
          ...(includeExceptions ? allQualifiers : qualifiers).filter((quote) =>
            comparedAnchors.has(quote.anchorDigest),
          ),
        ]
      : scope.quotes;
  const quotes = combined.filter(
    (quote, index) =>
      !combined.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          citationContains(other, quote) &&
          (other.start < quote.start || other.end > quote.end || otherIndex < index),
      ),
  );

  const hasDistinctQuotes = scope.quotes.some(
    (quote) =>
      !scope.quotes.some(
        (other) => other.sourceId !== quote.sourceId && other.quote === quote.quote,
      ),
  );
  const counterKinds = findings.counterKinds.map((kind, index) => {
    if (kind !== 'SEMANTIC_CONTRADICTION') return kind;
    const counter = findings.counter[index]!;
    const bound =
      hasDistinctQuotes &&
      allQualifiers.some((qualifier) =>
        quotes.some(
          (quote) =>
            (citationContains(quote, counter) && citationContains(qualifier, counter)) ||
            (citationContains(quote, qualifier) && citationContains(counter, qualifier)),
        ),
      );
    return bound ? 'SCOPE_LIMITATION' : 'UNRESOLVED';
  });
  return recordCounterKinds({ ...grounded, scopeEvidence: { ...scope, quotes } }, counterKinds);
}

function recordCounterKinds(
  grounded: GroundedScopeReview,
  counterKinds: SurferMeaningVerificationFindingsV2['counterKinds'],
): GroundedScopeReview {
  const { findings } = grounded;
  const changedCounters = counterKinds.some((kind, index) => kind !== findings.counterKinds[index]);
  const interpretationLimits =
    counterKinds.includes('UNRESOLVED') &&
    !grounded.interpretationLimits.includes('UNRESOLVED_COUNTER_KIND')
      ? [...grounded.interpretationLimits, 'UNRESOLVED_COUNTER_KIND']
      : grounded.interpretationLimits;
  return {
    ...grounded,
    interpretationLimits,
    ...(changedCounters
      ? {
          findings: { ...findings, counterKinds },
          reportedCounterKinds: findings.counterKinds,
        }
      : {}),
  };
}
