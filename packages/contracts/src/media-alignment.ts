import {
  sha256Text,
  stableJson,
  unicodeLength,
  type BoundingBoxSelector,
  type TextPositionSelector,
  type TextQuoteSelector,
} from './document-evidence.js';
import { ShotgunError } from './errors.js';

/** An inactive adapter contract, not an extension of SourceMap/EvidenceSpan authority. */
export const MEDIA_ALIGNMENT_SCHEMA_V1 = 'media-alignment/1.0.0' as const;

export type MediaSourceBindingV1 = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly mediaType: 'audio/mpeg' | 'audio/wav' | 'video/mp4' | 'video/webm';
  readonly durationMs: number;
  readonly frameCount?: number;
};

/** Milliseconds from the start of the original asset; end is exclusive. */
export type MediaTimeRangeSelectorV1 = {
  readonly type: 'MediaTimeRangeSelector';
  readonly schemaVersion: '1.0.0';
  readonly startMs: number;
  readonly endMs: number;
};

/** Index and presentation timestamp must match a separately verified frame manifest. */
export type MediaFrameSelectorV1 = {
  readonly type: 'MediaFrameSelector';
  readonly schemaVersion: '1.0.0';
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly frameContentHash: string;
  readonly region?: BoundingBoxSelector;
};

export type MediaSourceSelectorV1 = MediaTimeRangeSelectorV1 | MediaFrameSelectorV1;

export type MediaFrameManifestEntryV1 = {
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly frameContentHash: string;
  readonly widthPx: number;
  readonly heightPx: number;
};

/** Caller obtains these pins through the existing authorized SourceVersion/asset ports. */
export type MediaAlignmentContextV1 = {
  readonly source: MediaSourceBindingV1;
  readonly frames?: readonly MediaFrameManifestEntryV1[];
};

export type MediaTextAlignmentV1 = {
  readonly position: TextPositionSelector;
  readonly quote: TextQuoteSelector;
  readonly exactHash: string;
  readonly selector: MediaSourceSelectorV1;
};

/**
 * Generated text IR is intentionally distinct from DocumentIR 1.0.0. It cannot be
 * supplied as a source-origin SourceMap or EvidenceSpan by this contract.
 * Structural validity proves declared mapping consistency, not semantic fidelity.
 */
export type MediaAlignmentDocumentV1 = {
  readonly schemaVersion: typeof MEDIA_ALIGNMENT_SCHEMA_V1;
  readonly source: MediaSourceBindingV1;
  readonly derivation: {
    readonly kind: 'generated-transcript' | 'generated-description';
    readonly generator: { readonly id: string; readonly version: string };
    readonly requestHash: string;
    readonly responseTextHash: string;
  };
  readonly derivedText: string;
  readonly semanticStatus: 'UNVERIFIED';
  readonly alignmentStatus: 'DECLARED';
  readonly alignments: readonly MediaTextAlignmentV1[];
};

const MAX_TEXT_CODE_POINTS = 128_000;
const MAX_ALIGNMENTS = 16_384;
const MAX_DURATION_MS = 31 * 24 * 60 * 60 * 1_000;

const fail: (reason: string) => never = (reason) => {
  throw new ShotgunError({
    code: 'VALIDATION_ERROR',
    safeMessage: `Media alignment is invalid: ${reason}`,
    module: 'contracts',
    operation: 'parse-media-alignment-v1',
    retryable: false,
  });
};

const record = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object required');
  const result = value as Record<string, unknown>;
  if (
    !required.every((key) => Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fail('missing or unknown fields');
  }
  return result;
};

const label = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('identity required');
  return value as string;
};

const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('integer outside allowed range');
  }
  return value as number;
};

const digest = (value: unknown): string => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) fail('SHA-256 required');
  return value as string;
};

const parseSource = (value: unknown): MediaSourceBindingV1 => {
  const source = record(
    value,
    ['projectId', 'sourceId', 'sourceVersionId', 'sourceContentHash', 'mediaType', 'durationMs'],
    ['frameCount'],
  );
  const mediaType = source['mediaType'];
  if (!['audio/mpeg', 'audio/wav', 'video/mp4', 'video/webm'].includes(mediaType as string)) {
    fail('media type unsupported by this contract');
  }
  const video = (mediaType as string).startsWith('video/');
  if (video !== Object.hasOwn(source, 'frameCount')) fail('frame count required only for video');
  return Object.freeze({
    projectId: label(source['projectId']),
    sourceId: label(source['sourceId']),
    sourceVersionId: label(source['sourceVersionId']),
    sourceContentHash: digest(source['sourceContentHash']),
    mediaType: mediaType as MediaSourceBindingV1['mediaType'],
    durationMs: integer(source['durationMs'], 1, MAX_DURATION_MS),
    ...(video ? { frameCount: integer(source['frameCount'], 1) } : {}),
  });
};

