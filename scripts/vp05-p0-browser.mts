/** Reuse the frozen main browser journey in an isolated test-only database. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createIsolatedPostgresTestDatabase } from '../tests/helpers/isolated-postgres-test-database.js';
const output = 'docs/implementation/vp05-p0-execution-authority-2026-10-11';
const database = await createIsolatedPostgresTestDatabase();
try {
  const env = {
    ...process.env,
    TEST_DATABASE_URL: database.databaseUrl,
    VP_LIVE_DEEPSEEK: '0',
    VP_LIVE_DEEPSEEK_BROWSER: '0',
    CI: 'true',
  };
  delete env.DATABASE_URL;
  const child = spawn(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      'tests/browser/vp-two-action-ui.spec.ts',
      '--workers=1',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      log += chunk.toString();
      process.stdout.write(chunk);
    });
  const exit = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  await mkdir(output, { recursive: true });
  await writeFile(output + '/browser.log', log);
  await writeFile(
    output + '/browser-result.json',
    JSON.stringify(
      {
        canonicalMain: '083e779ec64e3216df78eb327a5ba73b3996a21c',
        databaseName: database.databaseName,
        exitCode: exit,
        fixture:
          'unchanged main VP browser journey; fake provider; runtime server composition fixture; explicit project setup; relation worker not enabled by this journey',
        scope:
          'upload A, revise A, add B, Ask current citations, cross-project rejection; not live-model or installed-launcher acceptance',
        liveProviderCalls: 0,
        cleanup: 'isolated database disposed in finally',
      },
      null,
      2,
    ) + '\n',
  );
  process.exitCode = exit;
} finally {
  await database.dispose();
}
