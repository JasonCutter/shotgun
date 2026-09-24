import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRegressionEvidenceAuthority } from './ts6-phase-b-regression-evidence-authority.js';
import { makeLineageMetadata } from './ts6-lineage-metadata.mjs';
import {
  buildAuditShape,
  ROOT,
  T3_BASELINE_SHA,
  validateCorpus,
  type Corpus,
  type RegressionEvidence,
} from './ts6-phase-b-transaction-authority-validator.js';

const ARTIFACT_DIR = 'artifacts/ts6-phase-b-c2-r15';
const OUTPUT_RELATIVE = `${ARTIFACT_DIR}/golden.v8.derived.json`;
const CURRENT_MANIFEST_RELATIVE = `${ARTIFACT_DIR}/current-authority-manifest.v8.json`;
const APPROVED_RELATIONS_RELATIVE = `${ARTIFACT_DIR}/approved-regression-relations.v8.json`;
const FROZEN_HISTORY_RELATIVE = `${ARTIFACT_DIR}/t3-frozen-history-manifest.json`;

type CurrentAuthorityManifest = {
  readonly schemaVersion: 'ts6.phase-b.current-authority-manifest.v8';
  readonly status: 'FROZEN_BASELINE_EXPECTATIONS';
  readonly baseCommit: string;
  readonly entries: readonly {
    readonly candidateId: string;
    readonly classification: string;
    readonly reachabilityStatus?: string;
  }[];
};

type ApprovedRelationsManifest = {
  readonly schemaVersion: 'ts6.phase-b.approved-regression-relations.v1';
  readonly status: 'FROZEN_APPROVED_INPUT';
  readonly sourceArtifact: string;
  readonly sourceArtifactSha256: string;
  readonly records: readonly RegressionEvidence[];
};

type FrozenHistoryManifest = {
  readonly schemaVersion: 'ts6.phase-b.frozen-history.v1';
  readonly status: 'IMMUTABLE_HISTORICAL_INPUT';
  readonly artifacts: readonly { readonly path: string; readonly sha256: string }[];
};