const parseFrames = (
  value: unknown,
  source: MediaSourceBindingV1,
): ReadonlyMap<number, MediaFrameManifestEntryV1> => {
  if (value !== undefined && (!Array.isArray(value) || value.length > MAX_ALIGNMENTS)) {
    fail('frame manifest exceeds budget or is invalid');
  }
  const frames = new Map<number, MediaFrameManifestEntryV1>();
  for (const entry of (value ?? []) as unknown[]) {
    if (source.frameCount === undefined) fail('audio cannot declare frames');
    const frame = record(entry, [
      'frameIndex',
      'timestampMs',
      'frameContentHash',
      'widthPx',
      'heightPx',
    ]);
    const frameIndex = integer(frame['frameIndex'], 0, source.frameCount! - 1);
    if (frames.has(frameIndex)) fail('ambiguous frame manifest');
    frames.set(
      frameIndex,
      Object.freeze({
        frameIndex,
        timestampMs: integer(frame['timestampMs'], 0, source.durationMs - 1),
        frameContentHash: digest(frame['frameContentHash']),
        widthPx: integer(frame['widthPx'], 1, 100_000),
        heightPx: integer(frame['heightPx'], 1, 100_000),
      }),
    );
  }
  // Presentation timestamps must increase with display-frame index. No FPS arithmetic:
  // a variable-frame-rate asset is represented by its actual decoded manifest.
  const ordered = [...frames.values()].sort((left, right) => left.frameIndex - right.frameIndex);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.timestampMs <= ordered[index - 1]!.timestampMs) {
      fail('ambiguous frame timestamps');
    }
  }
  return frames;
};

const parseSelector = (
  value: unknown,
  source: MediaSourceBindingV1,
  frames: ReadonlyMap<number, MediaFrameManifestEntryV1>,
): MediaSourceSelectorV1 => {
  if (!value || typeof value !== 'object') fail('media selector required');
  if ((value as Record<string, unknown>)['type'] === 'MediaTimeRangeSelector') {
    const selector = record(value, ['type', 'schemaVersion', 'startMs', 'endMs']);
    if (selector['schemaVersion'] !== '1.0.0') fail('selector version unsupported');
    const startMs = integer(selector['startMs'], 0, source.durationMs - 1);
    const endMs = integer(selector['endMs'], startMs + 1, source.durationMs);
    return Object.freeze({
      type: 'MediaTimeRangeSelector',
      schemaVersion: '1.0.0',
      startMs,
      endMs,
    });
  }
  const selector = record(
    value,
    ['type', 'schemaVersion', 'frameIndex', 'timestampMs', 'frameContentHash'],
    ['region'],
  );
  if (selector['type'] !== 'MediaFrameSelector' || selector['schemaVersion'] !== '1.0.0') {
    fail('selector type or version unsupported');
  }
  const frameIndex = integer(selector['frameIndex'], 0);
  const frame = frames.get(frameIndex);
  if (
    !frame ||
    selector['timestampMs'] !== frame.timestampMs ||
    selector['frameContentHash'] !== frame.frameContentHash
  ) {
    fail('frame is missing or does not match trusted manifest');
  }
  let region: BoundingBoxSelector | undefined;
  if (Object.hasOwn(selector, 'region')) {
    const box = record(selector['region'], ['type', 'x', 'y', 'width', 'height', 'unit']);
    if (box['type'] !== 'BoundingBoxSelector' || box['unit'] !== 'px')
      fail('pixel region required');
    const x = integer(box['x'], 0, frame!.widthPx - 1);
    const y = integer(box['y'], 0, frame!.heightPx - 1);
    const width = integer(box['width'], 1, frame!.widthPx - x);
    const height = integer(box['height'], 1, frame!.heightPx - y);
    region = Object.freeze({ type: 'BoundingBoxSelector', x, y, width, height, unit: 'px' });
  }
  return Object.freeze({
    type: 'MediaFrameSelector',
    schemaVersion: '1.0.0',
    frameIndex,
    timestampMs: frame!.timestampMs,
    frameContentHash: frame!.frameContentHash,
    ...(region ? { region } : {}),
  });
};

/**
 * Parse an untrusted adapter result against independently obtained immutable pins.
 * Every derived code point has exactly one alignment; missing, overlapping and
 * alternate mappings fail closed. The returned snapshot is detached and frozen.
 * This function does not authorize egress, authenticate a provider or create Evidence.
 */
