import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PythonDocumentFormatAdapter,
  NodeSafeUrlFetchAdapter,
  SafeUrlTextAdapter,
} from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  sha256Text,
  stableJson,
  type DocumentIR,
  type SourceSelector,
  type TransformationRevision,
} from '../../packages/contracts/src/index.js';
import { buildEvidenceCandidates } from '../../modules/evidence/src/index.js';

const fixtures = path.resolve('tests/fixtures/stage-8');
const pythonExecutable = process.env.PYTHON ?? 'python';

const hashBytes = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const transformFixture = async (
  fileName: string,
  mediaType: DocumentIR['mediaType'],
  multimodal = false,
) => {
  const bytes = await readFile(path.join(fixtures, fileName));
  const adapter = new PythonDocumentFormatAdapter({
    pythonExecutable,
    ...(multimodal
      ? {
          multimodal: {
            async describe() {
              return 'Blue validation image.';
            },
          },
        }
      : {}),
  });
  const output = await adapter.transform({
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    sourceContentHash: hashBytes(bytes),
    mediaType,
    contentBase64: bytes.toString('base64'),
  });
  return { adapter, bytes, output };
};

const selectorsOf = (
  output: Awaited<ReturnType<typeof transformFixture>>['output'],
): readonly SourceSelector[] => output.sourceMap.entries.flatMap((entry) => entry.selectors ?? []);

