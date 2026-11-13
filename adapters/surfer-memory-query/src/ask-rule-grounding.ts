import type { SurferGuidedRuleCatalog } from '../../../packages/contracts/src/surfer-guided-rule.js';
import type { SurferObservation } from '../../../packages/contracts/src/surfer-learning.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeLength } from '../../../packages/contracts/src/document-evidence.js';
import {
  assertSurferAskPremiseQuestion,
  type SurferAskPremiseGrounding,
  type SurferAskRule,
} from '../../../packages/contracts/src/surfer-ask-memory.js';
import { parseSurferLiteral } from '../../../modules/surfer-core/src/cognition.js';
import { readSurferAskRulePremises } from '../../../modules/surfer-learning/src/ask-rule-premises.js';

const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canonicalDecimal = (v: string) => {
  const [whole, fraction = ''] = v.replace(/^\+/, '').split('.');
  const f = fraction.replace(/0+$/, '');
  return /^-?0$/.test(whole!) && !f ? '0' : whole + (f ? '.' + f : '');
};
/** Closed declared-field clauses; not a general language or semantic binding model. */
export function groundSurferAskRulePremises(
  question: string,
  fields: SurferGuidedRuleCatalog['items'][number]['fields'],
) {
  const features: Record<string, SurferObservation> = {},
    reasons: string[] = [];
  const grounding: SurferAskPremiseGrounding = {
    revision: 'surfer.ask-declared-field-clauses.v1',
    questionDigest: surferDigest(question),
    bindings: [],
  };
  const legacy = readSurferAskRulePremises(question, fields);
  const unsupportedScope =
    /(?:\b(?:not|nor|either|whether|said|yesterday|previously|according)\b|아니|않|또는|어제|과거|예시|인용|라고|다른 장치)/iu.test(
      question,
    );
  let fenced = false;
  // Preserve UTF-16 indices while masking excluded regions; persisted spans use Unicode code points.
  const visible = question
    .split(/(?<=\n)/)
    .map((line) => {
      const fence = /^\s*(```|~~~)/.test(line);
      if (fence) fenced = !fenced;
      return fence || fenced || /^\s*>/.test(line)
        ? line.replace(/[^\r\n]/g, ' ')
        : line.replace(/`[^`\r\n]*`/g, (v) => ' '.repeat(v.length));
    })
    .join('');
  const segments: { start: number; end: number }[] = [];
  const separator = /\r?\n|[,;](?=\s|$)|[.!?](?=\s|$)|\s+(?:and|그리고)\s+|(?:이고|이며)\s+/gu;
  let start = 0;
  for (const m of visible.matchAll(separator)) {
    segments.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  segments.push({ start, end: visible.length });
  for (const field of fields) {
    if (unsupportedScope) {
      reasons.push('UNSUPPORTED_QUESTION_SCOPE:' + field.name);
      continue;
    }
    const mentions = [
      ...visible.matchAll(
        new RegExp(`(?<![\\p{L}\\p{N}_])${escape(field.name)}(?=\\s|=|은|는|이|가|$)`, 'gu'),
      ),
    ];
    if (!mentions.length) {
      reasons.push('MISSING_PREMISE:' + field.name);
      continue;
    }
    if (mentions.length !== 1) {
      reasons.push('AMBIGUOUS_PREMISE:' + field.name);
      continue;
    }
    const position = mentions[0]!.index,
      segment = segments.find((s) => s.start <= position && position < s.end)!;
    const raw = question.slice(segment.start, segment.end),
      leading = raw.length - raw.trimStart().length,
      clause = raw.trim();
    const match = new RegExp(
      `^(?:현재\\s+)?${escape(field.name)}\\s*(=\\s*|(?:is|are)\\s+|[은는이가]\\s*)(.+)$`,
      'u',
    ).exec(clause);
    if (
      !match ||
      unicodeLength(clause) > 2048 ||
      visible.slice(segment.start, segment.end).trim() !== clause
    ) {
      reasons.push('UNSUPPORTED_PREMISE:' + field.name);
      continue;
    }
    const assignment = match[1]!.trim() === '=',
      body = match[2]!.trim();
    const alternatives = [
      body,
      ...(!assignment ? [body.replace(/(?:입니다|이다|이에요|예요)$/u, '').trim()] : []),
    ];
    let value: SurferObservation | undefined,
      literal = '';
    if (assignment) {
      value = legacy.features[field.name];
      literal = body;
    } else
      for (const rawLiteral of [...new Set(alternatives)]) {
        const parsed = parseSurferLiteral(rawLiteral);
        const scalar =
          parsed.kind === 'NUMBER'
            ? Number(parsed.decimal)
            : parsed.kind === 'BOOLEAN' || parsed.kind === 'TEXT'
              ? parsed.value
              : field.type === 'TEXT' && field.values.includes(rawLiteral)
                ? rawLiteral
                : undefined;
        const unit = parsed.kind === 'NUMBER' ? parsed.unit : null;
        const type =
          field.type === 'NUMBER' ? 'number' : field.type === 'BOOLEAN' ? 'boolean' : 'string';
        if (
          typeof scalar !== type ||
          unit !== field.unit ||
          (parsed.kind === 'NUMBER' &&
            (!Number.isFinite(scalar) ||
              canonicalDecimal(String(scalar)) !== canonicalDecimal(parsed.decimal)))
        )
          continue;
        if (!field.values.some((v) => v === scalar)) continue;
        value = { value: scalar as string | number | boolean, ...(unit === null ? {} : { unit }) };
        literal = rawLiteral;
        break;
      }
    if (!value) {
      reasons.push(
        (assignment ? legacy.reasons.find((r) => r.endsWith(':' + field.name)) : null) ??
          'UNSUPPORTED_OR_UNOBSERVED_PREMISE:' + field.name,
      );
      continue;
    }
    features[field.name] = value;
    const clauseStart = segment.start + leading,
      literalStart =
        clauseStart +
        clause.length -
        match[2]!.length +
        (match[2]!.length - match[2]!.trimStart().length);
    grounding.bindings.push({
      name: field.name,
      syntax: assignment ? 'ASSIGNMENT' : 'DECLARED_FIELD_CLAUSE',
      start: unicodeLength(question.slice(0, clauseStart)),
      end: unicodeLength(question.slice(0, clauseStart + clause.length)),
      quote: clause,
      literal: {
        start: unicodeLength(question.slice(0, literalStart)),
        end: unicodeLength(question.slice(0, literalStart + literal.length)),
        quote: literal,
      },
    });
  }
  return { features, reasons, grounding };
}

/** Recheck literal-to-value bindings at the provider boundary without reading any new Source. */
export function assertSurferAskGroundedRule(question: string, rule: SurferAskRule) {
  if (!rule.grounding) return;
  assertSurferAskPremiseQuestion(rule.grounding, question);
  const checked = groundSurferAskRulePremises(
    question,
    rule.fields.map((f) => ({
      ...f,
      values: rule.premises.filter((p) => p.name === f.name).map((p) => p.value),
    })),
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
    throw surferFailure('Ask rule values differ from the grounded caller scenario.');
}
