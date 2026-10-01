import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Stage 8 PDFium glyph recovery and flat formula extraction', () => {
  it('repairs aligned comparison signs and conservative one-line equations', () => {
    const python = process.env.PYTHON ?? 'python';
    const result = spawnSync(python, [path.resolve('tests/python/test_pdf_glyph_recovery.py')], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });

    expect(result.error?.message).toBeUndefined();
    const output = result.stdout + result.stderr;
    expect(result.status, output).toBe(0);
    expect(output).toContain('Ran 10 tests');
    expect(output).toContain('OK');
  });
});
