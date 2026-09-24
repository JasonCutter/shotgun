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

  it('validates the v8 lineage against live AST and regression evidence authorities', () => {
    const result = validateCorpus(loadV8(), ROOT);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
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
