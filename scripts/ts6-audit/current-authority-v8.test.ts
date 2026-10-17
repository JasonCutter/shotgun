import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { literalPortBindings, type ReachIndex } from '../ts6-phase-b-production-reachability.js';
import { makeLineageMetadata } from '../ts6-lineage-metadata.mjs';
import {
  buildAuditShape,
  validateCorpus,
  type Corpus,
} from '../ts6-phase-b-transaction-authority-validator.js';

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts/ts6-phase-b-c2-r15');
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
const manifest = readJson<{
  entries: readonly {
    candidateId: string;
    classification: string;
    reachabilityStatus?: string;
  }[];
}>(path.join(ARTIFACT_DIR, 'current-authority-manifest.v8.json'));
const loadV8 = (): Corpus => readJson<Corpus>(path.join(ARTIFACT_DIR, 'golden.v8.derived.json'));

describe('T3-1 current authority and v8 lineage', () => {
  it('registers the isolated negative binding and atomic publication owners with explicit database evidence', () => {
    const audit = buildAuditShape(ROOT);
    for (const method of ['bindPolicy', 'finish']) {
      const owner = audit.boundaries.find(
        (boundary) =>
          boundary.file === 'adapters/vp-knowledge-postgres/src/negative-knowledge-isolated.ts' &&
          boundary.symbol === 'PostgresIsolatedNegativeKnowledgeJobs' &&
          boundary.method === method,
      );
      expect(owner?.ownership.kind).toBe('SAFE_HELPER');
      // Static concrete calls do not imply that the operating profile is enabled.
      expect(owner?.productionReachability.status).toBe('PROVEN');
      expect(loadV8().regressionEvidence).toContainEqual(
        expect.objectContaining({
          file: 'tests/database/vp-negative-knowledge-product.database.test.ts',
          coverageKind: method === 'bindPolicy' ? 'DIRECT_BOUNDARY' : 'OWNER_ATOMICITY',
          entrySymbol: method === 'bindPolicy' ? 'bindPolicy' : 'completeRecordedNoEdge',
          covers: [owner!.boundaryId],
        }),
      );
    }
  }, 120_000);

  it('matches every AST candidate and reachability grade to the frozen baseline manifest', () => {
    const audit = buildAuditShape(ROOT);
    const byId = new Map(audit.boundaries.map((boundary) => [boundary.boundaryId, boundary]));
    const actual = audit.reconciliation.map((row) => ({
      candidateId: row.candidateId,
      classification: row.c2r2Classification,
      ...(byId.has(row.candidateId)
        ? { reachabilityStatus: byId.get(row.candidateId)!.productionReachability.status }
        : {}),
    }));

    expect(actual).toEqual(manifest.entries);
  }, 120_000);

  it('records the image ledger append owner through its typed runtime Port and direct database test', () => {
    const audit = buildAuditShape(ROOT);
    const owner = audit.boundaries.find(
      (boundary) =>
        boundary.file === 'adapters/vp-knowledge-postgres/src/image-observations.ts' &&
        boundary.symbol === 'PostgresVPImageObservationLedger' &&
        boundary.method === 'append',
    );
    expect(owner).toBeDefined();
    expect(owner?.ownership.kind).toBe('SAFE_HELPER');
    expect(owner?.productionReachability.status).toBe('PORT_INFERRED');
    expect(owner?.productionReachability.callers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'assemblies/shotgun-app/src/image-observation-runtime.ts',
          bindingPort: 'VPImageObservationLedgerPort',
          receiverType: 'VPImageObservationLedgerPort',
          evidenceGrade: 'PORT_INFERRED',
        }),
      ]),
    );
    expect(
      loadV8().regressionEvidence.some(
        (record) =>
          record.file === 'tests/database/vp-image-observations.database.test.ts' &&
          record.testName ===
            'concurrent finalizers and a restarted ledger reuse one observation and one epoch' &&
          record.coverageKind === 'DIRECT_BOUNDARY' &&
          record.covers.includes(owner!.boundaryId),
      ),
    ).toBe(true);
  }, 120_000);

  it('keeps the explicit-negative no-edge finalizer outside normal app reachability', () => {
    const owner = buildAuditShape(ROOT).boundaries.find(
      (boundary) =>
        boundary.file === 'adapters/vp-knowledge-postgres/src/explicit-negative-isolated.ts' &&
        boundary.method === 'completeRecordedNoEdge',
    );
    expect(owner).toBeDefined();
    expect(owner?.productionReachability).toEqual({ status: 'TEST_ONLY_OR_DEAD', callers: [] });
    expect(loadV8().regressionEvidence).toContainEqual(
      expect.objectContaining({
        file: 'tests/database/vp-explicit-negative-isolated.database.test.ts',
        entrySymbol: 'completeRecordedNoEdge',
        coverageKind: 'DIRECT_BOUNDARY',
        covers: [owner!.boundaryId],
      }),
    );
  }, 120_000);

  it('binds generic execution calls to the repository Port instead of the output value', () => {
    const audit = buildAuditShape(ROOT);
    for (const method of ['claim', 'storeOutput', 'markOutcomeUnknown']) {
      const owner = audit.boundaries.find(
        (row) =>
          row.file === 'adapters/vp-knowledge-postgres/src/relation-jobs.ts' &&
          row.method === method,
      );
      expect(owner).toBeDefined();
      expect(owner!.productionReachability.callers).toContainEqual(
        expect.objectContaining({
          file: 'adapters/vp-global-provider-budget-postgres/src/execution-boundary.ts',
          receiverType: 'ExecutionBoundRelationLedger',
          bindingPort: 'ExecutionBoundRelationLedger',
          evidenceGrade: 'PORT_INFERRED',
        }),
      );
      expect(
        owner!.productionReachability.callers.some((caller) => caller.receiverType === 'Output'),
      ).toBe(false);
    }
  }, 120_000);

  it('binds the existing Frontend Canonical writer through its explicit implemented Port', () => {
    const owner = buildAuditShape(ROOT).boundaries.find(
      (row) =>
        row.symbol === 'PostgresCanonicalKnowledgeRepository' &&
        row.method === 'commitFrontendDraft',
    );
    expect(owner?.productionReachability.status).toBe('PORT_INFERRED');
    expect(owner?.productionReachability.callers).toContainEqual(
      expect.objectContaining({
        file: 'modules/frontend-knowledge-draft/src/product-api.ts',
        receiverType: 'FrontendKnowledgeDraftCanonicalCommitPort',
        bindingPort: 'FrontendKnowledgeDraftCanonicalCommitPort',
        evidenceGrade: 'PORT_INFERRED',
      }),
    );
  }, 120_000);

  it.each([
    { field: 'receiverType', replacement: 'Output', code: 'CALLER_RECEIVER_TYPE_DRIFT' },
    { field: 'bindingPort', replacement: 'Output', code: 'CALLER_BINDING_PORT_DRIFT' },
    { field: 'bindingKind', replacement: 'DIRECT', code: 'CALLER_BINDING_KIND_DRIFT' },
  ] as const)(
    'rejects a forged generic $field even when site and grade are unchanged',
    ({ field, replacement, code }) => {
      const corpus = loadV8();
      const mutated: Corpus = {
        ...corpus,
        transactionBoundaries: corpus.transactionBoundaries.map((owner) =>
          owner.file === 'adapters/vp-knowledge-postgres/src/relation-jobs.ts' &&
          owner.method === 'claim'
            ? {
                ...owner,
                productionReachability: {
                  ...owner.productionReachability,
                  callers: owner.productionReachability.callers.map((caller) =>
                    caller.file ===
                    'adapters/vp-global-provider-budget-postgres/src/execution-boundary.ts'
                      ? { ...caller, [field]: replacement }
                      : caller,
                  ),
                },
              }
            : owner,
        ),
      };
      expect(validateCorpus(mutated, ROOT).issues.map((issue) => issue.code)).toContain(code);
    },
    120_000,
  );

  it('validates the v8 lineage against live AST and regression evidence authorities', () => {
    const result = validateCorpus(loadV8(), ROOT);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  }, 120_000);

  it('rejects replacing distinct repeated calls with duplicate evidence for one site', () => {
    const corpus = loadV8();
    const owner = corpus.transactionBoundaries.find((row) =>
      row.productionReachability.callers.some((caller, index, callers) =>
        callers
          .slice(index + 1)
          .some(
            (other) =>
              other.file === caller.file &&
              other.callNeedle === caller.callNeedle &&
              other.line !== caller.line,
          ),
      ),
    )!;
    expect(owner).toBeDefined();
    const callers = [...owner.productionReachability.callers];
    const index = callers.findIndex((caller, position) =>
      callers
        .slice(position + 1)
        .some(
          (other) =>
            other.file === caller.file &&
            other.callNeedle === caller.callNeedle &&
            other.line !== caller.line,
        ),
    );
    const first = callers[index]!;
    const duplicateIndex = callers.findIndex(
      (caller, position) =>
        position > index && caller.file === first.file && caller.callNeedle === first.callNeedle,
    );
    callers[duplicateIndex] = first;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((row) =>
        row === owner
          ? { ...row, productionReachability: { ...row.productionReachability, callers } }
          : row,
      ),
    };
    expect(validateCorpus(mutated, ROOT).issues.map((issue) => issue.code)).toContain(
      'CALLER_SITE_DUPLICATE',
    );
  }, 120_000);

  it('rejects a forged caller line even when its expression and binding are unchanged', () => {
    const corpus = loadV8();
    const owner = corpus.transactionBoundaries.find(
      (row) => row.productionReachability.callers.length,
    )!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((row) =>
        row === owner
          ? {
              ...row,
              productionReachability: {
                ...row.productionReachability,
                callers: row.productionReachability.callers.map((caller, index) =>
                  index === 0 ? { ...caller, line: (caller.line ?? 0) + 100000 } : caller,
                ),
              },
            }
          : row,
      ),
    };
    expect(validateCorpus(mutated, ROOT).issues.map((issue) => issue.code)).toContain('CALLER_SET');
  }, 120_000);

  it('rejects caller grade drift with its specific error code', () => {
    const corpus = loadV8();
    const boundary = corpus.transactionBoundaries.find(
      (row) =>
        row.productionReachability.status === 'PORT_INFERRED' &&
        row.productionReachability.callers.length > 0,
    )!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((row) =>
        row.boundaryId === boundary.boundaryId
          ? {
              ...row,
              productionReachability: {
                ...row.productionReachability,
                callers: row.productionReachability.callers.map((caller, index) =>
                  index === 0 ? { ...caller, evidenceGrade: 'DIRECT_CALLER' } : caller,
                ),
              },
            }
          : row,
      ),
    };

    expect(validateCorpus(mutated, ROOT).issues.map((issue) => issue.code)).toContain(
      'CALLER_EVIDENCE_GRADE_DRIFT',
    );
  }, 120_000);

  it('rejects duplicate evidence identity and empty relation coverage specifically', () => {
    const corpus = loadV8();
    const duplicateId: Corpus = {
      ...corpus,
      regressionEvidence: [...corpus.regressionEvidence, corpus.regressionEvidence[0]!],
    };
    const emptyCoverage: Corpus = {
      ...corpus,
      regressionEvidence: corpus.regressionEvidence.map((record, index) =>
        index === 0 ? { ...record, covers: [] } : record,
      ),
    };

    expect(validateCorpus(duplicateId, ROOT).issues.map((issue) => issue.code)).toContain(
      'REGRESSION_EVIDENCE_ID_DUPLICATE',
    );
    expect(validateCorpus(emptyCoverage, ROOT).issues.map((issue) => issue.code)).toContain(
      'REGRESSION_COVERS_EMPTY',
    );
  }, 120_000);

  it('rejects a removed boundary back-reference with its specific error code', () => {
    const corpus = loadV8();
    const evidence = corpus.regressionEvidence[0]!;
    const boundaryId = evidence.covers[0]!;
    const mutated: Corpus = {
      ...corpus,
      transactionBoundaries: corpus.transactionBoundaries.map((row) =>
        row.boundaryId === boundaryId
          ? {
              ...row,
              regressionEvidenceIds: row.regressionEvidenceIds.filter(
                (id) => id !== evidence.testEvidenceId,
              ),
            }
          : row,
      ),
    };

    expect(validateCorpus(mutated, ROOT).issues.map((issue) => issue.code)).toContain(
      'REGRESSION_BACKREF_MISSING',
    );
  }, 120_000);

  it('counts only properties on objects actually returned by typed Port factories', () => {
    const declaration = {
      name: 'makePort',
      typeText: '',
      initText: '(): SamplePort => { const decoy = { wrong() {} }; return { actual() {} }; }',
      position: 0,
    };
    const index: ReachIndex = {
      classes: new Map(),
      methods: [],
      byOwner: new Map(),
      classFields: new Map(),
      typeAliasParts: new Map(),
      typeViewParts: new Map(),
      moduleDeclarations: new Map([['fixture.ts', [declaration]]]),
      files: ['fixture.ts'],
    };

    const members = literalPortBindings(index).get('SamplePort');
    expect(members?.has('actual')).toBe(true);
    expect(members?.has('wrong')).toBe(false);
  });

  it('builds explicit lineage metadata without inheriting legacy parent shapes', () => {
    const parentContent = '{\r\n  "derivedFrom": "legacy-string"\r\n}';
    const base = {
      parentArtifact: 'artifacts/parent.json',
      parentContent,
      baseCommit: 'baseline-sha',
      authorityVersion: 'authority.v1',
    };
    const legacyValues: readonly unknown[] = ['legacy-string', ['legacy-array'], { old: true }];

    for (const previousDerivedFrom of legacyValues) {
      const input = Object.assign({}, base, { previousDerivedFrom });
      const metadata = makeLineageMetadata(input);
      expect(Object.keys(metadata)).toEqual([
        'parentArtifact',
        'parentSha256',
        'baseCommit',
        'authorityVersion',
      ]);
      expect(metadata).toMatchObject({
        parentArtifact: base.parentArtifact,
        baseCommit: base.baseCommit,
        authorityVersion: base.authorityVersion,
      });
      expect(metadata.parentSha256).toBe(
        '6f2b7ff4b9e3c84e61597b9dbed2f1287fdc931535f793342fe9625119dba564',
      );
    }
  });

  it('blocks v6/v7 rebuilders from overwriting frozen or current lineage artifacts', () => {
    const protectedArtifacts = [
      'artifacts/ts6-phase-b-c2-r15/golden.v6.derived.json',
      'artifacts/ts6-phase-b-c2-r15/golden.v7.derived.json',
      'artifacts/ts6-phase-b-c2-r15/golden.v8.derived.json',
    ];
    const rebuilders = [
      'scripts/rebuild-ts6-phase-b-c2-r15-v6-lineage.mjs',
      'scripts/rebuild-ts6-phase-b-c2-r15-v7-lineage.mjs',
    ];

    for (const rebuilder of rebuilders)
      for (const artifact of protectedArtifacts) {
        const result = spawnSync(
          process.execPath,
          [path.join(ROOT, rebuilder), '--output', artifact],
          { cwd: ROOT, encoding: 'utf8' },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Refusing to overwrite protected lineage artifact');
      }
  });
});
