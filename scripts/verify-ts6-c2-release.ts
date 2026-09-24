/**
 * T3-1 release gate for the TS-6 transaction-authority correction.
 *
 * The gate compares the live AST result with a frozen baseline manifest, checks
 * immutable v2-v7 history, validates v8 and confirms deterministic regeneration.
 * All current totals come from the independent manifest and AST; historical
 * crosswalk figures are never used as current authority.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { buildV8Lineage } from './rebuild-ts6-phase-b-c2-r15-v8-lineage.js';
import {
  buildAuditShape,
  T3_BASELINE_SHA,
  validateCorpus,
  type Corpus,
} from './ts6-phase-b-transaction-authority-validator.js';

const ROOT = process.cwd();
const ARTIFACT_DIR = 'artifacts/ts6-phase-b-c2-r15';
const failures: string[] = [];

type CurrentManifest = {
  readonly schemaVersion: 'ts6.phase-b.current-authority-manifest.v8';
  readonly status: 'FROZEN_BASELINE_EXPECTATIONS';
  readonly baseCommit: string;
  readonly entries: readonly {
    readonly candidateId: string;
    readonly classification: string;
    readonly reachabilityStatus?: string;
  }[];
};

type FrozenHistoryManifest = {
  readonly schemaVersion: 'ts6.phase-b.frozen-history.v1';
  readonly status: 'IMMUTABLE_HISTORICAL_INPUT';
  readonly artifacts: readonly { readonly path: string; readonly sha256: string }[];
};

type ApprovedRelations = {
  readonly schemaVersion: 'ts6.phase-b.approved-regression-relations.v1';
  readonly status: 'FROZEN_APPROVED_INPUT';
  readonly sourceArtifact: string;
  readonly sourceArtifactSha256: string;
  readonly records: Corpus['regressionEvidence'];
};

const readJson = <T>(relative: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')) as T;

const normalizedSha256 = (content: string): string =>
  createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const check = (label: string, condition: boolean, detail: string): void => {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label} — ${detail}`);
    failures.push(`${label}: ${detail}`);
  }
};

console.log('T3-1 TS-6 transaction-authority release verification\n');

const history = readJson<FrozenHistoryManifest>(`${ARTIFACT_DIR}/t3-frozen-history-manifest.json`);
check(
  'frozen-history manifest identity',
  history.schemaVersion === 'ts6.phase-b.frozen-history.v1' &&
    history.status === 'IMMUTABLE_HISTORICAL_INPUT' &&
    history.artifacts.length > 0,
  'manifest identity or artifact list is invalid',
);
for (const item of history.artifacts) {
  const absolute = path.join(ROOT, item.path);
  const actual = fs.existsSync(absolute)
    ? normalizedSha256(fs.readFileSync(absolute, 'utf8'))
    : 'missing';
  check(
    `immutable history ${item.path}`,
    actual === item.sha256,
    `sha256 ${actual} != ${item.sha256}`,
  );
}

const audit = buildAuditShape(ROOT);
const currentManifest = readJson<CurrentManifest>(
  `${ARTIFACT_DIR}/current-authority-manifest.v8.json`,
);
const boundaryById = new Map(audit.boundaries.map((boundary) => [boundary.boundaryId, boundary]));
const derivedManifestEntries = audit.reconciliation.map((row) => ({
  candidateId: row.candidateId,
  classification: row.c2r2Classification,
  ...(boundaryById.has(row.candidateId)
    ? { reachabilityStatus: boundaryById.get(row.candidateId)!.productionReachability.status }
    : {}),
}));
check(
  'live AST authority matches the frozen T3 baseline manifest',
  currentManifest.schemaVersion === 'ts6.phase-b.current-authority-manifest.v8' &&
    currentManifest.status === 'FROZEN_BASELINE_EXPECTATIONS' &&
    currentManifest.baseCommit === T3_BASELINE_SHA &&
    JSON.stringify(currentManifest.entries) === JSON.stringify(derivedManifestEntries),
  'candidate identities, classifications, or evidence grades drifted',
);
check(
  'classification totals reconcile with candidate inventory',
  Object.values(audit.counts).reduce((total, count) => total + count, 0) ===
    audit.candidates.length,
  `derived classifications total ${Object.values(audit.counts).reduce((total, count) => total + count, 0)} for ${audit.candidates.length} candidates`,
);
check(
  'all unresolved production boundaries remain explicitly reviewable',
  audit.boundaries.every(
    (boundary) =>
      boundary.productionReachability.status !== 'REVIEW_REQUIRED' ||
      boundary.productionReachability.callers.length === 0,
  ),
  'a REVIEW_REQUIRED boundary carries purportedly qualified callers',
);
console.log(`        derived classification: ${JSON.stringify(audit.counts)}`);

const approved = readJson<ApprovedRelations>(
  `${ARTIFACT_DIR}/approved-regression-relations.v8.json`,
);
const sourceText = fs.readFileSync(path.join(ROOT, approved.sourceArtifact), 'utf8');
check(
  'approved relation input is anchored to frozen v7',
  approved.schemaVersion === 'ts6.phase-b.approved-regression-relations.v1' &&
    approved.status === 'FROZEN_APPROVED_INPUT' &&
    approved.sourceArtifact === `${ARTIFACT_DIR}/golden.v7.derived.json` &&
    normalizedSha256(sourceText) === approved.sourceArtifactSha256,
  'approved relation provenance does not match the frozen v7 input',
);

const v8Path = `${ARTIFACT_DIR}/golden.v8.derived.json`;
const v8 = readJson<Corpus>(v8Path);
const validation = validateCorpus(v8, ROOT);
check(
  'v8 lineage validates against current AST authority',
  validation.valid && validation.issues.length === 0,
  validation.issues
    .slice(0, 8)
    .map((issue) => `${issue.code}:${issue.boundaryId ?? issue.message}`)
    .join(', '),
);
check(
  'v8 derived lineage reproduces byte-for-byte',
  fs.readFileSync(path.join(ROOT, v8Path), 'utf8').replace(/\r\n/g, '\n') ===
    `${JSON.stringify(buildV8Lineage(ROOT), null, 2)}\n`,
  'committed v8 does not match deterministic regeneration',
);
check(
  'v8 summary follows the same classification authority',
  Object.entries(audit.counts).every(([key, count]) => v8.summary[key] === count),
  `v8 summary ${JSON.stringify(v8.summary)} differs from live AST counts ${JSON.stringify(audit.counts)}`,
);
check(
  'v8 carries one current row per AST transaction boundary',
  v8.transactionBoundaries.length === audit.boundaries.length &&
    v8.transactionBoundaries.every(
      (boundary, index) => boundary.boundaryId === audit.boundaries[index]?.boundaryId,
    ),
  'boundary inventory or order differs from current AST authority',
);

const graph = new Set<string>();
for (const boundary of v8.transactionBoundaries)
  for (const evidenceId of boundary.regressionEvidenceIds)
    graph.add(`${boundary.boundaryId}\u0000${evidenceId}`);
const approvedPairs = new Set(
  approved.records.flatMap((record) =>
    record.covers.map((boundaryId) => `${boundaryId}\u0000${record.testEvidenceId}`),
  ),
);
const evidenceById = new Map(
  v8.regressionEvidence.map((record) => [record.testEvidenceId, record]),
);
const hasFullBackrefs = v8.transactionBoundaries.every((boundary) =>
  boundary.regressionEvidenceIds.every((id) =>
    evidenceById.get(id)?.covers.includes(boundary.boundaryId),
  ),
);
check(
  'v8 relation graph equals the approved relation input',
  graph.size === approvedPairs.size && [...graph].every((pair) => approvedPairs.has(pair)),
  `derived ${graph.size} distinct relations; approved ${approvedPairs.size}`,
);
check(
  'v8 relation graph has complete reverse references',
  hasFullBackrefs,
  'a boundary relation is missing its matching evidence covers[] entry',
);

const legacy = buildAuditShape(ROOT, { legacyAuthority: true });
check(
  'historical and current authorities use the same source inventory',
  legacy.candidates.length === audit.candidates.length &&
    legacy.boundaries.length === audit.boundaries.length &&
    legacy.rawTransactionSites.length === audit.rawTransactionSites.length,
  'legacy comparison changed candidate, boundary, or raw-site inventory',
);
check(
  'qualified authority replaces the legacy method-name classification',
  legacy.counts.TX_BOUNDARY !== audit.counts.TX_BOUNDARY,
  'legacy and current transaction-boundary classifications unexpectedly match',
);

if (failures.length > 0) {
  console.error(`\nTS-6 C2 release verification FAILED (${failures.length} check(s)):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nTS-6 C2 release verification PASSED');
