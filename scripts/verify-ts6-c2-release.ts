/**
 * TS-6 C2 release verifier — the minimal, deterministic release gate.
 *
 * WHY THIS EXISTS
 *   `npm run test:ci` does not run `scripts/ts6-audit/*`, so the TS-6 C2 core
 *   deliverable — the qualified reachability authority and the `golden.v6`
 *   derived lineage — would ship UNSKIPPABLE-UNVERIFIED. This script is the small
 *   deterministic gate that closes that hole: it re-derives the authority from the
 *   current corpus and fails if the committed lineage no longer follows from it.
 *
 * WHAT IT DOES NOT DO
 *   It does not pin `96 / 17` as a constant and assert that. A hardcoded number
 *   would pass while the authority silently drifted. Every check below RE-DERIVES
 *   the value and compares, so a change in the authority fails this gate until the
 *   lineage is deliberately re-derived.
 *
 *   It also does not replace the issue-scoped audit suites
 *   (`scripts/ts6-audit/*.test.ts`), which remain the detailed negative-test
 *   taxonomy and are deliberately NOT permanent unit/contract gates.
 *
 * Run:  npm run verify:ts6-c2        exit 0 = release-verifiable, non-zero = drift
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildAuditShape,
  validateCorpus,
  type Corpus,
} from './ts6-phase-b-transaction-authority-validator.js';

const ROOT = process.cwd();

/**
 * Hashes of the artifacts this correction PROMISES not to modify.
 *
 * These are the expected values, not a convenience: a reachability correction
 * must never rewrite history, so if a change trips these the change is wrong, not
 * the hash. `golden.v6` is deliberately absent — it is the DERIVED output and is
 * expected to change only through `rebuild-ts6-phase-b-c2-r15-v6-lineage.mjs`.
 */
const FROZEN = {
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json': [
    '256E5906DB0AFBDEB175C1E754C2C8EC3A1213139AE4F805E95C5396086586CD',
    'frozen v2 fixture',
  ],
  'ts6-c2-r3-boundary-count-crosswalk.json': [
    'E4861D67B1EBC4885FA9034245C0B2734E25E3865DE278A4FF660C0B4B0621D2',
    'frozen boundary-count crosswalk',
  ],
  'artifacts/ts6-phase-b-c2-r15/golden.v5.derived.json': [
    'D5CB331B4060A7632BA5435292FD5E755CD196D7488D85FACE8D8D78C26ABE60',
    'previous derived lineage v5',
  ],
  'artifacts/ts6-phase-b-c2-r15/golden.v6.derived.json': [
    'D80F400F9B0388D0EB128A052F2A543312C03F2354ACEADA61A4BAAE18FF5EB8',
    'previous derived lineage v6',
  ],
} as const;

/** Inventory the authority owns. Counted independently of status, so it must not move. */
const EXPECTED_INVENTORY = { candidates: 120, boundaries: 113, rawSites: 11 } as const;

/** A PROVEN boundary carries a coverage obligation; the relation count is the approved graph. */
const EXPECTED_RELATIONS = 112;

const failures: string[] = [];
const notes: string[] = [];

const fail = (message: string): void => {
  failures.push(message);
};

