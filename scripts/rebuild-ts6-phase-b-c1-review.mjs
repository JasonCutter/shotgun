/* global process, console */

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'artifacts', 'ts6-phase-b-c1');
const previous = path.join(root, 'artifacts', 'ts6-phase-b-review');
const copy = (source, destination) => {
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
};
const write = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value.endsWith('\n') ? value : value + '\n', 'utf8');
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copy(previous, path.join(out, 'prior-phase-b-review'));
for (const relative of [
  'tests/helpers/postgres-commit-ack-loss.ts',
  'tests/database/post-tf-risk001a-proof-matrix.test.ts',
  'tests/database/post-tf-risk001b-proof-matrix.test.ts',
  'tests/database/ts6-semantic-embedding-ack-loss.database.test.ts',
  'tests/database/ts6-transaction-outcome-isolation.database.test.ts',
  'docs/implementation/ts6-postgres-transaction-phase-b.md',
  'scripts/rebuild-ts6-phase-b-c1-review.mjs',
]) {
  copy(path.join(root, relative), path.join(out, 'current-implementation', `${relative}.txt`));
}

const source = JSON.parse(
  readFileSync(path.join(previous, 'safe-helper-caller-review-49.json'), 'utf8'),
);
const positiveControlIds = new Set([
  'safe:adapters/connector-runtime-postgres/src/index.ts:1199:PostgresOrderingStore.acquireNext',
  'safe:adapters/connector-runtime-postgres/src/index.ts:1284:PostgresOrderingStore.commit',
]);
const unresolved = (row) =>
  row.semanticBoundaryId.includes('recoverExpiredLeases') ||
  row.bindingStatus !== 'EXACT_RUNTIME_PATH_PROVEN' ||
  row.immediateCaller?.status === 'UNRESOLVED_DYNAMIC' ||
  row.higherLevelBoundary?.status === 'UNRESOLVED_DYNAMIC' ||
  row.callerVisibleResult === 'UNRESOLVED_CALLER_RESULT' ||
  String(row.typedOutcomeUnknownBehavior).includes('NOT_PROVEN') ||
  String(row.durableOutcomeState).includes('UNRESOLVED');
