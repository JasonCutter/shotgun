import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import type { DocumentIR } from '../../packages/contracts/src/index.js';

const pythonExecutable = process.env.PYTHON ?? 'python';
const execFileAsync = promisify(execFile);

const contentHash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const storedZip = (names: readonly string[], flags = 0): Buffer => {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt32LE(0, 26);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    filename.copy(local, 30);
    locals.push(local);

    const directory = Buffer.alloc(46 + filename.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt32LE(0, 16);
    directory.writeUInt32LE(0, 20);
    directory.writeUInt32LE(0, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    filename.copy(directory, 46);
    central.push(directory);
    offset += local.length;
  }
  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, end]);
};

const transform = async (
  bytes: Buffer,
  mediaType: DocumentIR['mediaType'],
  options: ConstructorParameters<typeof PythonDocumentFormatAdapter>[0] = {},
) =>
  new PythonDocumentFormatAdapter({ pythonExecutable, ...options }).transform({
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    sourceContentHash: contentHash(bytes),
    mediaType,
    contentBase64: bytes.toString('base64'),
  });

const escapePdfText = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');

const twoLinePdf = (): Buffer => {
  const content = `BT\n/F1 12 Tf 1 0 0 1 72 720 Tm (${escapePdfText('First sentence ends here.')}) Tj\n/F1 12 Tf 1 0 0 1 72 690 Tm (${escapePdfText('Second sentence ends here.')}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
  ];
  const header = Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'binary');
  const body: Buffer[] = [header];
  const offsets = [0];
  let offset = header.byteLength;
  for (const [index, object] of objects.entries()) {
    const encoded = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'utf8');
    offsets.push(offset);
    body.push(encoded);
    offset += encoded.byteLength;
  }
  const xrefOffset = offset;
  body.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((value) => `${String(value).padStart(10, '0')} 00000 n `)
        .join(
          '\n',
        )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'utf8',
    ),
  );
  return Buffer.concat(body);
};

const highCardinalityFixtures = async (): Promise<
  readonly [Buffer, Buffer, Buffer, Buffer, Buffer]
> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts1-r3-'));
  const csv = Buffer.from(
    Array.from({ length: 40 }, (_, row) =>
      Array.from({ length: 40 }, (_, column) => `r${row}c${column}`).join(','),
    ).join('\n'),
    'utf8',
  );
  await writeFile(path.join(directory, 'large.csv'), csv);
  const generator = path.join(directory, 'generate.py');
  await writeFile(
    generator,
    `from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches

out = Path(sys.argv[1])
doc = Document()
for index in range(600):
    doc.add_paragraph(f'docx-block-{index} deterministic valid content')
doc.save(out / 'large.docx')

workbook = Workbook()
sheet = workbook.active
for row in range(1, 41):
    for column in range(1, 41):
        sheet.cell(row=row, column=column, value=f'xlsx-cell-{row}-{column}')
workbook.save(out / 'large.xlsx')

sparse_workbook = Workbook()
sparse_sheet = sparse_workbook.active
for row in range(1, 11):
    sparse_sheet.cell(row=row, column=1, value=f'sparse-{row}')
sparse_source = out / 'sparse-source.xlsx'
sparse_workbook.save(sparse_source)
with ZipFile(sparse_source, 'r') as source, ZipFile(out / 'sparse-dimension.xlsx', 'w', ZIP_DEFLATED) as target:
    for info in source.infolist():
        member = source.read(info.filename)
        if info.filename == 'xl/worksheets/sheet1.xml':
            member = member.replace(b'ref="A1:A10"', b'ref="A1:XFD10"')
        target.writestr(info, member)

presentation = Presentation()
blank = presentation.slide_layouts[6]
for slide_number in range(4):
    slide = presentation.slides.add_slide(blank)
    for shape_number in range(40):
        shape = slide.shapes.add_textbox(Inches(0.1 + (shape_number % 8) * 1.1), Inches(0.1 + (shape_number // 8) * 0.7), Inches(1.0), Inches(0.4))
        shape.text = f'pptx-shape-{slide_number}-{shape_number}'
presentation.save(out / 'large.pptx')
`,
    'utf8',
  );
  await execFileAsync(pythonExecutable, [generator, directory], { windowsHide: true });
  return [
    await readFile(path.join(directory, 'large.docx')),
    await readFile(path.join(directory, 'large.xlsx')),
    csv,
    await readFile(path.join(directory, 'large.pptx')),
    await readFile(path.join(directory, 'sparse-dimension.xlsx')),
  ];
};

describe('TS-1 document-format safety boundaries', () => {
  let highCardinality: readonly [Buffer, Buffer, Buffer, Buffer, Buffer];

  beforeAll(async () => {
    highCardinality = await highCardinalityFixtures();
  });

  it('rejects unsafe OOXML member paths before importing the heavy parser', async () => {
    const bytes = storedZip(['word/../document.xml']);
    await expect(
      transform(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).rejects.toMatchObject({ code: 'FORMAT_CORRUPT' });
  });

  it('rejects encrypted and over-cardinality OOXML packages', async () => {
    const encrypted = storedZip(['word/document.xml'], 0x1);
    const tooManyMembers = storedZip(
      Array.from({ length: 2_049 }, (_, index) => `word/member-${index}.xml`),
    );
    const mediaType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
    await expect(transform(encrypted, mediaType)).rejects.toMatchObject({
      code: 'FORMAT_ENCRYPTED',
    });
    await expect(transform(tooManyMembers, mediaType)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('performs image preflight before multimodal validation', async () => {
    let describeCalls = 0;
    const bytes = Buffer.from('not an image');
    await expect(
      transform(bytes, 'image/png', {
        multimodal: {
          async describe() {
            describeCalls += 1;
            return 'should not run';
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'FORMAT_CORRUPT' });
    expect(describeCalls).toBe(0);
  });

  it('fails closed when the worker JSON has the wrong runtime shape', async () => {
    await expect(
      transform(Buffer.from('broken'), 'application/pdf', {
        workerPath: 'tests/fixtures/stage-8/invalid-worker.py',
      }),
    ).rejects.toMatchObject({ code: 'TERMINAL_FAILURE' });
  });

  it('maps cleanup failure to terminal failure after a deadline', async () => {
    await expect(
      transform(Buffer.from('broken'), 'application/pdf', {
        workerPath: 'tests/fixtures/stage-8/sleep-worker.py',
        workerOptions: {
          timeoutMs: 25,
          terminateProcessTree: async () => {
            throw new Error('synthetic cleanup failure');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'TERMINAL_FAILURE' });
  });

  it.each([
    ['DOCX', 0, 600, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['XLSX', 1, 1600, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['CSV', 2, 1600, 'text/csv'],
    ['PPTX', 3, 160, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ] as const)(
    'accepts valid high-cardinality %s input',
    async (_name, index, minimumBlocks, mediaType) => {
      const output = await transform(highCardinality[index], mediaType);
      expect(output.documentIR.blocks.length).toBeGreaterThanOrEqual(minimumBlocks);
    },
    15_000,
  );

  it('bounds sparse XLSX iteration by actual worksheet cells, not declared dimensions', async () => {
    const output = await transform(
      highCardinality[4],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(output.documentIR.blocks).toHaveLength(10);
    expect(output.documentIR.blocks.map((block) => block.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `sparse-${index + 1}`),
    );
  });

  it('keeps 1600-cell CSV valid and rejects excessive logical cardinality', async () => {
    const valid = await transform(highCardinality[2], 'text/csv');
    expect(valid.documentIR.blocks).toHaveLength(1600);

    const tooManyCells = Buffer.from(Array.from({ length: 8193 }, () => 'x').join(','), 'utf8');
    await expect(transform(tooManyCells, 'text/csv')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
  }, 15_000);

  it('maps PDF physical line segments to only the overlapping sentence', async () => {
    const output = await transform(twoLinePdf(), 'application/pdf');
    const paragraphs = output.sourceMap.entries.filter((entry) => entry.nodeKind === 'paragraph');
    const sentences = output.sourceMap.entries.filter((entry) => entry.nodeKind === 'sentence');
    expect(paragraphs).toHaveLength(1);
    expect(sentences).toHaveLength(2);
    const paragraphBoxes = paragraphs[0]!.selectors?.filter(
      (selector) => selector.type === 'BoundingBoxSelector',
    );
    const firstBoxes = sentences[0]!.selectors?.filter(
      (selector) => selector.type === 'BoundingBoxSelector',
    );
    const secondBoxes = sentences[1]!.selectors?.filter(
      (selector) => selector.type === 'BoundingBoxSelector',
    );
    expect(paragraphBoxes).toHaveLength(2);
    expect(firstBoxes).toHaveLength(1);
    expect(secondBoxes).toHaveLength(1);
    expect(firstBoxes).not.toEqual(secondBoxes);
  });

  it('rejects normalized text by UTF-8 bytes rather than code-point count', async () => {
    await expect(
      transform(Buffer.from('worker-input'), 'application/pdf', {
        workerPath: 'tests/fixtures/stage-8/large-unicode-worker.py',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each([
    ['segment end beyond text', 'segment-end-beyond-text-worker.py'],
    ['too many segments', 'too-many-segments-worker.py'],
    ['too many segment selectors', 'too-many-segment-selectors-worker.py'],
    ['malformed segment selector', 'malformed-segment-selector-worker.py'],
  ] as const)('rejects %s as terminal worker failure', async (_name, workerPath) => {
    await expect(
      transform(Buffer.from('worker-input'), 'application/pdf', {
        workerPath: `tests/fixtures/stage-8/${workerPath}`,
      }),
    ).rejects.toMatchObject({ code: 'TERMINAL_FAILURE', retryable: false });
  });

  it('rejects raw image/document bytes above the intake ceiling before any provider call', async () => {
    let describeCalls = 0;
    await expect(
      transform(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', {
        multimodal: {
          async describe() {
            describeCalls += 1;
            return 'should not run';
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(describeCalls).toBe(0);
  });
});
