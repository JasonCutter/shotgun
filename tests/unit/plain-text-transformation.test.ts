import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import golden from '../fixtures/stage-3-plain-text-golden.json';
import {
  sha256Text,
  stableJson,
  type TransformationRevision,
} from '../../packages/contracts/src/index.js';
import {
  buildEvidenceCandidates,
  type EvidenceLocatorPort,
} from '../../modules/evidence/src/index.js';

const adapter = new LucasAugmentedPlainTextAdapter();

const transform = (
  text: string,
  sourceId = '11111111-1111-4111-8111-111111111111',
  sourceVersionId = '22222222-2222-4222-8222-222222222222',
) =>
  adapter.transform({
    sourceId,
    sourceVersionId,
    sourceContentHash: sha256Text(text),
    mediaType: 'text/plain',
    text,
  });

const revisionFor = (text: string): TransformationRevision => {
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const output = adapter.transform({
    sourceId,
    sourceVersionId,
    sourceContentHash: sha256Text(text),
    mediaType: 'text/plain',
    text,
  });
  return {
    revisionId: randomUUID(),
    projectId: 'project-a',
    sourceId,
    sourceVersionId,
    sourceContentHash: sha256Text(text),
    transformer: adapter.identity,
    ...output,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: '2026-07-17T00:00:00.000Z',
  };
};

describe('Stage 3 Plain Text Transformation golden behavior', () => {
  it('keeps Korean, emoji and CRLF text stable with Unicode code-point offsets', () => {
    const text = golden.input;
    const first = transform(text);
    const second = transform(text);

    expect(stableJson(first)).toBe(stableJson(second));
    expect(first.documentHash).toBe(golden.documentHash);
    expect(first.sourceMapHash).toBe(golden.sourceMapHash);
    expect(
      first.documentIR.blocks.map((block) => ({
        text: block.text,
        sentences: block.sentences.map((sentence) => sentence.text),
      })),
    ).toEqual(golden.blocks);
    expect(
      first.sourceMap.entries.map((entry) => ({
        pointer: entry.pointer,
        start: entry.position.start,
        end: entry.position.end,
      })),
    ).toEqual(golden.positions);
    for (const entry of first.sourceMap.entries) {
      expect(entry.exactHash).toBe(sha256Text(entry.quote.exact));
    }
  });

  it('splits a complete Korean nominal direction line into exact sentence Evidence', () => {
    const direction = '베타가 커질수록 요구되는 기대수익률도 커지는 방향';
    const reason = '위험을 더 많이 부담한다면 투자자는 더 높은 수익률을 요구하기 때문이다.';
    const revision = revisionFor(`${direction}\r\n${reason}`);
    const sentences = revision.documentIR.blocks.flatMap((block) => block.sentences);
    const evidence = buildEvidenceCandidates(revision, adapter).filter(
      (item) => item.nodeKind === 'sentence',
    );

    expect(sentences.map((sentence) => sentence.text)).toEqual([direction, reason]);
    expect(evidence.map((item) => item.quote.exact)).toEqual([direction, reason]);
    for (const item of evidence) {
      expect(item.exactHash).toBe(sha256Text(item.quote.exact));
    }
  });

  it('uses context to locate repeated quotes and refuses an ambiguous short quote', () => {
    const source = 'alpha common omega. beta common delta.';

    expect(adapter.locate(source, { type: 'TextQuoteSelector', exact: 'common' })).toBeUndefined();
    expect(
      adapter.locate(source, {
        type: 'TextQuoteSelector',
        exact: 'common',
        prefix: 'beta ',
        suffix: ' delta',
      }),
    ).toMatchObject({ start: 25, end: 31, unit: 'unicode-code-point' });
    expect(
      adapter.locate('alpha\n  beta', {
        type: 'TextQuoteSelector',
        exact: 'alpha beta',
      }),
    ).toMatchObject({ start: 0, end: 12 });
  });
});

describe('Stage 3 SourceMap and Evidence validation', () => {
  it('round-trips every source entry and excludes summary-origin entries from evidence', () => {
    const revision = revisionFor('원문 한 문장. 다음 문장.');
    const sentenceIndex = revision.sourceMap.entries.findIndex(
      (entry) => entry.nodeKind === 'sentence',
    );
    const sourceEntry = revision.sourceMap.entries[sentenceIndex]!;
    const mixedRevision = {
      ...revision,
      sourceMap: {
        ...revision.sourceMap,
        entries: revision.sourceMap.entries.map((entry, index) =>
          index === sentenceIndex ? { ...entry, origin: 'summary' as const } : entry,
        ),
      },
    };
    const corrected = {
      ...mixedRevision,
      sourceMapHash: sha256Text(stableJson(mixedRevision.sourceMap)),
    };
    const evidence = buildEvidenceCandidates(corrected, adapter);

    expect(evidence.some((item) => item.pointer === sourceEntry.pointer)).toBe(false);
    expect(evidence.every((item) => item.origin === 'source')).toBe(true);
  });

  it.each([
    [
      'offset',
      (revision: TransformationRevision) => {
        const entries = [...revision.sourceMap.entries];
        entries[0] = {
          ...entries[0]!,
          position: { ...entries[0]!.position, end: entries[0]!.position.end + 1 },
        };
        return { ...revision, sourceMap: { ...revision.sourceMap, entries } };
      },
    ],
    [
      'hash',
      (revision: TransformationRevision) => ({
        ...revision,
        sourceMap: {
          ...revision.sourceMap,
          entries: revision.sourceMap.entries.map((entry, index) =>
            index === 0 ? { ...entry, exactHash: sha256Text('forged') } : entry,
          ),
        },
      }),
    ],
    [
      'SourceVersion',
      (revision: TransformationRevision) => ({
        ...revision,
        sourceMap: {
          ...revision.sourceMap,
          entries: revision.sourceMap.entries.map((entry, index) =>
            index === 1 ? { ...entry, sourceVersionId: randomUUID() } : entry,
          ),
        },
      }),
    ],
  ])('rejects a wrong %s reference', (_name, mutate) => {
    const revision = mutate(revisionFor('검증할 원문입니다.'));
    const rehashed = {
      ...revision,
      sourceMapHash: sha256Text(stableJson(revision.sourceMap)),
    };
    expect(() => buildEvidenceCandidates(rehashed, adapter)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('allows the locator adapter to be replaced behind the same port', () => {
    const revision = revisionFor('Unique first. Unique second.');
    const positionOnlyLocator: EvidenceLocatorPort = {
      locate(source, quote) {
        const start = Array.from(source.slice(0, source.indexOf(quote.exact))).length;
        return {
          type: 'TextPositionSelector',
          start,
          end: start + Array.from(quote.exact).length,
          unit: 'unicode-code-point',
        };
      },
    };

    expect(buildEvidenceCandidates(revision, positionOnlyLocator)).toEqual(
      buildEvidenceCandidates(revision, adapter),
    );
  });
});
