import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildAuditShape,
  validateCountCrosswalk,
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

const issueCodes = (corpus: Corpus): string[] =>
  validateCorpus(corpus, ROOT).issues.map((issue) => issue.code);

describe('TS-6 C2-R3 transaction authority validator', () => {
  it('derives the complete C2-R1 candidate set and canonical inventory', () => {
    const audit = buildAuditShape(ROOT);

    expect(audit.candidates).toHaveLength(121);
    expect(new Set(audit.candidates.map((candidate) => candidate.candidateId)).size).toBe(121);
    expect(audit.rawTransactionSites).toHaveLength(11);
    expect(audit.boundaries).toHaveLength(114);
    expect(audit.participants).toHaveLength(1);
    // Current categories are taken from the independently frozen T3 manifest.
    const boundaries = new Map(audit.boundaries.map((boundary) => [boundary.boundaryId, boundary]));
    const actual = audit.reconciliation.map((row) => ({
      candidateId: row.candidateId,
      classification: row.c2r2Classification,
      ...(boundaries.has(row.candidateId)
        ? { reachabilityStatus: boundaries.get(row.candidateId)!.productionReachability.status }
        : {}),
    }));
    expect(actual).toEqual(currentManifest.entries);
    const expectedCounts = currentManifest.entries.reduce<Record<string, number>>((counts, row) => {
      counts[row.classification] = (counts[row.classification] ?? 0) + 1;
      return counts;
    }, {});
    expect(audit.counts).toMatchObject(expectedCounts);
  }, 60_000);

  it('still reconstructs the LEGACY authority inventory (historical record)', () => {
    const legacy = buildAuditShape(ROOT, { legacyAuthority: true });

    // Identical inventory — the authority replacement changed no count that the
    // inventory owns, only the derived TX_BOUNDARY / TEST_ONLY_OR_DEAD split.
    expect(legacy.candidates).toHaveLength(121);
    expect(legacy.boundaries).toHaveLength(114);
    expect(legacy.rawTransactionSites).toHaveLength(11);
    expect(legacy.counts).toMatchObject({
      TX_BOUNDARY: 101,
      NON_TX: 7,
      TEST_ONLY_OR_DEAD: 13,
      REVIEW_REQUIRED: 0,
    });
  }, 120_000);

  it('keeps the historical 87-row comparison informational', () => {
    const result = validateCorpus(loadCorpus(), ROOT);

    expect(result.issues.map((issue) => issue.code)).not.toContain('HISTORICAL_DELTA');
    expect(result.candidates).toHaveLength(121);
    // The frozen fixture is a record of the LEGACY authority, so its own
    // classification is read back from it rather than from the live authority.
    expect(loadCorpus().summary.TX_BOUNDARY).toBe(100);
    expect(result.counts.TX_BOUNDARY).toBe(buildAuditShape(ROOT).counts.TX_BOUNDARY);
  }, 60_000);

  it('rejects a source classification drift', () => {
    const corpus = loadCorpus();
    const index = corpus.candidateReconciliation.findIndex(
      (row) => row.c2r2Classification === 'TX_BOUNDARY',
    );
    const row = corpus.candidateReconciliation[index]!;
    const mutated: Corpus = {
      ...corpus,
      candidateReconciliation: corpus.candidateReconciliation.map((item, itemIndex) =>
        itemIndex === index ? { ...item, c2r2Classification: 'NON_TX' } : item,
      ),
    };

    expect(row.c2r2Classification).toBe('TX_BOUNDARY');
    expect(issueCodes(mutated)).toContain('CLASSIFICATION_DRIFT');
  });

  it('rejects fabricated, import-only, and owner-prefix caller evidence', () => {
    const corpus = loadCorpus();
    const boundary = corpus.transactionBoundaries.find(
      (item) =>
        item.productionReachability.status === 'PROVEN' &&
        item.productionReachability.callers.length > 0,
    )!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((item) =>
        item.boundaryId === boundary.boundaryId
          ? {
              ...item,
              productionReachability: {
                ...item.productionReachability,
                callers: item.productionReachability.callers.map((caller) => ({
                  ...caller,
                  file: 'tests/unit/fabricated-caller.test.ts',
                  callNeedle: "import { transaction } from 'owner-prefix';",
                  bindingEvidence: [],
                })),
              },
            }
          : item,
      ),
    };

    expect(issueCodes(mutated)).toEqual(
      expect.arrayContaining(['CALLER_CALLSITE', 'CALLER_BINDING']),
    );
  });

  it('rejects a missing caller binding and missing regression link', () => {
    const corpus = loadCorpus();
    const boundaryIndex = corpus.transactionBoundaries.findIndex(
      (item) =>
        item.productionReachability.status === 'PROVEN' &&
        item.productionReachability.callers.length > 0,
    );
    const boundary = corpus.transactionBoundaries[boundaryIndex]!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((item, index) =>
        index === boundaryIndex
          ? {
              ...item,
              regressionEvidenceIds: [],
              productionReachability: {
                ...item.productionReachability,
                callers: item.productionReachability.callers.map((caller) => ({
                  ...caller,
                  bindingEvidence: [],
                })),
              },
            }
          : item,
      ),
    };

    expect(boundary.productionReachability.status).toBe('PROVEN');
    expect(issueCodes(mutated)).toEqual(
      expect.arrayContaining(['CALLER_BINDING', 'MISSING_REGRESSION']),
    );
  });

  it('rejects an omitted candidate and a duplicate candidate identity', () => {
    const corpus = loadCorpus();
    const first = corpus.candidateReconciliation[0]!;
    const omitted: Corpus = {
      ...corpus,
      candidateReconciliation: corpus.candidateReconciliation.slice(1),
    };
    const duplicated: Corpus = {
      ...corpus,
      candidateReconciliation: [...corpus.candidateReconciliation, first],
    };

    expect(issueCodes(omitted)).toContain('UNREGISTERED_CANDIDATE');
    expect(issueCodes(duplicated)).toContain('DUPLICATE_CANDIDATE');
  }, 120_000);

  it('rejects a new or stale raw transaction site', () => {
    const corpus = loadCorpus();
    const first = corpus.rawTransactionSites[0]!;
    const unregistered: Corpus = {
      ...corpus,
      rawTransactionSites: [
        ...corpus.rawTransactionSites,
        { ...first, candidateId: 'raw:synthetic.ts:1' },
      ],
    };
    const stale: Corpus = {
      ...corpus,
      rawTransactionSites: corpus.rawTransactionSites.slice(1),
    };

    expect(issueCodes(unregistered)).toContain('STALE_RAW');
    expect(issueCodes(stale)).toContain('UNREGISTERED_RAW');
  }, 120_000);

  it('rejects production REVIEW_REQUIRED and unresolved regression targets', () => {
    const corpus = loadCorpus();
    const boundaryIndex = corpus.transactionBoundaries.findIndex(
      (item) => item.productionReachability.status === 'PROVEN',
    );
    const boundary = corpus.transactionBoundaries[boundaryIndex]!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((item, index) =>
        index === boundaryIndex
          ? {
              ...item,
              productionReachability: {
                ...item.productionReachability,
                status: 'REVIEW_REQUIRED',
              },
            }
          : item,
      ),
      regressionEvidence: [
        ...corpus.regressionEvidence,
        {
          testEvidenceId: 'test:missing-regression',
          file: 'tests/database/does-not-exist.test.ts',
          testName: 'fabricated regression',
          covers: [boundary.boundaryId],
          coverageKind: 'DIRECT_BOUNDARY',
          entrySymbol: 'fabricated.entry',
          path: ['fabricated.entry'],
        },
      ],
    };

    expect(issueCodes(mutated)).toEqual(
      expect.arrayContaining(['PRODUCTION_REVIEW_REQUIRED', 'REGRESSION_FILE']),
    );
  });

  it('R3-V16 keeps the fixture unchanged during verification', () => {
    const before = fs.readFileSync(FIXTURE_PATH, 'utf8');
    validateCorpus(loadCorpus(), ROOT);
    const after = fs.readFileSync(FIXTURE_PATH, 'utf8');

    expect(after).toBe(before);
  });

  // C2-R15: this assertion used to be `result.valid === true && issues === []`,
  // i.e. "the whole v2 fixture passes the current validator". That is no longer
  // the historical claim R3 made, and it is no longer true: the corrected
  // authority check rejects v2. The durable historical invariant is the R3
  // closure fact itself, verified against the frozen R3 artifacts.
  it('R3-V01 closes all sixteen previously missing regression records', () => {
    const closureCandidates = [
      path.join(ROOT, 'artifacts/ts6-phase-b-c2-r3/08-regression-evidence-closure.json'),
      path.join(
        ROOT,
        'artifacts/ts6-phase-b-c2-r15/pre-correction/bytes/artifacts__ts6-phase-b-c2-r3__08-regression-evidence-closure.json',
      ),
    ];
    const closurePath = closureCandidates.find((p) => fs.existsSync(p)) ?? closureCandidates[0]!;
    const startCandidates = [
      path.join(ROOT, 'artifacts/ts6-phase-b-c2-r3/07-missing-regression-16-start.json'),
      path.join(
        ROOT,
        'artifacts/ts6-phase-b-c2-r15/pre-correction/bytes/artifacts__ts6-phase-b-c2-r3__07-missing-regression-16-start.json',
      ),
    ];
    const startPath = startCandidates.find((p) => fs.existsSync(p)) ?? startCandidates[0]!;
    const closure = JSON.parse(fs.readFileSync(closurePath, 'utf8')) as {
      counters: Record<string, number>;
      records: readonly { evidence?: readonly { testEvidenceId?: string }[] }[];
    };
    const start = JSON.parse(fs.readFileSync(startPath, 'utf8')) as {
      missingRegressionAtStart: number;
    };
    const corpus = loadCorpus();
    const v2Ids = new Set(corpus.regressionEvidence.map((e) => e.testEvidenceId));

    // the R3 closure facts
    expect(start.missingRegressionAtStart).toBe(16);
    expect(closure.counters.missingRegressionAtStart).toBe(16);
    expect(closure.counters.closedByExistingDirect).toBe(1);
    expect(closure.counters.closedByExistingPath).toBe(12);
    expect(closure.counters.closedByNewMinimalTest).toBe(3);
    expect(closure.counters.remainingMissingRegression).toBe(0);
    expect(closure.records).toHaveLength(16);

    // every R3 closure evidence id is present in v2 (16/16)
    const closureIds = new Set<string>();
    for (const record of closure.records)
      for (const evidence of record.evidence ?? [])
        if (evidence.testEvidenceId) closureIds.add(evidence.testEvidenceId);
    expect(closureIds.size).toBe(16);
    const present = [...closureIds].filter((id) => v2Ids.has(id));
    expect(present).toHaveLength(16);

    // and the v2 lineage arithmetic holds at ID level
    expect(v2Ids.size).toBe(69);
    expect(v2Ids.size - present.length).toBe(53);
  }, 60_000);

  it('R3-V02 rejects a regression path with a nonexistent symbol', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence.find((item) => item.coverageKind === 'PUBLIC_PATH')!;
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item) =>
        item.testEvidenceId === evidence.testEvidenceId
          ? { ...item, path: [...item.path, 'doesNotExistInThePath'] }
          : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_PATH_SYMBOL');
  });

  it('R3-V03 rejects direct evidence that only constructs the repository', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence.find(
      (item) => item.coverageKind === 'DIRECT_BOUNDARY' && item.entrySymbol.includes('recover'),
    )!;
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item) =>
        item.testEvidenceId === evidence.testEvidenceId
          ? { ...item, path: ['new PostgresConnectorRuntimeState'] }
          : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_DIRECT_PATH');
  });

  it('R3-V04 accepts an existing public-path regression with explicit linkage', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence.find((item) => item.coverageKind === 'PUBLIC_PATH')!;

    expect(evidence.entrySymbol).toBeTruthy();
    expect(evidence.path.length).toBeGreaterThan(1);
    expect(issueCodes(corpus)).not.toContain('REGRESSION_PATH_SYMBOL');
  });

  it('R3-V05 rejects a fake middle edge in an otherwise real path', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence.find(
      (item) => item.coverageKind === 'OWNER_ATOMICITY',
    )!;
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item) =>
        item.testEvidenceId === evidence.testEvidenceId
          ? { ...item, path: [item.path[0]!, 'fakeMiddleEdge', item.path.at(-1)!] }
          : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_PATH_SYMBOL');
  });

  it('rejects unsupported participant-atomicity evidence with its exact error code', () => {
    const corpus = loadCorpus();
    const ownerEvidence = corpus.regressionEvidence.find((item) =>
      item.covers.includes('safe:adapters/frontend-ask-execution-postgres/src/index.ts:2421'),
    )!;
    const inherited = {
      ...ownerEvidence,
      testEvidenceId: `${ownerEvidence.testEvidenceId}:participant`,
      covers: [ownerEvidence.covers[0]!],
      coverageKind: 'PARTICIPANT_ATOMICITY' as const,
    };
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: [...corpus.regressionEvidence, inherited],
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_COVERAGE_KIND_UNSUPPORTED');
  });

  it('rejects unsupported delegate-path evidence with its exact error code', () => {
    const corpus = loadCorpus();
    const source = corpus.regressionEvidence.find((item) => item.coverageKind === 'PUBLIC_PATH')!;
    const inherited = {
      ...source,
      testEvidenceId: `${source.testEvidenceId}:delegate`,
      covers: [source.covers[0]!],
      coverageKind: 'DELEGATE_PATH' as const,
    };

    expect(
      issueCodes({ ...corpus, regressionEvidence: [...corpus.regressionEvidence, inherited] }),
    ).toContain('REGRESSION_COVERAGE_KIND_UNSUPPORTED');
  });

  it('R3-V08 rejects a fabricated regression test name', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence[0]!;
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item, index) =>
        index === 0 ? { ...item, testName: 'fabricated regression name' } : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_NAME');
    expect(evidence.testName).not.toBe('fabricated regression name');
  });

  it('R3-V09 rejects a skipped regression test title', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence[0]!;
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item, index) =>
        index === 0
          ? {
              ...item,
              file: 'tests/database/akp-8-wp2r-typed-proposition-conflict.database.test.ts',
              testName:
                'TEST_DATABASE_URL is unavailable; real PostgreSQL proof is deferred to automatic CI.',
            }
          : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_NAME');
    expect(evidence.file).not.toBe(
      'tests/database/akp-8-wp2r-typed-proposition-conflict.database.test.ts',
    );
  });

  it('R3-V10 rejects a TODO regression title even when the source file exists', () => {
    const corpus = loadCorpus();
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item, index) =>
        index === 0 ? { ...item, testName: 'TODO: add regression proof later' } : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_NAME');
  });

  it('R3-V11 rejects a nonexistent regression file', () => {
    const corpus = loadCorpus();
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item, index) =>
        index === 0 ? { ...item, file: 'tests/database/no-such-regression.test.ts' } : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_FILE');
  });

  it('R3-V12 rejects an evidence record with the wrong boundary id', () => {
    const corpus = loadCorpus();
    const mutated: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((item, index) =>
        index === 0 ? { ...item, covers: ['safe:synthetic-boundary.ts:1'] } : item,
      ),
    };

    expect(issueCodes(mutated)).toContain('REGRESSION_TARGET');
  });

  it('R3-V13 records private helper coverage through its public owner path', () => {
    const corpus = loadCorpus();
    const evidence = corpus.regressionEvidence.find((item) =>
      item.covers.includes('safe:adapters/frontend-activity-postgres/src/index.ts:91'),
    )!;

    expect(evidence.coverageKind).toBe('OWNER_ATOMICITY');
    expect(evidence.path.at(-1)).toBe('PostgresActivityIndexStore.withProjectWriteLock');
  });

  it('R3-V14 reports exactly sixteen target boundaries with regression closure', () => {
    const corpus = loadCorpus();
    const targetIds = [
      'safe:adapters/connector-runtime-postgres/src/index.ts:1199',
      'safe:adapters/connector-runtime-postgres/src/index.ts:1389',
      'safe:adapters/discovery-reentry-postgres/src/index.ts:777',
      'safe:adapters/discovery-reentry-postgres/src/index.ts:987',
      'safe:adapters/discovery-runtime-postgres/src/index.ts:2844',
      'safe:adapters/frontend-activity-postgres/src/index.ts:91',
      'safe:adapters/frontend-ask-execution-postgres/src/index.ts:2421',
      'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:467',
      'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:508',
      'safe:adapters/frontend-sources-write-postgres/src/product-service.ts:1485',
      'safe:adapters/postgres-stage5/src/index.ts:418',
      'safe:adapters/postgres-stage5/src/index.ts:1340',
      'safe:adapters/postgres/src/index.ts:971',
      'safe:adapters/postgres/src/index.ts:1500',
      'safe:adapters/provider-privacy-deployment-postgres/src/index.ts:90',
      'safe:adapters/provider-privacy-deployment-postgres/src/index.ts:160',
    ];
    const closed = targetIds.filter((id) =>
      corpus.regressionEvidence.some((evidence) => evidence.covers.includes(id)),
    );

    expect(closed).toHaveLength(16);
  });

  it('R3-V15 rejects an unexplained count-crosswalk record', () => {
    const crosswalk = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'ts6-c2-r3-boundary-count-crosswalk.json'), 'utf8'),
    );
    const mutated = { ...crosswalk, unexplained: [{ kind: 'synthetic' }] };

    expect(validateCountCrosswalk(mutated)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CROSSWALK_UNEXPLAINED' })]),
    );
  });
});
