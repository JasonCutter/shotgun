import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import type { EvidenceSpan, TransformationRevision } from '../../packages/contracts/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  createStage3Harness,
  documentRevisionQuery,
  evidenceListQuery,
  intakeResultQuery,
} from '../helpers/stage-3.js';
import { fileCommand } from '../helpers/stage-2.js';

describe('Stage 8 format pipeline contract', () => {
  it('preserves XLSX bytes through Intake and resolves cell evidence end-to-end', async () => {
    const transformer = new PythonDocumentFormatAdapter({
      pythonExecutable: process.env.PYTHON ?? 'python',
    });
    const { kernel } = await createStage3Harness({
      transport: new InProcessTransport(),
      transformer,
    });
    const bytes = await readFile(path.resolve('tests/fixtures/stage-8/golden.xlsx'));
    const command = fileCommand(
      'stage8-xlsx',
      'golden.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes,
    );
    await kernel.connector.sendCommand(command);
    const result = await kernel.connector.query<{
      sourceVersionId: string;
      assetReference: { contentHash: string; sizeBytes: number };
    }>(intakeResultQuery(command));
    const revision = await kernel.connector.query<TransformationRevision>(
      documentRevisionQuery(command, result.result.payload.sourceVersionId),
    );
    const evidence = await kernel.connector.query<{ readonly items: readonly EvidenceSpan[] }>(
      evidenceListQuery(command, result.result.payload.sourceVersionId),
    );
    expect(result.result.payload.assetReference.sizeBytes).toBe(bytes.byteLength);
    expect(revision.result.payload.documentIR.mediaType).toContain('spreadsheetml');
    expect(evidence.result.payload.items).toContainEqual(
      expect.objectContaining({
        selectors: expect.arrayContaining([
          expect.objectContaining({ type: 'CellSelector', sheet: 'Golden', cell: 'B2' }),
        ]),
      }),
    );
  }, 20_000);
});
