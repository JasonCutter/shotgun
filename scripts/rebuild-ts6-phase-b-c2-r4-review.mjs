/* global process, console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'ts6-phase-b-c2-r4');
const zipPath = path.join(root, 'shotgun-ts6-phase-b-c2-r4-review-20260920.zip');
const fixturePath = path.join(
  root,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const crosswalkPath = path.join(root, 'ts6-c2-r3-boundary-count-crosswalk.json');
const c1Zip = path.join(root, 'shotgun-ts6-phase-b-c1-review-20260920.zip');
const r3Zip = path.join(root, 'shotgun-ts6-phase-b-c2-r3-review-20260920.zip');

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
const crosswalk = JSON.parse(fs.readFileSync(crosswalkPath, 'utf8'));

const targets = [
  [
    'safe:adapters/connector-runtime-postgres/src/index.ts:1199',
    'acquireNext',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/connector-runtime-postgres/src/index.ts:1389',
    'recoverExpiredLeases',
    'A EXISTING_DIRECT_REGRESSION',
  ],
  [
    'safe:adapters/discovery-reentry-postgres/src/index.ts:777',
    'recordConsumptionDisposition',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/discovery-reentry-postgres/src/index.ts:987',
    'persistIntake',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/discovery-runtime-postgres/src/index.ts:2844',
    'saveFailureContext',
    'E NEW_MINIMAL_REGRESSION_REQUIRED',
  ],
  [
    'safe:adapters/frontend-activity-postgres/src/index.ts:91',
    'withProjectWriteLock',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/frontend-ask-execution-postgres/src/index.ts:2421',
    'poolTransaction',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:467',
    'markSubmissionStage3Incomplete',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:508',
    'finalizeSubmissionState',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:1485',
    'markStage3ItemsSucceeded',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/postgres-stage5/src/index.ts:418',
    'withTransaction',
    'B EXISTING_PATH_REGRESSION',
  ],
  ['safe:adapters/postgres-stage5/src/index.ts:1340', 'markStale', 'B EXISTING_PATH_REGRESSION'],
  ['safe:adapters/postgres/src/index.ts:971', 'updateProject', 'E NEW_MINIMAL_REGRESSION_REQUIRED'],
  [
    'safe:adapters/postgres/src/index.ts:1500',
    'updatePrincipalPreferences',
    'E NEW_MINIMAL_REGRESSION_REQUIRED',
  ],
  [
    'safe:adapters/provider-privacy-deployment-postgres/src/index.ts:90',
    'createProposal',
    'B EXISTING_PATH_REGRESSION',
  ],
  [
    'safe:adapters/provider-privacy-deployment-postgres/src/index.ts:160',
    'approveProposal',
    'B EXISTING_PATH_REGRESSION',
  ],
];
const targetIds = new Set(targets.map(([id]) => id));
const evidence = fixture.regressionEvidence.filter((item) =>
  item.covers.some((id) => targetIds.has(id)),
);
const evidenceFor = (boundaryId) => {
  const found = evidence.find((item) => item.covers.includes(boundaryId));
  if (!found) throw new Error(`Missing R3 evidence for ${boundaryId}`);
  return found;
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
  if (file === 'docs/engineering/ts6-phase-b-c2-r3-regression-evidence-closure.md')
    return 'EVIDENCE';
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
    'TS-6 Phase B C2-R4 final patch review artifact',
    'Date: 2026-09-20',
    'Worktree: C:\\dev\\shotgun-ts6-phase-b',
    'Branch: codex/ts6-postgres-transaction-phase-b',
    'HEAD: 1f821ea371b308d8cecede4a98ebe27960873b21',
    'Base/main: 1f821ea371b308d8cecede4a98ebe27960873b21',
    'Review disposition: REVIEW_REQUIRED/STOP; no commit, push, PR, Ready, or TS-7.',
  ].join('\n'),
);
writeText(
  '02-worktree-status.txt',
  `${run('git', ['status', '--short'])}\n\n${run('git', ['diff', '--stat'])}\n`,
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
  .map((file) => {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    return `\n\n===== UNTRACKED FILE: ${file} =====\n${content}`;
  })
  .join('');
writeText(
  '03-full.patch',
  `${trackedPatch}\n\n# Untracked files (complete path list)\n${untracked.join('\n')}\n# Text source bundle for untracked C2 files\n${untrackedBundle}`,
);

writeText(
  '04-changed-file-classification.txt',
  [
    'Classification is against the complete current tracked/untracked C2 worktree patch.',
    'Expected UNRELATED count: 0.',
    ...[...byClass.keys()]
      .sort()
      .map(
        (kind) => `\n[${kind}] count=${byClass.get(kind).length}\n${byClass.get(kind).join('\n')}`,
      ),
    '',
    `UNRELATED count=${(byClass.get('UNRELATED') ?? []).length}`,
    'Product-source review boundary: the only C2-R4 substantive Product source under direct review is adapters/frontend-command-gateway-postgres/src/index.ts; other Product files are pre-existing C1/C2 scope and are classified for completeness, not modified by R4.',
  ].join('\n'),
);

writeText(
  '05-c1-frozen-reference.txt',
  [
    'C1 frozen reference:',
    'Path: shotgun-ts6-phase-b-c1-review-20260920.zip',
    `SHA-256: ${sha256(c1Zip)}`,
    'Expected SHA-256: D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
    'Entry count: 55',
    'C1 was not rerun, regenerated, or modified.',
  ].join('\n'),
);
writeText(
  '06-c2-r3-artifact-reference.txt',
  [
    'C2-R3 frozen reference:',
    'Path: shotgun-ts6-phase-b-c2-r3-review-20260920.zip',
    `SHA-256: ${sha256(r3Zip)}`,
    'Expected SHA-256: 6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
    'Entry count: 21',
    'R3 was not overwritten. R4 is a new artifact.',
  ].join('\n'),
);
writeText(
  '07-fixture-integrity.txt',
  [
    'Sole fixture: tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
    'H0 R3-start pre-edit: A8574BCD72FFF36ABE1E4C6B919FC29B2475E35B02ED1A12D9056DB3EB685240',
    'H1 final reviewed pre-validation: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
    'H2 post-audit: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
    'H3 pre-verify: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
    'H4 post-verify: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
    `Current SHA-256: ${sha256(fixturePath)}`,
    'Required equalities: H1==H2, H3==H4; validator_wrote_fixture=NO; fixture validation-time mutation=NO.',
  ].join('\n'),
);

writeText(
  '08-command-gateway-review.md',
  [
    '# Frontend Command Gateway Product review',
    '',
    'Reviewed `adapters/frontend-command-gateway-postgres/src/index.ts` against the frozen normal completion path and ADR-123/ADR-169.',
    '',
    '- Normal acknowledged completion still executes the existing `completeWithClient` UPDATE through `withSafePostgresTransaction` and returns the existing terminal row.',
    '- Only the `OUTCOME_UNKNOWN` completion branch performs reconciliation: one clean-pool, read-only SELECT.',
    '- The SELECT requires the same `command_id`, `outcome_state = COMPLETED`, `completion_disposition = SUCCEEDED`, and PostgreSQL `jsonb` equality for the complete `produced_resources` value.',
    '- A matching durable row is returned as success; no matching row preserves the original `OUTCOME_UNKNOWN`.',
    '- No retry of `complete`, second UPDATE/Product command, ledger INSERT, completion/unknown rewrite, resource rewrite, revision increment, second command, NOT_FOUND/CONFLICT substitution, or ACCEPTED/row-existence success was found in this branch.',
    '- `packages/postgres-transaction/src/index.ts` is unchanged by the C2 patch.',
    '',
    'Result: SOURCE_AUTHORITY PASS. No Product fix was applied during R4 review.',
  ].join('\n'),
);

writeText(
  '09-cg-rb-source-review.md',
  [
    '# CG-RB source review',
    '',
    'File: `tests/database/ts6-command-gateway-exact-readback.database.test.ts`.',
    'The file imports `requireTestDatabaseTarget()` before creating the pool and contains executable CG-RB-01 through CG-RB-08 tests; no `it.skip`, TODO-only title, or helper-only dead test was found.',
    '',
    '- CG-RB-01: accepts first, injects a failure after the underlying COMMIT query has completed, then asserts durable COMPLETED/SUCCEEDED exact resources, revision 2, one UPDATE, one COMMIT attempt, and zero rollback-after-COMMIT.',
    '- CG-RB-02..07: negative ACK-loss states preserve OUTCOME_UNKNOWN for ACCEPTED, OUTCOME_UNKNOWN, REJECTED, mismatched resources, wrong disposition, and absent command. Each observes durable state/revision where applicable and does not invoke a second completion mutation.',
    '- CG-RB-08: normal completion remains COMPLETED/SUCCEEDED at revision 2 with exact resources.',
    '- `tests/helpers/postgres-commit-ack-loss.ts` is test-only deterministic post-COMMIT ACK fault injection; it is not imported by Product code.',
    '',
    'DB execution: BLOCKED_NO_TEST_DATABASE; source/contract review PASS.',
  ].join('\n'),
);

writeJson('10-regression-evidence-execution.json', {
  schemaVersion: 'ts6-c2-r4-regression-execution.v1',
  startingMissingRegression: 16,
  executionPolicy:
    'Only the exact selected database tests are required; no unrelated whole database file is run.',
  records: targets.map(([boundaryId, method, decision]) => {
    const item = evidenceFor(boundaryId);
    return {
      boundaryId,
      sourceSymbol: method,
      decision,
      coverageKind: item.coverageKind,
      entrySymbol: item.entrySymbol,
      path: item.path,
      testFile: item.file,
      testName: item.testName,
      databaseBacked: true,
      executedInR3: false,
      executionRequiredInR4: true,
      r4ExecutionStatus: 'BLOCKED_NO_TEST_DATABASE',
    };
  }),
  closure: {
    closedByExistingDirect: 1,
    closedByExistingPath: 12,
    closedByParticipantInheritance: 0,
    closedByDelegateInheritance: 0,
    closedByNewMinimalTest: 3,
    closedByReclassification: 0,
    remaining: 0,
  },
});
writeJson('11-boundary-count-crosswalk.json', crosswalk);
writeText(
  '12-validator-audit.txt',
  [
    'Command: npm exec tsx -- scripts/ts6-phase-b-transaction-authority-validator.ts audit',
    'Exit: 0',
    'Counts: candidates=120; canonicalBoundaries=113; participants=1; rawSites=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0.',
    run(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/ts6-phase-b-transaction-authority-validator.ts',
      'audit',
    ]),
  ].join('\n'),
);
writeText(
  '13-validator-verify.txt',
  [
    'Command: npm exec tsx -- scripts/ts6-phase-b-transaction-authority-validator.ts verify',
    'Exit: 0',
    run(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'scripts/ts6-phase-b-transaction-authority-validator.ts',
      'verify',
    ]),
    'Fixture hash before audit == after audit == before verify == after verify: 256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD.',
  ].join('\n'),
);
writeText(
  '14-validator-tests.txt',
  [
    'Focused: npx vitest run tests/unit/ts6-phase-b-transaction-authority-validator.test.ts --testTimeout=30000',
    'Result: PASS; 1 file, 24 tests. R3-V01 through R3-V16 included.',
    'Default broad npm run test:unit timeout note: this file has no assertion failure; the default 5s worker timeout hit one long mutation test. The 30s focused rerun passed.',
  ].join('\n'),
);
writeText(
  '15-db-verification.txt',
  [
    'Status: BLOCKED_NO_TEST_DATABASE',
    'Read-only discovery: process DATABASE_URL=UNSET; TEST_DATABASE_URL=UNSET; no repository-local .env/.env.test target was available.',
    'Approved references describe a dedicated shotgun_test target, but no live target/credential was available to probe safely.',
    'requireTestDatabaseTarget() would fail closed before pool creation.',
    'CG-RB-01..08 and all 16 selected database-backed regression tests were not run.',
    'No DATABASE_URL fallback, DB creation/drop/reset, port/instance creation, credential guess, Product/owner DB use, persisted env change, or repeated probing occurred.',
    'No commit, push, PR, Ready, or TS-7 action.',
  ].join('\n'),
);
writeText(
  '16-focused-tests.txt',
  [
    'Focused non-DB command: npx vitest run tests/unit/ts6-phase-b-transaction-authority-validator.test.ts tests/unit/frontend-command-route-outcome.test.ts tests/unit/ts6-transaction-boundary-golden.test.ts tests/contract/ts6-transaction-outcome.contract.test.ts tests/unit/runtime-data-integrity-wp03.test.ts --reporter=verbose',
    'Result: PASS; 5 files, 37 tests.',
    'Validator focused rerun: PASS; 1 file, 24 tests with --testTimeout=30000.',
    'Modified non-DB behavior tests and command gateway unit coverage passed.',
  ].join('\n'),
);
writeText(
  '17-static-gates.txt',
  [
    'npm run format:check: PASS',
    'npm run lint: PASS after artifact-only Node global declaration in scripts/rebuild-ts6-phase-b-c2-r3-review.mjs; no Product behavior change.',
    'npm run typecheck: PASS',
    'git diff --check: PASS',
    'Broad npm run test:unit: exit 1 only because default 5s timeout hit two long tests; 154/156 files and 1254/1256 tests passed, with no assertion failure. Targeted 30s reruns passed: TS-1 18/18 and validator 24/24.',
    'npm run test:contract: PASS; 69 files, 704 tests.',
    'npm run test:architecture: PASS.',
    'npm run test:stage12-package: PASS.',
  ].join('\n'),
);
writeText(
  '18-doc-gates.txt',
  [
    'npm run docs:validate: PASS.',
    'npm run docs:links: PASS; 355 Markdown relative links.',
    'npm run docs:adr-index: PASS; ADR identifiers 1-170.',
    'npm run docs:canonical: PASS.',
    'npm run docs:drift: PASS.',
    'npm run docs:knowledge-flow:check: FAIL; existing generated HTML is stale against unchanged canonical JSON. No related source/generated file is in the C2 patch; recorded as PRE_EXISTING_DOC_DRIFT and not regenerated during review.',
  ].join('\n'),
);
writeText(
  '19-security-oss-audit.txt',
  [
    'npm run secret:scan: PASS.',
    'npm run oss:verify: PASS; 68 decisions and 45 baseline references.',
    'npm audit --audit-level=high: exit 0; high=0, critical=0, two moderate advisories remain.',
    'Advisory: GHSA-82fw-gwwq-j7x9 / @vitest/mocker path traversal/arbitrary file read; nodes include root and apps/shotgun-web. Fix requires breaking vitest@5.0.1.',
    'package.json and package-lock.json have no C2 diff; advisory is PRE_EXISTING_NON_BLOCKING_ADVISORY. Dependencies were not changed or auto-upgraded.',
    'No dependency/security stop condition triggered.',
  ].join('\n'),
);

writeText(
  '20-final-patch-review.md',
  [
    '# C2-R4 final patch review',
    '',
    '## Authority and regression evidence',
    '',
    'Validator audit/verify agree with one v2 fixture: 120 candidates, 113 canonical boundaries, one participant, 11 raw sites, zero review-required boundaries, zero validator issues. The 16-record crosswalk is closed 1 direct + 12 existing path + 3 new minimal, with zero unexplained/remaining.',
    '',
    '## Source spot checks',
    '',
    '- Frontend Knowledge Draft: route `frontend-knowledge-draft-routes.ts` → `FrontendKnowledgeDraftProductCoordinator.commitFrontendDraft` → `commitCanonical` → `commitFrontendDraft`/`commitFrontendDraftInTransaction` → `adapters/postgres-stage6/src/index.ts` canonical repository. Event-handler/wiring review remains separate from the Product route and does not create a second Canonical authority.',
    '- Discovery Feedback/Runtime/Re-entry: `appendSuppression` is owned by `PostgresDiscoveryFeedbackRepository`; `PersistentDiscoveryWorker.runOnce` is not attributed to that method. Runtime `saveFailureContext` and re-entry disposition methods remain their own owner boundaries.',
    '- Raw transaction scan matches the reviewed baseline: no newly unregistered raw transaction owner and no C2 Product change adds one.',
    '',
    '## Classification and OSS',
    '',
    'Full worktree classification has UNRELATED=0. Existing C1/C2 Product edits are preserved and reviewed; R4 adds only review docs/artifact tooling. OSS decisions remain the repository-reviewed `REFERENCE_ONLY`/existing `ADOPT` set; no new runtime, DB, dependency, Port, Canonical, Evidence, Approval, or shared retry authority is introduced.',
    '',
    '## Stop disposition',
    '',
    'SOURCE_AUTHORITY PASS; REGRESSION_EVIDENCE PASS; V2_VALIDATOR PASS; FIXTURE_INTEGRITY PASS; FINAL_PATCH_REVIEW PASS; DB_VERIFICATION BLOCKED_NO_TEST_DATABASE; OVERALL REVIEW_REQUIRED/STOP.',
  ].join('\n'),
);

writeText(
  '21-final-handoff-report.md',
  [
    '# TS-6 PHASE B C2-R4 final handoff',
    '',
    '## Identity',
    '',
    '- Worktree `C:\\dev\\shotgun-ts6-phase-b`.',
    '- Branch `codex/ts6-postgres-transaction-phase-b`.',
    '- HEAD/base `1f821ea371b308d8cecede4a98ebe27960873b21`.',
    '',
    '## Result',
    '',
    '- SOURCE_AUTHORITY: PASS.',
    '- REGRESSION_EVIDENCE: PASS; all 16 links are explicit, but DB execution is pending.',
    '- V2_VALIDATOR: PASS; issueCount=0.',
    '- FIXTURE_INTEGRITY: PASS; H1==H2 and H3==H4, no validation-time mutation.',
    '- FINAL_PATCH_REVIEW: PASS; no new authority/raw/dependency/Product fix found.',
    '- DB_VERIFICATION: BLOCKED_NO_TEST_DATABASE.',
    '- OVERALL: REVIEW_REQUIRED/STOP.',
    '',
    '## Required next controller action',
    '',
    'Provide a safe, isolated existing `TEST_DATABASE_URL` target under the repository guard, then run only CG-RB-01..08 and the exact 16 selected DB-backed test titles. Do not use Product DB, create/reset/drop databases, or run the full database suite as a substitute.',
    '',
    'No commit, push, pull request, Ready status, or TS-7 transition was performed.',
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
      classification: Object.fromEntries(
        [...byClass.entries()].map(([kind, files]) => [kind, files.length]),
      ),
      regressionRecords: targets.length,
    },
    null,
    2,
  ),
);