const sha256 = (absolute: string): string =>
  createHash('sha256')
    .update(fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
    .toUpperCase();

const readJson = <T>(relative: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')) as T;

const check = (label: string, condition: boolean, detail: string): void => {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  console.log(`  FAIL  ${label} — ${detail}`);
  fail(`${label}: ${detail}`);
};

console.log('TS-6 C2 release verification\n');

// ---- 1. frozen artifacts are untouched ------------------------------------
console.log('1. frozen artifacts preserved');
for (const [relative, [expected, label]] of Object.entries(FROZEN)) {
  const absolute = path.join(ROOT, relative);
  if (!fs.existsSync(absolute)) {
    check(`${label} present`, false, `${relative} is missing`);
    continue;
  }
  const actual = sha256(absolute);
  check(label, actual === expected, `${relative} sha256 ${actual} != ${expected}`);
}

// ---- 2. the authority re-derives the committed inventory -------------------
console.log('\n2. current authority inventory and classification');
const audit = buildAuditShape(ROOT);
check(
  'candidate inventory',
  audit.candidates.length === EXPECTED_INVENTORY.candidates,
  `expected ${EXPECTED_INVENTORY.candidates}, derived ${audit.candidates.length}`,
);
check(
  'boundary inventory',
  audit.boundaries.length === EXPECTED_INVENTORY.boundaries,
  `expected ${EXPECTED_INVENTORY.boundaries}, derived ${audit.boundaries.length}`,
);
check(
  'raw transaction sites',
  audit.rawTransactionSites.length === EXPECTED_INVENTORY.rawSites,
  `expected ${EXPECTED_INVENTORY.rawSites}, derived ${audit.rawTransactionSites.length}`,
);
check(
  'REVIEW_REQUIRED is zero',
  audit.counts.REVIEW_REQUIRED === 0,
  `the validator rejects any projection containing REVIEW_REQUIRED; derived ${audit.counts.REVIEW_REQUIRED}`,
);
check(
  'classification reconciles to the boundary inventory',
  audit.counts.TX_BOUNDARY + audit.counts.TEST_ONLY_OR_DEAD === EXPECTED_INVENTORY.boundaries,
  `TX_BOUNDARY ${audit.counts.TX_BOUNDARY} + TEST_ONLY_OR_DEAD ${audit.counts.TEST_ONLY_OR_DEAD} != ${EXPECTED_INVENTORY.boundaries}`,
);
console.log(
  `        derived: PROVEN ${audit.counts.TX_BOUNDARY} / TEST_ONLY_OR_DEAD ${audit.counts.TEST_ONLY_OR_DEAD} / REVIEW_REQUIRED ${audit.counts.REVIEW_REQUIRED}`,
);

// Every PROVEN boundary must carry a qualified caller and a resolving relation.
// `validateCorpus` enforces the relation half; the caller half is enforced here
// because an empty caller list would mean a status the authority cannot support.
const provenWithoutCaller = audit.boundaries.filter(
  (boundary) =>
    boundary.productionReachability.status === 'PROVEN' &&
    boundary.productionReachability.callers.length === 0,
);
check(
  'every PROVEN boundary has a qualified caller',
  provenWithoutCaller.length === 0,
  `${provenWithoutCaller.length} PROVEN boundaries have no qualified caller`,
);

// ---- 3. the derived lineage follows from the current authority -------------
console.log('\n3. golden.v7 derived lineage');
const v7Path = 'artifacts/ts6-phase-b-c2-r15/golden.v7.derived.json';
if (!fs.existsSync(path.join(ROOT, v7Path))) {
  check('golden.v7 present', false, `${v7Path} is missing`);
} else {
  const v7 = readJson<Corpus>(v7Path);
  const result = validateCorpus(v7, ROOT);

  // `validateCorpus` compares the lineage's `candidateReconciliation[]` against
  // the CURRENT authority, so a clean result is exactly the claim "the committed
  // classification still follows from the committed authority". It also enforces
  // relation coverage, back-references and independent relation resolution.
  check(
    'golden.v7 validates clean against the current authority',
    result.valid && result.issues.length === 0,
    `${result.issues.length} issue(s): ${result.issues
      .slice(0, 5)
      .map((issue) => issue.code)
      .join(', ')}`,
  );
  check(
    'golden.v7 summary is the re-derived classification',
    v7.summary.TX_BOUNDARY === audit.counts.TX_BOUNDARY &&
      v7.summary.TEST_ONLY_OR_DEAD === audit.counts.TEST_ONLY_OR_DEAD &&
      v7.summary.REVIEW_REQUIRED === audit.counts.REVIEW_REQUIRED,
    `v7 ${v7.summary.TX_BOUNDARY}/${v7.summary.TEST_ONLY_OR_DEAD}/${v7.summary.REVIEW_REQUIRED} != derived ${audit.counts.TX_BOUNDARY}/${audit.counts.TEST_ONLY_OR_DEAD}/${audit.counts.REVIEW_REQUIRED}`,
  );
  check(
    'golden.v7 carries one row per canonical boundary',
    v7.transactionBoundaries.length === EXPECTED_INVENTORY.boundaries,
    `expected ${EXPECTED_INVENTORY.boundaries}, found ${v7.transactionBoundaries.length}`,
  );

  // ---- 4. relation graph completeness --------------------------------------
  console.log('\n4. relation graph');
  const relations = new Set<string>();
  for (const boundary of v7.transactionBoundaries)
    for (const id of boundary.regressionEvidenceIds)
      relations.add(`${boundary.boundaryId}\u0000${id}`);
  check(
    'declared relation count',
    relations.size === EXPECTED_RELATIONS,
    `expected ${EXPECTED_RELATIONS}, found ${relations.size}`,
  );

  // Bidirectional integrity: every declared cover must be back-referenced.
  const byBoundaryId = new Map(
    v7.transactionBoundaries.map((boundary) => [boundary.boundaryId, boundary]),
  );
  let backrefMissing = 0;
  for (const evidence of v7.regressionEvidence)
    for (const covered of evidence.covers) {
      const boundary = byBoundaryId.get(covered);
      if (!boundary || !boundary.regressionEvidenceIds.includes(evidence.testEvidenceId))
        backrefMissing += 1;
    }
  check(
    'every covers[] target is back-referenced',
    backrefMissing === 0,
    `${backrefMissing} back-reference(s) missing`,
  );

  const provenInLineage = v7.transactionBoundaries.filter(
    (boundary) => boundary.productionReachability.status === 'PROVEN',
  );
  check(
    'every PROVEN lineage row carries a resolving relation',
    provenInLineage.every((boundary) => boundary.regressionEvidenceIds.length > 0),
    `${provenInLineage.filter((b) => b.regressionEvidenceIds.length === 0).length} PROVEN rows carry no relation`,
  );
  check(
    'lineage PROVEN count equals the derived classification',
    provenInLineage.length === audit.counts.TX_BOUNDARY,
    `lineage ${provenInLineage.length} != derived ${audit.counts.TX_BOUNDARY}`,
  );
}

// ---- 5. the legacy authority stays retired from authority ------------------
console.log('\n5. legacy authority retirement');
const legacy = buildAuditShape(ROOT, { legacyAuthority: true });
check(
  'the legacy reconstruction is still reachable for historical assertions',
  legacy.boundaries.length === EXPECTED_INVENTORY.boundaries,
  `legacy reconstruction derived ${legacy.boundaries.length} boundaries`,
);
check(
  'the legacy and current authorities differ (the correction is actually applied)',
  legacy.counts.TX_BOUNDARY !== audit.counts.TX_BOUNDARY,
  `legacy ${legacy.counts.TX_BOUNDARY} == current ${audit.counts.TX_BOUNDARY}; the authority replacement is not in effect`,
);
check(
  'the inventory does not move with the authority',
  legacy.candidates.length === audit.candidates.length &&
    legacy.rawTransactionSites.length === audit.rawTransactionSites.length,
  'candidate or raw-site inventory changed with the authority',
);
console.log(
  `        legacy: PROVEN ${legacy.counts.TX_BOUNDARY} / TEST_ONLY_OR_DEAD ${legacy.counts.TEST_ONLY_OR_DEAD}  (historical record)`,
);

// ---- verdict ---------------------------------------------------------------
console.log('');
if (notes.length > 0) for (const note of notes) console.log(`NOTE  ${note}`);
if (failures.length > 0) {
  console.error(`TS-6 C2 release verification FAILED (${failures.length} check(s)):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('TS-6 C2 release verification PASSED');
