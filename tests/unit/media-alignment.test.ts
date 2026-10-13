import { describe, expect, it } from 'vitest';

import {
  MEDIA_ALIGNMENT_SCHEMA_V1,
  parseMediaAlignmentDocumentV1,
  sha256Text,
  unicodeLength,
  unicodeSlice,
  type MediaAlignmentContextV1,
  type MediaAlignmentDocumentV1,
  type MediaTextAlignmentV1,
} from '../../packages/contracts/src/index.js';

const context: MediaAlignmentContextV1 = {
  source: {
    projectId: 'project-media',
    sourceId: 'source-media',
    sourceVersionId: 'version-1',
    sourceContentHash: sha256Text('immutable audio bytes'),
    mediaType: 'audio/wav',
    durationMs: 2_000,
  },
};

const segment = (
  text: string,
  start: number,
  end: number,
  startMs: number,
  endMs: number,
): MediaTextAlignmentV1 => {
  const exact = unicodeSlice(text, start, end);
  return {
    position: { type: 'TextPositionSelector', start, end, unit: 'unicode-code-point' },
    quote: { type: 'TextQuoteSelector', exact },
    exactHash: sha256Text(exact),
    selector: { type: 'MediaTimeRangeSelector', schemaVersion: '1.0.0', startMs, endMs },
  };
};

const audio = (text = '조건: 10%가 아니다. 😀'): MediaAlignmentDocumentV1 => ({
  schemaVersion: MEDIA_ALIGNMENT_SCHEMA_V1,
  source: { ...context.source },
  derivation: {
    kind: 'generated-transcript',
    generator: { id: 'offline-fixture', version: '1.0.0' },
    requestHash: sha256Text('request'),
    responseTextHash: sha256Text(text),
  },
  derivedText: text,
  semanticStatus: 'UNVERIFIED',
  alignmentStatus: 'DECLARED',
  alignments: [segment(text, 0, unicodeLength(text), 0, 2_000)],
});

const videoContext: MediaAlignmentContextV1 = {
  source: { ...context.source, mediaType: 'video/mp4', frameCount: 100 },
  frames: [
    {
      frameIndex: 0,
      timestampMs: 0,
      frameContentHash: sha256Text('frame-0'),
      widthPx: 100,
      heightPx: 60,
    },
    {
      frameIndex: 42,
      timestampMs: 1_777,
      frameContentHash: sha256Text('frame-42'),
      widthPx: 100,
      heightPx: 60,
    },
  ],
};

const video = (): MediaAlignmentDocumentV1 => {
  const base = audio();
  return {
    ...base,
    source: { ...videoContext.source },
    derivation: { ...base.derivation, kind: 'generated-description' },
    alignments: [
      {
        ...base.alignments[0]!,
        selector: {
          type: 'MediaFrameSelector',
          schemaVersion: '1.0.0',
          frameIndex: 42,
          timestampMs: 1_777,
          frameContentHash: sha256Text('frame-42'),
          region: { type: 'BoundingBoxSelector', x: 0, y: 0, width: 100, height: 60, unit: 'px' },
        },
      },
    ],
  };
};

const rejected = (value: unknown, expected = context): void => {
  expect(() => parseMediaAlignmentDocumentV1(value, expected)).toThrowError(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      operation: 'parse-media-alignment-v1',
      retryable: false,
    }),
  );
};

