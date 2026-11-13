import {
  sha256Text,
  stableJson,
  unicodeLength,
  unicodeSlice,
} from '../../../packages/contracts/src/document-evidence.js';
import { assertSurferJson, surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferSourceMaterial } from '../../../packages/contracts/src/surfer-source.js';
import type { SurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  decodeSurferObservationAnchor,
  cognitiveFailure,
  decodeSurferObservedLiteral,
  decodeSurferLiteralNormalization,
  type SurferObservedLiteral,
  type SurferLiteralNormalization,
  type SurferLiteralNormalizationPort,
  type SurferObservationSelection,
  type SurferObservationAnchor,
  type SurferAnchorRef,
} from '../../../packages/contracts/src/surfer-cognition.js';

/** Literal syntax only. Never infers sentence polarity, policy role, subject or causal meaning. */
export function parseSurferLiteral(raw: string): SurferObservedLiteral {
  if (typeof raw !== 'string' || unicodeLength(raw) > 2048)
    throw cognitiveFailure('Literal exceeds the bounded parser profile.');
  const value = raw.trim();
  if (value === 'true' || value === 'false') return { kind: 'BOOLEAN', value: value === 'true' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
      ? { kind: 'DATE', value }
      : { kind: 'UNMODELED', reason: 'INVALID_CALENDAR_DATE' };
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return { kind: 'TEXT', value: parsed };
    } catch {
      /* malformed literal stays unmodeled */
    }
    return { kind: 'UNMODELED', reason: 'INVALID_STRING_LITERAL' };
  }
  const match =
    /^([+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)(?:[ \t]+([A-Za-z°%][A-Za-z0-9°%/_-]*))?$/.exec(value);
  if (!match)
    return {
      kind: 'UNMODELED',
      reason: /[0-9],[0-9]|^[+-]?0[0-9]/.test(value)
        ? 'AMBIGUOUS_NUMBER_FORMAT'
        : 'NON_LITERAL_OR_UNSUPPORTED_SYNTAX',
    };
  const decimal = match[1]!.replace(/^\+/, ''),
    digits = decimal.replace(/[-.]/g, '').length,
    scale = decimal.split('.')[1]?.length ?? 0;
  if (digits > 38 || scale > 18 || (match[2]?.length ?? 0) > 64)
    return { kind: 'UNMODELED', reason: 'UNSUPPORTED_PRECISION_OR_UNIT_LENGTH' };
  return {
    kind: 'NUMBER',
    decimal,
    unit: match[2] ?? null,
    precision: { digits, scale, notation: 'PLAIN_DECIMAL', interpretation: 'LEXICAL_ONLY' },
  };
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}
function finiteDecimal(n: bigint, d: bigint): string | null {
  const g = gcd(n, d);
  n /= g;
  d /= g;
  let twos = 0,
    fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  const scale = Math.max(twos, fives);
  if (d !== 1n || scale > 38) return null;
  n *= 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives);
  const sign = n < 0n ? '-' : '',
    digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return sign + digits.slice(0, -scale) + (fraction ? '.' + fraction : '');
}
const UNITS: Readonly<Record<string, { dimension: string; factor: bigint }>> = {
  mg: { dimension: 'mass', factor: 1n },
  g: { dimension: 'mass', factor: 1000n },
  kg: { dimension: 'mass', factor: 1000000n },
  mm: { dimension: 'length', factor: 1n },
  cm: { dimension: 'length', factor: 10n },
  m: { dimension: 'length', factor: 1000n },
  ms: { dimension: 'time', factor: 1n },
  s: { dimension: 'time', factor: 1000n },
  min: { dimension: 'time', factor: 60000n },
  h: { dimension: 'time', factor: 3600000n },
};
export class ExactSurferLiteralNormalization implements SurferLiteralNormalizationPort {
  readonly revision = 'surfer.exact-mass-length-time.v1';
  normalize(
    observed: SurferObservedLiteral,
    targetUnit: string | null,
  ): SurferLiteralNormalization {
    observed = decodeSurferObservedLiteral(observed);
    if (
      targetUnit !== null &&
      (typeof targetUnit !== 'string' || !targetUnit.length || targetUnit.length > 64)
    )
      throw cognitiveFailure('Invalid normalization target unit.');
    if (
      observed.kind === 'NUMBER' &&
      surferDigest(
        parseSurferLiteral(observed.decimal + (observed.unit ? ' ' + observed.unit : '')),
      ) !== surferDigest(observed)
    )
      throw cognitiveFailure('Observed numeric value and precision disagree.');
    const base: SurferLiteralNormalization = {
      state: 'NOT_REQUIRED',
      targetUnit,
      normalizedValue: null,
      normalizedUnit: null,
      conversion: null,
      reason: null,
    };
    if (targetUnit === null) return base;
    const unresolved = (reason: string): SurferLiteralNormalization => ({
      ...base,
      state: 'UNRESOLVED',
      reason,
    });
    if (observed.kind !== 'NUMBER') return unresolved('NON_NUMERIC_LITERAL');
    if (!observed.unit) return unresolved('MISSING_SOURCE_UNIT');
    const a = Object.hasOwn(UNITS, observed.unit) ? UNITS[observed.unit] : undefined,
      b = Object.hasOwn(UNITS, targetUnit) ? UNITS[targetUnit] : undefined;
    if (!a || !b) return unresolved('UNSUPPORTED_UNIT');
    if (a.dimension !== b.dimension) return unresolved('DIMENSION_MISMATCH');
    const g = gcd(a.factor, b.factor),
      num = a.factor / g,
      den = b.factor / g;
    const conversion = {
      revision: this.revision,
      numerator: num.toString(),
      denominator: den.toString(),
      rounding: 'EXACT' as const,
    };
    const coefficient = BigInt(observed.decimal.replace('.', '')),
      divisor = 10n ** BigInt(observed.precision.scale);
    const value = finiteDecimal(coefficient * num, divisor * den);
    if (value === null)
      return { ...unresolved('NON_TERMINATING_OR_UNSUPPORTED_DECIMAL'), conversion };
    return {
      ...base,
      state: 'RESOLVED',
      normalizedValue: value,
      normalizedUnit: targetUnit,
      conversion,
    };
  }
}
export const anchorRefOf = (a: SurferObservationAnchor): SurferAnchorRef => ({
  anchorId: a.anchorId,
  revision: a.revision,
  digest: a.digest,
});
export const cognitiveViewDigest = (
  basis: SurferSourceBasisV2,
  anchors: SurferObservationAnchor[],
) => surferDigest({ basisContentDigest: basis.contentDigest, anchors: anchors.map(anchorRefOf) });
/** Material must come from the trusted current Source port; this pure helper does not authorize access. */
export function buildSurferObservationAnchor(
  materialInput: SurferSourceMaterial,
  basis: SurferSourceBasisV2,
  selection: SurferObservationSelection,
  normalizer: SurferLiteralNormalizationPort = new ExactSurferLiteralNormalization(),
): SurferObservationAnchor {
  assertSurferJson(materialInput);
  assertSurferJson(selection);
  const material = structuredClone(materialInput),
    e = material.evidence.find((e) => e.evidenceId === selection.evidenceId),
    dep = basis.sources.find((s) => s.sourceId === selection.sourceId);
  if (
    !e ||
    !dep ||
    material.sourceId !== selection.sourceId ||
    e.sourceId !== material.sourceId ||
    e.sourceVersionId !== material.sourceVersionId ||
    e.revisionId !== material.revisionId ||
    e.projectId !== material.scope.spaceId
  )
    throw cognitiveFailure('Observation source/Evidence lineage mismatch.');
  if (
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start ||
    selection.end > unicodeLength(e.quote.exact) ||
    selection.end - selection.start > 2048
  )
    throw cognitiveFailure('Observation selection exceeds the actual Unicode Evidence.');
  const entry = material.sourceMap.entries.find((x) => x.pointer === e.pointer),
    root = material.sourceMap.entries.find((x) => x.pointer === '');
  if (
    !entry ||
    !root ||
    entry.exactHash !== e.exactHash ||
    e.exactHash !== sha256Text(e.quote.exact) ||
    surferDigest(entry.position) !== surferDigest(e.position) ||
    surferDigest(entry.selectors ?? []) !== surferDigest(e.selectors ?? []) ||
    sha256Text(stableJson(material.documentIR)) !== material.documentHash ||
    sha256Text(stableJson(material.sourceMap)) !== material.sourceMapHash
  )
    throw cognitiveFailure('Observation Evidence/SourceMap/hash mismatch.');
  const rawLiteral = unicodeSlice(e.quote.exact, selection.start, selection.end),
    start = e.position.start + selection.start,
    end = e.position.start + selection.end;
  if (unicodeSlice(root.quote.exact, start, end) !== rawLiteral)
    throw cognitiveFailure('Observation does not round-trip to the source root.');
  const observed = parseSurferLiteral(rawLiteral),
    normalization = decodeSurferLiteralNormalization(
      normalizer.normalize(observed, selection.targetUnit),
    );
  if (
    normalization.targetUnit !== selection.targetUnit ||
    (normalization.conversion && normalization.conversion.revision !== normalizer.revision)
  )
    throw cognitiveFailure('Normalizer result does not match the requested unit/revision.');
  const identity = {
    basis: basis.contentDigest,
    sourceId: material.sourceId,
    sourceVersionId: material.sourceVersionId,
    evidenceId: e.evidenceId,
    start,
    end,
    parserRevision: 'surfer.literal.v1',
    normalizerRevision: normalizer.revision,
    targetUnit: selection.targetUnit,
  };
  const content = {
    schemaVersion: '1.0.0' as const,
    anchorId: 'anchor:' + surferDigest(identity),
    revision: 1 as const,
    scope: material.scope,
    source: {
      originalAssetId: material.originalAssetId,
      sourceId: material.sourceId,
      sourceVersionId: material.sourceVersionId,
      revisionId: material.revisionId,
      indexingResultId: material.indexingResultId,
      sourceContentHash: material.sourceContentHash,
      documentHash: material.documentHash,
      sourceMapHash: material.sourceMapHash,
      materialProof: dep.materialProof,
      evidenceId: e.evidenceId,
      evidenceDigest: surferDigest(e),
      pointer: e.pointer,
      sourceBindingContentDigest: basis.contentDigest,
    },
    position: {
      type: 'TextPositionSelector' as const,
      start,
      end,
      unit: 'unicode-code-point' as const,
    },
    selectors: [...(e.selectors ?? [])],
    rawLiteral,
    observed,
    normalization,
    producer: {
      parserRevision: 'surfer.literal.v1',
      executionRef: 'literal:' + surferDigest(identity),
    },
    contentRole: 'UNTRUSTED_SOURCE_DATA' as const,
    groundingAssessment: 'SOURCE_BOUND_LITERAL' as const,
    semanticAssessment: 'NOT_EVALUATED' as const,
  };
  return decodeSurferObservationAnchor({ ...content, digest: surferDigest(content) });
}

export {
  cognitiveFailure,
  validateSurferFrameGrounding,
} from '../../../packages/contracts/src/surfer-cognition.js';
