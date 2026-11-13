import type { SurferDirectiveScenarioEvaluationPort } from '../../../packages/contracts/src/surfer-directive-memory.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import type { SurferMemoryQuestion } from '../../../packages/contracts/src/surfer-directive-memory.js';
import type { SurferStructureExpression } from '../../../packages/contracts/src/surfer-structure.js';
import {
  type SurferExpression,
  type SurferObservation,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { evaluateSurferRule } from '../../../modules/surfer-learning/src/rule-interpreter.js';
import {
  ExactSurferLiteralNormalization,
  parseSurferLiteral,
} from '../../../modules/surfer-core/src/cognition.js';

const normalizer = new ExactSurferLiteralNormalization();
/** Exact decimal ordering after existing unit normalization; never convert a decimal to binary Number. */
function order(a: string, b: string) {
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (v: string) => {
    const neg = v.startsWith('-'),
      [w, f = ''] = (neg ? v.slice(1) : v).split('.');
    return BigInt((neg ? '-' : '') + w + f.padEnd(scale, '0'));
  };
  const x = integer(a),
    y = integer(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function evaluateDirectiveQuestion(
  packet: SurferDirectiveExtractionV2,
  q: SurferMemoryQuestion,
  options: { minimalPremises?: boolean } = {},
) {
  const v = packet.clauses.proposal.interpretation;
  if (v.state !== 'RESOLVED' || !packet.meaning)
    throw surferFailure('Unresolved memory cannot supply a declared operation.');
  const s = v.structure,
    a = s.assertion;
  const needed: { predicateId: string; quote: string; reason: string }[] = [];
  const result = (outcome: string, reasons: string[] = []) => ({ outcome, reasons, needed });
  if (q.kind === 'RECALL') return result('RECALLED_INTERPRETATION');
  if (a.quantifier || a.scope.condition || !['IF', 'UNCONDITIONAL'].includes(a.direction))
    return result('UNKNOWN', ['UNSUPPORTED_APPLICABILITY_STRUCTURE']);
  const allowed = new Set(
    packet.clauses.bindings.filter((b) => b.role !== 'ACTION').map((b) => b.predicateId),
  );
  if (q.observations.some((o) => !allowed.has(o.predicateId)))
    throw surferFailure(
      'Question observations must name the declared condition/exception, never the conclusion.',
    );
  if (a.scope.time) {
    if (!q.atDate) return result('UNKNOWN', ['DATE_REQUIRED']);
    const t = a.scope.time,
      d = q.atDate;
    if (
      (t.from && (d < t.from || (!t.fromInclusive && d === t.from))) ||
      (t.to && (d > t.to || (!t.toInclusive && d === t.to)))
    )
      return result('OUTSIDE_TIME_SCOPE');
  }
  const predicates: Record<string, SurferObservation> = {};
  for (const p of s.predicates.filter((p) => allowed.has(p.id))) {
    const supplied = q.observations.find((o) => o.predicateId === p.id)?.value;
    let value: boolean | null = null,
      reason = 'MISSING_OBSERVATION';
    if (supplied) {
      if (supplied.type !== p.operand.type) reason = 'TYPE_MISMATCH';
      else if (p.operand.type === 'BOOLEAN' && supplied.type === 'BOOLEAN') {
        if (!['eq', 'ne'].includes(p.comparison)) reason = 'UNSUPPORTED_BOOLEAN_OPERATOR';
        else
          value =
            p.comparison === 'eq'
              ? supplied.value === p.operand.value
              : supplied.value !== p.operand.value;
      } else if (p.operand.type === 'NUMBER' && supplied.type === 'NUMBER') {
        let decimal = supplied.decimal;
        if (supplied.unit !== p.operand.unit) {
          const n = normalizer.normalize(
            parseSurferLiteral(decimal + (supplied.unit ? ' ' + supplied.unit : '')),
            p.operand.unit,
          );
          if (n.state !== 'RESOLVED') reason = n.reason ?? 'UNIT_MISMATCH';
          else decimal = n.normalizedValue!;
          if (n.state !== 'RESOLVED') {
            predicates[p.id] = { value: null };
            needed.push({
              predicateId: p.id,
              quote: packet.clauses.bindings.find((b) => b.predicateId === p.id)!.quote,
              reason,
            });
            continue;
          }
        }
        const c = order(decimal, p.operand.decimal);
        value = { eq: c === 0, ne: c !== 0, gt: c > 0, gte: c >= 0, lt: c < 0, lte: c <= 0 }[
          p.comparison
        ];
      }
    }
    predicates[p.id] = { value };
    if (value === null)
      needed.push({
        predicateId: p.id,
        quote: packet.clauses.bindings.find((b) => b.predicateId === p.id)!.quote,
        reason,
      });
  }
  const expression = (e: SurferStructureExpression): SurferExpression =>
    e.op === 'predicate'
      ? { op: 'field', name: e.id }
      : e.op === 'not'
        ? { op: 'not', arg: expression(e.arg) }
        : { op: e.op, args: e.args.map(expression) };
  const evaluate = (e: SurferStructureExpression | null) =>
    e ? evaluateSurferRule(expression(e), predicates, { maxOperations: 128 }).outcome : 'TRUE';
  const condition = evaluate(a.condition);
  if (condition === 'FALSE') {
    needed.length = 0;
    return result('NOT_TRIGGERED');
  }
  const exceptions = a.exceptions.map((e) => evaluate(e.when));
  if (exceptions.includes('TRUE')) {
    needed.length = 0;
    return result('EXEMPT');
  }
  if (options.minimalPremises) {
    // Only unknown leaves of unresolved subexpressions can affect this outcome.
    const relevant = new Set<string>();
    const visit = (e: SurferStructureExpression) => {
      if (evaluate(e) !== 'UNKNOWN') return;
      if (e.op === 'predicate') relevant.add(e.id);
      else if (e.op === 'not') visit(e.arg);
      else e.args.forEach(visit);
    };
    if (a.condition) visit(a.condition);
    a.exceptions.forEach((e) => visit(e.when));
    for (let i = needed.length - 1; i >= 0; i--)
      if (!relevant.has(needed[i]!.predicateId)) needed.splice(i, 1);
  }
  if (condition === 'UNKNOWN' || exceptions.includes('UNKNOWN'))
    return result('UNKNOWN', ['MISSING_OR_UNSUPPORTED_PREMISE']);
  needed.length = 0;
  return result(packet.meaning.action.mode);
}

export class SurferDirectiveScenarioEvaluator implements SurferDirectiveScenarioEvaluationPort {
  readonly revision = 'surfer.directive-scenario.v1';
  evaluate(packet: SurferDirectiveExtractionV2, question: SurferMemoryQuestion) {
    return evaluateDirectiveQuestion(packet, question);
  }
}
/** Opt-in inquiry semantics; the original v1 evaluator remains reproducible. */
export class SurferDirectiveScenarioEvaluatorV2 implements SurferDirectiveScenarioEvaluationPort {
  readonly revision = 'surfer.directive-scenario.v2';
  evaluate(packet: SurferDirectiveExtractionV2, question: SurferMemoryQuestion) {
    return evaluateDirectiveQuestion(packet, question, { minimalPremises: true });
  }
}
