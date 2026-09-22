/* global process, console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts', 'ts6-phase-b-c2-r6');
const zipPath = path.join(root, 'shotgun-ts6-phase-b-c2-r6-review-20260920.zip');
const fixturePath = path.join(
  root,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const baseSha = '1f821ea371b308d8cecede4a98ebe27960873b21';
const frozen = {
  c1: 'D651A2D750C9FA098E62B3E6A42DCFA256EA1A1FEB7B7CCECB6DAC7542076D04',
  r3: '6DC3EF9C2B1917B1401A4C5CD0BF4E7FFA8EE768A117C734B5D9292CB32D49E0',
  r4: '0E7512DF209A9786A766104F1FBDA42EB0D92BBFF7F00E4B0D657380680E091E',
  r5: 'B25CFCA152A89480809968F696BBA3699079BD278DBAE3C0E58E1762476BFE89',
  fixture: '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
};

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
    'TS-6 Phase B C2-R6 CI-equivalent closure artifact',
    'Date: 2026-09-20',
    'Worktree: C:\\dev\\shotgun-ts6-phase-b',
    'Branch: codex/ts6-postgres-transaction-phase-b',
    `Base/main/HEAD: ${baseSha}`,
    'Disposition: CHANGES_REQUIRED/STOP; no commit, push, PR, Ready, or TS-7.',
  ].join('\n'),
);

writeText(
  '02-worktree-before.txt',
  [
    'R6 worktree identity and preserved owner scope.',
    `git status --short:\n${run('git', ['status', '--short'])}`,
    `git diff --stat:\n${run('git', ['diff', '--stat'])}`,
    'The listed Product/test/document changes predate and remain owner scope. R6 added only its closure document, builder, evidence directory, and ZIP.',
  ].join('\n\n'),
);

writeText(
  '03-r5-command-analysis.txt',
  [
    'R5 command canonicality analysis',
    'R5 used: npm exec vitest -- run <11 files> -t <titles> --reporter=verbose',
    'R5_USED_CANONICAL_SERIAL_FLAGS = NO',
    'Omitted: --maxWorkers=1 --fileParallelism=false --testTimeout=60000 --hookTimeout=60000',
    'Repository official database command includes all four flags.',
    'R6 kept Product/test/helper files unchanged.',
  ].join('\n'),
);

writeText(
  '04-f1-clean-reproduction.txt',
  [
    'F1: tests/database/akp-5-wp2-discovery-reentry.database.test.ts',
    'Title: durably defers retryable failures, advances the retry boundary, and transitions to processed',
    'Precondition: fresh db:test:reset and db:test:verify PASS.',
    'Official serial flags: PASS.',
    'Result: 1 passed / 12 skipped.',
  ].join('\n'),
);

writeText(
  '05-f2-clean-reproduction.txt',
  [
    'F2: tests/database/frontend-ask-write-postgres.database.test.ts',
    'Title: commits aggregate and outcome atomically, recovers after restart, and serializes follow-ups',
    'Precondition: fresh db:test:reset and db:test:verify PASS.',
    'Official serial flags: PASS.',
    'Result: 1 passed / 1 skipped.',
  ].join('\n'),
);

writeText(
  '06-f3-clean-reproduction.txt',
  [
    'F3: tests/database/frontend-sources-stage3-recovery.test.ts',
    'Title: Stage3 first attempt throws → retry → same SourceId/SourceVersionId → Stage3 completes → Evidence exists → no duplicate SourceVersion',
    'Precondition: fresh db:test:reset and db:test:verify PASS.',
    'Official serial flags: PASS.',
    'Result: 1 passed / 1 skipped.',
  ].join('\n'),
);

writeText(
  '07-three-test-serial-sequences.txt',
  [
    'Forward sequence: PASS; all 13 selected assertions passed in the R5 observed file-order sequence.',
    'Reverse sequence: PASS; all 13 selected assertions passed in reverse order.',
    'Each sequence had one reset/verify before the sequence and no reset between selected tests.',
    'Conclusion: no serial order defect; R5 concurrent failures are a focused-runner concurrency artifact.',
  ].join('\n'),
);

writeText(
  '08-sixteen-evidence-serial.txt',
  [
    'Sixteen boundary records: PASS.',
    'Runner result: 11 files passed; 15 selected assertions passed; 72 exact-title skips.',
    'One mixed Sources test covers two boundary records.',
    'Supplied file order: runtime-data, post-tf-risk002, akp-5, akp-4, frontend-activity, frontend-ask, frontend-sources, stage-5, comparison-reentry, section2, provider-authority.',
    'Observed Vitest worker order is recorded separately in the R6 handoff; scheduling is not treated as an order guarantee.',
    'No Product/test/helper patch was needed.',
  ].join('\n'),
);

writeJson('09-isolation-root-cause.json', {
  classification: 'FOCUSED_RUNNER_CONCURRENCY_ARTIFACT',
  r5UsedCanonicalSerialFlags: false,
  cleanIndividualReproductions: { f1: 'PASS', f2: 'PASS', f3: 'PASS' },
  forwardSequence: 'PASS',
  reverseSequence: 'PASS',
  sixteenBoundarySerialRun: 'PASS',
  isolationPatchApplied: false,
  rootCause:
    'R5 launched shared-database tests concurrently without the repository serial flags; individual and serial R6 execution passed.',
  allowedIsolationFilesConsidered: [
    'tests/database/akp-5-wp2-discovery-reentry.database.test.ts',
    'tests/database/frontend-ask-write-postgres.database.test.ts',
    'tests/database/frontend-sources-stage3-recovery.test.ts',
  ],
});

writeText(
  '10-conditional-test-patch.txt',
  [
    'Conditional isolation patch: NOT APPLIED.',
    'R6 proved the focused runner concurrency artifact with clean individual, forward, reverse, and sixteen-boundary serial runs.',
    'Existing helper tests/helpers/isolated-postgres-test-database.ts was reviewed but not changed.',
    'No test, Product, helper, database, Docker, or timeout configuration change was authorized or made.',
  ].join('\n'),
);

writeText(
  '11-knowledge-flow-base-comparison.txt',
  [
    'Base commit: 1f821ea371b308d8cecede4a98ebe27960873b21',
    'knowledge-flow-baseline-v1.0.json base blob/current Git object: dcd522c6be121aba57e4198c9ba82718eb3b1e30',
    'render-knowledge-flow-baseline.mjs base blob/current Git object: 7936a32424343bc35d0b2b145c70e5a9bbacb848',
    'SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html base blob/current Git object: 5b3fccaf379477bb331bb0e31a20d230f91f04f1',
    'Git-normalized semantic diff: none.',
    'Classification: LOCAL_WORKTREE_EOL_MATERIALIZATION.',
  ].join('\n'),
);

writeText(
  '12-knowledge-flow-eol-proof.txt',
  [
    'Base/current raw bytes and line endings:',
    'JSON: base 13554 bytes, LF=265, CRLF=0; current 13819 bytes, LF=265, CRLF=265; current raw SHA D2A9F7E3F19E8F60C5C9FAD3D88F953E208D21B0C29EF8AF940BD088C7841597.',
    'Renderer: base 7479 bytes, LF=93, CRLF=0; current 7572 bytes, LF=93, CRLF=93; current raw SHA 330E70C350F16FC528055DFF84A82C490C18920BD563F4670EF7BE3FCB3357E5.',
    'HTML: base/current 18479 bytes, LF=38, CRLF=0; current raw SHA 0C126E42A2CEABD061F9156B0963D3310B6FF37DB6B39FB8B972A67E2B9110EC.',
    'No semantic generated HTML diff remained after authorized render.',
  ].join('\n'),
);

writeText(
  '13-knowledge-flow-final.txt',
  [
    'npm run docs:knowledge-flow:render: PASS.',
    'npm run docs:knowledge-flow:check: PASS.',
    'Generated artifacts are semantically unchanged from base; the prior dirty state was local EOL materialization.',
    'No knowledge-flow product or canonical data change.',
  ].join('\n'),
);

writeText(
  '14-validator-final.txt',
  [
    'Focused validator unit: PASS; 1 file, 24 tests.',
    'Audit/verify: PASS.',
    'candidateCount=120; rawSiteCount=11; TX_BOUNDARY=100; TX_PARTICIPANT=0; TX_DELEGATE=0; NON_TX=7; TEST_ONLY_OR_DEAD=13; REVIEW_REQUIRED=0; issueCount=0; missingRegression=0.',
    `Fixture SHA: ${frozen.fixture}; unchanged.`,
  ].join('\n'),
);

writeText(
  '15-official-unit.txt',
  [
    'Targeted authorized rerun: PASS; tests/unit/ts1-document-format-boundary.test.ts, 18/18 with --testTimeout=30000.',
    'Official run 1: FAIL; 155 passed files, 1 failed file; 1255 passed tests, 1 failed test.',
    'Official run 2: FAIL; 155 passed files, 1 failed file; 1255 passed tests, 1 failed test; one unhandled vitest-worker onTaskUpdate timeout also reported.',
    'Sole failure: ts1-document-format-boundary.test.ts, "keeps 1600-cell CSV valid and rejects excessive logical cardinality", default Test timed out in 5000ms.',
    'Official unit gate: CHANGES_REQUIRED / STOP.',
  ].join('\n'),
);

writeText(
  '16-doc-quality-gates.txt',
  [
    'Deferred after official unit gate stop: docs:validate, docs:links, docs:adr-index, docs:canonical, docs:drift, docs:frontend-work-items, docs:completion-invariants, docs:frontend-projections:check, plus final docs bundle.',
    'Knowledge-flow render/check already passed and is recorded in entries 11-13.',
    'No completion claim.',
  ].join('\n'),
);

writeText(
  '17-static-security-oss.txt',
  [
    'Deferred after official unit gate stop: format:check, lint, typecheck, git diff --check, secret:scan, oss:audit, oss:verify, npm sbom --sbom-format cyclonedx, and stage12:reuse-operations-gate.',
    'No dependency or lockfile change; no new OSS decision in R6.',
  ].join('\n'),
);

writeText(
  '18-test-ci.txt',
  'Status: NOT RUN. R6 stopped after the required two official unit attempts did not both pass.',
);
writeText(
  '19-full-database-suite.txt',
  'Status: NOT RUN. Individual/serial focused database evidence passed; full suite was deferred because the official unit gate stopped R6.',
);
writeText(
  '20-final-db-verify.txt',
  [
    'Status: NOT RUN after the official unit gate stop.',
    'All R6 focused runs used canonical shotgun_test at localhost:5433 and passed their reset/verify preconditions.',
    'Pre-existing db-test container remains running; no service stop performed.',
  ].join('\n'),
);

const trackedPatch = run('git', ['diff', '--binary', 'main', '--']);
const untracked = run('git', ['ls-files', '--others', '--exclude-standard'])
  .split(/\r?\n/)
  .filter(Boolean);
writeText(
  '21-final-diff.patch',
  `${trackedPatch}\n\n# Untracked path list\n${untracked.join('\n')}`,
);

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
const changed = run('git', ['status', '--short'])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/^"|"$/g, ''));
const byClass = new Map();
for (const file of changed) {
  const kind = classify(file);
  if (!byClass.has(kind)) byClass.set(kind, []);
  byClass.get(kind).push(file);
}
for (const files of byClass.values()) files.sort();
writeText(
  '22-changed-files.txt',
  [
    'Current worktree classification; owner/pre-existing changes preserved.',
    ...[...byClass.keys()]
      .sort()
      .map(
        (kind) => `\n[${kind}] count=${byClass.get(kind).length}\n${byClass.get(kind).join('\n')}`,
      ),
    '',
    `UNRELATED count=${(byClass.get('UNRELATED') ?? []).length}`,
    'R6 substantive additions: closure document, evidence builder, evidence directory, and R6 ZIP only.',
  ].join('\n'),
);

writeText(
  '23-r6-closure-report.md',
  fs.readFileSync(
    path.join(root, 'docs/engineering/ts6-phase-b-c2-r6-ci-equivalent-closure.md'),
    'utf8',
  ),
);
writeText(
  '24-final-handoff-report.md',
  [
    '# TS-6 PHASE B C2-R6 EXECUTION CLOSURE HANDOFF',
    '',
    '## Final status',
    '',
    '- R5_USED_CANONICAL_SERIAL_FLAGS: NO.',
    '- DB_ISOLATION_REPRODUCTION: PASS; F1/F2/F3 clean, forward/reverse sequences, and sixteen serial boundary evidence passed.',
    '- FOCUSED_RUNNER_CONCURRENCY_ARTIFACT: PROVEN; no isolation patch applied.',
    '- KNOWLEDGE_FLOW: PASS; LOCAL_WORKTREE_EOL_MATERIALIZATION; no semantic generated change.',
    '- VALIDATOR: PASS; candidate=120, raw=11, issueCount=0, fixture unchanged.',
    '- OFFICIAL_UNIT: CHANGES_REQUIRED/STOP; two consecutive unmodified npm run test:unit runs failed the same default 5s TS-1 timeout.',
    '- OVERALL: REVIEW_REQUIRED/STOP. No commit, push, PR, Ready, or TS-7.',
    '',
    '## Required controller decision',
    '',
    'Decide whether to authorize a narrowly scoped remedy for the default timeout in tests/unit/ts1-document-format-boundary.test.ts or its test configuration. R6 did not infer authorization and changed no Product/test/helper/timeout/dependency file.',
    '',
    '## Deferred',
    '',
    'Docs/governance bundle after unit stop, static/security/OSS/SBOM, stage12, test:ci, full database suite, and final db verify were not run. The canonical db-test service remains running.',
  ].join('\n'),
);

const manifestEntries = fs.readdirSync(artifactDir).sort();
const manifest = manifestEntries.map((name) => `${sha256(path.join(artifactDir, name))}  ${name}`);
writeText('25-sha256-manifest.txt', manifest.join('\n'));
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
      frozen,
      unrelatedCount: (byClass.get('UNRELATED') ?? []).length,
    },
    null,
    2,
  ),
);
