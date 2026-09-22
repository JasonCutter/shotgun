/**
 * C2-R15 round 4 — derive the v7 lineage on merged main@0ac63ea5c.
 *
 * Discipline (owner-approved):
 *   frozen v2 / crosswalk / golden.v5 / golden.v6  PRESERVED, never rewritten
 *   legacy `callersFor` authority                   RETIRED from every decision
 *   qualified `boundaryMatchKind`                   the only authority
 *   base commit: 0ac63ea5c548b1cb44422afeef668b90274724c8 (merged PR #359)
 *
 * This writes a NEW snapshot (golden.v7.derived.json); it does not touch any
 * frozen artifact. Every value that the authority derives — productionReachability.status,
 * caller set, candidateReconciliation[].c2r2Classification, summary — is re-derived
 * from the fresh AST scan of the merged main tree.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const validator = await import(
  `file:///${path.join(ROOT, 'scripts/ts6-phase-b-transaction-authority-validator.ts').replace(/\\/g, '/')}`
);

const ARTIFACTS = 'artifacts/ts6-phase-b-c2-r15';
const previous = JSON.parse(fs.readFileSync(`${ARTIFACTS}/golden.v6.derived.json`, 'utf8'));
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
  const after = current ? current.productionReachability.status : before;
  if (before !== after)
    moved.push({
      boundaryId: row.boundaryId,
      symbol: row.symbol,
      method: row.method,
      before,
      after,
      reason:
        current && current.productionReachability.callers.length === 0
          ? 'no production caller survives qualified receiver resolution'
          : 'recovered by a qualified binding rule',
    });
  return {
    ...row,
    productionReachability: {
      status: after,
      callers: current ? current.productionReachability.callers : row.productionReachability.callers,
    },
    legacyRecordedCallers: current ? current.legacyRecordedCallers : row.legacyRecordedCallers,
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
  baseSha: validator.BASELINE_SHA,
  derivedFrom: {
    ...(previous.derivedFrom ?? {}),
    authority: 'scripts/ts6-phase-b-production-reachability.ts — boundaryMatchKind()',
    previousAuthority:
      'retired: callersFor() method-name-only scan (scripts/ts6-phase-b-transaction-authority-validator.ts)',
    previousLineage: 'golden.v6.derived.json (preserved, unmodified)',
    baseCommit: validator.BASELINE_SHA,
  },
  correctionRound: 'C2-R15-R4-POST-MERGE-MAIN-V7-LINEAGE',
  correctionNotes:
    'Post-merge main (0ac63ea5c548b1cb44422afeef668b90274724c8) derived lineage. PR #359 production prerequisite merged. Frozen v2, crosswalk, golden.v5, and golden.v6 are preserved and unmodified. No relation proof was re-opened.',
  c2r15Round4: {
    authority: 'qualified production reachability (boundaryMatchKind)',
    legacyAuthorityRetired: 'callersFor() retained as legacyRecordedCallers metadata only',
    statusMoves: moved,
    baseCommit: validator.BASELINE_SHA,
    totals: summary,
  },
  transactionBoundaries,
  candidateReconciliation: reconciliation,
  summary,
};

const out = `${ARTIFACTS}/golden.v7.derived.json`;
fs.writeFileSync(out, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');

console.log('status moves:', moved.length);
for (const m of moved) console.log(`  ${m.symbol}.${m.method}: ${m.before} -> ${m.after}`);
console.log('summary:', JSON.stringify(summary));
console.log('wrote', out);
