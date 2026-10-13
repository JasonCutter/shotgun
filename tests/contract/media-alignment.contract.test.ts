import { describe, expect, it } from 'vitest';

import {
  MEDIA_ALIGNMENT_SCHEMA_V1,
  parseMediaAlignmentDocumentV1,
  sha256Text,
  stableJson,
  unicodeLength,
  type MediaAlignmentContextV1,
  type MediaAlignmentDocumentV1,
  type TransformationRevision,
  type EvidenceSpan,
} from '../../packages/contracts/src/index.js';
import {
  createStage3Harness,
  directTextCommand,
  documentRevisionQuery,
  evidenceListQuery,
  evidenceQuery,
  intakeResultQuery,
} from '../helpers/stage-3.js';

const context: MediaAlignmentContextV1 = {
  source: {
    projectId: 'project-1',
    sourceId: 'source-1',
    sourceVersionId: 'source-version-1',
    sourceContentHash: sha256Text('offline audio fixture bytes'),
    mediaType: 'audio/mpeg',
    durationMs: 4_000,
  },
};

// Authored offline declarations exercise interchangeable adapter outputs only.
// Neither fixture adapter decodes media or certifies that these words were spoken.
const adapterOutput = (id: string): MediaAlignmentDocumentV1 => {
  const text = '2026년 조건: 값은 10%, 보장하지 않는다. 😀';
  return {
    schemaVersion: MEDIA_ALIGNMENT_SCHEMA_V1,
    source: context.source,
    derivation: {
      kind: 'generated-transcript',
      generator: { id, version: '1.0.0' },
      requestHash: sha256Text(`fixture-request:${id}`),
      responseTextHash: sha256Text(text),
    },
    derivedText: text,
    semanticStatus: 'UNVERIFIED',
    alignmentStatus: 'DECLARED',
    alignments: [
      {
        position: {
          type: 'TextPositionSelector',
          start: 0,
          end: unicodeLength(text),
          unit: 'unicode-code-point',
        },
        quote: { type: 'TextQuoteSelector', exact: text },
        exactHash: sha256Text(text),
        selector: {
          type: 'MediaTimeRangeSelector',
          schemaVersion: '1.0.0',
          startMs: 0,
          endMs: 4_000,
        },
      },
    ],
  };
};

describe('media alignment inactive adapter contract', () => {
  it('permits adapter replacement without changing original identity or alignment semantics', () => {
    const first = parseMediaAlignmentDocumentV1(adapterOutput('fixture-adapter-A'), context);
    const replacement = parseMediaAlignmentDocumentV1(
      JSON.parse(JSON.stringify(adapterOutput('fixture-adapter-B'))),
      context,
    );
    expect(replacement.source).toEqual(first.source);
    expect(replacement.derivedText).toBe(first.derivedText);
    expect(replacement.alignments).toEqual(first.alignments);
    expect(replacement.derivation.generator.id).not.toBe(first.derivation.generator.id);
    expect(replacement.semanticStatus).toBe('UNVERIFIED');
  });

  it('round-trips immutable declarations and fails closed against a revised source', () => {
    const declared = parseMediaAlignmentDocumentV1(adapterOutput('fixture-adapter-A'), context);
    const replay = parseMediaAlignmentDocumentV1(JSON.parse(stableJson(declared)), context);
    expect(stableJson(replay)).toBe(stableJson(declared));
    expect(() =>
      parseMediaAlignmentDocumentV1(declared, {
        source: {
          ...context.source,
          sourceVersionId: 'source-version-2',
          sourceContentHash: sha256Text('new bytes'),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR', retryable: false }));
  });

  it('keeps generated declarations out of active transformation and Evidence repositories', async () => {
    const harness = await createStage3Harness();
    const before = harness.transformationRepository.counts();
    parseMediaAlignmentDocumentV1(adapterOutput('fixture-adapter-A'), context);
    expect(harness.evidenceRepository.count()).toBe(0);
    expect(harness.transformationRepository.counts()).toEqual(before);

    const original = '원본 조건은 10%입니다. 😀 보장하지 않습니다.';
    const command = directTextCommand('media-foundation-compatibility', original);
    await harness.kernel.connector.sendCommand(command);
    const intake = (
      await harness.kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const revision = (
      await harness.kernel.connector.query<TransformationRevision>(
        documentRevisionQuery(command, intake.sourceVersionId),
      )
    ).result.payload;
    const listed = (
      await harness.kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(command, intake.sourceVersionId),
      )
    ).result.payload;
    const evidence = await Promise.all(
      listed.items.map(
        async (entry) =>
          (
            await harness.kernel.connector.query<EvidenceSpan>(
              evidenceQuery(command, entry.evidenceId),
            )
          ).result.payload,
      ),
    );
    expect(revision.documentIR.schemaVersion).toBe('1.0.0');
    expect(revision.documentIR.mediaType).toBe('text/plain');
    expect(revision.sourceMap.schemaVersion).toBe('1.0.0');
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((span) => span.origin === 'source')).toBe(true);
    expect(evidence.map((span) => span.quote.exact)).toContain('원본 조건은 10%입니다.');
    expect(
      evidence.every(
        (span) =>
          !span.selectors?.some((selector) => (selector.type as string).startsWith('Media')),
      ),
    ).toBe(true);
  });
});
