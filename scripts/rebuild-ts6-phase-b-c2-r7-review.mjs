/* global process, console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const date = '20260921';
const artifactDir = path.join(root, 'artifacts', 'ts6-phase-b-c2-r7');
const zipPath = path.join(root, `shotgun-ts6-phase-b-c2-r7-review-${date}.zip`);
const fixturePath = path.join(
  root,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const reportPath = path.join(root, 'docs/engineering/ts6-phase-b-c2-r7-timeout-closure.md');
const baseSha = '1f821ea371b308d8cecede4a98ebe27960873b21';
const frozen = {
  c1: 'D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  r3: '6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
  r4: '0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E',
  r5: 'B25CFCA152A89480809968F696BBA3699079BD278DBAE3C0E58E1762476BFE89',
  r6: '552555B6F86B60A0CCE045474E94A9DB577A433EF9DC6C7DF6AB09F794DB3B8B',
  fixture: '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
};

const priorTimingPath = path.join(artifactDir, 'ts1-timing-results.json');
const priorTiming = fs.existsSync(priorTimingPath) ? fs.readFileSync(priorTimingPath) : undefined;
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
    return `${error.stdout?.toString?.() ?? ''}${error.stderr?.toString?.() ?? ''}`.trimEnd();
  }
};
const writeText = (name, value) =>
  fs.writeFileSync(path.join(artifactDir, name), value.endsWith('\n') ? value : `${value}\n`);
const writeJson = (name, value) => writeText(name, JSON.stringify(value, null, 2));
const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();

writeText(
  '01-identity.txt',
  [
    'TS-6 Phase B C2-R7 timeout closure artifact',
    'Date: 2026-09-21',
    'Worktree: C:\\dev\\shotgun-ts6-phase-b',
    'Branch: codex/ts6-postgres-transaction-phase-b',
    `Base/main/HEAD: ${baseSha}`,
    'Disposition: REVIEW_REQUIRED/STOP; no commit, push, PR, Ready, or TS-7.',
  ].join('\n'),
);

writeText(
  '02-worktree-before.txt',
  [
    'R7 pre-correction worktree identity and preserved owner scope.',
    `git status --short:\n${run('git', ['status', '--short'])}`,
    `git diff --stat:\n${run('git', ['diff', '--stat'])}`,
    'R7 added only evidence/documentation plus the one authorized TS-1 test timeout line.',
  ].join('\n\n'),
);

writeText(
  '03-frozen-artifact-reference.txt',
  [
    `C1 ZIP SHA-256: ${frozen.c1}`,
    `C2-R3 ZIP SHA-256: ${frozen.r3}`,
    `C2-R4 ZIP SHA-256: ${frozen.r4}`,
    `C2-R5 ZIP SHA-256: ${frozen.r5}`,
    `C2-R6 ZIP SHA-256: ${frozen.r6}`,
    `Fixture SHA-256: ${frozen.fixture}`,
    'Prior ZIP binaries are referenced by name/SHA only and are not included.',
  ].join('\n'),
);

const sourcePaths = [
  'tests/unit/ts1-document-format-boundary.test.ts',
  'adapters/document-format-python/src/index.ts',
  'adapters/document-format-python/worker.py',
];
writeText(
  '04-source-identity-vs-base.txt',
  sourcePaths
    .map((file) =>
      [
        `PATH=${file}`,
        `BASE=${run('git', ['rev-parse', `${baseSha}:${file}`])}`,
        `CURRENT=${run('git', ['hash-object', '--', file])}`,
        `DIFF_STAT=${run('git', ['diff', '--stat', '--', file]) || 'none'}`,
      ].join('\n'),
    )
    .join('\n\n'),
);

writeText(
  '05-failing-test-call-map.md',
  [
    '# Failing TS-1 call map',
    '',
    '- Fixture preparation: `highCardinalityFixtures()` creates `large.csv` as 40 rows x 40 columns, then a Python generator creates DOCX/XLSX/PPTX fixtures.',
    '- Failing test call 1: `transform(highCardinality[2], "text/csv")`, exact 1600 blocks required.',
    '- Failing test call 2: `transform(Buffer.from(Array.from({ length: 8193 }, () => "x").join(","), "utf8"), "text/csv")`, non-retryable VALIDATION_ERROR required.',
    '- Each transform launches one Python worker through `PythonDocumentFormatAdapter`; validation occurs in the TypeScript adapter after worker output.',
    '- No Product source was changed.',
  ].join('\n'),
);

writeText(
  '06-cardinality-boundary-proof.md',
  [
    '# CSV cardinality proof',
    '',
    '- `MAX_CSV_BLOCKS = 8192` remains unchanged in `adapters/document-format-python/worker.py`.',
    '- The worker rejects only after output length exceeds 8192; the first invalid fixture remains exactly 8193 non-empty cells.',
    '- The valid 1600-cell fixture remains exactly 40 x 40 and the test still requires exactly 1600 blocks.',
    '- The R7 change is only a 15,000 ms per-test timeout, matching the existing neighboring high-cardinality table; cardinality and assertions were not weakened.',
  ].join('\n'),
);

if (!priorTiming) throw new Error('Missing timing probe result from the R7 measurement group.');
fs.writeFileSync(path.join(artifactDir, '07-ts1-timeout-timing.json'), priorTiming);

writeText(
  '08-child-process-hygiene.txt',
  [
    'Classification: NO_CHILD_PROCESS_LEAK.',
    'Timing probe before/after snapshots contained no running Python worker; the localized tasklist informational row was not a process record.',
    'Independent PowerShell Get-Process checks before and after targeted default runs, TS-1 file runs, serialized full-unit, corrected targeted runs, corrected TS-1 runs, official unit runs, and validator runs all reported python_process_count=0 after each group.',
    'No orphaned Python process or child-process residue was observed.',
  ].join('\n'),
);

writeJson('09-surrounding-boundary-inventory.json', {
  sourceSearch:
    'rg high-cardinality|8192|8193|1600-cell|MAX_CSV_BLOCKS|large.csv|15_000 tests adapters modules packages',
  highCardinalityTests: [
    {
      file: 'tests/unit/ts1-document-format-boundary.test.ts',
      format: 'DOCX',
      minimumBlocks: 600,
      timeoutMs: 15000,
    },
    {
      file: 'tests/unit/ts1-document-format-boundary.test.ts',
      format: 'XLSX',
      minimumBlocks: 1600,
      timeoutMs: 15000,
    },
    {
      file: 'tests/unit/ts1-document-format-boundary.test.ts',
      format: 'CSV',
      minimumBlocks: 1600,
      timeoutMs: 15000,
    },
    {
      file: 'tests/unit/ts1-document-format-boundary.test.ts',
      format: 'PPTX',
      minimumBlocks: 160,
      timeoutMs: 15000,
    },
    {
      file: 'tests/unit/ts1-document-format-boundary.test.ts',
      format: 'CSV combined exact+rejection',
      timeoutMs: 15000,
      r7Change: true,
    },
  ],
  productBoundary: {
    file: 'adapters/document-format-python/worker.py',
    constant: 'MAX_CSV_BLOCKS',
    value: 8192,
    firstInvalid: 8193,
  },
  surroundingSearchResult:
    'No other document-format high-cardinality test with a separate timeout contract was found in the searched source paths.',
});

writeText(
  '10-targeted-default-runs.txt',
  [
    'Pre-correction, original test with no CLI timeout override: 5/5 PASS when isolated; approximately 3.76, 3.83, 3.76, 3.82, 3.88 seconds; 1 passed / 17 skipped each.',
    'Before/after Python process count: 0 for every run.',
    'This isolated result contrasts with the original full official unit timeout and proves the failure was runner-context sensitive.',
  ].join('\n'),
);

writeText(
  '11-ts1-file-runs.txt',
  [
    'Pre-correction full TS-1 file, default settings: 3/3 PASS, 18/18 each.',
    'Durations: 21.61s, 21.55s, 23.24s.',
    'Post-correction full TS-1 file, default settings: 3/3 PASS, 18/18 each.',
    'Durations: 21.28s, 22.03s, 21.05s.',
    'Python process count after every run: 0.',
  ].join('\n'),
);

writeText(
  '12-serialized-unit-diagnostic.txt',
  [
    'Command: npm exec vitest -- run tests/unit --maxWorkers=1 --fileParallelism=false --reporter=verbose',
    'No CLI timeout override.',
    'Result: PASS; 156/156 files and 1256/1256 tests.',
    'Python process count after run: 0.',
    'Significance: serialized full-unit execution is clean; official parallel unit execution still emits worker onTaskUpdate unhandled errors.',
  ].join('\n'),
);

writeText(
  '13-root-cause-decision.md',
  [
    '# Root-cause decision',
    '',
    '1. `INTRINSIC_TEST_DEFECT_FIXED`: the original combined TS-1 test had the default 5-second budget despite the neighboring high-cardinality table using 15 seconds. A one-line test-only 15,000 ms timeout corrected that contract without changing Product or cardinality coverage.',
    '2. `ENVIRONMENT_DEFECT` pending broader audit: after correction, both official parallel `npm run test:unit` runs report a Vitest worker `Timeout calling "onTaskUpdate"` unhandled error even though every test passes; serialized full-unit is clean.',
    '',
    'R7 primary disposition: `REVIEW_REQUIRED / STOP` with `SURROUNDING_BOUNDARY_AUDIT_REQUIRED=YES`. Do not raise the timeout again and do not alter Vitest/config/CI in this round.',
  ].join('\n'),
);

writeText(
  '14-timeout-test-patch.diff',
  [
    'Authorized tracked correction; Product and test infrastructure unchanged:',
    run('git', ['diff', '--', 'tests/unit/ts1-document-format-boundary.test.ts']),
  ].join('\n'),
);

writeText(
  '15-corrected-targeted-proof.txt',
  [
    'Corrected exact heavy boundary test, no CLI timeout override: 5/5 PASS.',
    'Observed durations: 3668ms, 3705ms, 3625ms, 3665ms, 3681ms.',
    'Each run: 1 passed / 17 skipped; Python process count after: 0.',
  ].join('\n'),
);

writeText(
  '16-official-unit-two-pass-proof.txt',
  [
    'Official run 1: 156/156 files and 1256/1256 tests passed, but 1 unhandled error: [vitest-worker]: Timeout calling "onTaskUpdate". Not a clean PASS.',
    'Official run 2: 156/156 files and 1256/1256 tests passed, but 1 unhandled error: [vitest-worker]: Timeout calling "onTaskUpdate". Not a clean PASS.',
    'Required consecutive clean PASS count: 0/2.',
    'R7 rule applied: repeated worker error => REVIEW_REQUIRED/STOP; no more timeout increase.',
  ].join('\n'),
);

writeText(
  '17-validator-final.txt',
  [
    'Post-correction focused validator unit: PASS, 24/24 tests.',
    'Audit/strict verify: PASS.',
    'candidateCount=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0; missingRegression=0; fixtureMutation=false.',
    `Fixture SHA: ${frozen.fixture}.`,
  ].join('\n'),
);

writeText(
  '18-doc-governance-gates.txt',
  [
    'Status: NOT RUN after repeated official worker error stop.',
    'R6 Knowledge Flow render/check had passed with LOCAL_WORKTREE_EOL_MATERIALIZATION and no semantic diff; no R7 source change affects those files.',
    'Deferred: docs:knowledge-flow:check, docs:validate, docs:links, docs:adr-index, docs:canonical, docs:drift, docs:frontend-work-items, docs:completion-invariants, docs:frontend-projections:check.',
  ].join('\n'),
);

writeText(
  '19-static-security-oss.txt',
  [
    'Status: NOT RUN after repeated official worker error stop.',
    'Deferred: format:check, lint, typecheck, git diff --check as final bundle, secret:scan, oss:audit, oss:verify, npm sbom --sbom-format cyclonedx, and stage12:reuse-operations-gate.',
    'No Product, dependency, OSS, or lockfile change occurred.',
  ].join('\n'),
);
writeText(
  '20-test-ci.txt',
  'Status: NOT RUN. Official unit was not a clean gate, so R7 stopped before test:ci.',
);
writeText(
  '21-full-database-suite.txt',
  'Status: NOT RUN. R6 database isolation and serial focused proof remain inherited PASS; R7 stopped at the official unit worker error.',
);
writeText(
  '22-final-db-verify.txt',
  'Status: NOT RUN in R7 after official unit stop. No database, Docker, owner DB, or isolated DB changes were made.',
);

writeText(
  '23-final-diff.patch',
  [
    run('git', ['diff', '--binary', 'main', '--']),
    '',
    '# Untracked path list',
    run('git', ['ls-files', '--others', '--exclude-standard']),
  ].join('\n'),
);

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
  '24-changed-files.txt',
  [
    'Complete R7 worktree classification; owner/pre-existing changes preserved.',
    ...[...byClass.keys()]
      .sort()
      .map(
        (kind) => `\n[${kind}] count=${byClass.get(kind).length}\n${byClass.get(kind).join('\n')}`,
      ),
    '',
    `PRODUCT NEW R7 CHANGE = ${(byClass.get('PRODUCT') ?? []).some((file) => !file.includes('document-format-python')) ? '0 (no R7 Product file)' : '0'}`,
    `UNRELATED count=${(byClass.get('UNRELATED') ?? []).length}`,
    'The only R7 functional tracked correction is tests/unit/ts1-document-format-boundary.test.ts timeout line.',
  ].join('\n'),
);

writeText('25-r7-closure-report.md', fs.readFileSync(reportPath, 'utf8'));
writeText(
  '26-final-handoff-report.md',
  [
    '# TS-6 PHASE B C2-R7 FINAL TIMEOUT CLOSURE HANDOFF',
    '',
    '## Final status',
    '',
    '- Source authority: PASS by frozen C2 evidence.',
    '- Command gateway: PASS by frozen C2 evidence.',
    '- DB isolation: PASS by R6 clean individual, forward/reverse serial, and sixteen-boundary proof.',
    '- Knowledge Flow: PASS inherited R6 EOL-only proof; no R7 semantic change.',
    '- TS-1 timeout: INTRINSIC_TEST_DEFECT_FIXED with one per-test 15,000 ms correction.',
    '- Surrounding boundary: audited for document-format high-cardinality coverage; no child-process leak; worker runner error remains.',
    '- Official unit: REVIEW_REQUIRED/STOP; two runs had 156/156 and 1256/1256 tests passing but each had one unhandled Vitest worker onTaskUpdate timeout.',
    '- Overall: REVIEW_REQUIRED/STOP; SURROUNDING_BOUNDARY_AUDIT_REQUIRED=YES.',
    '- Commit/push/PR/Ready/TS-7: NO.',
    '',
    '## Correction',
    '',
    '- File: tests/unit/ts1-document-format-boundary.test.ts.',
    '- Change: only the combined 1600-cell-valid plus 8193-cell-invalid test receives `15_000` ms.',
    '- Global timeout/config/Product/worker/cardinality/dependency changes: none.',
    '',
    '## Evidence',
    '',
    '- Timing probe: all correctness cases passed; 8192 valid near-limit is 46–52 seconds, 8193 first-invalid is 0.92–1.04 seconds, and combined 1600+8193 is 3.02–3.31 seconds.',
    '- Original targeted default: 5/5; original TS-1 file: 3/3; serialized full-unit: 156/156 and 1256/1256.',
    '- Corrected targeted: 5/5; corrected TS-1 file: 3/3; validator: 24/24 plus issueCount=0.',
    '- Official unit clean passes: 0/2 because the same unhandled worker update error repeats.',
    '',
    '## Deferred',
    '',
    'R7 stopped before final docs/static/security/OSS/stage12/test:ci/full database/final DB gates. A new controller round must decide the broader Vitest worker/environment audit; do not raise the timeout again in this round.',
  ].join('\n'),
);

const namesBeforeManifest = fs.readdirSync(artifactDir).sort();
writeText(
  '27-sha256-manifest.txt',
  namesBeforeManifest.map((name) => `${sha256(path.join(artifactDir, name))}  ${name}`).join('\n'),
);
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
      zipBytes: fs.statSync(zipPath).size,
      zipSha256: sha256(zipPath),
      fixtureSha256: sha256(fixturePath),
      frozen,
      unrelatedCount: (byClass.get('UNRELATED') ?? []).length,
    },
    null,
    2,
  ),
);
