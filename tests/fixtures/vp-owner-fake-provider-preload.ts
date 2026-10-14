/** Explicit isolated proof injection. Never imported by a production entry. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = '85e3a88a3be010c047fe32d6b917bcef70635837';
const entry = path.resolve(process.argv[1] ?? '.');
const isLauncher = entry === path.join(root, 'scripts/launch-local.ts');
if (isLauncher) {
  assert.equal(process.env.VP_CANONICAL_OWNER_FAKE_PROOF, expected);
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    expected,
  );
  assert(!existsSync(path.join(root, '.env')) && !existsSync(path.join(root, '.env.test')));
  for (const name of ['DATABASE_URL', 'VP_GLOBAL_RELATION_BUDGET_DATABASE_URL']) {
    const url = new URL(process.env[name]!);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55432');
    assert.match(url.pathname, /^\/shotgun_test_iso_[a-z0-9_]+$/u);
  }
  assert.notEqual(process.env.DATABASE_URL, process.env.VP_GLOBAL_RELATION_BUDGET_DATABASE_URL);
  for (const name of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'])
    assert(!process.env[name]);
  const logPath = process.env.VP_OWNER_FAKE_LOG!;
  assert(
    path
      .resolve(logPath)
      .startsWith(path.resolve(process.env.VP_OWNER_PROOF_DIRECTORY!) + path.sep),
  );
  const record = (value: Record<string, unknown>) =>
    appendFileSync(
      logPath,
      JSON.stringify({
        ...value,
        pid: process.pid,
        parentPid: process.ppid,
        at: new Date().toISOString(),
      }) + '\n',
    );
  record({
    type: 'PROCESS_START',
    runtimeChild: process.env.SHOTGUN_LAUNCH_RUNTIME_CHILD === '1',
    entry,
    sourceSha: expected,
  });
  // A test IPC stimulus invokes the unchanged owner's real signal handler.
  // This is not a Windows OS signal or reboot proof.
  if (process.env.SHOTGUN_LAUNCH_RUNTIME_CHILD !== '1') {
    process.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'proof-signal-shutdown'
      )
        process.emit('SIGTERM');
    });
  } else {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== process.env.PORT
      ) {
        record({ type: 'EGRESS_DENIED', hostname: url.hostname });
        throw new Error('OWNER_PROOF_PROVIDER_EGRESS_DENIED');
      }
      return originalFetch(input, init);
    };
    const { DeepSeekConnectivityAdapter } =
      await import('../../adapters/ai-provider-deepseek/src/index.js');
    const { FakeAIProviderAdapter } = await import('../../adapters/ai-provider-fake/src/index.js');
    const fake = new FakeAIProviderAdapter();
    DeepSeekConnectivityAdapter.prototype.generateStructured = async ({ apiKey, request }) => {
      assert.equal(Buffer.from(apiKey).toString(), 'FAKE-VP-OWNER-PROVIDER-NOT-A-LIVE-CREDENTIAL');
      const prompt = JSON.parse(request.prompt) as {
        left?: { claim: string };
        right?: { claim: string };
        task?: string;
      };
      const kind = prompt.left
        ? 'relation'
        : prompt.task?.startsWith('shotgun-ask')
          ? 'answer'
          : 'extraction';
      const prior = existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { type: string })
        : [];
      assert(
        prior.filter((item) => item.type === 'FAKE_CALL').length < 18,
        'ISOLATED_FAKE_CALL_CAP',
      );
      const providerResponseId = `fake-owner-${randomUUID()}`;
      record({
        type: 'FAKE_CALL',
        kind,
        providerResponseId,
        requestDigest: createHash('sha256').update(request.prompt).digest('hex'),
      });
      if (kind === 'relation') {
        const choice = prompt.left!.claim === prompt.right!.claim ? 'EQUIVALENT' : 'RELATED';
        const choices = [
          'EQUIVALENT',
          'SUPPORTS',
          'QUALIFIES',
          'CONTRADICTS',
          'RELATED',
          'UNRESOLVED',
        ];
        return {
          rawText: JSON.stringify({
            choice,
            direction: 'NONE',
            confidence: 0.99,
            probabilities: Object.fromEntries(choices.map((c) => [c, c === choice ? 0.99 : 0.002])),
          }),
          providerResponseId,
          modelVersion: 'fake-no-semantic-certification',
          inputTokens: 10,
          outputTokens: 10,
        };
      }
      return { ...(await fake.generateStructured(request)), providerResponseId };
    };
  }
}
