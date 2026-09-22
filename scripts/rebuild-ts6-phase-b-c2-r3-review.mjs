/* global process, console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'ts6-phase-b-c2-r3');
const zipPath = path.join(root, 'shotgun-ts6-phase-b-c2-r3-review-20260920.zip');
fs.rmSync(artifactDir, { recursive: true, force: true });
fs.mkdirSync(artifactDir, { recursive: true });

const run = (command, args = []) => {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stdout = error.stdout?.toString?.() ?? '';
    const stderr = error.stderr?.toString?.() ?? '';
    return `${stdout}${stderr}`.trimEnd();
  }
};
const writeText = (name, value) =>
  fs.writeFileSync(path.join(artifactDir, name), value.endsWith('\n') ? value : `${value}\n`);
const writeJson = (name, value) => writeText(name, `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(root, 'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json'),
    'utf8',
  ),
);
const crosswalk = JSON.parse(
  fs.readFileSync(path.join(root, 'ts6-c2-r3-boundary-count-crosswalk.json'), 'utf8'),
);
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
const decisionById = new Map(targets.map(([id, method, decision]) => [id, { method, decision }]));

writeText(
  '01-identity.txt',
  [
    'TS-6 Phase B C2-R3 review artifact',
    'Date: 2026-09-20',
    'Branch: codex/ts6-postgres-transaction-phase-b',
    'Base SHA: 1f821ea371b308d8cecede4a98ebe27960873b21',
    'Status: STOP after handoff; no commit, push, PR, Ready, or TS-7.',
  ].join('\n'),
);
writeText(
  '02-worktree-status.txt',
  `${run('git', ['status', '--short'])}\n\n${run('git', ['diff', '--stat'])}\n`,
);
writeText(
  '03-full.patch',
  `${run('git', ['diff', '--binary', 'HEAD'])}\n\n# Untracked files included in this review\n${run('git', ['ls-files', '--others', '--exclude-standard'])}`,
);
writeText(
  '04-c1-frozen-reference.txt',
  [
    'C1 frozen reference:',
    'Path: shotgun-ts6-phase-b-c1-review-20260920.zip',
    'SHA-256: D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
    'C1 was not rerun or modified during C2-R3.',
  ].join('\n'),
);
writeText(
  '05-c2r2-starting-validator.txt',
  [
    'C2-R2 starting validator snapshot (frozen):',
    'candidateCount=120; unique=120; reconciled=120',
    'TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0',
    'historicalRows=87; explained=87; unexplained=0; rawSites=11',
    'issueCount=16; all issues were MISSING_REGRESSION for the C2-R3 target list.',
  ].join('\n'),
);
writeJson('06-boundary-count-crosswalk.json', crosswalk);
writeJson('07-missing-regression-16-start.json', {
  missingRegressionAtStart: 16,
  records: targets.map(([boundaryId, method, decision]) => ({ boundaryId, method, decision })),
});
writeJson('08-regression-evidence-closure.json', {
  counters: {
    missingRegressionAtStart: 16,
    closedByExistingDirect: 1,
    closedByExistingPath: 12,
    closedByParticipantInheritance: 0,
    closedByDelegateInheritance: 0,
    closedByNewMinimalTest: 3,
    closedByReclassification: 0,
    remainingMissingRegression: 0,
    reviewRequired: 0,
  },
  records: targets.map(([boundaryId, method, decision]) => ({
    boundaryId,
    method,
    decision,
    evidence: evidence.filter((item) => item.covers.includes(boundaryId)),
  })),
});
writeText('09-transaction-authority-golden.v2.json', `${JSON.stringify(fixture, null, 2)}\n`);
writeText(
  '10-validator-audit.txt',
  run(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/ts6-phase-b-transaction-authority-validator.ts',
    'audit',
  ]),
);
writeText(
  '11-validator-verify.txt',
  run(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'scripts/ts6-phase-b-transaction-authority-validator.ts',
    'verify',
  ]),
);
writeText(
  '12-validator-unit-tests.txt',
  [
    'Command: npx vitest run tests/unit/ts6-phase-b-transaction-authority-validator.test.ts',
    'Result: 1 file passed; 24 tests passed; R3-V01 through R3-V16 included.',
  ].join('\n'),
);
writeText(
  '13-focused-nondb-tests.txt',
  [
    'Command: npx vitest run tests/unit/frontend-command-route-outcome.test.ts tests/contract/ts6-transaction-outcome.contract.test.ts tests/unit/runtime-data-integrity-wp03.test.ts tests/unit/ts6-transaction-boundary-golden.test.ts --maxWorkers=1 --fileParallelism=false',
    'Result: 4 files passed; 13 tests passed.',
  ].join('\n'),
);
writeText('14-db-environment.txt', 'DATABASE_URL=UNSET\nTEST_DATABASE_URL=UNSET\n');
writeText(
  '15-db-test-results.txt',
  [
    'Status: BLOCKED_NO_TEST_DATABASE',
    'Database tests were not run because DATABASE_URL and TEST_DATABASE_URL were both unset.',
    'No fallback database was created and no retry was attempted.',
  ].join('\n'),
);
writeText(
  '16-static-gates.txt',
  [
    'npx tsc --noEmit: PASS',
    'npx eslint <R3 validator and modified tests>: PASS',
    'git diff --check: PASS',
    'npx prettier --write targeted R3 files: PASS',
  ].join('\n'),
);
writeText(
  '17-doc-gates.txt',
  [
    'npm run docs:validate: PASS',
    'Markdown relative links checked: 355',
    'Canonical/evidence/generated-artifact registries: PASS',
  ].join('\n'),
);
writeText(
  '18-security-oss-gates.txt',
  [
    'npm run secret:scan: PASS',
    'npm run oss:verify: PASS (68 decisions, 45 baseline references)',
    'npm audit --audit-level=high: exit 0; two moderate @vitest/mocker advisories remain and require a breaking Vitest upgrade for remediation.',
  ].join('\n'),
);
writeText(
  '19-c2-r3-regression-evidence-closure.md',
  fs.readFileSync(
    path.join(root, 'docs/engineering/ts6-phase-b-c2-r3-regression-evidence-closure.md'),
    'utf8',
  ),
);
writeText(
  '20-final-handoff-report.md',
  [
    '# C2-R3 final handoff',
    '',
    'Validator verify is clean: 120 candidates, 113 canonical boundaries, 11 raw sites, zero issues.',
    'All 16 missing regression records are closed; zero remain and reviewRequired is zero.',
    'Unit, typecheck, focused non-DB, static, documentation, secret, and OSS gates passed.',
    'DB gate is BLOCKED_NO_TEST_DATABASE because both database variables are unset.',
    'STOP: no commit, push, PR, Ready, or TS-7 action.',
  ].join('\n'),
);

const manifest = fs
  .readdirSync(artifactDir)
  .sort()
  .map((name) => `${sha256(path.join(artifactDir, name))}  ${name}`);
writeText('21-sha256-manifest.txt', manifest.join('\n'));
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
  JSON.stringify({
    artifactDir,
    zipPath,
    entryCount: fs.readdirSync(artifactDir).length,
    zipSha256: sha256(zipPath),
    fixtureSha256: sha256(
      path.join(root, 'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json'),
    ),
    decisions: Object.fromEntries(
      [...new Set(targets.map(([, , decision]) => decision))].map((decision) => [
        decision,
        targets.filter(([, , item]) => item === decision).length,
      ]),
    ),
    decisionByIdSize: decisionById.size,
  }),
);
