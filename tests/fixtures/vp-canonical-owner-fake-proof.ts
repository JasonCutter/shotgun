/** Manually invoked isolated evidence fixture; no production entry imports it. */
import assert from 'node:assert/strict';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import { PostgresStandingAIProcessingPolicyRepository } from '../../adapters/project-standing-ai-policy-postgres/src/index.js';
import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  ProjectAIConfigurationService,
  initialProviderRegistry,
} from '../../modules/ai-configuration/src/index.js';
import { StandingAIProcessingPolicyService } from '../../packages/policy/src/index.js';
import type { AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expected = '85e3a88a3be010c047fe32d6b917bcef70635837';
assert.equal(
  root,
  path.resolve(
    'C:/dev/artifacts/vp-full-completion-2026-10-12/canonical-pr386-85e3a88-exact-install',
  ),
);
assert.equal(process.platform, 'win32');
assert.equal(
  process.env.NODE_OPTIONS,
  '--require=C:/dev/artifacts/vp-full-completion-2026-10-12/canonical-pr386-pg-bridge.cjs',
);
assert.equal(process.env.VP_CANONICAL_OWNER_FAKE_PROOF, expected);
assert.equal(
  process.env.TEST_DATABASE_URL,
  'postgres://shotgun:shotgun_test_only@127.0.0.1:55432/shotgun_test',
);
for (const name of [
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DATABASE_URL',
  'VP_GLOBAL_RELATION_BUDGET_DATABASE_URL',
  'SHOTGUN_CREDENTIAL_MASTER_KEY',
])
  assert(!process.env[name]);
for (const name of ['.env', '.env.test']) assert(!existsSync(path.join(root, name)));
const git = (args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const checkGit = () => {
  assert.equal(git(['rev-parse', 'HEAD']), expected);
  assert.equal(git(['branch', '--show-current']), 'main');
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/u)[0], expected);
  assert.equal(git(['diff', '--name-only']), '');
  assert.equal(git(['diff', '--cached', '--name-only']), '');
};
checkGit();
const directory = process.env.VP_OWNER_PROOF_DIRECTORY!;
assert(
  path
    .resolve(directory)
    .startsWith(path.resolve('C:/dev/artifacts/vp-full-completion-2026-10-12') + path.sep),
);
assert(!existsSync(directory), 'PROOF_DIRECTORY_ALREADY_EXISTS');
await mkdir(directory);
const logPath = path.join(directory, 'process-provider-trace.jsonl');
const identityPath = path.join(root, '.data/launcher/runtime.json');
assert(!existsSync(identityPath), 'EXISTING_RUNTIME_IDENTITY');
const owners: ChildProcess[] = [];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const waitFor = async <T>(
  read: () => Promise<T | undefined>,
  label: string,
  timeout = 120_000,
): Promise<T> => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await wait(200);
  }
  throw new Error(`OWNER_PROOF_TIMEOUT:${label}`);
};
const trace = async (): Promise<Record<string, unknown>[]> =>
  existsSync(logPath)
    ? (await readFile(logPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];
const isOwnedRuntimeAlive = (pid: number, parentPid: number): boolean => {
  assert(Number.isSafeInteger(pid) && pid > 0);
  const text = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  if (!text) return false;
  const p = JSON.parse(text) as {
    ProcessId: number;
    ParentProcessId: number;
    CommandLine: string | null;
  };
  if (p.ProcessId !== pid || p.ParentProcessId !== parentPid) return false;
  // A reused unrelated PID has exited the observed ownership, and is never killed.
  if (p.CommandLine === null) throw new Error('OWNED_CHILD_COMMAND_UNREADABLE');
  return (
    p.CommandLine.replaceAll('\\', '/').includes(
      root.replaceAll('\\', '/') + '/scripts/launch-local.ts',
    ) && p.CommandLine.includes('--runtime-child')
  );
};
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      assert(a && typeof a !== 'string');
      s.close(() => resolve(a.port));
    });
  });