describe('inactive media alignment v1 foundation', () => {
  it('preserves Unicode, numbers, conditions and negation as declared generated text', () => {
    const value = audio();
    const result = parseMediaAlignmentDocumentV1(value, context);
    expect(result).toEqual(value);
    expect(result.alignments[0]!.position.end).toBe(Array.from(value.derivedText).length);
    expect(result.semanticStatus).toBe('UNVERIFIED');
    expect(result).not.toHaveProperty('origin');
    expect(result).not.toHaveProperty('evidenceId');
  });

  it('accepts adjacent complete time segments at the exact duration boundary', () => {
    const value = audio('A😀B');
    const result = parseMediaAlignmentDocumentV1(
      {
        ...value,
        alignments: [
          segment(value.derivedText, 0, 2, 0, 1_000),
          segment(value.derivedText, 2, 3, 1_000, 2_000),
        ],
      },
      context,
    );
    expect(result.alignments.map((entry) => entry.quote.exact)).toEqual(['A😀', 'B']);
  });

  it('detaches and freezes every identity, generator, quote and selector', () => {
    const value = structuredClone(video());
    const expected = structuredClone(videoContext);
    const result = parseMediaAlignmentDocumentV1(value, expected);
    const mutable = value as unknown as { source: { sourceId: string }; derivedText: string };
    mutable.source.sourceId = 'changed';
    mutable.derivedText = 'changed';
    expect(result.source.sourceId).toBe(context.source.sourceId);
    expect(result.derivedText).not.toBe('changed');
    for (const part of [
      result,
      result.source,
      result.derivation,
      result.derivation.generator,
      result.alignments,
      result.alignments[0],
      result.alignments[0]!.position,
      result.alignments[0]!.quote,
      result.alignments[0]!.selector,
      (result.alignments[0]!.selector as { region: unknown }).region,
    ]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });

  it.each([
    'projectId',
    'sourceId',
    'sourceVersionId',
    'sourceContentHash',
    'durationMs',
    'mediaType',
  ])('rejects a changed immutable source pin: %s', (key) => {
    const value = audio();
    rejected({
      ...value,
      source: { ...value.source, [key]: key === 'durationMs' ? 3_000 : 'changed' },
    });
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid start time %s',
    (startMs) => {
      const value = audio();
      rejected({
        ...value,
        alignments: [
          {
            ...value.alignments[0],
            selector: {
              type: 'MediaTimeRangeSelector',
              schemaVersion: '1.0.0',
              startMs,
              endMs: 2_000,
            },
          },
        ],
      });
    },
  );

  it.each([0, -1, 2_001, 1.5])('rejects empty, reversed or out-of-bounds end time %s', (endMs) => {
    const value = audio();
    rejected({
      ...value,
      alignments: [
        {
          ...value.alignments[0],
          selector: {
            type: 'MediaTimeRangeSelector',
            schemaVersion: '1.0.0',
            startMs: 0,
            endMs,
          },
        },
      ],
    });
  });

  it('rejects time overlap even when text is completely and uniquely mapped', () => {
    const value = audio('AB');
    rejected({
      ...value,
      alignments: [segment('AB', 0, 1, 0, 1_500), segment('AB', 1, 2, 1_000, 2_000)],
    });
  });

  it('rejects missing, overlapping, unordered and empty text alignments', () => {
    const value = audio('ABC');
    for (const alignments of [
      [],
      [segment('ABC', 0, 2, 0, 1_000)],
      [segment('ABC', 1, 3, 0, 1_000)],
      [segment('ABC', 0, 2, 0, 1_000), segment('ABC', 1, 3, 1_000, 2_000)],
      [segment('ABC', 2, 3, 0, 1_000), segment('ABC', 0, 2, 1_000, 2_000)],
    ])
      rejected({ ...value, alignments });
  });

  it('rejects wrong quote, quote hash, response digest and UTF-16 offsets', () => {
    const value = audio('😀A');
    for (const entry of [
      { ...value.alignments[0], quote: { type: 'TextQuoteSelector', exact: '😀B' } },
      { ...value.alignments[0], exactHash: sha256Text('different') },
      {
        ...value.alignments[0],
        position: { type: 'TextPositionSelector', start: 0, end: 3, unit: 'unicode-code-point' },
      },
    ])
      rejected({ ...value, alignments: [entry] });
    rejected({
      ...value,
      derivation: { ...value.derivation, responseTextHash: sha256Text('other') },
    });
  });

  it('requires generated provenance and rejects original/Fact/verified authority claims', () => {
    const value = audio();
    for (const patch of [
      { semanticStatus: 'VERIFIED' },
      { alignmentStatus: 'VERIFIED' },
      { origin: 'source' },
      { fact: true },
      { derivation: { ...value.derivation, kind: 'original-text' } },
      { derivation: { ...value.derivation, generator: { id: '', version: '1.0.0' } } },
    ])
      rejected({ ...value, ...patch });
  });

  it('rejects malformed, unsupported versions and unknown fields without echoing source content', () => {
    const value = audio('secret media content');
    for (const input of [
      null,
      [],
      {},
      { ...value, schemaVersion: 'media-alignment/2.0.0' },
      { ...value, unexpected: 'secret media content' },
      { ...value, source: { ...value.source, injected: true } },
      { ...value, alignments: [undefined] },
    ])
      rejected(input);
    try {
      parseMediaAlignmentDocumentV1({ ...value, injected: value.derivedText }, context);
    } catch (error) {
      expect((error as Error).message).not.toContain(value.derivedText);
    }
  });

  it('bounds derived text, alignment cardinality and metadata', () => {
    rejected(audio(' '));
    rejected(audio('a'.repeat(128_001)));
    rejected({ ...audio(), alignments: Array(16_385).fill(audio().alignments[0]) });
    rejected(audio(), { source: { ...context.source, durationMs: 0 } });
    rejected(audio(), { source: { ...context.source, durationMs: Number.POSITIVE_INFINITY } });
  });

  it('uses actual presentation timestamps for sparse variable-frame-rate manifests', () => {
    const result = parseMediaAlignmentDocumentV1(video(), videoContext);
    expect(result.alignments[0]!.selector).toMatchObject({ frameIndex: 42, timestampMs: 1_777 });
  });

  it.each([
    { frameIndex: 99 },
    { frameIndex: -1 },
    { frameIndex: 100 },
    { timestampMs: 1_776 },
    { timestampMs: 2_000 },
    { frameContentHash: sha256Text('other frame') },
    { schemaVersion: '2.0.0' },
  ])('rejects absent or inconsistent frames: %j', (patch) => {
    const value = video();
    rejected(
      {
        ...value,
        alignments: [
          {
            ...value.alignments[0],
            selector: {
              ...value.alignments[0]!.selector,
              ...patch,
            },
          },
        ],
      },
      videoContext,
    );
  });

  it('requires a trusted frame manifest and rejects duplicate or unordered timestamps', () => {
    const frames = videoContext.frames!;
    rejected(video(), { source: videoContext.source });
    rejected(video(), { ...videoContext, frames: [frames[0]!, frames[0]!] });
    rejected(video(), { ...videoContext, frames: [frames[0]!, { ...frames[1]!, timestampMs: 0 }] });
    rejected(video(), { ...videoContext, frames: [{ ...frames[0]!, frameIndex: 100 }] });
    rejected(video(), { ...videoContext, frames: [{ ...frames[0]!, timestampMs: 2_000 }] });
    rejected(audio(), { ...context, frames });
  });

  it('rejects unsupported video metadata and audio frame-count declarations', () => {
    rejected(video(), { source: { ...videoContext.source, frameCount: undefined } });
    rejected(audio(), { source: { ...context.source, frameCount: 10 } });
  });

  it.each([
    { x: -1 },
    { width: 101 },
    { height: 61 },
    { width: 0 },
    { x: 0.5 },
    { unit: 'pt' },
    { page: 1 },
  ])('rejects invalid pixel regions: %j', (patch) => {
    const value = video();
    const selector = value.alignments[0]!.selector;
    rejected(
      {
        ...value,
        alignments: [
          {
            ...value.alignments[0],
            selector: {
              ...selector,
              region: {
                type: 'BoundingBoxSelector',
                x: 0,
                y: 0,
                width: 100,
                height: 60,
                unit: 'px',
                ...patch,
              },
            },
          },
        ],
      },
      videoContext,
    );
  });

  it('rejects repeated frames and mixed frame/time mappings for the same text document', () => {
    const value = video();
    const frame = value.alignments[0]!.selector;
    const base = audio('AB');
    const first = { ...segment('AB', 0, 1, 0, 1_000), selector: frame };
    rejected(
      {
        ...value,
        derivedText: 'AB',
        derivation: base.derivation,
        alignments: [first, { ...segment('AB', 1, 2, 1_000, 2_000), selector: frame }],
      },
      videoContext,
    );
    rejected(
      {
        ...value,
        derivedText: 'AB',
        derivation: base.derivation,
        alignments: [first, segment('AB', 1, 2, 1_000, 2_000)],
      },
      videoContext,
    );
  });
});
