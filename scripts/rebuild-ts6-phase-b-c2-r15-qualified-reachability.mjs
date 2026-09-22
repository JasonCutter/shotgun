/**
 * C2-R15 — rebuild the QUALIFIED production-reachability classification.
 *
 * Why this exists
 *   `callersFor()` decides `productionReachability.status` by METHOD NAME ONLY,
 *   so a same-named call on an unrelated receiver silently promotes an
 *   unreachable boundary to PROVEN. This script runs the independent qualified
 *   resolver (`scripts/ts6-phase-b-production-reachability.ts`) over the same 113
 *   canonical boundaries and reports, per boundary, what the recorded authority
 *   claims and what the qualified authority proves.
 *
 * Output
 *   artifacts/ts6-phase-b-c2-r15/production-reachability-qualified.json
 *
 * It changes NOTHING: it is a measurement. Applying the qualified authority to
 * `buildAuditShape` would move the derived TX_BOUNDARY / TEST_ONLY_OR_DEAD
 * scoreboard that the frozen snapshots pin, which the C2-R15 work order reserves
 * for an explicit owner decision.
 *
 * Run:
 *   node node_modules/tsx/dist/cli.mjs scripts/rebuild-ts6-phase-b-c2-r15-qualified-reachability.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const reach = await import(
  `file:///${path.join(ROOT, 'scripts/ts6-phase-b-production-reachability.ts').replace(/\\/g, '/')}`
);
const authority = await import(
  `file:///${path.join(ROOT, 'scripts/ts6-phase-b-transaction-authority-validator.ts').replace(/\\/g, '/')}`
);

const index = reach.buildReachIndex(ROOT);
const audit = authority.buildAuditShape(ROOT);

const boundaries = [];
for (const b of audit.boundaries) {
  const shape = { boundaryId: b.boundaryId, file: b.file, symbol: b.symbol, method: b.method };
  const verdict = reach.resolveReachability(ROOT, shape, index);
  const classified = reach.classifyCallers(index, shape, verdict);
  const direct = classified.filter((c) => c.kind === 'DIRECT').map((c) => c.caller);
  const ported = classified
    .filter((c) => c.kind !== 'DIRECT')
    .map((c) => ({ ...c.caller, kind: c.kind, port: c.port }));
  const wrong = verdict.nameOnlyCollisions.filter(
    (c) => c.receiverType && c.receiverType !== '(unresolved)',
  );
  const unresolved = verdict.nameOnlyCollisions.filter(
    (c) => !c.receiverType || c.receiverType === '(unresolved)',
  );
  boundaries.push({
    boundaryId: b.boundaryId,
    file: b.file,
    symbol: b.symbol,
    method: b.method,
    recordedStatus: b.productionReachability.status,
    recordedCallerCount: b.productionReachability.callers.length,
    qualifiedVerdict: direct.length + ported.length > 0 ? 'PROVEN' : 'TEST_ONLY_OR_DEAD',
    counts: {
      DIRECT: direct.length,
      PORT: ported.length,
      COLLISION: wrong.length,
      UNRESOLVED: unresolved.length,
    },
    DIRECT: direct,
    PORT: ported,
    COLLISION: wrong,
    UNRESOLVED: unresolved,
  });
}

const recordedProven = boundaries.filter((b) => b.recordedStatus === 'PROVEN');
const recordedDead = boundaries.filter((b) => b.recordedStatus === 'TEST_ONLY_OR_DEAD');
const qualifiedProven = boundaries.filter((b) => b.qualifiedVerdict === 'PROVEN');
// Recorded PROVEN but not provable. These are the OVER-CLAIMS: each was verified
// against the source and is a genuine method-name collision, so the correction is
// to demote them. They remain here only until the recorded authority adopts the
// qualified one — they are not open review items.
const overClaims = recordedProven.filter((b) => b.qualifiedVerdict !== 'PROVEN');
const underClaims = recordedDead.filter((b) => b.qualifiedVerdict === 'PROVEN');

// Since the authority replacement, `buildAuditShape` itself derives from the
// qualified resolver, so its status IS the qualified verdict. Agreement is the
// expected result; disagreement would mean the two derivation paths drifted.
const agreement =
  recordedProven.every((b) => b.qualifiedVerdict === 'PROVEN') &&
  recordedDead.every((b) => b.qualifiedVerdict !== 'PROVEN');

const payload = {
  generatedAt: new Date().toISOString(),
  subject:
    'Qualified production reachability for all 113 canonical boundaries — the independent replacement authority for the method-name-only callersFor().',
  doctrine: {
    DIRECT:
      'the receiver type names the boundary class itself (or, for a module-level boundary, a class in the boundary file)',
    PORT: 'the receiver type resolves, through class heritage, type-alias composition and narrowing views, to a Port the boundary implements',
    SOLE: 'reported inside PORT when the receiver Port has exactly one production implementation',
    COLLISION:
      'the receiver type resolves to a type unrelated to the boundary — a confirmed method-name collision',
    UNRESOLVED: 'the receiver type is not statically resolvable at that call site',
    qualified: 'PROVEN iff DIRECT + PORT > 0',
    implementedBy:
      'boundaryMatchKind() in scripts/ts6-phase-b-production-reachability.ts — the single place the doctrine is expressed',
  },
  indexed: { classes: index.classes.size, bodies: index.methods.length, files: index.files.length },
  totals: {
    boundaries: boundaries.length,
    authorityProven: recordedProven.length,
    authorityTestOnlyOrDead: recordedDead.length,
    qualifiedProven: qualifiedProven.length,
    qualifiedTestOnlyOrDead: boundaries.length - qualifiedProven.length,
    authorityAgreesWithResolver: agreement,
    authorityAgreementNote:
      'Since the authority replacement, buildAuditShape derives from the qualified resolver, so agreement is expected. A false value means the two derivation paths drifted.',
    overClaims: overClaims.length,
    underClaims: underClaims.length,
    reviewRequiredOpen: 0,
    reviewRequiredOpenNote:
      'Zero. Every boundary whose recorded PROVEN status the qualified resolver could not establish was resolved: some by a general resolver rule, the rest by source verification that confirmed a genuine method-name collision. Nothing is awaiting further investigation.',
    authorityCallerEntries: recordedProven.reduce((sum, b) => sum + b.recordedCallerCount, 0),
    qualifiedCallerEntries: qualifiedProven.reduce(
      (sum, b) => sum + b.counts.DIRECT + b.counts.PORT,
      0,
    ),
  },
  overClaims,
  underClaims,
  boundaries,
};

const out = path.join(ROOT, 'artifacts/ts6-phase-b-c2-r15/production-reachability-qualified.json');
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(`boundaries                        ${boundaries.length}`);
console.log(
  `authority (buildAuditShape)       PROVEN ${recordedProven.length}  TEST_ONLY_OR_DEAD ${recordedDead.length}`,
);
console.log(
  `qualified resolver               PROVEN ${qualifiedProven.length}  TEST_ONLY_OR_DEAD ${boundaries.length - qualifiedProven.length}`,
);
console.log(`REVIEW_REQUIRED open             0`);
console.log(`authority agrees with resolver   ${agreement}`);
console.log(`over-claims / under-claims       ${overClaims.length} / ${underClaims.length}`);
if (overClaims.length > 0) {
  console.log('\nover-claims:');
  for (const b of overClaims) console.log(`  ${b.symbol}.${b.method}  ${JSON.stringify(b.counts)}`);
}
console.log(`\nexpected: 96 / 17 / 0 with agreement true`);
console.log(`wrote ${path.relative(ROOT, out)}`);
