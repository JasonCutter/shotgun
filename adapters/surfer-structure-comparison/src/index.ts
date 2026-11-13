import type {
  SurferDeclaredStructure as Structure,
  SurferStructureExpression as Expression,
  SurferStructureOperand,
  SurferStructureComparison,
  SurferStructureComparisonPort,
} from '../../../packages/contracts/src/surfer-structure.js';
import { decodeSurferStructureProposal } from '../../../packages/contracts/src/surfer-structure.js';
import {
  surferDigest,
  surferFailure,
  type SurferExpression,
  type SurferObservation,
} from '../../../packages/contracts/src/surfer-learning.js';
import {
  ExactSurferLiteralNormalization,
  parseSurferLiteral,
} from '../../../modules/surfer-core/src/index.js';
import { evaluateSurferRule } from '../../../modules/surfer-learning/src/index.js';
const decimal = (v: string) => {
  const negative = v.startsWith('-'),
    [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.');
  const f = fraction.replace(/0+$/, '');
  return (negative && (whole !== '0' || f) ? '-' : '') + whole + (f ? '.' + f : '');
};
const display = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
type Operand =
  | { type: 'NUMBER'; decimal: string; unit: string | null }
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'TEXT'; value: string };
type Feature = {
  key: string;
  kind: Operand['type'];
  unit: string | null;
  scale: number;
  domain: (string | boolean | number)[];
};
const literal = (value: string | boolean | number, unit?: string): SurferExpression => ({
  op: 'literal',
  value,
  ...(unit ? { unit } : {}),
});
const not = (arg: SurferExpression): SurferExpression => ({ op: 'not', arg });
const all = (args: SurferExpression[]): SurferExpression =>
  args.length === 0 ? literal(true) : args.length === 1 ? args[0]! : { op: 'all', args };
const any = (args: SurferExpression[]): SurferExpression =>
  args.length === 0 ? literal(false) : args.length === 1 ? args[0]! : { op: 'any', args };
