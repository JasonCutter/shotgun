import type { SurferGuidedRuleCatalog } from '../../../packages/contracts/src/surfer-guided-rule.js';
import type { SurferObservation } from '../../../packages/contracts/src/surfer-learning.js';

/** Literal standalone assignments only. Never infer facts from narrative or convert units. */
export function readSurferAskRulePremises(
  question: string,
  fields: SurferGuidedRuleCatalog['items'][number]['fields'],
) {
  const features: Record<string, SurferObservation> = {},
    reasons: string[] = [];
  let fenced = false;
  const lines = question.split(/\r?\n/).filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
  for (const field of fields) {
    const assignments = lines.filter(
      (line) =>
        line.trim().startsWith(field.name + ' =') || line.trim().startsWith(field.name + '='),
    );
    if (!assignments.length) {
      reasons.push('MISSING_PREMISE:' + field.name);
      continue;
    }
    if (assignments.length !== 1) {
      reasons.push('AMBIGUOUS_PREMISE:' + field.name);
      continue;
    }
    const raw = assignments[0]!
      .trim()
      .slice(field.name.length)
      .replace(/^\s*=\s*/, '');
    const match =
      /^("(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:\s+([^\s]+))?$/.exec(
        raw,
      );
    if (!match) {
      reasons.push('UNSUPPORTED_PREMISE:' + field.name);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(match[1]!);
    } catch {
      reasons.push('UNSUPPORTED_PREMISE:' + field.name);
      continue;
    }
    if (value === null) {
      reasons.push('MISSING_PREMISE:' + field.name);
      continue;
    }
    const kind =
      field.type === 'NUMBER' ? 'number' : field.type === 'BOOLEAN' ? 'boolean' : 'string';
    if (
      typeof value !== kind ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (match[2] ?? null) !== field.unit
    ) {
      reasons.push('TYPE_OR_UNIT_MISMATCH:' + field.name);
      continue;
    }
    if (!field.values.some((v) => v === value)) {
      reasons.push('UNOBSERVED_VALUE:' + field.name);
      continue;
    }
    features[field.name] = {
      value: value as string | number | boolean,
      ...(field.unit === null ? {} : { unit: field.unit }),
    };
  }
  return { features, reasons };
}
