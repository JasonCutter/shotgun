/**
 * C2-R15 focused verification of the corrected regression-evidence authority.
 *
 * This is the acceptance test for the correction: it proves that the corrected
 * validator REJECTS the unmodified golden.v2, and that it rejects it for the right
 * reasons — while accepting the specific record classes that are legitimately
 * fine. It also exercises the negative cases required by C2-R15 §17.4.
 *
 * Run explicitly:  npx vitest run scripts/ts6-audit/regression-evidence-authority.test.ts
 * (not collected by `vitest run tests/unit`)
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildAuditShape,
  validateCorpus,
  type Corpus,
} from '../ts6-phase-b-transaction-authority-validator.js';

const ROOT = process.cwd();
const CURRENT_MANIFEST_PATH = path.join(
  ROOT,
  'artifacts/ts6-phase-b-c2-r15/current-authority-manifest.v8.json',
);
const currentManifest = JSON.parse(fs.readFileSync(CURRENT_MANIFEST_PATH, 'utf8')) as {
  entries: readonly {
    candidateId: string;
    classification: string;
    reachabilityStatus?: string;
  }[];
};
const FIXTURE_PATH = path.join(
  ROOT,
  'tests/fixtures/ts6-phase-b-transaction-authority-golden.v2.json',
);
const loadCorpus = (): Corpus => JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as Corpus;

describe('C2-R15 regression-evidence authority correction', () => {
  it('rejects the UNMODIFIED v2 fixture (the correction acceptance criterion)', () => {
    const result = validateCorpus(loadCorpus(), ROOT);
    const codes = new Set(result.issues.map((i) => i.code));

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    // the new, semantically distinct failure classes must be present
    expect(codes).toContain('REGRESSION_COVERAGE_INCOMPLETE');
    expect(codes).toContain('REGRESSION_BACKREF_MISMATCH');
    // ...and the pre-existing code must NOT be the only signal
    expect(codes.size).toBeGreaterThan(1);
  }, 120_000);

  it('keeps the retained transaction inventory unchanged', () => {
    const retained = loadCorpus();
    expect(retained.candidateReconciliation).toHaveLength(120);
    expect(retained.rawTransactionSites).toHaveLength(11);
  }, 120_000);

  /**
   * The scoreboard is DERIVED from the reachability authority, so the two eras
   * are asserted separately and explicitly. Substituting one number for the other
   * would destroy the evidence that the pre-correction figure was ever the
   * recorded one.
   */
  it('applies legacy method-name scoring to current code while preserving historical totals', () => {
    const audit = buildAuditShape(ROOT, { legacyAuthority: true });
    expect(audit.counts).toMatchObject({
      TX_BOUNDARY: 102,
      TX_PARTICIPANT: 0,
      TX_DELEGATE: 0,
      NON_TX: 7,
      TEST_ONLY_OR_DEAD: 13,
      REVIEW_REQUIRED: 0,
    });
    // The frozen v2 fixture is a record of exactly this era: its OWN summary is
    // the prerecorded number, while the live audit derives the corrected split.
    expect(loadCorpus().summary.TX_BOUNDARY).toBe(100);
    expect(loadCorpus().summary.TEST_ONLY_OR_DEAD).toBe(13);
    expect(validateCorpus(loadCorpus(), ROOT).counts.TX_BOUNDARY).toBe(
      buildAuditShape(ROOT).counts.TX_BOUNDARY,
    );
  }, 120_000);

  it('derives the CURRENT qualified-authority scoreboard from the frozen T3 manifest', () => {
    const audit = buildAuditShape(ROOT);
    const boundaries = new Map(audit.boundaries.map((boundary) => [boundary.boundaryId, boundary]));
    expect(
      audit.reconciliation.map((row) => ({
        candidateId: row.candidateId,
        classification: row.c2r2Classification,
        ...(boundaries.has(row.candidateId)
          ? { reachabilityStatus: boundaries.get(row.candidateId)!.productionReachability.status }
          : {}),
      })),
    ).toEqual(currentManifest.entries);
    const expectedCounts = currentManifest.entries.reduce<Record<string, number>>((counts, row) => {
      counts[row.classification] = (counts[row.classification] ?? 0) + 1;
      return counts;
    }, {});
    expect(audit.counts).toMatchObject(expectedCounts);
    // The live T3 audit includes the Ask read snapshot boundary; the frozen v2
    // history above remains unchanged at its original inventory totals.
    expect(audit.candidates).toHaveLength(122);
    expect(audit.boundaries).toHaveLength(115);
    expect(audit.rawTransactionSites).toHaveLength(11);
  }, 120_000);

  it('derives the T3 v8 lineage from the same authority and validates clean', () => {
    const lineage = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'artifacts/ts6-phase-b-c2-r15/golden.v8.derived.json'),
        'utf8',
      ),
    ) as Corpus;
    const result = validateCorpus(lineage, ROOT);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.counts).toMatchObject(buildAuditShape(ROOT).counts);
  }, 120_000);

  it('does not re-open an approved relation when the reachability authority changes', () => {
    const read = (name: string) =>
      JSON.parse(
        fs.readFileSync(path.join(ROOT, `artifacts/ts6-phase-b-c2-r15/${name}`), 'utf8'),
      ) as Corpus;
    const relations = (corpus: Corpus) => {
      const set = new Set<string>();
      for (const boundary of corpus.transactionBoundaries)
        for (const id of boundary.regressionEvidenceIds)
          set.add(`${boundary.boundaryId}\u0000${id}`);
      return set;
    };
    const before = relations(read('golden.v5.derived.json'));
    const after = relations(read('golden.v6.derived.json'));
    expect(before.size).toBe(112);
    expect(after.size).toBe(112);
    expect([...after].every((relation) => before.has(relation))).toBe(true);
  }, 60_000);

  it('derives canonical boundaries independently of fixture evidence', () => {
    const audit = buildAuditShape(ROOT);
    const boundaryCount = currentManifest.entries.filter(
      (entry) => entry.reachabilityStatus,
    ).length;
    expect(audit.boundaries).toHaveLength(boundaryCount);
    expect(audit.participants.length).toBeGreaterThan(0);
    expect(audit.rawTransactionSites.length).toBeGreaterThan(0);
  }, 60_000);

  // ---- negative regression: the failure taxonomy must be reachable ----------

  it('negative: rejects an orphan evidence id (invariant A)', () => {
    const corpus = loadCorpus();
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((b, i) =>
        i === 0
          ? {
              ...b,
              regressionEvidenceIds: [
                ...b.regressionEvidenceIds,
                'test:does/not/exist.test.ts:ghost',
              ],
            }
          : b,
      ),
    };
    const codes = validateCorpus(mutated, ROOT).issues.map((i) => i.code);
    expect(codes).toContain('REGRESSION_EVIDENCE_ID_UNRESOLVED');
  }, 120_000);

  it('negative: rejects a missing reverse relation (invariant B)', () => {
    const corpus = loadCorpus();
    const first = corpus.transactionBoundaries.find((b) => b.regressionEvidenceIds.length > 0)!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((b) =>
        b.boundaryId === first.boundaryId ? { ...b, regressionEvidenceIds: [] } : b,
      ),
    };
    const codes = validateCorpus(mutated, ROOT).issues.map((i) => i.code);
    expect(codes).toContain('MISSING_REGRESSION');
  }, 120_000);

  it('negative: rejects a wrong same-name target (invariant C)', () => {
    const corpus = loadCorpus();
    // point the PostgresOrderingStore.commit boundary's evidence at a test that
    // exercises a DIFFERENT class's `commit`
    const target = corpus.transactionBoundaries.find(
      (b) => b.symbol === 'PostgresOrderingStore' && b.method === 'commit',
    )!;
    const wrongEvidenceId = corpus.regressionEvidence.find((e) =>
      e.file.includes('akp-8-wp2-cross-section-causal-acceptance'),
    )!.testEvidenceId;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((b) =>
        b.boundaryId === target.boundaryId ? { ...b, regressionEvidenceIds: [wrongEvidenceId] } : b,
      ),
      regressionEvidence: corpus.regressionEvidence.map((e) =>
        e.testEvidenceId === wrongEvidenceId ? { ...e, covers: [target.boundaryId] } : e,
      ),
    };
    const codes = validateCorpus(mutated, ROOT).issues.map((i) => i.code);
    expect(
      codes.some((c) =>
        [
          'REGRESSION_TARGET_MISMATCH',
          'REGRESSION_COVERAGE_INCOMPLETE',
          'REGRESSION_QUALIFIED_CALL_MISSING',
        ].includes(c),
      ),
    ).toBe(true);
  }, 120_000);

  it('negative: a comment-only occurrence is not direct evidence', () => {
    const corpus = loadCorpus();
    const claimBoundary = corpus.transactionBoundaries.find(
      (b) => b.method === 'claim' && b.symbol === 'PostgresSourcesStage3ProgressRepository',
    )!;
    const result = validateCorpus(corpus, ROOT);
    const messages = result.issues
      .filter(
        (i) =>
          i.boundaryId === claimBoundary.boundaryId || i.message.includes(claimBoundary.boundaryId),
      )
      .map((i) => `${i.code}: ${i.message}`);
    // the browser spec attribution must be rejected, not accepted
    expect(messages.join('\n')).not.toBe('');
  }, 120_000);

  it('records the pre-correction decision manifest as a derived artifact', () => {
    const manifestPath = path.join(ROOT, 'artifacts/ts6-phase-b-c2-r15/correction-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      totals: { records: number; resolved: number; correctionRequired: number };
      entries: readonly { original: { coverageKind: string } }[];
    };
    expect(manifest.totals.records).toBe(69);
    expect(manifest.totals.resolved + manifest.totals.correctionRequired).toBe(69);
    const declared = manifest.entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.original.coverageKind] = (acc[e.original.coverageKind] ?? 0) + 1;
      return acc;
    }, {});
    expect(declared).toMatchObject({ DIRECT_BOUNDARY: 57, PUBLIC_PATH: 6, OWNER_ATOMICITY: 6 });
  }, 60_000);
});