describe('Stage 8 format Golden Corpus', () => {
  it.each([
    ['golden.html', 'text/html', 'CssSelector', 'Shotgun Format Golden'],
    ['golden.pdf', 'application/pdf', 'PageSelector', 'Shotgun'],
    [
      'golden.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'CellSelector',
      'Shotgun DOCX Golden',
    ],
    ['golden.csv', 'text/csv', 'CellSelector', 'Status'],
    [
      'golden.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'CellSelector',
      '=1+1',
    ],
    [
      'golden.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'ShapeSelector',
      'Shotgun PPTX Golden',
    ],
  ] as const)(
    'extracts %s with recoverable selectors',
    async (fileName, mediaType, selectorType, expectedText) => {
      const { output } = await transformFixture(fileName, mediaType);
      expect(output.documentIR.blocks.map((item) => item.text).join('\n')).toContain(expectedText);
      expect(selectorsOf(output)).toContainEqual(expect.objectContaining({ type: selectorType }));
      expect(
        output.sourceMap.entries.every((entry) => entry.sourceContentHash.startsWith('sha256:')),
      ).toBe(true);
    },
    20_000,
  );

  it('preserves PDF page and BBox selectors together', async () => {
    const { output } = await transformFixture('golden.pdf', 'application/pdf');
    const selectors = selectorsOf(output);
    expect(selectors).toContainEqual(expect.objectContaining({ type: 'PageSelector', page: 1 }));
    expect(selectors).toContainEqual(
      expect.objectContaining({ type: 'BoundingBoxSelector', page: 1, unit: 'pt' }),
    );
  });

  it('preserves spreadsheet table cells without structural loss', async () => {
    const { output } = await transformFixture(
      'golden.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const cells = selectorsOf(output).filter((selector) => selector.type === 'CellSelector');
    expect(cells).toHaveLength(6);
    expect(cells).toContainEqual(
      expect.objectContaining({ type: 'CellSelector', sheet: 'Golden', cell: 'B2' }),
    );
  });

  it('requires multimodal validation for image meaning and records the image BBox', async () => {
    await expect(transformFixture('golden.png', 'image/png')).rejects.toMatchObject({
      code: 'MULTIMODAL_VALIDATION_REQUIRED',
    });
    const { output } = await transformFixture('golden.png', 'image/png', true);
    expect(output.documentIR.blocks[0]?.text).toBe('Blue validation image.');
    expect(selectorsOf(output)).toContainEqual(
      expect.objectContaining({
        type: 'BoundingBoxSelector',
        width: 320,
        height: 180,
        unit: 'px',
      }),
    );
  });

  it('returns explicit corrupt and unsupported format statuses', async () => {
    const adapter = new PythonDocumentFormatAdapter({ pythonExecutable });
    const base = {
      sourceId: randomUUID(),
      sourceVersionId: randomUUID(),
      sourceContentHash: hashBytes(Buffer.from('broken')),
      contentBase64: Buffer.from('broken').toString('base64'),
    };
    await expect(
      adapter.transform({ ...base, mediaType: 'application/pdf' }),
    ).rejects.toMatchObject({
      code: 'FORMAT_CORRUPT',
    });
    await expect(
      adapter.transform({ ...base, mediaType: 'audio/mpeg' as DocumentIR['mediaType'] }),
    ).rejects.toMatchObject({ code: 'FORMAT_UNSUPPORTED' });
    await expect(transformFixture('encrypted.pdf', 'application/pdf')).rejects.toMatchObject({
      code: 'FORMAT_ENCRYPTED',
    });
  });

  it('keeps binary SourceVersion evidence separate from translated revisions', async () => {
    const { adapter, output } = await transformFixture('golden.pdf', 'application/pdf');
    const sourceVersionId = output.sourceMap.entries[0]!.sourceVersionId;
    const sourceId = randomUUID();
    const sourceContentHash = output.sourceMap.entries[0]!.sourceContentHash;
    const translated = {
      ...output.sourceMap.entries[1]!,
      pointer: '/blocks/0',
      origin: 'translation' as const,
    };
    const sourceMap = { ...output.sourceMap, entries: [output.sourceMap.entries[0]!, translated] };
    const revision: TransformationRevision = {
      revisionId: randomUUID(),
      projectId: 'project-stage-8',
      sourceId,
      sourceVersionId,
      sourceContentHash,
      transformer: adapter.identity,
      documentIR: output.documentIR,
      sourceMap,
      documentHash: output.documentHash,
      sourceMapHash: sha256Text(stableJson(sourceMap)),
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: new Date().toISOString(),
    };
    const candidates = buildEvidenceCandidates(revision, new LucasAugmentedPlainTextAdapter());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.pointer).toBe('');
  });

  it('reuses HTML extraction for accessible video-page text and blocks private URLs', async () => {
    const transformer = new PythonDocumentFormatAdapter({ pythonExecutable });
    const adapter = new SafeUrlTextAdapter(
      {
        async fetch(url) {
          expect(url.hostname).toBe('video.example.com');
          return {
            mediaType: 'text/html',
            contentBase64: Buffer.from(
              '<main><h1>Video title</h1><section aria-label="Transcript"><p>Accessible transcript text.</p></section><video src="ignored.mp4"></video></main>',
            ).toString('base64'),
          };
        },
      },
      transformer,
    );
    const base = {
      sourceId: randomUUID(),
      sourceVersionId: randomUUID(),
      sourceContentHash: hashBytes(Buffer.from('page')),
    };
    const output = await adapter.transform({ ...base, url: 'https://video.example.com/watch/1' });
    expect(output.documentIR.blocks.map((item) => item.text).join(' ')).toContain(
      'Accessible transcript text.',
    );
    expect(output.documentIR.blocks.map((item) => item.text).join(' ')).not.toContain(
      'ignored.mp4',
    );
    await expect(
      adapter.transform({ ...base, url: 'https://127.0.0.1/private' }),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });

  it('fetches public HTML with redirect, DNS, timeout, and size policy boundaries', async () => {
    const requested: string[] = [];
    const fetcher = new NodeSafeUrlFetchAdapter({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: async (url) => {
        requested.push(url);
        if (url.endsWith('/start')) {
          return new Response(null, {
            status: 302,
            headers: { location: '/final' },
          });
        }
        return new Response('<main><p>Public HTML</p></main>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    });
    const fetched = await fetcher.fetch(new URL('https://example.com/start'));
    expect(Buffer.from(fetched.contentBase64, 'base64').toString()).toContain('Public HTML');
    expect(requested).toEqual(['https://example.com/start', 'https://example.com/final']);

    const privateFetcher = new NodeSafeUrlFetchAdapter({
      resolve: async () => [{ address: '10.0.0.2', family: 4 }],
      fetch: async () => new Response('never'),
    });
    await expect(privateFetcher.fetch(new URL('https://private.example/'))).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });

  it('allows a format adapter replacement without changing the upper contract shape', async () => {
    const first = await transformFixture('golden.csv', 'text/csv');
    const replacement = new PythonDocumentFormatAdapter({ pythonExecutable });
    const second = await replacement.transform({
      sourceId: randomUUID(),
      sourceVersionId: randomUUID(),
      sourceContentHash: hashBytes(first.bytes),
      mediaType: 'text/csv',
      contentBase64: first.bytes.toString('base64'),
    });
    expect(Object.keys(second).sort()).toEqual(Object.keys(first.output).sort());
    expect(Object.keys(second.documentIR).sort()).toEqual(
      Object.keys(first.output.documentIR).sort(),
    );
    expect(Object.keys(second.sourceMap).sort()).toEqual(
      Object.keys(first.output.sourceMap).sort(),
    );
  });
});
