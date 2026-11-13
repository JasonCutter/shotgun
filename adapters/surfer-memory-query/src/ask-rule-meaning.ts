import type { SurferGuidedRuleCatalog } from '../../../packages/contracts/src/surfer-guided-rule.js';
import type {
  SurferAskRule,
  SurferAskPremiseGrounding,
  SurferAskMemoryPacket,
} from '../../../packages/contracts/src/surfer-ask-memory.js';
import { assertSurferAskPremiseQuestion } from '../../../packages/contracts/src/surfer-ask-memory.js';
import {
  surferDigest,
  surferFailure,
  type SurferObservation,
} from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferAskRulePremises, assertSurferAskGroundedRule } from './ask-rule-grounding.js';
type Fields = SurferGuidedRuleCatalog['items'][number]['fields'];
export type SurferAskMeaningSource = SurferAskMemoryPacket['items'][number]['citations'][number];
export type SurferRuleFieldLexicon = {
  contract: 'surfer.rule-field-lexicon.v1';
  domain: string;
  subject: string | null;
  time: string | null;
  fields: {
    name: string;
    type: 'NUMBER' | 'BOOLEAN' | 'TEXT';
    unit: string | null;
    aliases: string[];
  }[];
};
const exact = (v: object, k: string) => Object.keys(v).sort().join(',') === k;
const text = (v: unknown, n = 256): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= n && v.trim() === v;
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (q: string, term: string) =>
  [...q.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escape(term)}(?=\\s|=|은|는|이|가|$)`, 'gu'))]
    .length;
/** JSON.parse alone discards earlier duplicate keys, including escaped-key equivalents. */
function uniqueObjectKeys(json: string) {
  const stack: ({ keys: Set<string>; expectKey: boolean } | null)[] = [];
  for (const token of json.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g)) {
    const t = token[0];
    if (t === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (t === '[') stack.push(null);
    else if (t === '}' || t === ']') stack.pop();
    else if (t === ',') {
      const top = stack.at(-1);
      if (top) top.expectKey = true;
    } else if (t.startsWith('"')) {
      const top = stack.at(-1);
      if (top?.expectKey) {
        const key = JSON.parse(t) as string;
        if (top.keys.has(key)) return false;
        top.keys.add(key);
        top.expectKey = false;
      }
    }
  }
  return true;
}
/** Explicit Source declaration only; partial prose, inferred translations and unknown keys are not accepted. */
export function readSurferRuleFieldLexicon(quote: string): SurferRuleFieldLexicon | null {
  if (quote.length > 4096) return null;
  try {
    const v = JSON.parse(quote) as SurferRuleFieldLexicon;
    if (!uniqueObjectKeys(quote)) return null;
    if (
      !v ||
      !exact(v, 'contract,domain,fields,subject,time') ||
      v.contract !== 'surfer.rule-field-lexicon.v1' ||
      !text(v.domain) ||
      [v.subject, v.time].some((s) => s !== null && !text(s)) ||
      !Array.isArray(v.fields) ||
      !v.fields.length ||
      v.fields.length > 8 ||
      new Set(v.fields.map((f) => f?.name)).size !== v.fields.length
    )
      return null;
    for (const f of v.fields) {
      if (
        !f ||
        !exact(f, 'aliases,name,type,unit') ||
        !text(f.name, 64) ||
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(f.name) ||
        ['constructor', 'prototype'].includes(f.name) ||
        !['NUMBER', 'BOOLEAN', 'TEXT'].includes(f.type) ||
        (f.unit !== null && (!text(f.unit, 64) || f.type !== 'NUMBER')) ||
        !Array.isArray(f.aliases) ||
        !f.aliases.length ||
        f.aliases.length > 8 ||
        new Set(f.aliases).size !== f.aliases.length ||
        f.aliases.some(
          (a) =>
            !text(a, 64) ||
            !/^[\p{L}\p{N}][\p{L}\p{N}_ -]*$/u.test(a) ||
            ['constructor', 'prototype', '__proto__', f.name].includes(a),
        )
      )
        return null;
    }
    return v;
  } catch {
    return null;
  }
}
/** Maps only Source-declared terms with matching rule field contracts; does not infer semantic equivalence. */
export function groundSurferAskRuleMeanings(
  question: string,
  fields: Fields,
  domain: string,
  documents: readonly SurferAskMeaningSource[],
) {
  const selected: SurferAskMeaningSource[] = [],
    aliases: NonNullable<SurferAskPremiseGrounding['aliases']> = [];
  for (const source of documents) {
    const lexicon = readSurferRuleFieldLexicon(source.quote);
    if (!lexicon || lexicon.domain !== domain) continue;
    for (const definition of lexicon.fields) {
      const field = fields.find((f) => f.name === definition.name);
      if (!field) continue;
      for (const term of definition.aliases) {
        if (!mentions(question, term)) continue;
        let sourceIndex = selected.findIndex((s) => surferDigest(s) === surferDigest(source));
        if (sourceIndex < 0) {
          sourceIndex = selected.length;
          selected.push(source);
        }
        aliases.push({
          field: field.name,
          term,
          sourceIndex,
          lexiconDigest: surferDigest(lexicon),
          status:
            lexicon.subject !== null || lexicon.time !== null
              ? 'UNSUPPORTED_SCOPE'
              : field.type !== definition.type || field.unit !== definition.unit
                ? 'FIELD_CONTRACT_MISMATCH'
                : 'SOURCE_DECLARED',
        });
      }
    }
  }
  return groundSurferAskResolvedMeanings(question, fields, selected, aliases);
}
export function groundSurferAskResolvedMeanings(
  question: string,
  fields: Fields,
  selected: SurferAskMeaningSource[],
  aliases: NonNullable<SurferAskPremiseGrounding['aliases']>,
) {
  if (!aliases.length) return groundSurferAskRulePremises(question, fields);
  if (aliases.length > 16 || selected.length > 16)
    throw surferFailure('Ask meaning mapping exceeds its bounded profile.');
  const features: Record<string, SurferObservation> = {},
    reasons: string[] = [],
    grounding: SurferAskPremiseGrounding = {
      revision: 'surfer.ask-source-field-meanings.v1',
      questionDigest: surferDigest(question),
      bindings: [],
      sources: selected,
      aliases,
    };
  for (const field of fields) {
    const labels = [
      ...new Set([field.name, ...aliases.filter((a) => a.field === field.name).map((a) => a.term)]),
    ].filter((term) => mentions(question, term));
    if (!labels.length) {
      reasons.push('MISSING_PREMISE:' + field.name);
      continue;
    }
    if (labels.length !== 1 || mentions(question, labels[0]!) !== 1) {
      reasons.push('AMBIGUOUS_PREMISE:' + field.name);
      continue;
    }
    const label = labels[0]!,
      defs = aliases.filter((a) => a.term === label);
    const meanings = new Set([
      ...defs.map((a) => a.field),
      ...fields.filter((f) => f.name === label).map((f) => f.name),
    ]);
    if (meanings.size !== 1) {
      reasons.push('AMBIGUOUS_FIELD_MEANING:' + field.name);
      continue;
    }
    if (defs.some((d) => d.status !== 'SOURCE_DECLARED')) {
      reasons.push('UNSUPPORTED_FIELD_MEANING:' + field.name);
      continue;
    }
    const parsed = groundSurferAskRulePremises(question, [{ ...field, name: label }]);
    if (parsed.features[label]) features[field.name] = parsed.features[label]!;
    reasons.push(...parsed.reasons.map((r) => r.slice(0, r.lastIndexOf(':') + 1) + field.name));
    grounding.bindings.push(
      ...parsed.grounding.bindings.map((b) => ({ ...b, name: field.name, label })),
    );
  }
  return { features, reasons, grounding };
}
export function assertSurferAskMeaningRule(question: string, rule: SurferAskRule) {
  if (rule.grounding?.revision !== 'surfer.ask-source-field-meanings.v1')
    return assertSurferAskGroundedRule(question, rule);
  assertSurferAskPremiseQuestion(rule.grounding, question);
  const checked = groundSurferAskRuleMeanings(
    question,
    rule.fields.map((f) => ({
      ...f,
      values: rule.premises.filter((p) => p.name === f.name).map((p) => p.value),
    })),
    rule.domain,
    rule.grounding.sources!,
  );
  const expected = Object.fromEntries(
    rule.premises.map((p) => [
      p.name,
      { value: p.value, ...(p.unit === null ? {} : { unit: p.unit }) },
    ]),
  );
  if (
    surferDigest(checked.grounding) !== surferDigest(rule.grounding) ||
    surferDigest(checked.features) !== surferDigest(expected)
  )
    throw surferFailure('Ask meanings differ from their Source declarations or caller literals.');
}
