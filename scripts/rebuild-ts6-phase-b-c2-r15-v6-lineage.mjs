/**
 * C2-R15 round 3 ??derive the v6 lineage under the QUALIFIED authority.
 *
 * Discipline (owner-approved):
 *   frozen v2 / crosswalk / golden.v5   PRESERVED, never rewritten
 *   legacy `callersFor` authority        RETIRED from every decision
 *   qualified `boundaryMatchKind`        the only authority
 *
 * This only writes an explicitly requested scratch snapshot; it cannot touch a
 * frozen artifact. Every value
 * that the previous authority derived ??productionReachability.status, the caller
 * set, candidateReconciliation[].c2r2Classification, summary ??is re-derived from
 * the SAME single qualified result, so status and scoreboard cannot diverge into
 * two doctrines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveLineageOutput } from './ts6-lineage-output-guard.mjs';
import { makeLineageMetadata } from './ts6-lineage-metadata.mjs';

const ROOT = process.cwd();
const out = resolveLineageOutput(ROOT, process.argv.slice(2));
const validator = await import(
  `file:///${path.join(ROOT, 'scripts/ts6-phase-b-transaction-authority-validator.ts').replace(/\\/g, '/')}`
);

const ARTIFACTS = 'artifacts/ts6-phase-b-c2-r15';
const parentArtifact = `${ARTIFACTS}/golden.v5.derived.json`;
const parentContent = fs.readFileSync(parentArtifact, 'utf8');
const previous = JSON.parse(parentContent);
const audit = validator.buildAuditShape(ROOT);

// The approved regression-evidence relations are NOT re-opened by a reachability
// correction: a reachability correction only changes WHICH boundaries carry a
// coverage obligation, never whether an approved relation proof holds.
const approvedEvidence = previous.regressionEvidence;
const approvedRelationsByBoundary = new Map();
for (const evidence of approvedEvidence)
  for (const boundaryId of evidence.covers)
    approvedRelationsByBoundary.set(boundaryId, [
      ...(approvedRelationsByBoundary.get(boundaryId) ?? []),
      evidence.testEvidenceId,
    ]);

const byId = new Map(audit.boundaries.map((b) => [b.boundaryId, b]));
const moved = [];
const transactionBoundaries = previous.transactionBoundaries.map((row) => {
  const current = byId.get(row.boundaryId);
  const before = row.productionReachability.status;
  const after = current.productionReachability.status;
  if (before !== after)
    moved.push({
      boundaryId: row.boundaryId,
      symbol: row.symbol,
      method: row.method,
      before,
      after,
      reason:
        current.productionReachability.callers.length === 0
          ? 'no production caller survives qualified receiver resolution'
          : 'recovered by a qualified binding rule',
    });
  return {
    ...row,
    productionReachability: {
      status: after,
      callers: current.productionReachability.callers,
    },
    legacyRecordedCallers: current.legacyRecordedCallers,
    // The approved relation graph is NOT re-opened by a reachability correction.
    // `covers[]` and `regressionEvidenceIds` stay in agreement for every boundary;
    // what changes is which boundaries the coverage rule APPLIES to, and that is
    // derived from `status`, never from this list.
    regressionEvidenceIds: row.regressionEvidenceIds,
  };
});

const reconciliation = previous.candidateReconciliation.map((row) => {
  const boundary = byId.get(row.candidateId);
  if (!boundary) return row;
  const proven = boundary.productionReachability.status === 'PROVEN';
  return {
    ...row,
    c2r2Classification: proven ? 'TX_BOUNDARY' : 'TEST_ONLY_OR_DEAD',
    productionReachable: proven,
  };
});

const summary = {
  ...previous.summary,
  TX_BOUNDARY: reconciliation.filter((r) => r.c2r2Classification === 'TX_BOUNDARY').length,
  TEST_ONLY_OR_DEAD: reconciliation.filter((r) => r.c2r2Classification === 'TEST_ONLY_OR_DEAD')
    .length,
  REVIEW_REQUIRED: 0,
};

const derived = {
  ...previous,
  derivedFrom: makeLineageMetadata({
    parentArtifact,
    parentContent,
    baseCommit: validator.BASELINE_SHA,
    authorityVersion: 'scripts/ts6-phase-b-production-reachability.ts#boundaryMatchKind',
  }),
  correctionRound: 'C2-R15-R3-QUALIFIED-REACHABILITY-AUTHORITY',
  correctionNotes:
    'Reachability authority replacement only. Frozen v2, the crosswalk and golden.v5 are preserved and unmodified. No relation proof was re-opened: 5 boundaries lose PROVEN and leave the coverage-required set; every other relation is unchanged.',
  c2r15Round3: {
    authority: 'qualified production reachability (boundaryMatchKind)',
    legacyAuthorityRetired: 'callersFor() retained as legacyRecordedCallers metadata only',
    statusMoves: moved,
    guards:
      'a call written behind a non-production gate (VITEST / NODE_ENV=test) is test evidence, not a production execution path',
    totals: summary,
  },
  transactionBoundaries,
  candidateReconciliation: reconciliation,
  summary,
};

fs.writeFileSync(out, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');

console.log('status moves:', moved.length);
for (const m of moved) console.log(`  ${m.symbol}.${m.method}: ${m.before} -> ${m.after}`);
console.log('summary:', JSON.stringify(summary));
console.log('wrote scratch lineage', out);
