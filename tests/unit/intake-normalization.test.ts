import { describe, expect, it } from 'vitest';

import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  createStage2Harness,
  directTextCommand,
  fileCommand,
  intakeCommand,
} from '../helpers/stage-2.js';

describe('Stage 2 intake validation', () => {
  it('rejects unsupported files before creating an Original Asset', async () => {
    const { kernel, originalAssetRepository } = await createStage2Harness({
      transport: new InProcessTransport(),
    });
    const command = intakeCommand('unsupported', {
      kind: 'text_file',
      fileName: 'document.pdf',
      mediaType: 'text/plain',
      contentBase64: Buffer.from('not a pdf', 'utf8').toString('base64'),
    });

    await expect(kernel.connector.sendCommand(command)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(
      await originalAssetRepository.findBySubmission('project-a', 'unsupported'),
    ).toBeUndefined();
  });

  it('rejects non-UTF-8 text files without changing their bytes', async () => {
    const { kernel } = await createStage2Harness({ transport: new InProcessTransport() });
    const command = fileCommand(
      'invalid-utf8',
      'invalid.txt',
      'text/plain',
      Uint8Array.from([0xc3, 0x28]),
    );

    await expect(kernel.connector.sendCommand(command)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects direct text that cannot round-trip through UTF-8', async () => {
    const { kernel } = await createStage2Harness({ transport: new InProcessTransport() });
    const command = directTextCommand('invalid-unicode', '\ud800');

    await expect(kernel.connector.sendCommand(command)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
