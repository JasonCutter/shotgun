/** Read-only architecture inventory/integrity checks; writes only its derived audit JSON. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProductionSemanticDigest } from './vp-acceptance-evaluator-engine.js';

const root = 'docs/implementation/development-strategy-reset-2026-10-10';
const base = '6be130125d211ac4da6d45a29fd1db101387a296';
const initialMain = 'e08449982cbf2247b9b1e7a7ef39281eab09166a';
const hash = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex');
const git = (...args: string[]) => execFileSync('git', args);
const gitText = (...args: string[]) =>
  git(...args)
    .toString('utf8')
    .trim();
const read = (p: string) => readFileSync(p, 'utf8');
function walk(p: string): string[] {
  return readdirSync(p).flatMap((name) => {
    const path = join(p, name).replaceAll('\\', '/');
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const allowedChanged = new Set([
  'AGENTS.md',
  'docs/architecture/add/README.md',
  'docs/architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md',
  'docs/architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md',
  'docs/architecture/adr/README.md',
  'docs/architecture/adr/adr-registry.json',
  'docs/architecture/module-architecture/shotgun-module-architecture-add.md',
  'docs/implementation/README.md',
  'docs/implementation/definition-of-done.md',
  'docs/implementation/implementation-roadmap.md',
  'docs/implementation/oss-evaluation-plan.md',
  'docs/implementation/oss-integration-roadmap.md',
  'docs/implementation/release-strategy.md',
  'docs/implementation/testing-strategy.md',
  'docs/implementation/vp-completion-tracker.md',
  'docs/implementation/vp-vampire-implementation-plan.md',
  'docs/engineering/evidence-registry.json',
  'docs/generated-artifacts.json',
]);
const changed = gitText('diff', '--name-only', '--diff-filter=MDTR', base, '--')
  .split('\n')
  .filter(Boolean);
assert(
  changed.every((p) => allowedChanged.has(p)),
  'Change outside approved documentation scope',
);
const additions = gitText('diff', '--name-only', '--diff-filter=A', base, '--')
  .split('\n')
  .filter(Boolean);
assert(
  additions.every(
    (p) =>
      p.startsWith(root + '/') ||
      p === 'scripts/audit-development-strategy.ts' ||
      p ===
        'docs/architecture/adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md',
  ),
  'Unexpected tracked addition',
);
assert.equal(
  gitText('rev-parse', 'main'),
  initialMain,
  'Primary main changed; reconcile before claiming integrity',
);
const inventory = [
  ...walk('docs/architecture/adr'),
  ...walk('docs/architecture/add'),
  ...walk('docs/architecture/module-architecture'),
]
  .filter((p) => p.endsWith('.md'))
  .sort()
  .map((path) => {
    const text = read(path),
      lines = text.split(/\r?\n/u);
    const cues = {
      knowledgeAuthority: /Canonical|VP Ledger|Claim.*Fact/u.test(text),
      sourceSecurity: /Evidence|SourceVersion|accessScope|권한/u.test(text),
      evaluation: /Golden|Gold|Corpus|평가|Threshold|metric/u.test(text),
      executionRecovery: /OUTCOME_UNKNOWN|Idempot|budget|예산|복구/u.test(text),
      reuse: /OSS|EXTRACT|ADOPT|REFERENCE_ONLY/u.test(text),
    };
    return {
      path,
      sha256: hash(readFileSync(path)),
      title: lines.find((s) => /^# /u.test(s)) ?? null,
      statusText: lines.find((s) => /Status:|상태:/u.test(s))?.slice(0, 250) ?? null,
      reviewLevel: 'AUTOMATED_FULL_TEXT_BOUNDARY_SCREENING_NOT_INDEPENDENT_SEMANTIC_APPROVAL',
      cues,
    };
  });
const retainedPrefixes = [
  'docs/architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md',
  'docs/architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md',
].map((path) => {
  const old = git('show', `${base}:${path}`).toString('utf8').replaceAll('\r\n', '\n');
  const current = read(path).replaceAll('\r\n', '\n');
  assert(current.startsWith(old), `Original ADR text rewritten: ${path}`);
  return { path, originalRecordPreservedAsPrefix: true, baseline: base };
});
const paused = JSON.parse(read(root + '/paused-drafts.json')) as {
  stash: string;
  originalFiles: { path: string; sha256: string }[];
  priorB2Stash: string;
};
assert.equal(paused.originalFiles.length, 20);
const stashedNames = gitText('ls-tree', '-r', '--name-only', `${paused.stash}^3`)
  .split('\n')
  .sort();
assert.deepEqual(stashedNames, paused.originalFiles.map((f) => f.path).sort());
for (const f of paused.originalFiles)
  assert.equal(hash(git('show', `${paused.stash}^3:${f.path}`)), f.sha256);
assert(gitText('stash', 'list', '--format=%H').split('\n').includes(paused.priorB2Stash));
const source = JSON.parse(read(root + '/source-provenance.json')) as {
  source: string;
  copy: string;
  sha256: string;
};
assert.equal(hash(readFileSync(source.source)), source.sha256);
assert.equal(hash(readFileSync(source.copy)), source.sha256);
const protectedFiles = [
  'docs/implementation/vp-05-relation-ab-final-evidence.json',
  'docs/implementation/vp-05-relation-ab-final-scores.json',
  'docs/implementation/vp-05-relation-b-live-screen-evidence.json',
  'docs/implementation/vp-04-05-acceptance-contract-v1.0.md',
  'scripts/vp-acceptance-evaluator-engine.ts',
  'scripts/vp-relation-a-b.ts',
  'scripts/vp-relation-a-b-score.ts',
  'scripts/vp-structured-relation-candidate.ts',
  'adapters/vp-decision-general-ai/src/index.ts',
  'modules/vp-decision/src/index.ts',
  'docs/CANONICAL.md',
  'docs/canonical-manifest.yaml',
].map((path) => ({ path, sha256: hash(readFileSync(path)), changed: changed.includes(path) }));
assert(protectedFiles.every((f) => !f.changed));
const semantic = computeProductionSemanticDigest().semanticDigest;
assert.equal(semantic, '996ad83ba1fd74e8b50c07ed0811adbe8a4e7e6a1b801c893c251929615bf463');
const registry = JSON.parse(read('docs/architecture/adr/adr-registry.json')) as {
  expectedRange: { end: number };
  ownerRules: { start: number; end: number }[];
};
assert.equal(registry.expectedRange.end, 173);
for (const id of [172, 173])
  assert.equal(registry.ownerRules.filter((r) => id >= r.start && id <= r.end).length, 1);
const report = {
  generator: 'node node_modules/tsx/dist/cli.mjs scripts/audit-development-strategy.ts',
  generatorSha256: hash(readFileSync('scripts/audit-development-strategy.ts')),
  canonicalInputsAfterPublication: [
    'docs/architecture/adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md',
    'docs/architecture/adr/adr-registry.json',
    root + '/reconciliation.md',
    root + '/source-provenance.json',
    root + '/paused-drafts.json',
  ],
  authority: 'DERIVED_DOC_INVENTORY_AND_INTEGRITY_EVIDENCE_NOT_PRODUCT_OR_SEMANTIC_APPROVAL',
  baseCommit: base,
  primaryMainUnchanged: initialMain,
  publication: 'LOCAL_USER_ACCEPTED_DECISION_PENDING_REVIEWED_MAIN_MERGE',
  inventoryCount: inventory.length,
  inventory,
  targetedClauseReview: root + '/reconciliation.md',
  targetedClauseReviewSha256: hash(readFileSync(root + '/reconciliation.md')),
  wholeAdrsSuperseded: 0,
  retainedPrefixes,
  pausedDrafts: {
    stash: paused.stash,
    count: 20,
    bytesMatchOriginal: true,
    resumed: false,
    adoptedAsEvaluator: false,
    priorB2StashPreserved: true,
  },
  sourceByteCopyVerified: source,
  changedOriginalPaths: changed,
  protectedFiles,
  productionSemanticDigest: semantic,
  providerCalls: 0,
  productionDataWrites: 0,
  goldB7Opened: false,
  vp06Started: false,
  empiricalProductOrQualityGateClosed: false,
};
writeFileSync(root + '/alignment-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    inventory: inventory.length,
    wholeAdrsSuperseded: 0,
    originalAdrsPreserved: retainedPrefixes.length,
    pausedFilesVerified: 20,
    productionSemanticDigest: semantic,
    mainUnchanged: initialMain,
    publication: report.publication,
  }),
);