export const parseMediaAlignmentDocumentV1 = (
  value: unknown,
  expected: MediaAlignmentContextV1,
): MediaAlignmentDocumentV1 => {
  const context = record(expected, ['source'], ['frames']);
  const source = parseSource(context['source']);
  const frames = parseFrames(context['frames'], source);
  const document = record(value, [
    'schemaVersion',
    'source',
    'derivation',
    'derivedText',
    'semanticStatus',
    'alignmentStatus',
    'alignments',
  ]);
  if (document['schemaVersion'] !== MEDIA_ALIGNMENT_SCHEMA_V1) fail('document version unsupported');
  if (stableJson(parseSource(document['source'])) !== stableJson(source))
    fail('source binding mismatch');
  if (document['semanticStatus'] !== 'UNVERIFIED' || document['alignmentStatus'] !== 'DECLARED') {
    fail('derived text cannot claim verified meaning or original authority');
  }
  const text = document['derivedText'];
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > MAX_TEXT_CODE_POINTS * 2 ||
    unicodeLength(text) > MAX_TEXT_CODE_POINTS
  ) {
    fail('derived text missing or exceeds budget');
  }
  const derivedText = text as string;
  const textCodePoints = Array.from(derivedText);
  const derivation = record(document['derivation'], [
    'kind',
    'generator',
    'requestHash',
    'responseTextHash',
  ]);
  if (!['generated-transcript', 'generated-description'].includes(derivation['kind'] as string)) {
    fail('generated derivation declaration required');
  }
  const generator = record(derivation['generator'], ['id', 'version']);
  const responseTextHash = digest(derivation['responseTextHash']);
  if (responseTextHash !== sha256Text(derivedText)) fail('derived text digest mismatch');
  const entries = document['alignments'];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ALIGNMENTS) {
    fail('complete bounded alignments required');
  }
  const alignments: MediaTextAlignmentV1[] = [];
  let cursor = 0;
  let previousEndMs = 0;
  let previousFrameIndex = -1;
  let selectorKind: MediaSourceSelectorV1['type'] | undefined;
  const textLength = textCodePoints.length;
  for (const entry of entries) {
    const alignment = record(entry, ['position', 'quote', 'exactHash', 'selector']);
    const position = record(alignment['position'], ['type', 'start', 'end', 'unit']);
    if (position['type'] !== 'TextPositionSelector' || position['unit'] !== 'unicode-code-point') {
      fail('Unicode position required');
    }
    const start = integer(position['start'], 0, textLength - 1);
    const end = integer(position['end'], start + 1, textLength);
    if (start !== cursor) fail('missing or ambiguous text alignment');
    const quote = record(alignment['quote'], ['type', 'exact']);
    const exact = textCodePoints.slice(start, end).join('');
    if (quote['type'] !== 'TextQuoteSelector' || quote['exact'] !== exact) fail('quote mismatch');
    const exactHash = digest(alignment['exactHash']);
    if (exactHash !== sha256Text(exact)) fail('quote digest mismatch');
    const selector = parseSelector(alignment['selector'], source, frames);
    if (selectorKind !== undefined && selectorKind !== selector.type) fail('mixed alignment kinds');
    selectorKind = selector.type;
    if (selector.type === 'MediaTimeRangeSelector') {
      if (selector.startMs < previousEndMs) fail('overlapping or unordered media ranges');
      previousEndMs = selector.endMs;
    } else {
      if (selector.frameIndex <= previousFrameIndex)
        fail('overlapping or unordered frame alignments');
      previousFrameIndex = selector.frameIndex;
    }
    alignments.push(
      Object.freeze({
        position: Object.freeze({
          type: 'TextPositionSelector',
          start,
          end,
          unit: 'unicode-code-point',
        }),
        quote: Object.freeze({ type: 'TextQuoteSelector', exact }),
        exactHash,
        selector,
      }),
    );
    cursor = end;
  }
  if (cursor !== textLength) fail('derived text has unmapped suffix');
  return Object.freeze({
    schemaVersion: MEDIA_ALIGNMENT_SCHEMA_V1,
    source,
    derivation: Object.freeze({
      kind: derivation['kind'] as MediaAlignmentDocumentV1['derivation']['kind'],
      generator: Object.freeze({
        id: label(generator['id']),
        version: label(generator['version']),
      }),
      requestHash: digest(derivation['requestHash']),
      responseTextHash,
    }),
    derivedText,
    semanticStatus: 'UNVERIFIED',
    alignmentStatus: 'DECLARED',
    alignments: Object.freeze(alignments),
  });
};
