import {
  assertSurferJson,
  decodeSurferExpression,
  surferFailure,
  type SurferExpression,
  type SurferObservation,
  type SurferScalar,
} from '../../../packages/contracts/src/surfer-learning.js';

export type SurferRuleEvaluation = {
  readonly outcome: 'TRUE' | 'FALSE' | 'UNKNOWN';
  readonly reasons: readonly string[];
  readonly usedFeatures: readonly string[];
  readonly operations: number;
};
type Value = { readonly value: SurferScalar; readonly unit?: string } | undefined;

/** Declarative, deterministic IR only: never eval, Function, shell, or model code. */
export function evaluateSurferRule(
  expressionInput: unknown,
  features: Readonly<Record<string, SurferObservation>>,
  options: { readonly maxOperations?: number } = {},
): SurferRuleEvaluation {
  const expression = decodeSurferExpression(expressionInput);
  assertSurferJson(features);
  const maxOperations = options.maxOperations ?? 4096;
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > 50_000) {
    throw surferFailure('Invalid Surfer operation budget.', 'evaluate-rule');
  }
  const reasons = new Set<string>();
  const used = new Set<string>();
  let operations = 0;
  let exhausted = false;
  const unknown = (reason: string): undefined => {
    reasons.add(reason);
    return undefined;
  };
  const boolean = (v: Value): boolean | undefined => {
    if (!v) return undefined;
    if (typeof v.value !== 'boolean' || v.unit !== undefined) return unknown('BOOLEAN_REQUIRED');
    return v.value;
  };
  const visit = (node: SurferExpression): Value => {
    if (operations >= maxOperations) {
      exhausted = true;
      return unknown('OPERATION_BUDGET_EXHAUSTED');
    }
    operations++;
    switch (node.op) {
      case 'literal':
        if (node.unit !== undefined && typeof node.value !== 'number')
          return unknown('INVALID_UNIT');
        return { value: node.value, ...(node.unit === undefined ? {} : { unit: node.unit }) };
      case 'field': {
        used.add(node.name);
        if (!Object.hasOwn(features, node.name)) return unknown('MISSING_FEATURE');
        const value = features[node.name];
        if (
          !value ||
          typeof value !== 'object' ||
          !Object.hasOwn(value, 'value') ||
          Object.keys(value).some((key) => key !== 'value' && key !== 'unit')
        )
          return unknown('INVALID_FEATURE');
        if (value.value === null) return unknown('MISSING_FEATURE');
        if (!['string', 'number', 'boolean'].includes(typeof value.value))
          return unknown('INVALID_FEATURE');
        if (typeof value.value === 'number' && !Number.isFinite(value.value))
          return unknown('INVALID_FEATURE');
        if (
          value.unit !== undefined &&
          (typeof value.unit !== 'string' || typeof value.value !== 'number')
        )
          return unknown('INVALID_UNIT');
        return value as Exclude<Value, undefined>;
      }
      case 'not': {
        const result = boolean(visit(node.arg));
        return result === undefined ? undefined : { value: !result };
      }
      case 'all':
      case 'any': {
        const values = node.args.map((arg) => boolean(visit(arg)));
        if (node.op === 'all' && values.includes(false)) return { value: false };
        if (node.op === 'any' && values.includes(true)) return { value: true };
        if (values.includes(undefined)) return undefined;
        return { value: node.op === 'all' };
      }
      default: {
        const a = visit(node.left),
          b = visit(node.right);
        if (!a || !b) return undefined;
        if (['add', 'sub', 'mul', 'div'].includes(node.op)) {
          if (typeof a.value !== 'number' || typeof b.value !== 'number')
            return unknown('NUMBER_REQUIRED');
          let unit: string | undefined;
          let value: number;
          if (node.op === 'add' || node.op === 'sub') {
            if (a.unit !== b.unit) return unknown('UNIT_MISMATCH');
            unit = a.unit;
            value = node.op === 'add' ? a.value + b.value : a.value - b.value;
          } else if (node.op === 'mul') {
            if (a.unit !== undefined && b.unit !== undefined)
              return unknown('UNSUPPORTED_UNIT_COMPOSITION');
            unit = a.unit ?? b.unit;
            value = a.value * b.value;
          } else {
            if (b.value === 0) return unknown('DIVISION_BY_ZERO');
            if (b.unit !== undefined && a.unit !== b.unit)
              return unknown('UNSUPPORTED_UNIT_COMPOSITION');
            unit = b.unit === undefined ? a.unit : undefined;
            value = a.value / b.value;
          }
          if (!Number.isFinite(value)) return unknown('INVALID_ARITHMETIC');
          return { value, ...(unit === undefined ? {} : { unit }) };
        }
        if (typeof a.value !== typeof b.value) return unknown('TYPE_MISMATCH');
        if (a.unit !== b.unit) return unknown('UNIT_MISMATCH');
        if (node.op === 'eq') return { value: a.value === b.value };
        if (node.op === 'ne') return { value: a.value !== b.value };
        if (typeof a.value !== 'number' || typeof b.value !== 'number')
          return unknown('NUMBER_REQUIRED');
        switch (node.op) {
          case 'gt':
            return { value: a.value > b.value };
          case 'gte':
            return { value: a.value >= b.value };
          case 'lt':
            return { value: a.value < b.value };
          case 'lte':
            return { value: a.value <= b.value };
          default:
            return unknown('UNSUPPORTED_OPERATION');
        }
      }
    }
  };
  const result = boolean(visit(expression));
  return {
    outcome: exhausted || result === undefined ? 'UNKNOWN' : result ? 'TRUE' : 'FALSE',
    reasons: [...reasons].sort(),
    usedFeatures: [...used].sort(),
    operations,
  };
}