const normalizedSha256 = (value: string): string =>
  createHash('sha256').update(value.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const readJson = <T>(root: string, relative: string): T =>
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as T;

const assertFrozenHistory = (root: string): FrozenHistoryManifest => {
  const manifest = readJson<FrozenHistoryManifest>(root, FROZEN_HISTORY_RELATIVE);
  if (
    manifest.schemaVersion !== 'ts6.phase-b.frozen-history.v1' ||
    manifest.status !== 'IMMUTABLE_HISTORICAL_INPUT' ||
    manifest.artifacts.length === 0
  )
    throw new Error('T3 frozen-history manifest is invalid or empty');
  for (const artifact of manifest.artifacts) {
    const actual = normalizedSha256(fs.readFileSync(path.join(root, artifact.path), 'utf8'));
    if (actual !== artifact.sha256)
      throw new Error(`Frozen historical artifact changed: ${artifact.path}`);
  }
  return manifest;
};

const expectedCurrentEntries = (
  audit: ReturnType<typeof buildAuditShape>,
): CurrentAuthorityManifest['entries'] => {
  const boundaries = new Map(audit.boundaries.map((boundary) => [boundary.boundaryId, boundary]));
  return audit.reconciliation.map((row) => ({
    candidateId: row.candidateId,
    classification: row.c2r2Classification,
    ...(boundaries.has(row.candidateId)
      ? { reachabilityStatus: boundaries.get(row.candidateId)!.productionReachability.status }
      : {}),
  }));
};

const assertCurrentManifest = (
  root: string,
  audit: ReturnType<typeof buildAuditShape>,
): CurrentAuthorityManifest => {
  const manifest = readJson<CurrentAuthorityManifest>(root, CURRENT_MANIFEST_RELATIVE);
  if (
    manifest.schemaVersion !== 'ts6.phase-b.current-authority-manifest.v8' ||
    manifest.status !== 'FROZEN_BASELINE_EXPECTATIONS' ||
    manifest.baseCommit !== T3_BASELINE_SHA
  )
    throw new Error('Current authority manifest does not match the frozen T3 baseline');
  const expected = JSON.stringify(expectedCurrentEntries(audit));
  const recorded = JSON.stringify(manifest.entries);
  if (expected !== recorded)
    throw new Error('AST-derived transaction inventory or evidence grade drifted from v8 manifest');
  return manifest;
};

const assertApprovedRelations = (root: string, manifest: ApprovedRelationsManifest): void => {
  if (
    manifest.schemaVersion !== 'ts6.phase-b.approved-regression-relations.v1' ||
    manifest.status !== 'FROZEN_APPROVED_INPUT' ||
    manifest.sourceArtifact !== `${ARTIFACT_DIR}/golden.v7.derived.json`
  )
    throw new Error('Approved regression relation manifest has an unexpected identity');
  const source = fs.readFileSync(path.join(root, manifest.sourceArtifact), 'utf8');
  if (normalizedSha256(source) !== manifest.sourceArtifactSha256)
    throw new Error('Approved relation source hash does not match frozen golden.v7');
  if (manifest.records.length === 0)
    throw new Error('Approved regression relation manifest is empty');
};

const assertNoIssues = (
  root: string,
  boundaries: Corpus['transactionBoundaries'],
  records: readonly RegressionEvidence[],
): void => {
  const issues = checkRegressionEvidenceAuthority(root, boundaries, records);
  if (issues.length > 0)
    throw new Error(
      `Approved regression relations no longer resolve: ${issues
        .slice(0, 12)
        .map((issue) => `${issue.code}:${issue.boundaryId ?? issue.message}`)
        .join(', ')}`,
    );
};

export const buildV8Lineage = (root: string = ROOT): Corpus => {
  assertFrozenHistory(root);
  const audit = buildAuditShape(root);
  assertCurrentManifest(root, audit);
  const approved = readJson<ApprovedRelationsManifest>(root, APPROVED_RELATIONS_RELATIVE);
  assertApprovedRelations(root, approved);

  const evidenceIdsByBoundary = new Map<string, string[]>();
  const knownBoundaryIds = new Set(audit.boundaries.map((boundary) => boundary.boundaryId));
  const uniqueEvidenceIds = new Set<string>();
  for (const record of approved.records) {
    if (uniqueEvidenceIds.has(record.testEvidenceId))
      throw new Error(`Approved relation manifest repeats evidence id ${record.testEvidenceId}`);
    uniqueEvidenceIds.add(record.testEvidenceId);
    if (record.covers.length === 0)
      throw new Error(`Approved evidence ${record.testEvidenceId} has no covered boundary`);
    for (const boundaryId of record.covers) {
      if (!knownBoundaryIds.has(boundaryId))
        throw new Error(`Approved evidence ${record.testEvidenceId} targets unknown ${boundaryId}`);
      const ids = evidenceIdsByBoundary.get(boundaryId) ?? [];
      if (ids.includes(record.testEvidenceId))
        throw new Error(
          `Approved relation is duplicated: ${boundaryId} <- ${record.testEvidenceId}`,
        );
      ids.push(record.testEvidenceId);
      evidenceIdsByBoundary.set(boundaryId, ids);
    }
  }

  const boundaries = audit.boundaries.map((boundary) => {
    const regressionEvidenceIds = evidenceIdsByBoundary.get(boundary.boundaryId) ?? [];
    return {
      ...boundary,
      productionReachability: {
        ...boundary.productionReachability,
        callers: boundary.productionReachability.callers.map((caller) => ({
          ...caller,
          regressionEvidenceIds,
        })),
      },
      regressionEvidenceIds,
    };
  });
  assertNoIssues(root, boundaries, approved.records);

  const parentContent = fs.readFileSync(path.join(root, APPROVED_RELATIONS_RELATIVE), 'utf8');
  const prior = readJson<Corpus>(root, `${ARTIFACT_DIR}/golden.v7.derived.json`);
  const historicalSummaryValue = (
    key: 'historicalRows' | 'historicalRowsExplained' | 'historicalRowsUnexplained',
  ): number => {
    const value = prior.summary[key];
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(`Frozen golden.v7 summary is missing numeric ${key}`);
    return value;
  };
  const summary: Record<string, number> = {
    ...audit.counts,
    c2r1CandidateRecords: audit.candidates.length,
    uniqueCandidateIdentities: new Set(audit.candidates.map((candidate) => candidate.candidateId))
      .size,
    reconciliationTotal: audit.candidates.length,
    historicalRows: historicalSummaryValue('historicalRows'),
    historicalRowsExplained: historicalSummaryValue('historicalRowsExplained'),
    historicalRowsUnexplained: historicalSummaryValue('historicalRowsUnexplained'),
  };
  const lineage: Corpus = {
    schemaVersion: 'ts6.phase-b.transaction-authority.v4',
    baseSha: T3_BASELINE_SHA,
    derivedFrom: makeLineageMetadata({
      parentArtifact: APPROVED_RELATIONS_RELATIVE,
      parentContent,
      baseCommit: T3_BASELINE_SHA,
      authorityVersion: 'ts6.phase-b.current-authority-manifest.v8',
    }),
    correctionRound: 'T3-1-V8-FRESH-AST-AND-APPROVED-RELATION-AUTHORITY',
    transactionBoundaries: boundaries,
    transactionParticipants: audit.participants,
    transactionDelegates: audit.delegates,
    excludedCandidates: audit.excluded,
    candidateReconciliation: audit.reconciliation,
    historicalReconciliation: prior.historicalReconciliation,
    rawTransactionSites: audit.rawTransactionSites,
    regressionEvidence: [...approved.records],
    historical: prior.historical,
    summary,
  };

  const validation = validateCorpus(lineage, root);
  if (!validation.valid)
    throw new Error(
      `Generated v8 lineage failed validation: ${validation.issues
        .slice(0, 20)
        .map((issue) => `${issue.code}:${issue.boundaryId ?? issue.message}`)
        .join(', ')}`,
    );
  return lineage;
};

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (executedPath.toLowerCase() === modulePath.toLowerCase()) {
  const output = path.join(ROOT, OUTPUT_RELATIVE);
  const generated = `${JSON.stringify(buildV8Lineage(ROOT), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const committed = fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n');
    if (committed !== generated) {
      console.error('golden.v8.derived.json is stale; regenerate with npm run ts6:v8:rebuild');
      process.exitCode = 1;
    } else console.log('TS-6 v8 authority lineage is reproducible');
  } else {
    fs.writeFileSync(output, generated, 'utf8');
    console.log(`wrote ${OUTPUT_RELATIVE}`);
  }
}