let db: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>> | undefined;
let authorityDb: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>> | undefined;
let owner: ChildProcess | undefined;
const result: Record<string, unknown> = {
  status: 'RUNNING',
  sourceSha: expected,
  liveProviderCalls: 0,
  productionActivated: false,
  windowsRebootVerified: false,
  realAISemanticQualityCertified: false,
};
try {
  db = await createIsolatedPostgresTestDatabase();
  authorityDb = await createIsolatedPostgresTestDatabase();
  const pool = db.createPool(),
    authority = authorityDb.createPool();
  const key = 'FAKE-VP-OWNER-PROVIDER-NOT-A-LIVE-CREDENTIAL';
  const fingerprint = createHash('sha256').update(key).digest('hex');
  const storeId = randomUUID(),
    authorityId = randomUUID(),
    port = await freePort();
  const assetRoot = path.join(directory, 'assets');
  await mkdir(assetRoot);
  const master = randomBytes(32).toString('base64url');
  process.env.SHOTGUN_CREDENTIAL_MASTER_KEY = master;
  process.env.SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION = 'vp-owner-test-only';
  const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
    accountId: 'local-owner',
  });
  await new PostgresProjectAdministrationRepository(pool).createProject({
    commandId: randomUUID(),
    clientRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    projectId: 'shotgun',
    name: 'Isolated Canonical owner proof',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });
  const vault = new CredentialVaultService(
    new PostgresCredentialVaultRepository(pool),
    new EnvironmentCredentialMasterKeyAuthority(),
  );
  const credential = await vault.create({
    projectId: 'shotgun',
    providerId: 'deepseek',
    secret: key,
    clientRequestId: randomUUID(),
  });
  await new ProjectAIConfigurationService(
    initialProviderRegistry(),
    new PostgresProjectAIConfigurationRepository(pool),
    vault,
    undefined,
    { enforceDeepSeekOnly: true },
  ).save({
    projectId: 'shotgun',
    expectedRevision: 0,
    activeProviderId: 'deepseek',
    activeModelId: 'deepseek-flash',
    credentialId: credential.credentialId,
    credentialRevision: 1,
    updatedBy: principal.principalId,
  });
  const standing = new StandingAIProcessingPolicyService(
    new PostgresStandingAIProcessingPolicyRepository(pool),
    { enforceDeepSeekOnly: true },
  );
  const policy = await standing.getCurrent('shotgun');
  await standing.save({
    projectId: 'shotgun',
    expectedRevision: policy?.policyRevision ?? 0,
    enabled: true,
    providerId: 'deepseek',
    aiConfigurationRevision: 1,
    changedBy: principal.principalId,
  });
  for (const table of [
    'settings.provider_external_transfer_approval_revisions',
    'settings.provider_external_transfer_approvals',
  ])
    await pool.query(
      `INSERT INTO ${table}(project_id,provider_id,approved,approval_revision,reviewed_by,reviewed_at) VALUES('shotgun','deepseek',true,1,$1,clock_timestamp())`,
      [principal.principalId],
    );
  await authority.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
    storeId,
  ]);
  await authority.query(
    "INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)",
    [authorityId, fingerprint],
  );
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'SystemRoot',
    'SYSTEMROOT',
    'SystemDrive',
    'COMSPEC',
    'PATH',
    'Path',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'CI',
    'npm_config_update_notifier',
    'npm_config_userconfig',
    'npm_config_globalconfig',
    'npm_config_cache',
    'npm_config_registry',
    'GIT_CONFIG_NOSYSTEM',
    'GIT_CONFIG_GLOBAL',
    'GIT_TERMINAL_PROMPT',
    'TEST_DATABASE_URL',
    'SHOTGUN_PG_TOOL_MODE',
    'VP_CANONICAL_OWNER_FAKE_PROOF',
    'VP_OWNER_PROOF_DIRECTORY',
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, {
    DATABASE_URL: db.databaseUrl,
    SOURCES_STAGING_SECRET: 'isolated-canonical-owner-staging-secret-0001',
    ASSET_STORAGE_ROOT: assetRoot,
    PORT: String(port),
    HOST: '127.0.0.1',
    SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID: 'local-owner',
    SHOTGUN_CREDENTIAL_MASTER_KEY: master,
    SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION: 'vp-owner-test-only',
    VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: authorityDb.databaseUrl,
    VP_GLOBAL_RELATION_BUDGET_STORE_ID: storeId,
    VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID: authorityId,
    VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT: fingerprint,
    AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS: 'deepseek',
    VP_OWNER_FAKE_LOG: logPath,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=tsx --import=${pathToFileURL(path.join(root, 'tests/fixtures/vp-owner-fake-provider-preload.ts')).href}`,
  });
  const launch = () => {
    checkGit();
    const child = fork(path.join(root, 'scripts/launch-local.ts'), ['--no-open'], {
      cwd: root,
      env,
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    owners.push(child);
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (bytes: Buffer) => {
        process.stdout.write(bytes);
      });
    return child;
  };
  type Identity = {
    phase: string;
    pid: number;
    ownershipNonce: string;
    sha: string;
    repoRoot: string;
  };
  const readIdentity = async () => JSON.parse(await readFile(identityPath, 'utf8')) as Identity;
  let cookie = '',
    csrf = '',
    httpRequests = 0;
  const request = <T>(method: string, url: string, payload?: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      assert(url.startsWith('/'));
      const bytes =
        payload === undefined
          ? undefined
          : Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(JSON.stringify(payload));
      const headers = {
        host: '127.0.0.1',
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(bytes
          ? {
              'content-length': String(bytes.length),
              'content-type': Buffer.isBuffer(payload)
                ? 'application/octet-stream'
                : 'application/json',
            }
          : {}),
      };
      httpRequests++;
      const req = httpRequest(
        { hostname: '127.0.0.1', port, path: url, method, headers },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (b: Buffer) => chunks.push(b));
          response.once('error', reject);
          response.once('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode ?? 0) >= 400)
              return reject(new Error(`HTTP ${method} ${url}: ${response.statusCode} ${text}`));
            if (response.headers['set-cookie'])
              cookie = response.headers['set-cookie'][0]!.split(';')[0]!;
            try {
              resolve(JSON.parse(text) as T);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.setTimeout(30_000, () => req.destroy(new Error('OWNED_HTTP_TIMEOUT')));
      req.once('error', reject);
      req.end(bytes);
    });
  const ready = (processOwner: ChildProcess, previousChildPid?: number) =>
    waitFor(
      async () => {
        if (processOwner.exitCode !== null || processOwner.signalCode !== null)
          throw new Error('CANONICAL_OWNER_EXITED');
        if (!existsSync(identityPath)) return undefined;
        const identity = await readIdentity();
        const children = (await trace()).filter(
          (r) =>
            r.type === 'PROCESS_START' &&
            r.runtimeChild === true &&
            r.parentPid === processOwner.pid,
        );
        const child = children.at(-1);
        if (identity.phase !== 'ready' || !child || child.pid === previousChildPid)
          return undefined;
        assert.equal(identity.pid, processOwner.pid);
        assert.equal(identity.sha, expected);
        assert.equal(identity.repoRoot, root);
        // Kernel.health() uses ok/starting; launcher identity uses ready/starting.
        assert.equal((await request<{ status: string }>('GET', '/health')).status, 'ok');
        return { identity, childPid: Number(child.pid) };
      },
      'actual owner readiness',
      180_000,
    );
  const submit = async (text: string, label: string, sourceId?: string) => {
    const draftId = randomUUID(),
      itemId = randomUUID();
    const query = new URLSearchParams({
      draftId,
      itemId,
      kind: 'FILE',
      label,
      fileName: label,
      mediaType: 'text/plain',
    });
    const staged = await request<{ receipt: { stagingReference: string } }>(
      'POST',
      `/product-api/frontend/sources/staging/bytes?${query}`,
      Buffer.from(text),
    );
    const accepted = await request<{ submission: { submissionId: string } }>(
      'POST',
      '/product-api/frontend/sources/submissions',
      {
        envelopeVersion: '1.0.0',
        commandType: 'sources.intake.submit.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectContext: {
          activeProjectId: 'shotgun',
          targetProjectId: 'shotgun',
          resourceProjectId: 'shotgun',
        },
        policyBinding: { mode: 'CURRENT' },
        preconditions: [],
        clientIssuedAt: new Date().toISOString(),
        payload: {
          draftId,
          duplicateHandling: 'AUTOMATIC',
          inputs: [
            {
              itemId,
              kind: 'FILE',
              label,
              fileName: label,
              mediaType: 'text/plain',
              stagingReference: staged.receipt.stagingReference,
              ...(sourceId ? { requestedSourceId: sourceId } : {}),
            },
          ],
        },
      },
    );
    await waitFor(async () => {
      const observed = await request<{ submission: { state: string } }>(
        'GET',
        `/product-api/frontend/sources/submissions/${accepted.submission.submissionId}`,
      );
      if (
        ['FAILED', 'PARTIAL', 'ACTION_REQUIRED', 'OUTCOME_INDETERMINATE'].includes(
          observed.submission.state,
        )
      )
        throw new Error(`SOURCE_FAILED:${observed.submission.state}`);
      return observed.submission.state === 'SUCCEEDED' ? true : undefined;
    }, 'normal source worker');
    const selected = await pool.query<{ sourceId: string; sourceVersionId: string }>(
      'SELECT produced_source_id::text AS "sourceId", produced_source_version_id::text AS "sourceVersionId" FROM source_product.intake_submission_items WHERE project_id=$1 AND submission_id=$2 ORDER BY ordinal',
      ['shotgun', accepted.submission.submissionId],
    );
    assert.equal(selected.rows.length, 1);
    return selected.rows[0]!;
  };
  const getAnswer = async (id: string) =>
    (
      await request<{ answerRun: AskAnswerRunSnapshot }>(
        'GET',
        `/product-api/frontend/ask/answer-runs/${id}`,
      )
    ).answerRun;
  const ask = async () => {
    const submitted = await request<{ submission: { answerRun: AskAnswerRunSnapshot } }>(
      'POST',
      '/product-api/frontend/ask/questions',
      {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question: 'What are the quasar archive count and access conditions?',
        mode: 'AUTO_PROJECT_KNOWLEDGE',
        sourceSelections: [],
      },
    );
    return waitFor(async () => {
      const r = await getAnswer(submitted.submission.answerRun.answerRunId);
      if (['FAILED', 'OUTCOME_UNKNOWN', 'ACTION_REQUIRED', 'CANCELLED'].includes(r.state))
        throw new Error(`ASK_FAILED:${r.state}`);
      return r.state === 'SUCCEEDED' ? r : undefined;
    }, 'same normal Ask run');
  };
  owner = launch();
  const first = await ready(owner);
  const bootstrap = await request<{ session: { activeProject: { id: string } | null } }>(
    'POST',
    '/api/v1/session/local-bootstrap',
    {},
  );
  assert.equal(
    bootstrap.session.activeProject?.id,
    'shotgun',
    'SERVER_AUTHORITY_MUST_SELECT_EXISTING_OWNER_MEMBERSHIP_WITHOUT_MANUAL_PROJECT_ACTION',
  );
  csrf = (await request<{ csrfToken: string }>('GET', '/api/v1/security/csrf')).csrfToken;
  const a = await submit('The quasar archive contains 42 records.', 'A.txt');
  const old = await ask();
  const citations = (r: AskAnswerRunSnapshot) => r.statements.flatMap((s) => s.citations);
  assert(citations(old).some((c) => c.sourceVersionId === a.sourceVersionId));
  const b = await submit('The quasar archive is accessible only to licensed users.', 'B.txt');
  const both = await ask();
  assert(citations(both).some((c) => c.sourceVersionId === a.sourceVersionId));
  assert(citations(both).some((c) => c.sourceVersionId === b.sourceVersionId));
  const revised = await submit('The quasar archive contains 43 records.', 'A.txt', a.sourceId);
  const current = await ask();
  assert.equal(revised.sourceId, a.sourceId);
  assert.notEqual(revised.sourceVersionId, a.sourceVersionId);
  assert(citations(current).some((c) => c.sourceVersionId === revised.sourceVersionId));
  assert(citations(current).some((c) => c.sourceVersionId === b.sourceVersionId));
  assert(!citations(current).some((c) => c.sourceVersionId === a.sourceVersionId));
  const historical = await getAnswer(old.answerRunId);
  assert.equal(historical.stale, true);
  assert.deepEqual(historical.statements, old.statements);
  assert.deepEqual(historical.capabilities, old.capabilities);
  assert.equal((await getAnswer(current.answerRunId)).stale, false);
  await waitFor(async () => {
    const r = await pool.query(
      "SELECT count(*)::int AS n FROM vp.relation_jobs WHERE status IN ('PENDING','RUNNING','RETRYABLE')",
    );
    const calls = (await trace()).filter((t) => t.type === 'FAKE_CALL' && t.kind === 'relation');
    return r.rows[0]?.n === 0 && calls.length ? true : undefined;
  }, 'normal relation backlog settled');
  const runIds = [old.answerRunId, both.answerRunId, current.answerRunId];
  const persisted = async () => {
    const runs = await pool.query(
      'SELECT to_jsonb(r) AS row FROM frontend_ask.answer_runs r WHERE answer_run_id=ANY($1::text[]) ORDER BY answer_run_id',
      [runIds],
    );
    const statements = await pool.query(
      'SELECT to_jsonb(r) AS row FROM frontend_ask.statements r WHERE answer_run_id=ANY($1::text[]) ORDER BY statement_id',
      [runIds],
    );
    const citationRows = await pool.query(
      'SELECT to_jsonb(c) AS row FROM frontend_ask.citations c JOIN frontend_ask.statements s USING(statement_id) WHERE s.answer_run_id=ANY($1::text[]) ORDER BY citation_id',
      [runIds],
    );
    const attempts = await pool.query(
      'SELECT to_jsonb(r) AS row FROM frontend_ask.answer_run_attempts r WHERE answer_run_id=ANY($1::text[]) ORDER BY attempt_id',
      [runIds],
    );
    const calls = await pool.query(
      'SELECT to_jsonb(r) AS row FROM vp.relation_provider_calls r ORDER BY call_id',
    );
    return {
      runs: runs.rows,
      statements: statements.rows,
      citations: citationRows.rows,
      attempts: attempts.rows,
      calls: calls.rows,
    };
  };
  const before = await persisted();
  assert(before.calls.length > 0);
  const fakeBefore = (await trace()).filter((r) => r.type === 'FAKE_CALL');
  const killOwnedChild = async (pid: number, parentPid: number) => {
    assert(isOwnedRuntimeAlive(pid, parentPid));
    process.kill(pid);
  };
  await killOwnedChild(first.childPid, owner.pid!);
  const restarted = await ready(owner, first.childPid);
  assert.deepEqual(restarted.identity, first.identity);
  assert.deepEqual(await persisted(), before);
  assert.deepEqual(
    (await trace()).filter((r) => r.type === 'FAKE_CALL'),
    fakeBefore,
  );
  assert.equal((await getAnswer(old.answerRunId)).stale, true);
  assert.equal((await getAnswer(current.answerRunId)).stale, false);
  owner.kill();
  await waitFor(
    async () => (owner!.exitCode !== null || owner!.signalCode !== null ? true : undefined),
    'owned parent crash',
  );
  await waitFor(
    async () => (!isOwnedRuntimeAlive(restarted.childPid, owner!.pid!) ? true : undefined),
    'child exits after IPC disconnect',
    30_000,
  );
  owner = launch();
  const recovered = await ready(owner);
  assert.notEqual(recovered.identity.ownershipNonce, first.identity.ownershipNonce);
  assert.deepEqual(await persisted(), before);
  assert.deepEqual(
    (await trace()).filter((r) => r.type === 'FAKE_CALL'),
    fakeBefore,
  );
  assert.deepEqual((await getAnswer(old.answerRunId)).statements, old.statements);
  assert.equal((await getAnswer(old.answerRunId)).stale, true);
  assert.equal((await getAnswer(current.answerRunId)).stale, false);
  const claims = (await authority.query('SELECT * FROM vp_global_budget.claims ORDER BY claim_id'))
    .rows;
  assert.equal(claims.length, before.calls.length);
  assert(claims.every((c) => c.state === 'PROVIDER_SUCCEEDED' && c.execution_authorized_at));
  for (const c of before.calls) {
    const row = c.row as {
      global_claim_id: string;
      semantic_attempt_id: string;
      job_id: string;
      execution_key: string;
      provider_identity: string;
    };
    const claim = claims.find((a) => a.claim_id === row.global_claim_id);
    assert(claim);
    assert.equal(claim.relation_job_id, row.job_id);
    assert.equal(claim.semantic_attempt_id, row.semantic_attempt_id);
    assert.equal(claim.execution_key, row.execution_key);
    assert.equal(claim.provider_identity, row.provider_identity);
  }
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM vp_global_budget.authority_store')).rows[0]
      ?.n,
    0,
  );
  owner.send({ type: 'proof-signal-shutdown' });
  await waitFor(async () => (owner!.exitCode === 0 ? true : undefined), 'signal-handler cleanup');
  assert(!existsSync(identityPath));
  assert(!(await trace()).some((r) => r.type === 'EGRESS_DENIED'));
  checkGit();
  Object.assign(result, {
    status: 'PASS',
    httpRequests,
    sourcesSubmitted: 3,
    questionsSubmitted: 3,
    individualReviewClicks: 0,
    projectSelectionClicks: 0,
    initialProjectSelectedByExistingServerAuthority: true,
    sourceSelectionClicks: 0,
    normalOwnerEntry: 'scripts/launch-local.ts',
    runtimeProfile: 'runtime-development',
    runtimeGenerations: 3,
    ownerGenerations: 2,
    childRestartIdentityPreserved: true,
    parentCrashNonceReplaced: true,
    completedAnswerRowsImmutable: true,
    completedRelationReceiptsImmutable: true,
    fakeCallsNotRepeated: true,
    fakeCalls: fakeBefore.map((r) => ({
      kind: r.kind,
      providerResponseId: r.providerResponseId,
      requestDigest: r.requestDigest,
    })),
    beforePersistenceDigest: createHash('sha256').update(JSON.stringify(before)).digest('hex'),
    oldAnswerRunId: old.answerRunId,
    currentAnswerRunId: current.answerRunId,
    workloadDatabase: db.databaseName,
    authorityDatabase: authorityDb.databaseName,
    authorityStoreId: storeId,
    authorityId,
    credentialFingerprint: fingerprint,
    relationClaimCount: claims.length,
    unresolvedReservations: claims.filter((c) => c.state === 'RESERVED').length,
    imageRuntimeActivated: false,
    cleanupSignal: 'TEST_IPC_EMITS_REAL_SIGTERM_HANDLER_NOT_OS_SIGNAL',
  });
} catch (error) {
  result.status = 'FAIL';
  result.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const cleanupErrors: string[] = [];
  for (const child of owners)
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) {
        try {
          child.send({ type: 'proof-signal-shutdown' });
        } catch (error) {
          cleanupErrors.push(String(error));
        }
      }
      await waitFor(
        async () => (child.exitCode !== null || child.signalCode !== null ? true : undefined),
        'owned cleanup exit',
        30_000,
      ).catch(() => {
        child.kill();
      });
    }
  // All owned process children must exit before the test databases are dropped.
  let childrenExited = false;
  try {
    await waitFor(
      async () =>
        owners.every((child) => child.exitCode !== null || child.signalCode !== null)
          ? true
          : undefined,
      'all owned owner handles exited',
      30_000,
    );
    const runtimeChildren = (await trace()).filter(
      (r) => r.type === 'PROCESS_START' && r.runtimeChild === true,
    );
    for (const child of runtimeChildren)
      await waitFor(
        async () =>
          !isOwnedRuntimeAlive(Number(child.pid), Number(child.parentPid)) ? true : undefined,
        'no owned runtime child',
        30_000,
      );
    childrenExited = true;
  } catch (error) {
    cleanupErrors.push(String(error));
  }
  let databasesDropped = false;
  if (childrenExited) {
    const disposed = await Promise.allSettled([db?.dispose(), authorityDb?.dispose()]);
    databasesDropped = disposed.every((item) => item.status === 'fulfilled');
    for (const item of disposed)
      if (item.status === 'rejected') cleanupErrors.push(String(item.reason));
  }
  delete process.env.SHOTGUN_CREDENTIAL_MASTER_KEY;
  delete process.env.SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION;
  result.ownedChildrenExited = childrenExited;
  result.isolatedDatabasesDropped = databasesDropped;
  result.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length) result.status = 'FAIL';
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (cleanupErrors.length) process.exitCode = 1;
}