/** Closed declaration comparison. Finite probes can disprove agreement, never prove equivalence. */
export class SurferDeclaredStructureComparator implements SurferStructureComparisonPort {
  readonly revision = 'surfer.declared-structure-comparison.v1';
  private readonly normalizer = new ExactSurferLiteralNormalization();
  constructor(private readonly options = { maxProbes: 128, maxKernelOperations: 8192 }) {
    if (
      !Number.isInteger(options.maxProbes) ||
      options.maxProbes < 1 ||
      options.maxProbes > 512 ||
      !Number.isInteger(options.maxKernelOperations) ||
      options.maxKernelOperations < 1 ||
      options.maxKernelOperations > 50000
    )
      throw surferFailure('Invalid structure comparison budget.');
    this.options = Object.freeze({ ...options });
  }
  private operand(v: SurferStructureOperand): Operand {
    if (v.type !== 'NUMBER') return { type: v.type, value: v.value } as Operand;
    const observed = parseSurferLiteral(v.decimal + (v.unit ? ' ' + v.unit : ''));
    if (observed.kind !== 'NUMBER')
      return { type: 'NUMBER', decimal: decimal(v.decimal), unit: v.unit };
    for (const unit of ['kg', 'm', 's']) {
      const n = this.normalizer.normalize(observed, unit);
      if (n.state === 'RESOLVED')
        return { type: 'NUMBER', decimal: decimal(n.normalizedValue!), unit: n.normalizedUnit };
    }
    return { type: 'NUMBER', decimal: decimal(v.decimal), unit: v.unit };
  }
  private prepare(s: Structure) {
    const entities = new Map(s.entities.map((e) => [e.id, surferDigest(e.mention)]));
    const predicates = new Map(
      s.predicates.map((p) => [
        p.id,
        {
          subject: entities.get(p.subject)!,
          attribute: p.attribute,
          comparison: p.comparison,
          operand: this.operand(p.operand),
        },
      ]),
    );
    const pkey = (id: string) => surferDigest(predicates.get(id));
    const expression = (e: Expression): unknown => {
      if (e.op === 'predicate') return { predicate: pkey(e.id) };
      if (e.op === 'not') {
        const child = expression(e.arg) as { not?: unknown };
        return child && typeof child === 'object' && Object.keys(child).join(',') === 'not'
          ? child.not
          : { not: child };
      }
      const collect = (v: Expression): unknown[] =>
        v.op === e.op ? v.args.flatMap(collect) : [expression(v)];
      const values = [
        ...new Map(e.args.flatMap(collect).map((v) => [surferDigest(v), v])).entries(),
      ]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
      return values.length === 1 ? values[0] : { [e.op]: values };
    };
    const a = s.assertion,
      q = a.quantifier,
      t = a.scope.time;
    const canonical = {
      entities: [...entities.values()].sort(),
      predicates: [...new Set([...predicates.values()].map(surferDigest))].sort(),
      assertion: {
        target: pkey(a.target),
        condition: a.condition ? expression(a.condition) : null,
        direction: a.direction,
        quantifier: q
          ? { kind: q.kind, domain: entities.get(q.domain), predicate: pkey(q.predicate) }
          : null,
        exceptions: a.exceptions
          .map((e) => ({ appliesTo: pkey(e.appliesTo), when: expression(e.when) }))
          .sort((a, b) => surferDigest(a).localeCompare(surferDigest(b))),
        scope: {
          entities: a.scope.entities.map((e) => entities.get(e)!).sort(),
          condition: a.scope.condition ? expression(a.scope.condition) : null,
          time: t
            ? { from: t.from, to: t.to, fromInclusive: t.fromInclusive, toInclusive: t.toInclusive }
            : null,
        },
        documentRole: a.documentRole,
      },
    };
    return { s, entities, predicates, canonical };
  }
  compare(left: unknown, right: unknown): SurferStructureComparison {
    const l = decodeSurferStructureProposal(left),
      r = decodeSurferStructureProposal(right);
    let probes = 0,
      operations = 0;
    const done = (
      status: SurferStructureComparison['status'],
      reason: string,
      witness: SurferStructureComparison['witness'] = null,
    ): SurferStructureComparison => ({
      schemaVersion: '1.0.0',
      scope: 'DECLARED_STRUCTURE_COMPARISON_NOT_TRUTH',
      leftDigest: surferDigest(l),
      rightDigest: surferDigest(r),
      status,
      reasons: [reason],
      probes,
      kernelOperations: operations,
      witness,
    });
    if (l.viewDigest !== r.viewDigest) return done('NOT_COMPARABLE', 'SOURCE_VIEW_DIFFERS');
    if (l.interpretation.state !== 'RESOLVED' || r.interpretation.state !== 'RESOLVED')
      return done('NOT_COMPARABLE', 'UNRESOLVED_STRUCTURE');
    const a = this.prepare(l.interpretation.structure),
      b = this.prepare(r.interpretation.structure);
    const eq = (a: unknown, b: unknown) => surferDigest(a) === surferDigest(b);
    if (eq(a.canonical, b.canonical)) {
      if (eq(a.s, b.s) && l.rendering === r.rendering) return done('EXACT', 'SAME_DECLARATION');
      if (eq(a.s, b.s) && display(l.rendering) === display(r.rendering))
        return done('FORM_ONLY', 'DISPLAY_NORMALIZATION_ONLY');
      return done('STRUCTURE_MATCHED', 'ALIGNED_DECLARED_STRUCTURE_ONLY');
    }
    if (!eq(a.canonical.entities, b.canonical.entities))
      return done('NOT_COMPARABLE', 'ENTITY_ALIGNMENT_REQUIRED');
    if (!eq(a.canonical.assertion.scope.entities, b.canonical.assertion.scope.entities))
      return done('NOT_COMPARABLE', 'ENTITY_SCOPE_CHANGED');
    if (a.s.assertion.documentRole !== b.s.assertion.documentRole)
      return done('NOT_COMPARABLE', 'DOCUMENT_ROLE_CHANGED');
    if (a.s.assertion.quantifier || b.s.assertion.quantifier)
      return done('NOT_COMPARABLE', 'QUANTIFIER_REQUIRES_INDEPENDENT_DOMAIN_PROOF');
    const ap = a.predicates.get(a.s.assertion.target)!,
      bp = b.predicates.get(b.s.assertion.target)!;
    if (ap.subject !== bp.subject || ap.attribute !== bp.attribute)
      return done('NOT_COMPARABLE', 'TARGET_ALIGNMENT_REQUIRED');
    const groups = new Map<
      string,
      { base: { subject: string; attribute: string }; operands: Operand[] }
    >();
    for (const p of [...a.predicates.values(), ...b.predicates.values()]) {
      const key = 'f' + surferDigest({ subject: p.subject, attribute: p.attribute }).slice(7, 67),
        g = groups.get(key) ?? {
          base: { subject: p.subject, attribute: p.attribute },
          operands: [],
        };
      g.operands.push(p.operand);
      groups.set(key, g);
    }
    const features: Feature[] = [];
    const scaled = (v: string, scale: number) => {
      const neg = v.startsWith('-'),
        [w, f = ''] = (neg ? v.slice(1) : v).split('.');
      return BigInt((neg ? '-' : '') + w + f.padEnd(scale, '0'));
    };
    for (const [key, g] of groups) {
      if (new Set(g.operands.map((v) => v.type)).size !== 1)
        return done('NOT_COMPARABLE', 'FEATURE_TYPE_CHANGED');
      const first = g.operands[0]!;
      if (first.type === 'NUMBER') {
        const ns = g.operands as Extract<Operand, { type: 'NUMBER' }>[];
        if (new Set(ns.map((v) => v.unit)).size !== 1)
          return done('NOT_COMPARABLE', 'UNIT_MAPPING_UNSUPPORTED');
        if ((first.unit?.length ?? 0) > 48)
          return done('NOT_COMPARABLE', 'UNIT_LABEL_PROBE_UNSUPPORTED');
        const scale = Math.max(...ns.map((n) => n.decimal.split('.')[1]?.length ?? 0));
        if (scale > 6) return done('NOT_COMPARABLE', 'NUMERIC_PROBE_PRECISION_UNSUPPORTED');
        const values = ns.map((n) => scaled(n.decimal, scale));
        if (
          values.some(
            (v) =>
              v <= BigInt(Number.MIN_SAFE_INTEGER) + 1n ||
              v >= BigInt(Number.MAX_SAFE_INTEGER) - 1n,
          )
        )
          return done('NOT_COMPARABLE', 'NUMERIC_PROBE_RANGE_UNSUPPORTED');
        features.push({
          key,
          kind: 'NUMBER',
          unit: (first.unit ?? 'unitless') + '@10^-' + scale,
          scale,
          domain: [
            ...new Set(values.flatMap((v) => [Number(v - 1n), Number(v), Number(v + 1n)])),
          ].sort((x, y) => x - y),
        });
      } else if (first.type === 'BOOLEAN')
        features.push({ key, kind: 'BOOLEAN', unit: null, scale: 0, domain: [false, true] });
      else {
        const values = (g.operands as Extract<Operand, { type: 'TEXT' }>[]).map((v) => v.value);
        let other = '__OTHER__';
        while (values.includes(other)) other += '_';
        features.push({
          key,
          kind: 'TEXT',
          unit: null,
          scale: 0,
          domain: [...new Set([...values, other])],
        });
      }
    }
    const times = [a.s.assertion.scope.time, b.s.assertion.scope.time]
      .filter((t) => t !== null)
      .flatMap((t) => [t.from, t.to])
      .filter((d) => d !== null)
      .map((d) => Date.parse(d) / 86400000);
    if (times.length)
      features.push({
        key: 'scope_time',
        kind: 'NUMBER',
        unit: 'day',
        scale: 0,
        domain: [...new Set(times.flatMap((t) => [t - 1, t, t + 1]))].sort((x, y) => x - y),
      });
    if (features.length > 8) return done('NOT_COMPARABLE', 'FEATURE_PROBE_BUDGET_EXCEEDED');
    const compile = (prepared: typeof a): SurferExpression => {
      const pred = (id: string): SurferExpression => {
        const p = prepared.predicates.get(id)!,
          key = 'f' + surferDigest({ subject: p.subject, attribute: p.attribute }).slice(7, 67),
          f = features.find((f) => f.key === key)!,
          v = p.operand;
        return {
          op: p.comparison,
          left: { op: 'field', name: key },
          right:
            v.type === 'NUMBER'
              ? literal(Number(scaled(v.decimal, f.scale)), f.unit!)
              : literal(v.value),
        };
      };
      const expr = (e: Expression): SurferExpression =>
        e.op === 'predicate'
          ? pred(e.id)
          : e.op === 'not'
            ? not(expr(e.arg))
            : e.op === 'all'
              ? all(e.args.map(expr))
              : any(e.args.map(expr));
      const s = prepared.s.assertion,
        target = pred(s.target),
        condition = s.condition ? expr(s.condition) : literal(true);
      const rule =
        s.direction === 'UNCONDITIONAL'
          ? target
          : s.direction === 'IF'
            ? any([not(condition), target])
            : s.direction === 'ONLY_IF'
              ? any([not(target), condition])
              : all([any([not(condition), target]), any([not(target), condition])]);
      const scope: SurferExpression[] = [];
      if (s.scope.condition) scope.push(expr(s.scope.condition));
      const time = s.scope.time;
      if (time) {
        if (time.from)
          scope.push({
            op: time.fromInclusive ? 'gte' : 'gt',
            left: { op: 'field', name: 'scope_time' },
            right: literal(Date.parse(time.from) / 86400000, 'day'),
          });
        if (time.to)
          scope.push({
            op: time.toInclusive ? 'lte' : 'lt',
            left: { op: 'field', name: 'scope_time' },
            right: literal(Date.parse(time.to) / 86400000, 'day'),
          });
      }
      return any([
        not(all(scope)),
        ...s.exceptions.filter((e) => e.appliesTo === s.target).map((e) => expr(e.when)),
        rule,
      ]);
    };
    const leftExpression = compile(a),
      rightExpression = compile(b),
      indices = features.map(() => 0);
    let exhausted = false;
    for (;;) {
      if (probes >= this.options.maxProbes || operations + 2 > this.options.maxKernelOperations) {
        exhausted = true;
        break;
      }
      const values: Record<string, SurferObservation> = Object.fromEntries(
        features.map((f, i) => [
          f.key,
          { value: f.domain[indices[i]!]!, ...(f.unit ? { unit: f.unit } : {}) },
        ]),
      );
      probes++;
      const le = evaluateSurferRule(leftExpression, values, {
        maxOperations: Math.min(512, this.options.maxKernelOperations - operations - 1),
      });
      operations += le.operations;
      const re = evaluateSurferRule(rightExpression, values, {
        maxOperations: Math.min(512, this.options.maxKernelOperations - operations),
      });
      operations += re.operations;
      if (le.outcome !== 'UNKNOWN' && re.outcome !== 'UNKNOWN' && le.outcome !== re.outcome)
        return done(
          'CONTRADICTED',
          'SYNTHETIC_DECLARED_RULE_DISAGREEMENT_NOT_WORLD_INCONSISTENCY',
          { features: values, left: le.outcome, right: re.outcome },
        );
      let position = indices.length - 1;
      while (position >= 0 && indices[position]! + 1 >= features[position]!.domain.length) {
        indices[position] = 0;
        position--;
      }
      if (position < 0) break;
      indices[position] = indices[position]! + 1;
    }
    return done(
      'NOT_COMPARABLE',
      exhausted
        ? 'PROBE_OR_KERNEL_BUDGET_EXHAUSTED'
        : 'DIFFERENT_DECLARATIONS_WITHOUT_EQUIVALENCE_PROOF',
    );
  }
}
