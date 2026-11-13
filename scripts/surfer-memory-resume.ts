import { SurferDirectiveScenarioEvaluatorV2 } from '../adapters/surfer-memory-query/src/index.js';
/** Explicit isolated inquiry continuation CLI. Uses existing sessions; no auth bootstrap, model calls or .env loading. */
import { readFileSync, statSync } from 'node:fs';
import { Pool } from 'pg';
import { ShotgunError } from '../packages/contracts/src/errors.js';
import { PostgresSurferSourceSession } from '../adapters/surfer-shotgun-source-postgres/src/index.js';
import { ShotgunSurferRoutedMemorySession } from '../adapters/surfer-shotgun-bridge/src/routed-memory.js';
import { SurferMemoryLanguageService } from '../modules/surfer-core/src/memory-language.js';
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--request-file')
    throw new Error('Use --request-file with a bounded JSON command.');
  const target = process.env.SURFER_MEMORY_DATABASE_URL,
    projectId = process.env.SURFER_MEMORY_PROJECT_ID,
    sessionToken = process.env.SURFER_MEMORY_SESSION_TOKEN;
  if (!target || !projectId || !sessionToken)
    throw new Error('Explicit isolated database and current Source actor are required.');
  const u = new URL(target),
    disposable =
      u.hostname === '127.0.0.1' && u.username === 'surfer_test' && u.pathname === '/surfer_test';
  if (
    !['postgres:', 'postgresql:'].includes(u.protocol) ||
    !['localhost', '127.0.0.1'].includes(u.hostname) ||
    (!disposable && !/^\/shotgun_surfer_(directivev3|memory)_[a-f0-9]{32}$/.test(u.pathname))
  )
    throw new Error('Only explicitly named isolated Surfer databases are allowed.');
  if (statSync(process.argv[3]!).size > 262144)
    throw new Error('Memory command exceeds the bounded CLI profile.');
  const request = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as {
    action: string;
    payload: unknown;
  };
  if (
    !request ||
    Object.keys(request).sort().join(',') !== 'action,payload' ||
    request.action !== 'RESUME'
  )
    throw new Error('Expected action/payload memory command.');
  const pool = new Pool({
    connectionString: target,
    max: 1,
    statement_timeout: 10000,
    connectionTimeoutMillis: 5000,
  });
  try {
    const service = new SurferMemoryLanguageService(
        new ShotgunSurferRoutedMemorySession(new PostgresSurferSourceSession(pool)),
        new SurferDirectiveScenarioEvaluatorV2(),
      ),
      actor = { projectId, sessionToken };
    const result = await service.resume(actor, request.payload);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(
      JSON.stringify({ error: e instanceof ShotgunError ? e.code : 'MEMORY_COMMAND_FAILED' }),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
} catch {
  console.error(JSON.stringify({ error: 'INVALID_MEMORY_COMMAND_OR_ENVIRONMENT' }));
  process.exitCode = 1;
}
