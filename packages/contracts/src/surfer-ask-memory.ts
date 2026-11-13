import {
  assertSurferAskMeaningReview,
  type SurferAskMeaningReview,
} from './surfer-ask-adoption.js';
import type { SurferArtifactRef } from './surfer-knowledge.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import { SURFER_ACTION_MODES } from './surfer-directive.js';
import { unicodeSlice } from './document-evidence.js';
import { assertSurferAskDiscoveryPin, type SurferAskDiscoveryPin } from './surfer-ask-discovery.js';
export type SurferAskPremiseGrounding = {
  revision:
    | 'surfer.ask-declared-field-clauses.v1'
    | 'surfer.ask-source-field-meanings.v1'
    | 'surfer.ask-reviewed-proposal-meanings.v1';
  reviews?: SurferAskMeaningReview[];
  questionDigest: string;
  bindings: {
    name: string;
    label?: string;
    syntax: 'ASSIGNMENT' | 'DECLARED_FIELD_CLAUSE';
    start: number;
    end: number;
    quote: string;
    literal: { start: number; end: number; quote: string };
  }[];
  sources?: SurferAskMemoryPacket['items'][number]['citations'];
  aliases?: {
    field: string;
    term: string;
    sourceIndex: number;
    lexiconDigest: string;
    status:
      'SOURCE_DECLARED' | 'UNSUPPORTED_SCOPE' | 'FIELD_CONTRACT_MISMATCH' | 'PROPOSAL_REJECTED';
  }[];
};
export type SurferAskRule = {
  memory: SurferArtifactRef;
  description: string;
  domain: string;
  state: 'ACTIVE' | 'QUARANTINED' | 'RETRACTED';
  qualification: {
    proofId: string;
    receiptDigest: string;
    reviewDigest: string;
    generationDigest: string;
    status: 'SCOPE_VALIDATED';
  };
  outcome: 'TRUE' | 'FALSE' | 'UNKNOWN';
  reasons: string[];
  fields: { name: string; type: 'NUMBER' | 'BOOLEAN' | 'TEXT'; unit: string | null }[];
  premises: { name: string; value: string | number | boolean; unit: string | null }[];
  citations: SurferAskMemoryPacket['items'][number]['citations'];
  grounding?: SurferAskPremiseGrounding;
};
export type SurferAskMemoryPacket = {
  storage: 'LEGACY' | 'ROWS';
  snapshot: { snapshotId: string; digest: string };
  sources: {
    sourceId: string;
    sourceVersionId: string;
    revisionId: string;
    indexingResultId: string;
  }[];
  items: {
    memory: SurferArtifactRef;
    subject: string;
    operation: string;
    declaredMode: string;
    citations: {
      evidenceId: string;
      sourceId: string;
      sourceVersionId: string;
      revisionId: string;
      quote: string;
    }[];
  }[];
  rules?: SurferAskRule[];
  discovery?: SurferAskDiscoveryPin;
};
/** Internal audit pin. The provider gets a deliberately smaller projection of this packet. */
export type SurferAskMemoryContext = {
  revision:
    | 'surfer.ask-memory.v1'
    | 'surfer.ask-memory.v2'
    | 'surfer.ask-memory.v3'
    | 'surfer.ask-memory.v4'
    | 'surfer.ask-memory.v5'
    | 'surfer.ask-memory.v6'
    | 'surfer.ask-memory.v7'
    | 'surfer.ask-memory.v8'
    | 'surfer.ask-memory.v9';
  baseContextDigest: string;
  packet: SurferAskMemoryPacket | null;
  digest: string;
};
const keys = (o: object, k: string) => Object.keys(o).sort().join(',') === k;
const text = (s: unknown, n = 256) => typeof s === 'string' && s.length > 0 && s.length <= n;
function validateSurferAskPremiseGrounding(input: unknown, names: string[]) {
  const g = input as SurferAskPremiseGrounding;
  const reviewed = g?.revision === 'surfer.ask-reviewed-proposal-meanings.v1';
  const meaning = reviewed || g?.revision === 'surfer.ask-source-field-meanings.v1';
  if (
    !g ||
    !keys(
      g,
      reviewed
        ? 'aliases,bindings,questionDigest,reviews,revision,sources'
        : meaning
          ? 'aliases,bindings,questionDigest,revision,sources'
          : 'bindings,questionDigest,revision',
    ) ||
    ![
      'surfer.ask-declared-field-clauses.v1',
      'surfer.ask-source-field-meanings.v1',
      'surfer.ask-reviewed-proposal-meanings.v1',
    ].includes(g.revision) ||
    !/^sha256:[a-f0-9]{64}$/.test(g.questionDigest) ||
    !Array.isArray(g.bindings) ||
    g.bindings.length > 8 ||
    JSON.stringify(g.bindings.map((b) => b?.name).sort()) !== JSON.stringify([...names].sort())
  )
    throw surferFailure('Invalid Ask premise grounding.');
  for (const b of g.bindings) {
    if (
      !b ||
      !keys(
        b,
        meaning
          ? 'end,label,literal,name,quote,start,syntax'
          : 'end,literal,name,quote,start,syntax',
      ) ||
      (meaning && !text(b.label, 64)) ||
      !text(b.name, 64) ||
      !['ASSIGNMENT', 'DECLARED_FIELD_CLAUSE'].includes(b.syntax) ||
      !b.literal ||
      !keys(b.literal, 'end,quote,start') ||
      [b, b.literal].some(
        (s) =>
          !Number.isSafeInteger(s.start) ||
          !Number.isSafeInteger(s.end) ||
          s.start < 0 ||
          s.end <= s.start ||
          s.end > 10000 ||
          !text(s.quote, 4096),
      ) ||
      b.literal.start < b.start ||
      b.literal.end > b.end ||
      unicodeSlice(b.quote, b.literal.start - b.start, b.literal.end - b.start) !== b.literal.quote
    )
      throw surferFailure('Invalid Ask premise span.');
  }
  if (meaning) {
    if (reviewed) {
      if (!Array.isArray(g.reviews) || !g.reviews.length || g.reviews.length > 8)
        throw surferFailure('Invalid meaning review list.');
      for (const r of g.reviews) assertSurferAskMeaningReview(r);
    }
    if (
      !Array.isArray(g.sources) ||
      !g.sources.length ||
      g.sources.length > 16 ||
      !Array.isArray(g.aliases) ||
      !g.aliases.length ||
      g.aliases.length > 16
    )
      throw surferFailure('Invalid Ask meaning sources.');
    for (const a of g.aliases)
      if (
        !a ||
        !keys(a, 'field,lexiconDigest,sourceIndex,status,term') ||
        !text(a.field, 64) ||
        !text(a.term, 64) ||
        !Number.isSafeInteger(a.sourceIndex) ||
        a.sourceIndex < 0 ||
        a.sourceIndex >= g.sources.length ||
        !/^sha256:[a-f0-9]{64}$/.test(a.lexiconDigest) ||
        ![
          'SOURCE_DECLARED',
          'UNSUPPORTED_SCOPE',
          'FIELD_CONTRACT_MISMATCH',
          ...(reviewed ? ['PROPOSAL_REJECTED'] : []),
        ].includes(a.status)
      )
        throw surferFailure('Invalid Ask source meaning.');
  }
}
/** Question provenance is not Source Evidence and never grants an E citation identity. */
export function assertSurferAskPremiseQuestion(g: SurferAskPremiseGrounding, question: string) {
  validateSurferAskPremiseGrounding(
    g,
    g.bindings.map((b) => b.name),
  );
  if (
    g.questionDigest !== surferDigest(question) ||
    g.bindings.some(
      (b) =>
        unicodeSlice(question, b.start, b.end) !== b.quote ||
        unicodeSlice(question, b.literal.start, b.literal.end) !== b.literal.quote,
    )
  )
    throw surferFailure('Ask premise anchors differ from the pinned question.');
}
export function decodeSurferAskMemoryContext(value: unknown): SurferAskMemoryContext {
  assertSurferJson(value);
  const r = value as SurferAskMemoryContext;
  if (
    !r ||
    !keys(r, 'baseContextDigest,digest,packet,revision') ||
    ![
      'surfer.ask-memory.v1',
      'surfer.ask-memory.v2',
      'surfer.ask-memory.v3',
      'surfer.ask-memory.v4',
      'surfer.ask-memory.v5',
      'surfer.ask-memory.v6',
      'surfer.ask-memory.v7',
      'surfer.ask-memory.v8',
      'surfer.ask-memory.v9',
    ].includes(r.revision) ||
    !text(r.baseContextDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(r.digest) ||
    JSON.stringify(r).length > 65536
  )
    throw surferFailure('Invalid Ask memory context.');
  const p = r.packet;
  if (
    r.revision === 'surfer.ask-memory.v7' &&
    p?.discovery?.revision !== 'surfer.ask-meaning-discovery.v2'
  )
    throw surferFailure('Missing semantic scope discovery profile.');
  if (p !== null) {
    if (
      !p ||
      !keys(
        p,
        r.revision === 'surfer.ask-memory.v5' ||
          ([
            'surfer.ask-memory.v6',
            'surfer.ask-memory.v7',
            'surfer.ask-memory.v8',
            'surfer.ask-memory.v9',
          ].includes(r.revision) &&
            p.discovery)
          ? 'discovery,items,rules,snapshot,sources,storage'
          : r.revision !== 'surfer.ask-memory.v1'
            ? 'items,rules,snapshot,sources,storage'
            : 'items,snapshot,sources,storage',
      ) ||
      !['LEGACY', 'ROWS'].includes(p.storage) ||
      !p.snapshot ||
      !keys(p.snapshot, 'digest,snapshotId') ||
      !text(p.snapshot.snapshotId) ||
      !/^sha256:[a-f0-9]{64}$/.test(p.snapshot.digest) ||
      !Array.isArray(p.items) ||
      (!p.items.length && !p.rules?.length) ||
      p.items.length > 16 ||
      !Array.isArray(p.sources) ||
      !p.sources.length ||
      p.sources.length > 16
    )
      throw surferFailure('Invalid bounded Ask memory packet.');
    if (r.revision !== 'surfer.ask-memory.v1') {
      if (!Array.isArray(p.rules) || p.rules.length > 8)
        throw surferFailure('Invalid Ask rule list.');
      if (new Set(p.rules.map((v) => v?.memory?.artifactId)).size !== p.rules.length)
        throw surferFailure('Duplicate Ask rule.');
      for (const rule of p.rules) {
        if (
          !rule ||
          !keys(
            rule,
            [
              'surfer.ask-memory.v3',
              'surfer.ask-memory.v4',
              'surfer.ask-memory.v5',
              'surfer.ask-memory.v6',
              'surfer.ask-memory.v7',
              'surfer.ask-memory.v8',
              'surfer.ask-memory.v9',
            ].includes(r.revision)
              ? 'citations,description,domain,fields,grounding,memory,outcome,premises,qualification,reasons,state'
              : 'citations,description,domain,fields,memory,outcome,premises,qualification,reasons,state',
          ) ||
          !text(rule.description, 4096) ||
          !text(rule.domain) ||
          !['ACTIVE', 'QUARANTINED', 'RETRACTED'].includes(rule.state) ||
          !['TRUE', 'FALSE', 'UNKNOWN'].includes(rule.outcome) ||
          !Array.isArray(rule.reasons) ||
          rule.reasons.length > 32 ||
          rule.reasons.some((v) => !text(v)) ||
          !rule.qualification ||
          !keys(rule.qualification, 'generationDigest,proofId,receiptDigest,reviewDigest,status') ||
          rule.qualification.status !== 'SCOPE_VALIDATED' ||
          ['proofId', 'receiptDigest', 'reviewDigest', 'generationDigest'].some(
            (k) => !/^sha256:[a-f0-9]{64}$/.test(rule.qualification[k as 'proofId']),
          ) ||
          !Array.isArray(rule.fields) ||
          rule.fields.length > 8 ||
          !Array.isArray(rule.premises) ||
          rule.premises.length > 8 ||
          (rule.state !== 'ACTIVE' && rule.outcome !== 'UNKNOWN') ||
          (rule.outcome !== 'UNKNOWN' && rule.reasons.length > 0)
        )
          throw surferFailure('Invalid Ask rule qualification.');
        if (
          [
            'surfer.ask-memory.v3',
            'surfer.ask-memory.v4',
            'surfer.ask-memory.v5',
            'surfer.ask-memory.v6',
            'surfer.ask-memory.v7',
            'surfer.ask-memory.v8',
            'surfer.ask-memory.v9',
          ].includes(r.revision)
        )
          validateSurferAskPremiseGrounding(
            rule.grounding,
            rule.premises.map((p) => p.name),
          );
        if (
          r.revision === 'surfer.ask-memory.v3' &&
          rule.grounding?.revision !== 'surfer.ask-declared-field-clauses.v1'
        )
          throw surferFailure('Historical v3 cannot acquire source aliases.');
        if (
          rule.grounding?.reviews &&
          ![
            'surfer.ask-memory.v6',
            'surfer.ask-memory.v7',
            'surfer.ask-memory.v8',
            'surfer.ask-memory.v9',
          ].includes(r.revision)
        )
          throw surferFailure('Historical Ask cannot acquire meaning reviews.');
        if (
          rule.grounding?.reviews?.some(
            (review) => review.revision === 'surfer.ask-meaning-review.v2',
          ) &&
          !['surfer.ask-memory.v8', 'surfer.ask-memory.v9'].includes(r.revision)
        )
          throw surferFailure('Historical Ask cannot acquire scope-aware meaning reviews.');
        if (
          rule.grounding?.reviews?.some(
            (review) => review.revision === 'surfer.ask-meaning-review.v3',
          ) &&
          r.revision !== 'surfer.ask-memory.v9'
        )
          throw surferFailure('Historical Ask cannot acquire cross-review pins.');

        if (
          rule.grounding?.reviews?.some(
            (review) =>
              surferDigest(review.candidate.rule) !== surferDigest(rule.memory) ||
              review.sources.some(
                (c) => !rule.citations.some((x) => surferDigest(x) === surferDigest(c)),
              ),
          )
        )
          throw surferFailure('Meaning review differs from the pinned rule or citations.');
        if (
          rule.grounding?.sources?.some(
            (c) => !rule.citations.some((x) => surferDigest(x) === surferDigest(c)),
          )
        )
          throw surferFailure('Meaning Source is outside rule citations.');
        for (const f of rule.fields)
          if (
            !f ||
            !keys(f, 'name,type,unit') ||
            !text(f.name, 64) ||
            !['NUMBER', 'BOOLEAN', 'TEXT'].includes(f.type) ||
            (f.unit !== null && !text(f.unit, 64))
          )
            throw surferFailure('Invalid Ask rule field.');
        for (const f of rule.premises)
          if (
            !f ||
            !keys(f, 'name,unit,value') ||
            !text(f.name, 64) ||
            !['string', 'number', 'boolean'].includes(typeof f.value) ||
            (typeof f.value === 'number' && !Number.isFinite(f.value)) ||
            (f.unit !== null && !text(f.unit, 64))
          )
            throw surferFailure('Invalid Ask rule premise.');
        if (
          new Set(rule.fields.map((f) => f.name)).size !== rule.fields.length ||
          new Set(rule.premises.map((f) => f.name)).size !== rule.premises.length ||
          rule.premises.some((p) => {
            const f = rule.fields.find((f) => f.name === p.name);
            return (
              !f ||
              f.unit !== p.unit ||
              typeof p.value !==
                (f.type === 'NUMBER' ? 'number' : f.type === 'BOOLEAN' ? 'boolean' : 'string')
            );
          }) ||
          (rule.outcome !== 'UNKNOWN' &&
            (!rule.fields.length || rule.fields.length !== rule.premises.length))
        )
          throw surferFailure('Ask rule premises differ from their field contract.');
        // Reuse the same bounded ref/citation validator as interpretation memory.
        const check = pinSurferAskMemory(r.baseContextDigest, {
          storage: p.storage,
          snapshot: p.snapshot,
          sources: p.sources,
          items: [
            {
              memory: rule.memory,
              subject: rule.domain,
              operation: 'scoped-rule',
              declaredMode: 'ASSERTED',
              citations: rule.citations,
            },
          ],
        });
        if (!check.packet) throw surferFailure('Invalid Ask rule citations.');
      }
    }
    if (
      r.revision === 'surfer.ask-memory.v5' ||
      ([
        'surfer.ask-memory.v6',
        'surfer.ask-memory.v7',
        'surfer.ask-memory.v8',
        'surfer.ask-memory.v9',
      ].includes(r.revision) &&
        p.discovery)
    ) {
      assertSurferAskDiscoveryPin(p.discovery);
      if (
        ['surfer.ask-memory.v7', 'surfer.ask-memory.v8', 'surfer.ask-memory.v9'].includes(
          r.revision,
        ) !==
        (p.discovery.revision === 'surfer.ask-meaning-discovery.v2')
      )
        throw surferFailure('Historical Ask cannot acquire semantic scope discovery.');
      if (
        !p.rules?.some(
          (r) =>
            r.state === 'ACTIVE' &&
            r.outcome === 'UNKNOWN' &&
            r.reasons.some((x) => x.startsWith('MISSING_PREMISE:')),
        ) ||
        p.discovery.evidence.some(
          (e) =>
            !p.sources.some(
              (s) =>
                s.sourceId === e.sourceId &&
                s.sourceVersionId === e.sourceVersionId &&
                s.revisionId === e.revisionId,
            ),
        )
      )
        throw surferFailure('Discovery is outside current eligible rules or Sources.');
    }
    for (const s of p.sources)
      if (
        !s ||
        !keys(s, 'indexingResultId,revisionId,sourceId,sourceVersionId') ||
        Object.values(s).some((x) => !text(x))
      )
        throw surferFailure('Invalid Ask memory Source pin.');
    for (const i of p.items) {
      if (
        !i ||
        !keys(i, 'citations,declaredMode,memory,operation,subject') ||
        !i.memory ||
        !keys(i.memory, 'artifactId,digest,revision') ||
        !text(i.memory.artifactId) ||
        !Number.isSafeInteger(i.memory.revision) ||
        i.memory.revision < 1 ||
        !/^sha256:[a-f0-9]{64}$/.test(i.memory.digest) ||
        !text(i.subject, 2048) ||
        !text(i.operation, 2048) ||
        !(SURFER_ACTION_MODES as readonly string[]).includes(i.declaredMode) ||
        !Array.isArray(i.citations) ||
        !i.citations.length ||
        i.citations.length > 32
      )
        throw surferFailure('Invalid Ask memory item.');
      for (const c of i.citations)
        if (
          !c ||
          !keys(c, 'evidenceId,quote,revisionId,sourceId,sourceVersionId') ||
          !text(c.evidenceId) ||
          !text(c.sourceId) ||
          !text(c.sourceVersionId) ||
          !text(c.revisionId) ||
          !text(c.quote, 4096)
        )
          throw surferFailure('Invalid Ask memory citation.');
    }
  }
  if (
    surferDigest({
      revision: r.revision,
      baseContextDigest: r.baseContextDigest,
      packet: r.packet,
    }) !== r.digest
  )
    throw surferFailure('Ask memory context digest changed.');
  return structuredClone(r);
}
export function pinSurferAskMemory(
  baseContextDigest: string,
  packet: SurferAskMemoryPacket | null,
): SurferAskMemoryContext {
  const body = {
    revision: packet?.rules?.some((r) =>
      r.grounding?.reviews?.some((v) => v.revision === 'surfer.ask-meaning-review.v3'),
    )
      ? ('surfer.ask-memory.v9' as const)
      : packet?.rules?.some((r) =>
            r.grounding?.reviews?.some((v) => v.revision === 'surfer.ask-meaning-review.v2'),
          )
        ? ('surfer.ask-memory.v8' as const)
        : packet?.discovery?.revision === 'surfer.ask-meaning-discovery.v2'
          ? ('surfer.ask-memory.v7' as const)
          : packet?.rules?.some((r) => r.grounding?.reviews?.length)
            ? ('surfer.ask-memory.v6' as const)
            : packet?.discovery
              ? ('surfer.ask-memory.v5' as const)
              : packet?.rules?.some(
                    (r) => r.grounding?.revision === 'surfer.ask-source-field-meanings.v1',
                  )
                ? ('surfer.ask-memory.v4' as const)
                : packet?.rules?.some((r) => r.grounding)
                  ? ('surfer.ask-memory.v3' as const)
                  : packet?.rules
                    ? ('surfer.ask-memory.v2' as const)
                    : ('surfer.ask-memory.v1' as const),
    baseContextDigest,
    packet,
  };
  return decodeSurferAskMemoryContext({ ...body, digest: surferDigest(body) });
}
