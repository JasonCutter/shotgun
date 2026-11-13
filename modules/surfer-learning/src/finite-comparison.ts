import type {
  SurferBoundedProposal,
  SurferBoundedLimits,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import {
  surferDigest,
  type SurferLearningCase,
  type SurferExpression,
  type SurferObservation,
} from '../../../packages/contracts/src/surfer-learning.js';
import { evaluateSurferRule } from './rule-interpreter.js';
/** Shared finite search mechanics; callers decode and bind their own versioned requests. */
export function searchSurferFiniteComparison(
  rows: readonly SurferLearningCase[],
  limits: SurferBoundedLimits,
) {
  const keys = Object.keys(rows[0]!.features).sort();
  const statistics = {
    generatedAtoms: 0,
    distinctPredicates: 0,
    expressionsChecked: 0,
    primitiveEvaluations: 0,
    selectedClauses: 0,
  };
  const done = (
    status: SurferBoundedProposal['status'],
    reason: string,
    expression: SurferExpression | null = null,
    clauses = 0,
  ): Pick<SurferBoundedProposal, 'status' | 'reason' | 'expression' | 'statistics'> => ({
    status,
    expression,
    statistics: { ...statistics, selectedClauses: clauses },
    reason,
  });
  if (keys.length > limits.maxFeatures) return done('LIMIT_REACHED', 'FEATURE_LIMIT');
  for (const name of keys) {
    const first = rows[0]!.features[name]!;
    if (
      first.value === null ||
      (first.unit !== undefined && typeof first.value !== 'number') ||
      rows.some(
        (r) =>
          r.features[name]!.value === null ||
          typeof r.features[name]!.value !== typeof first.value ||
          r.features[name]!.unit !== first.unit,
      )
    )
      return done('UNSUPPORTED_DATA', 'MISSING_OR_MIXED_TYPE_OR_UNIT');
  }
  const observed = new Map<string, boolean>();
  for (const r of rows) {
    const key = surferDigest(r.features);
    if (observed.has(key) && observed.get(key) !== r.observedOutcome)
      return done('CONTRADICTORY_DATA', 'OPPOSITE_LABELS_FOR_IDENTICAL_FEATURES');
    observed.set(key, r.observedOutcome);
  }
  const all = (1n << BigInt(rows.length)) - 1n,
    target = rows.reduce((mask, r, i) => (r.observedOutcome ? mask | (1n << BigInt(i)) : mask), 0n);
  const check = (mask: bigint): boolean | null => {
    if (statistics.expressionsChecked >= limits.maxExpressions) return null;
    statistics.expressionsChecked++;
    return mask === target;
  };
  for (const value of [false, true]) {
    const fits = check(value ? all : 0n);
    if (fits === null) return done('LIMIT_REACHED', 'EXPRESSION_LIMIT');
    if (fits)
      return done(
        'PROPOSED',
        'FIRST_DEVELOPMENT_CONSISTENT_EXPRESSION',
        { op: 'literal', value },
        0,
      );
  }
  const atoms: { expression: SurferExpression; mask: bigint }[] = [],
    seen = new Set<string>();
  for (const name of keys) {
    const first = rows[0]!.features[name]!,
      values = [
        ...new Set(
          rows.map((r) => r.features[name]!.value as Exclude<SurferObservation['value'], null>),
        ),
      ];
    values.sort((a, b) =>
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
    );
    const ops =
      typeof first.value === 'number'
        ? (['gte', 'lte', 'gt', 'lt', 'eq', 'ne'] as const)
        : (['eq', 'ne'] as const);
    for (const op of ops)
      for (const value of values) {
        if (
          statistics.generatedAtoms >= limits.maxAtoms ||
          statistics.primitiveEvaluations + rows.length > limits.maxPrimitiveEvaluations
        )
          return done('LIMIT_REACHED', 'ATOM_OR_PRIMITIVE_LIMIT');
        const expression: SurferExpression = {
          op,
          left: { op: 'field', name },
          right: {
            op: 'literal',
            value,
            ...(first.unit === undefined ? {} : { unit: first.unit }),
          },
        };
        statistics.generatedAtoms++;
        let mask = 0n;
        for (let i = 0; i < rows.length; i++) {
          statistics.primitiveEvaluations++;
          const e = evaluateSurferRule(expression, rows[i]!.features, { maxOperations: 512 });
          if (e.outcome === 'UNKNOWN') return done('UNSUPPORTED_DATA', 'PRIMITIVE_UNKNOWN');
          if (e.outcome === 'TRUE') mask |= 1n << BigInt(i);
        }
        if (mask === 0n || mask === all || seen.has(mask.toString())) continue;
        seen.add(mask.toString());
        atoms.push({ expression, mask });
        statistics.distinctPredicates = atoms.length;
        const fits = check(mask);
        if (fits === null) return done('LIMIT_REACHED', 'EXPRESSION_LIMIT');
        if (fits) return done('PROPOSED', 'FIRST_DEVELOPMENT_CONSISTENT_EXPRESSION', expression, 1);
      }
  }
  if (limits.maxClauses >= 2)
    for (let i = 0; i < atoms.length; i++)
      for (let j = i + 1; j < atoms.length; j++)
        for (const op of ['all', 'any'] as const) {
          const mask =
              op === 'all' ? atoms[i]!.mask & atoms[j]!.mask : atoms[i]!.mask | atoms[j]!.mask,
            fits = check(mask);
          if (fits === null) return done('LIMIT_REACHED', 'EXPRESSION_LIMIT');
          if (fits)
            return done(
              'PROPOSED',
              'FIRST_DEVELOPMENT_CONSISTENT_EXPRESSION',
              { op, args: [atoms[i]!.expression, atoms[j]!.expression] },
              2,
            );
        }
  if (limits.maxClauses >= 3)
    for (let i = 0; i < atoms.length; i++)
      for (let j = i + 1; j < atoms.length; j++)
        for (let k = j + 1; k < atoms.length; k++)
          for (const op of ['all', 'any'] as const) {
            const mask =
                op === 'all'
                  ? atoms[i]!.mask & atoms[j]!.mask & atoms[k]!.mask
                  : atoms[i]!.mask | atoms[j]!.mask | atoms[k]!.mask,
              fits = check(mask);
            if (fits === null) return done('LIMIT_REACHED', 'EXPRESSION_LIMIT');
            if (fits)
              return done(
                'PROPOSED',
                'FIRST_DEVELOPMENT_CONSISTENT_EXPRESSION',
                { op, args: [atoms[i]!.expression, atoms[j]!.expression, atoms[k]!.expression] },
                3,
              );
          }
  return done('NO_FIT', 'NO_EXPRESSION_IN_BOUNDED_GRAMMAR');
}