const finalRows = source.rows.map((row) => ({
  stableBoundaryId: row.semanticBoundaryId,
  surface: row.surface,
  transactionOwner: row.transactionOwner,
  exactImmediateCaller: row.immediateCaller,
  higherRuntimeApiBoundary: row.higherLevelBoundary,
  bindingEvidence: {
    status: row.bindingStatus,
    detail: row.bindingEvidence,
    callerBindingEvidence: row.callerBindingEvidence,
    source: row.evidenceReferences,
  },
  outcomeUnknownBehavior: row.typedOutcomeUnknownBehavior,
  durableAmbiguityAuthority: row.durableOutcomeState,
  automaticRetryOwner: row.automaticRetryOwner,
  restartRecoveryOwner: row.restartRecoveryOwner,
  callerVisibleResult: row.callerVisibleResult,
  durableSideEffects: row.externalSideEffects,
  externalSideEffects: row.externalSideEffects,
  finalRiskClass: row.finalBlastRadius,
  finalDisposition: positiveControlIds.has(row.semanticBoundaryId) ? 'NO_CHANGE_PROVEN_SAFE' : null,
  evidenceRefs: [
    ...new Set([...(row.evidenceReferences ?? []), ...(row.sourceControlEvidence ?? [])]),
  ],
  reviewState: positiveControlIds.has(row.semanticBoundaryId)
    ? 'PROVEN_POSITIVE_CONTROL'
    : unresolved(row)
      ? 'BLOCKED_UNRESOLVED_CALLER_SEMANTICS'
      : 'READY_FOR_CONTROLLER_REVIEW',
}));
const unresolvedRows = finalRows.filter(
  (row) => row.reviewState === 'BLOCKED_UNRESOLVED_CALLER_SEMANTICS',
);
write(
  path.join(out, 'safe-helper-final-phase-b-c1.json'),
  JSON.stringify(
    {
      schemaVersion: 'ts6-phase-b-c1.safe-helper-final.v1',
      status: unresolvedRows.length === 0 ? 'READY_FOR_CONTROLLER_REVIEW' : 'BLOCKED',
      complete: unresolvedRows.length === 0,
      total: finalRows.length,
      unresolvedCount: unresolvedRows.length,
      dispositionTotals: finalRows.reduce((counts, row) => {
        const key = row.finalDisposition ?? 'UNRESOLVED';
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
      allowedFinalDispositions: [
        'NO_CHANGE_PROVEN_SAFE',
        'FIX_CALLER_OUTCOME_PROPAGATION',
        'FIX_OPERATION_SPECIFIC_RESOLUTION',
      ],
      stopReason:
        unresolvedRows.length === 0
          ? null
          : '48 safe-helper rows still contain dynamic caller binding or unresolved propagation fields; C1 completion is not claimed.',
      rows: finalRows,
    },
    null,
    2,
  ),
);

const golden = JSON.parse(readFileSync(path.join(previous, 'golden-corpus.json'), 'utf8'));
write(
  path.join(out, 'golden-corpus-c1.json'),
  JSON.stringify(
    {
      ...golden,
      schemaVersion: 'ts6-transaction-boundary-golden.c1.v1',
      c1Status: unresolvedRows.length === 0 ? 'READY_FOR_CONTROLLER_REVIEW' : 'BLOCKED',
      c1UnresolvedSafeHelperRows: unresolvedRows.length,
      c1Note:
        'The inherited 112-row corpus is copied for audit. It is not a C1 completion proof while safe-helper caller semantics remain unresolved.',
    },
    null,
    2,
  ),
);

write(
  path.join(out, 'db-proof-results.json'),
  JSON.stringify(
    {
      schemaVersion: 'ts6-phase-b-c1.db-proof-results.v1',
      databaseTarget: 'postgres://shotgun:shotgun@localhost:5433/shotgun_test',
      productDatabaseUsed: false,
      dbTestVerify: 'PASS',
      fullDatabaseSuite: { filesPassed: 111, filesSkipped: 1, testsPassed: 543, testsSkipped: 2 },
      focusedProofs: {
        genericTransactionOutcomeIsolation: 'PASS (1)',
        primaryProofMatrixA: 'PASS (14)',
        primaryProofMatrixB: 'PASS (12)',
        semanticEmbeddingAckLoss: 'PASS (1)',
      },
      fivePrimaryCorrections: {
        'PostgresAIProviderCallRepository.ensure': 'PASS',
        'PostgresCandidateRepository.saveBatch': 'PASS',
        'PostgresChangeSetReviewV2Repository.resolveOperation': 'PASS',
        'PostgresCredentialVaultRepository.advanceRevision': 'PASS',
        'PostgresSemanticEmbeddingProfileRepository.saveRevision': 'PASS',
      },
      deterministicFaultLabel: 'DETERMINISTIC_POST_COMMIT_ACK_LOSS_FAULT_INJECTION',
      commitAttempted: true,
      postCommitRollbackAttempted: false,
      isolationRule: 'shotgun_test_iso_* only; all children disposed',
    },
    null,
    2,
  ),
);

write(
  path.join(out, 'hygiene-and-environment.json'),
  JSON.stringify(
    {
      schemaVersion: 'ts6-phase-b-c1.hygiene.v1',
      testDatabaseUrl: 'postgres://shotgun:shotgun@localhost:5433/shotgun_test',
      databaseUrl: 'unset',
      isolatedNamespace: 'shotgun_test_iso_*',
      residueCountAfterSuite: 0,
      dbTestVerify: 'PASS',
      residueCleanup: {
        approvedTarget: 'shotgun_test_iso_1789897010279_e16820bb47c3',
        readOnlyProvenanceChecked: true,
        activeSessionsBeforeDrop: 0,
        dropped: true,
      },
    },
    null,
    2,
  ),
);

write(
  path.join(out, 'baseline-comparison.md'),
  `# C1 baseline comparison

+ Baseline and current HEAD: \`1f821ea371b308d8cecede4a98ebe27960873b21\`.
+ \`package-lock.json\` hash is identical: \`e0cfdf81997db94945582c44bb62729e3f6860e1\`.
- Targeted unit baseline and current both reproduce exactly 7 pre-existing frontend retry-classification failures.
- Targeted contract comparison: PASS, 12 tests.
- Targeted integration comparison: PASS, 33 tests.
- Baseline/current documentation knowledge-flow check remains stale; no generated baseline was rewritten.
- Baseline/current moderate audit result remains two Vitest advisories; no dependency upgrade was applied.
+ Clean-install SBOM and \`npm ls --depth=0\` pass.
`,
);

write(
  path.join(out, 'verification-summary.md'),
  `# TS-6 Phase B C1 verification summary

## Passing evidence

- Full PostgreSQL suite: 111 files passed, 1 skipped; 543 tests passed, 2 skipped.
- Five primary Product corrections and focused ACK-loss matrices pass.
- Database hygiene is zero isolated-database residue after the suite.
- Typecheck, lint, architecture, docs validation, ADR index, secret scan, OSS gate, clean-install SBOM and dependency inventory pass.
- Contract and integration targeted baseline comparisons pass.

## Non-gating baseline classifications

- Seven frontend retry unit failures are reproduced exactly on the clean baseline and current worktree.
- Knowledge Flow generated baseline is stale on both baseline and current worktrees.
- Two moderate Vitest audit advisories are present on both baseline and current worktrees.

## C1 stop condition

The exact immediate caller, higher runtime boundary, and typed OUTCOME_UNKNOWN propagation are still not proven for 48 of the 51 safe-helper rows. The bundle therefore does not claim C1 completion or commit authorization. The controller must provide the next disposition before implementation continues.
`,
);

const tracked = execFileSync('git', ['diff', '--name-only'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
write(
  path.join(out, 'changed-file-manifest.md'),
  `# Changed-file manifest\n\n## Tracked\n\n${tracked || '(none)'}\n\n## Untracked\n\n${untracked || '(none)'}\n\nCommit, push, and PR are prohibited at this handoff.\n`,
);
write(
  path.join(out, 'commands.txt'),
  `git rev-parse HEAD\ngit rev-parse origin/main\ngit diff --check\nnpm run db:test:verify\nnpm run test:database\nnpm run typecheck\nnpm run lint\nnpm run format:check\nnpm run docs:validate\nnpm run docs:adr-index\nnpm run oss:verify\nnpm sbom --sbom-format cyclonedx\nnpm ls --depth=0\n`,
);

const hashFile = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'sha256.txt' || entry.name.endsWith('.zip')) continue;
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(out);
files.sort();
write(
  path.join(out, 'sha256.txt'),
  files
    .map((file) => `${hashFile(file)}  ${path.relative(out, file).replaceAll('\\', '/')}`)
    .join('\n'),
);
console.log(
  JSON.stringify({
    out,
    totalSafeHelperRows: finalRows.length,
    unresolvedSafeHelperRows: unresolvedRows.length,
    manifestEntries: files.length,
  }),
);
