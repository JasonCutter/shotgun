/* global process, console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'ts6-phase-b-c2-r5');
const zipPath = path.join(root, 'shotgun-ts6-phase-b-c2-r5-review-20260920.zip');
const fixturePath = path.join(
  root,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const c1Zip = path.join(root, 'shotgun-ts6-phase-b-c1-review-20260920.zip');
const r3Zip = path.join(root, 'shotgun-ts6-phase-b-c2-r3-review-20260920.zip');
const r4Zip = path.join(root, 'shotgun-ts6-phase-b-c2-r4-review-20260920.zip');

fs.rmSync(artifactDir, { recursive: true, force: true });
fs.mkdirSync(artifactDir, { recursive: true });

const run = (command, args = []) => {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? '';
    const stderr = error.stderr?.toString?.() ?? '';
    return `${stdout}${stderr}`.trimEnd();
  }
};

const writeText = (name, value) =>
  fs.writeFileSync(path.join(artifactDir, name), value.endsWith('\n') ? value : `${value}\n`);
const writeJson = (name, value) => writeText(name, JSON.stringify(value, null, 2));
const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const baseSha = '1f821ea371b308d8cecede4a98ebe27960873b21';
const frozen = {
  c1: 'D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  r3: '6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
  r4: '0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E',
  fixture: '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
};

const targets = [
  ['safe:adapters/connector-runtime-postgres/src/index.ts:1199', 'acquireNext', 'PASS'],
  ['safe:adapters/connector-runtime-postgres/src/index.ts:1389', 'recoverExpiredLeases', 'PASS'],
  [
    'safe:adapters/discovery-reentry-postgres/src/index.ts:777',
    'recordConsumptionDisposition',
    'FAIL',
  ],
  ['safe:adapters/discovery-reentry-postgres/src/index.ts:987', 'persistIntake', 'PASS'],
  ['safe:adapters/discovery-runtime-postgres/src/index.ts:2844', 'saveFailureContext', 'PASS'],
  ['safe:adapters/frontend-activity-postgres/src/index.ts:91', 'withProjectWriteLock', 'PASS'],
  ['safe:adapters/frontend-ask-execution-postgres/src/index.ts:2421', 'poolTransaction', 'FAIL'],
  [
    'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:467',
    'markSubmissionStage3Incomplete',
    'FAIL',
  ],
  [
    'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:508',
    'finalizeSubmissionState',
    'PASS',
  ],
  [
    'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:1485',
    'markStage3ItemsSucceeded',
    'PASS',
  ],
  ['safe:adapters/postgres-stage5/src/index.ts:418', 'withTransaction', 'PASS'],
  ['safe:adapters/postgres-stage5/src/index.ts:1340', 'markStale', 'PASS'],
  ['safe:adapters/postgres/src/index.ts:971', 'updateProject', 'PASS'],
  ['safe:adapters/postgres/src/index.ts:1500', 'updatePrincipalPreferences', 'PASS'],
  ['safe:adapters/provider-privacy-deployment-postgres/src/index.ts:90', 'createProposal', 'PASS'],
  [
    'safe:adapters/provider-privacy-deployment-postgres/src/index.ts:160',
    'approveProposal',
    'PASS',
  ],
];
const targetIds = new Set(targets.map(([id]) => id));
const evidence = fixture.regressionEvidence.filter((item) =>
  item.covers.some((id) => targetIds.has(id)),
);
const evidenceFor = (boundaryId) => {
  const found = evidence.find((item) => item.covers.includes(boundaryId));
  if (!found) throw new Error(`Missing regression evidence for ${boundaryId}`);
  return found;
};

const failureDetails = {
  'safe:adapters/discovery-reentry-postgres/src/index.ts:777': {
    testFile: 'tests/database/akp-5-wp2-discovery-reentry.database.test.ts',
    testName:
      'durably defers retryable failures, advances the retry boundary, and transitions to processed',
    error:
      '23503 source_versions_original_asset_id_fkey: seedApprovedAuthority inserted a source_versions row whose original_asset_id was removed by concurrent shared-table cleanup.',
  },
  'safe:adapters/frontend-ask-execution-postgres/src/index.ts:2421': {
    testFile: 'tests/database/frontend-ask-write-postgres.database.test.ts',
    testName:
      'commits aggregate and outcome atomically, recovers after restart, and serializes follow-ups',
    error:
      'ShotgunError: The requested question submission was not found while resolving the question submission after restart; shared database reset/cleanup interference remains the working hypothesis.',
  },
  'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:467': {
    testFile: 'tests/database/frontend-sources-stage3-recovery.test.ts',
    testName:
      'Stage3 first attempt throws → retry → same SourceId/SourceVersionId → Stage3 completes → Evidence exists → no duplicate SourceVersion',
    error: 'PostgreSQL 40P01 deadlock detected in the shared-table TRUNCATE setup.',
  },
};

const changed = run('git', ['status', '--short'])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/^"|"$/g, ''));
const classify = (file) => {
  if (file.startsWith('artifacts/') || file.endsWith('.zip') || file.startsWith('scripts/rebuild-'))
    return 'ARTIFACT';
  if (file.startsWith('tests/fixtures/') || file.endsWith('boundary-count-crosswalk.json'))
    return 'FIXTURE';
  if (file.startsWith('tests/')) return 'TEST';
  if (file.includes('transaction-authority-validator')) return 'VALIDATOR';
  if (file.startsWith('docs/architecture/adr/')) return 'ADR';
  if (file.startsWith('docs/engineering/ts6-phase-b-c2-r')) return 'EVIDENCE';
  if (file.startsWith('docs/')) return 'DOC';
  if (
    file.startsWith('adapters/') ||
    file.startsWith('modules/') ||
    file.startsWith('assemblies/') ||
    file.startsWith('apps/')
  )
    return 'PRODUCT';
  return 'UNRELATED';
};
const byClass = new Map();
for (const file of changed) {
  const kind = classify(file);
  if (!byClass.has(kind)) byClass.set(kind, []);
  byClass.get(kind).push(file);
}
for (const files of byClass.values()) files.sort();

writeText(
  '01-identity.txt',
  [
    'TS-6 Phase B C2-R5 CI-equivalent closure artifact',
    'Date: 2026-09-20',
    'Worktree: C:\\dev\\shotgun-ts6-phase-b',
    'Branch: codex/ts6-postgres-transaction-phase-b',
    `HEAD: ${baseSha}`,
    `Base/main: ${baseSha}`,
    'Final disposition: CHANGES_REQUIRED/STOP; no commit, push, PR, Ready, or TS-7.',
  ].join('\n'),
);
writeText(
  '02-worktree-before.txt',
  [
    'R5 pre-execution worktree identity and preserved owner scope.',
    `git status --short:\n${run('git', ['status', '--short'])}`,
    `git diff --stat:\n${run('git', ['diff', '--stat'])}`,
    'No unrelated worktree change was detected in the R4 review baseline. R5 added only this closure document, this artifact builder, and this new failure bundle.',
  ].join('\n\n'),
);
writeText(
  '03-base-ci-reference.txt',
  [
    'Controller-provided exact base CI reference:',
    'GitHub push CI run: 35488359650',
    'Branch: main',
    'Conclusion: success',
    `Base/main/HEAD in this worktree: ${baseSha}`,
    'The run identifier was supplied by the controller request and was not independently fetched after the focused DB stop.',
    'The controller specifically requires the current worktree knowledge-flow failure to be resolved; it is not accepted as PRE_EXISTING_DOC_DRIFT for R5 closure.',
  ].join('\n'),
);
writeText(
  '04-db-test-prestate.txt',
  [
    'Canonical repository-owned database pre-state',
    'Service: db-test',
    'Database: shotgun_test',
    'Host port: 5433',
    'Image: pgvector/pgvector:pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b',
    'Existing container: shotgun-issue-356-db-test-isolation-audit-db-test-1',
    'Pre-state: running and healthy before R5; R5 started the service: NO.',
    'Current-worktree compose project had no db-test container, but docker inspect confirmed the existing canonical repository-owned service and its 5433 binding.',
    'Owner db service/5432: not touched. The pre-existing container must remain running after R5.',
  ].join('\n'),
);
writeText(
  '05-db-target-guard.txt',
  [
    'Process-local target guard',
    'Guard result: PASS',
    'Guard output: {"host":"localhost","port":"5433","database":"shotgun_test","databaseUrlProvided":true}',
    'DATABASE_URL: unset',
    'TEST_DATABASE_URL: process-local only; credentials omitted from this evidence bundle.',
    'One initial tsx eval wrapper used top-level await and failed before executing the guard; it was immediately retried with an async IIFE. The retry passed. No DB operation occurred in the wrapper failure.',
  ].join('\n'),
);
writeText(
  '06-db-reset-verify.txt',
  [
    'npm run db:test:reset: PASS',
    'Canonical migrations applied and shotgun_test schema recreated.',
    'npm run db:test:verify: PASS',
    'Database bootstrap verified before focused evidence execution.',
    'No owner database, arbitrary database/port, manual schema, persisted environment change, or guessed credential was used.',
  ].join('\n'),
);
writeText(
  '07-command-gateway-cg-rb.txt',
  [
    'Command: npm exec vitest -- run tests/database/ts6-command-gateway-exact-readback.database.test.ts --reporter=verbose',
    'Result: PASS; 1 file, 8 tests.',
    'CG-RB-01..08: PASS.',
    'The tests assert exact durable COMPLETED/SUCCEEDED readback, revision, one mutation, post-COMMIT ambiguity behavior, no rollback-after-COMMIT, and no second completion mutation.',
    'This evidence does not authorize a Product change.',
  ].join('\n'),
);
writeText(
  '08-three-minimal-db-proofs.txt',
  [
    'Command: npm exec vitest -- run tests/database/akp-4-wp4-discovery-execution.database.test.ts tests/database/section2-postgres.test.ts -t <three exact titles> --reporter=verbose',
    'Result: PASS; 2 files, 3 selected tests passed; 19 unrelated tests skipped by the exact title filter.',
    'saveFailureContext: PASS.',
    'updateProject: PASS.',
    'updatePrincipalPreferences: PASS.',
  ].join('\n'),
);

writeJson('09-regression-evidence-db-execution.json', {
  schemaVersion: 'ts6-c2-r5-regression-execution.v1',
  selectedTargetCount: 16,
  databaseBackedTargetCount: 16,
  executionPolicy:
    'Stop immediately on any selected focused DB failure; no serial cleanup rerun was used to erase failed evidence.',
  testFilesLaunched: 11,
  testExecutionSummary: {
    testFilesFailed: 3,
    testFilesPassed: 8,
    testsPassed: 12,
    testsFailed: 3,
    testsSkippedByExactTitleFilter: 72,
    note: 'One selected test covers both source-service target 508 and 1485; therefore 16 boundary records map to 15 selected test assertions in this run.',
  },
  records: targets.map(([boundaryId, sourceSymbol, status]) => {
    const item = evidenceFor(boundaryId);
    const failure = failureDetails[boundaryId];
    return {
      boundaryId,
      sourceSymbol,
      coverageKind: item.coverageKind,
      entrySymbol: item.entrySymbol,
      path: item.path,
      testFile: failure?.testFile ?? item.file,
      testName: failure?.testName ?? item.testName,
      databaseBacked: true,
      executionStatus: status,
      failure: failure?.error ?? null,
    };
  }),
  closure: {
    passedBoundaryRecords: targets.filter(([, , status]) => status === 'PASS').length,
    failedBoundaryRecords: targets.filter(([, , status]) => status === 'FAIL').length,
    remaining: 3,
    classification: 'TEST_ISOLATION_DEFECT / CHANGES_REQUIRED / STOP',
    nextControllerDecisionRequired: true,
  },
});
writeText(
  '10-official-unit-gate.txt',
  [
    'Status: NOT_RUN after the focused DB stop.',
    'R5 explicitly requires stopping before official unit rerun when any focused DB evidence fails.',
    'R4 baseline: npm run test:unit exited 1 only on default 5s timeouts; targeted 30s reruns for the two timeout files passed.',
  ].join('\n'),
);
writeText(
  '11-knowledge-flow-closure.txt',
  [
    'Status: NOT_RUN after the focused DB stop.',
    'R4 baseline: npm run docs:knowledge-flow:check failed on the current worktree because generated HTML was stale against unchanged canonical JSON.',
    'The controller states the exact base CI run 35488359650 passed this check; the current worktree failure therefore remains an unresolved R5 closure item, not an accepted pre-existing classification.',
  ].join('\n'),
);
writeText(
  '12-validator-final.txt',
  [
    'Status: NOT_RUN after the focused DB stop.',
    'R4 baseline: validator audit/verify PASS, issueCount=0; fixture SHA remained stable at the frozen v2 hash.',
    'No validator or fixture mutation occurred in R5.',
  ].join('\n'),
);
writeText(
  '13-quality-gates.txt',
  [
    'Status: NOT_RUN after the focused DB stop.',
    'R4 baseline: format, lint, typecheck, diff-check, contract, architecture, stage12 package, docs validate/links/ADR/canonical/drift, secret scan, and OSS verify passed; npm audit had zero high/critical with two pre-existing moderate @vitest/mocker advisories.',
    'R5 makes no claim that these gates were rerun after the stop.',
  ].join('\n'),
);
writeText(
  '14-test-ci.txt',
  [
    'Status: NOT_RUN.',
    'The R5 controller requires focused DB closure before test:ci; the three focused failures triggered the stop.',
  ].join('\n'),
);
writeText(
  '15-full-database-suite.txt',
  [
    'Status: NOT_RUN.',
    'The full database suite was explicitly prohibited after a focused DB failure in this cycle.',
  ].join('\n'),
);
writeText(
  '16-final-db-verify.txt',
  [
    'Final verify status: NOT_RUN after focused DB failure.',
    'Initial db:test:verify before focused execution: PASS.',
    'The pre-existing canonical db-test container remains running and healthy; R5 did not stop it.',
  ].join('\n'),
);
writeText(
  '17-security-oss-sbom.txt',
  [
    'Status: NOT_RUN after the focused DB stop.',
    'R4 baseline: secret scan PASS; OSS verify PASS; npm audit high/critical=0 with two pre-existing moderate @vitest/mocker advisories; no package or lockfile change.',
    'No new dependency, OSS runtime, license, or security claim is made for R5.',
  ].join('\n'),
);

const trackedPatch = run('git', ['diff', '--binary', 'main', '--']);
const untracked = run('git', ['ls-files', '--others', '--exclude-standard'])
  .split(/\r?\n/)
  .filter(Boolean);
const sourceLike = untracked.filter(
  (file) =>
    !file.startsWith('artifacts/') &&
    !file.endsWith('.zip') &&
    !file.includes('node_modules/') &&
    /\.(md|json|mjs|ts|tsx|txt|yml|yaml)$/.test(file),
);
const untrackedBundle = sourceLike
  .map(
    (file) =>
      `\n\n===== UNTRACKED FILE: ${file} =====\n${fs.readFileSync(path.join(root, file), 'utf8')}`,
  )
  .join('');
writeText(
  '18-final-diff.patch',
  `${trackedPatch}\n\n# Untracked files (complete path list)\n${untracked.join('\n')}\n# Text source bundle (artifact binaries excluded)${untrackedBundle}`,
);
writeText(
  '19-final-changed-files.txt',
  [
    'Complete current worktree classification for R5 handoff.',
    'Expected unrelated count: 0 based on the R4 baseline review.',
    ...[...byClass.keys()]
      .sort()
      .map(
        (kind) => `\n[${kind}] count=${byClass.get(kind).length}\n${byClass.get(kind).join('\n')}`,
      ),
    '',
    `UNRELATED count=${(byClass.get('UNRELATED') ?? []).length}`,
    'R5 substantive additions are the closure document and evidence-builder script; no Product source or test fixture was modified during R5.',
  ].join('\n'),
);
writeText(
  '20-c2-r5-ci-equivalent-closure.md',
  fs.readFileSync(
    path.join(root, 'docs/engineering/ts6-phase-b-c2-r5-ci-equivalent-closure.md'),
    'utf8',
  ),
);
writeText(
  '21-final-handoff-report.md',
  [
    '# TS-6 PHASE B C2-R5 EXECUTION CLOSURE HANDOFF',
    '',
    '## Final status',
    '',
    '- SOURCE_AUTHORITY: PASS by the frozen C2-R4 review.',
    '- REGRESSION_EVIDENCE: CHANGES_REQUIRED/STOP; 16 selected DB-backed records were attempted, with 13 boundary records passing and 3 failing in 3 test files.',
    '- DATABASE_EXECUTION: target guard, reset, verify, CG-RB, and three new minimal proofs passed; selected evidence failed and stopped the cycle.',
    '- OVERALL: CHANGES_REQUIRED/STOP; controller review required.',
    '- Commit/push/PR/Ready/TS-7: NO.',
    '',
    '## Identity and frozen references',
    '',
    `- Worktree: C:\\dev\\shotgun-ts6-phase-b; branch: codex/ts6-postgres-transaction-phase-b; base/main/HEAD: ${baseSha}.`,
    '- Base CI reference: GitHub push CI run 35488359650 on main, controller-provided as success; not independently fetched after the focused stop.',
    `- C1: ${frozen.c1}; C2-R3: ${frozen.r3}; C2-R4: ${frozen.r4}; fixture v2: ${frozen.fixture}.`,
    '',
    '## DB target and execution',
    '',
    '- Canonical existing db-test: pgvector/pg16, shotgun_test, localhost:5433, healthy before R5; R5 started it: NO; owner DB untouched; leave it running.',
    '- Guard PASS; db:test:reset PASS; db:test:verify PASS.',
    '- CG-RB-01..08 PASS (8/8).',
    '- Three minimal proofs PASS (3/3): saveFailureContext, updateProject, updatePrincipalPreferences.',
    '- Exact 16-target DB evidence was launched against the shared canonical database and stopped at the first focused failure policy. Execution summary: 12 assertions passed, 3 failed, 72 exact-filter skips; 16 boundary records map to 15 selected assertions because one source recovery test covers two boundaries.',
    '',
    '## Failures and classification',
    '',
    '- discovery re-entry: source_versions FK 23503 during seedApprovedAuthority after concurrent shared-table cleanup.',
    '- frontend ask write: question submission NOT_FOUND after restart while resolving the submission; left open pending isolated serial reproduction.',
    '- frontend sources Stage3 recovery: PostgreSQL 40P01 deadlock during shared-table TRUNCATE setup.',
    '- Classification: TEST_ISOLATION_DEFECT / CHANGES_REQUIRED / STOP. No Product fix, serial rerun, broad database suite, test:ci, official unit rerun, or further focused rerun was performed.',
    '',
    '## Deferred gates',
    '',
    '- Official unit, knowledge-flow closure, validator final, quality/security/OSS/SBOM, test:ci, full database suite, and final db verify: NOT_RUN after the focused DB stop.',
    '- Knowledge-flow remains an unresolved worktree item: R4 current-worktree check failed while controller-provided exact base CI passed.',
    '',
    '## Artifact and handoff',
    '',
    '- New ZIP: shotgun-ts6-phase-b-c2-r5-review-20260920.zip.',
    '- Required entry count: 22; manifest excludes itself and covers the other 21 entries.',
    '- No credentials, .env files, database contents, node_modules, coverage, owner DB artifacts, or prior C1/R3/R4 ZIP binaries are included.',
    '- Controller must provide the next complete request deciding isolation repair/reproduction and the unresolved knowledge-flow closure. No commit authorization is requested or inferred.',
  ].join('\n'),
);

const manifest = fs
  .readdirSync(artifactDir)
  .sort()
  .map((name) => `${sha256(path.join(artifactDir, name))}  ${name}`);
writeText('22-sha256-manifest.txt', manifest.join('\n'));

fs.rmSync(zipPath, { force: true });
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${artifactDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ],
  { cwd: root, stdio: 'inherit' },
);

console.log(
  JSON.stringify(
    {
      artifactDir,
      zipPath,
      entryCount: fs.readdirSync(artifactDir).length,
      zipSha256: sha256(zipPath),
      fixtureSha256: sha256(fixturePath),
      frozenHashes: {
        c1: sha256(c1Zip),
        r3: sha256(r3Zip),
        r4: sha256(r4Zip),
      },
      classification: Object.fromEntries(
        [...byClass.entries()].map(([kind, files]) => [kind, files.length]),
      ),
      regressionRecords: targets.length,
    },
    null,
    2,
  ),
);
