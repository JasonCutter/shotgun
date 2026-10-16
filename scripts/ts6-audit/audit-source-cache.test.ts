import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuditShape,
  T3_BASELINE_SHA,
  validateCorpus,
  type Corpus,
} from '../ts6-phase-b-transaction-authority-validator.js';
import { readSource } from '../ts6-phase-b-regression-evidence-resolver.js';

const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotgun-ts6-audit-cache-'));
  roots.push(root);
  const file = path.join(root, 'adapters/fixture/src/index.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `export type OwnerPort = { run(): Promise<void> };
export class Owner implements OwnerPort {
  async run() { await withSafePostgresTransaction(pool, async () => {}); }
}
export async function dispatch(owner: OwnerPort) { await owner.run(); }
`,
  );
  return { root, file };
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^shotgun-ts6-audit-cache-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const validationFixture = () => {
  const { root, file } = fixture();
  const relative = 'tests/linked.test.tsx';
  const testFile = path.join(root, relative);
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(
    testFile,
    "it('first title', () => { driver.dispatch(owner); });\nit('second title', () => { driver.dispatch(owner); });",
  );
  const audit = buildAuditShape(root);
  const boundary = audit.boundaries[0]!;
  const evidence = ['first title', 'second title'].map((testName) => ({
    testEvidenceId: `test:${relative}:${testName}`,
    file: relative,
    testName,
    covers: [boundary.boundaryId],
    coverageKind: 'PUBLIC_PATH' as const,
    entrySymbol: 'dispatch',
    path: ['dispatch', 'run'],
  }));
  const ids = evidence.map((item) => item.testEvidenceId);
  const corpus: Corpus = {
    schemaVersion: 'ts6.phase-b.transaction-authority.v4',
    baseSha: T3_BASELINE_SHA,
    historical: { previousSchema: 'v1', previousReviewedRows: 87, c2r1CandidateRows: 120 },
    transactionBoundaries: [
      {
        ...boundary,
        regressionEvidenceIds: ids,
        productionReachability: {
          ...boundary.productionReachability,
          callers: boundary.productionReachability.callers.map((caller) => ({
            ...caller,
            regressionEvidenceIds: ids,
          })),
        },
      },
    ],
    transactionParticipants: audit.participants,
    transactionDelegates: audit.delegates,
    excludedCandidates: audit.excluded,
    candidateReconciliation: audit.reconciliation,
    historicalReconciliation: Array.from({ length: 87 }, (_, i) => ({
      historicalRowId: `synthetic:${i}`,
      disposition: 'STILL_VALID',
      mappedCandidateIds: [boundary.boundaryId],
      explanation: 'Synthetic cache-invalidation fixture, not historical evidence.',
    })),
    rawTransactionSites: audit.rawTransactionSites,
    regressionEvidence: evidence,
    summary: {
      ...audit.counts,
      reconciliationTotal: 1,
      historicalRowsExplained: 87,
      historicalRowsUnexplained: 0,
    },
  };
  return { root, file, testFile, corpus };
};
describe('TS6 immutable-source audit reuse', () => {
  it('returns detached audits and reuses the same source facts without trusting caller mutation', () => {
    const { root } = fixture();
    const first = buildAuditShape(root);
    expect(first.candidates).toHaveLength(1);
    const expected = structuredClone(first);
    (first as unknown as { candidates: { line: number }[] }).candidates[0]!.line = -100;
    expect(buildAuditShape(root)).toEqual(expected);
  });
  it('detects source bytes changed with preserved timestamps and file additions/removals', () => {
    const { root, file } = fixture();
    expect(buildAuditShape(root).boundaries[0]?.productionReachability.status).toBe(
      'PORT_INFERRED',
    );
    const times = fs.statSync(file);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('await owner.run()', 'await owner.foo()'),
    );
    fs.utimesSync(file, times.atime, times.mtime);
    expect(buildAuditShape(root).boundaries[0]?.productionReachability.status).toBe(
      'TEST_ONLY_OR_DEAD',
    );
    const extra = path.join(path.dirname(file), 'extra.ts');
    fs.writeFileSync(
      extra,
      'export class Extra { async execute(){ await withSafePostgresTransaction(pool, async () => {}); } }',
    );
    expect(buildAuditShape(root).candidates).toHaveLength(2);
    fs.unlinkSync(extra);
    expect(buildAuditShape(root).candidates).toHaveLength(1);
  });
  it('keeps qualified and legacy projections separate across repository roots', () => {
    const a = fixture(),
      b = fixture();
    const qualified = buildAuditShape(a.root);
    expect(qualified.boundaries[0]?.productionReachability.status).toBe('PORT_INFERRED');
    expect(
      buildAuditShape(a.root, { legacyAuthority: true }).boundaries[0]?.productionReachability
        .status,
    ).toBe('PROVEN');
    fs.writeFileSync(
      b.file,
      'export class Other { async run(){ await withSafePostgresTransaction(pool, async () => {}); } }',
    );
    expect(buildAuditShape(b.root).boundaries[0]).toMatchObject({ symbol: 'Other', method: 'run' });
    expect(buildAuditShape(a.root)).toEqual(qualified);
  });
  it('invalidates linked TSX regression source caches without changing production scanning', () => {
    const { root } = fixture();
    const relative = 'tests/linked.test.tsx',
      file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "it('first title', () => {});");
    const expected = buildAuditShape(root);
    expect(readSource(root, relative)).toContain('first title');
    fs.writeFileSync(file, "it('other title', () => {});");
    expect(buildAuditShape(root)).toEqual(expected);
    expect(readSource(root, relative)).toContain('other title');
  });
  it('reads every inventoried file again on each validation but not once per evidence relation', () => {
    const { root, file, testFile, corpus } = validationFixture();
    expect(validateCorpus(corpus, root).issues).toEqual([]);
    const read = vi.spyOn(fs, 'readFileSync');
    for (let pass = 0; pass < 2; pass++) {
      read.mockClear();
      expect(validateCorpus(corpus, root).issues).toEqual([]);
      for (const expected of [file, testFile])
        expect(read.mock.calls.filter(([actual]) => actual === expected)).toHaveLength(1);
    }
  });
  it('rechecks shared regression titles and qualified paths after equal-length byte edits', () => {
    const { root, testFile, corpus } = validationFixture();
    expect(validateCorpus(corpus, root).issues).toEqual([]);
    const original = fs.readFileSync(testFile, 'utf8');
    const times = fs.statSync(testFile);
    fs.writeFileSync(testFile, original.replace('first title', 'other title'));
    fs.utimesSync(testFile, times.atime, times.mtime);
    expect(validateCorpus(corpus, root).issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['REGRESSION_NAME', 'REGRESSION_TEST_BLOCK_MISSING']),
    );
    fs.writeFileSync(testFile, original.replaceAll('driver.dispatch', 'driver.replaced'));
    fs.utimesSync(testFile, times.atime, times.mtime);
    expect(validateCorpus(corpus, root).issues.map((issue) => issue.code)).toContain(
      'REGRESSION_ENTRY_NOT_INVOKED',
    );
    fs.writeFileSync(testFile, original);
    expect(validateCorpus(corpus, root).issues).toEqual([]);
  });
  it('propagates a fresh source read failure instead of accepting a previous snapshot', () => {
    const { root, file, corpus } = validationFixture();
    expect(validateCorpus(corpus, root).issues).toEqual([]);
    const original = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
      if (args[0] === file) throw new Error('INJECTED_SOURCE_READ_FAILURE');
      return original(...args);
    });
    expect(() => validateCorpus(corpus, root)).toThrow('INJECTED_SOURCE_READ_FAILURE');
    vi.restoreAllMocks();
    expect(validateCorpus(corpus, root).issues).toEqual([]);
  });
});
