/** Portable documentation audit. No provider, database, or main mutation. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'docs/implementation/development-strategy-reset-2026-10-10';
const publicationBase = 'e08449982cbf2247b9b1e7a7ef39281eab09166a';
const originalCommit = '1a36c7b55562783372dbc73c3188b9d797737c7e';
const hash = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex');
const git = (...args: string[]) => execFileSync('git', args);
const gitText = (...args: string[]) =>
  git(...args)
    .toString('utf8')
    .trim();
const read = (p: string) => readFileSync(p, 'utf8');
const protectedRoots = [
  'adapters',
  'assemblies',
  'modules',
  'packages',
  'apps',
  'migrations',
  'tests',
  '.github',
];
const productionChanges = gitText(
  'diff',
  '--name-only',
  publicationBase,
  '--',
  ...protectedRoots,
  'tsconfig.json',
);
assert.equal(productionChanges, '', 'Production/test/workflow changes are outside this review PR');
// The 2026-10-11 repository audit authorized this single upstream security patch.
// Verify its entire manifest/lockfile delta rather than allowing arbitrary upgrades.
const dependencyChanges = gitText(
  'diff',
  '--name-only',
  publicationBase,
  '--',
  'package.json',
  'package-lock.json',
)
  .split('\n')
  .filter(Boolean);
if (dependencyChanges.length > 0) {
  const baseManifest = JSON.parse(git('show', `${publicationBase}:package.json`).toString('utf8'));
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.overrides['source-map-js'], '1.2.2');
  delete manifest.overrides['source-map-js'];
  assert.deepEqual(manifest, baseManifest, 'Unrelated manifest change');
  const baseLock = JSON.parse(git('show', `${publicationBase}:package-lock.json`).toString('utf8'));
  const lock = JSON.parse(read('package-lock.json'));
  const patched = lock.packages['node_modules/source-map-js'];
  assert.equal(patched.version, '1.2.2');
  assert.equal(
    patched.resolved,
    'https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz',
  );
  assert.equal(
    patched.integrity,
    'sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==',
  );
  const original = baseLock.packages['node_modules/source-map-js'];
  for (const field of ['version', 'resolved', 'integrity']) patched[field] = original[field];
  assert.deepEqual(lock, baseLock, 'Unrelated dependency lockfile change');
}
const existingScripts = gitText('ls-tree', '-r', '--name-only', publicationBase, 'scripts')
  .split('\n')
  .filter(Boolean);
assert.equal(
  gitText('diff', '--name-only', publicationBase, '--', ...existingScripts),
  '',
  'Existing scripts changed',
);
const baseCodeTree = git(
  'ls-tree',
  '-r',
  publicationBase,
  '--',
  ...protectedRoots,
  'package.json',
  'package-lock.json',
  'tsconfig.json',
);
const codeTreeDigest = hash(baseCodeTree);
function walk(p: string): string[] {
  return readdirSync(p).flatMap((name) => {
    const path = join(p, name).replaceAll('\\', '/');
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const inventory = [
  ...walk('docs/architecture/adr'),
  ...walk('docs/architecture/add'),
  ...walk('docs/architecture/module-architecture'),
]
  .filter((p) => p.endsWith('.md'))
  .sort()
  .map((path) => {
    const text = read(path).replaceAll('\r\n', '\n');
    return {
      path,
      normalizedLfSha256: hash(text),
      reviewLevel: 'AUTOMATED_BOUNDARY_INVENTORY_NOT_INDEPENDENT_SEMANTIC_APPROVAL',
    };
  });
const retainedPrefixes = [
  'docs/architecture/adr/ADR-098-stage-12-1-quality-evaluation-contract.md',
  'docs/architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md',
].map((path) => {
  const old = git('show', `${publicationBase}:${path}`).toString('utf8').replaceAll('\r\n', '\n');
  assert(
    read(path).replaceAll('\r\n', '\n').startsWith(old),
    `Published original ADR text rewritten: ${path}`,
  );
  return { path, publishedBaseOriginalTextPreserved: true };
});
const source = JSON.parse(read(root + '/source-provenance.json')) as {
  copy: string;
  sha256: string;
};
assert.equal(hash(readFileSync(source.copy)), source.sha256, 'Original strategy copy changed');
const originalAuditPath = root + '/original-local-alignment-audit.json';
const originalReportPath = root + '/original-local-report.md';
const snapshot = JSON.parse(read(originalAuditPath)) as {
  baseCommit: string;
  productionSemanticDigest: string;
  protectedFiles: { path: string; sha256: string }[];
};
assert.equal(snapshot.baseCommit, '6be130125d211ac4da6d45a29fd1db101387a296');
const paused = JSON.parse(read(root + '/paused-drafts.json')) as {
  stash: string;
  originalFiles: { path: string; sha256: string }[];
  priorB2Stash: string;
};
let localPreservation: unknown = {
  state: 'ARCHIVED_LOCAL_SOURCE_EVIDENCE_NOT_CHECKED_IN_THIS_CHECKOUT',
  originalCommit,
  snapshotSha256: hash(readFileSync(originalAuditPath)),
  reportSha256: hash(readFileSync(originalReportPath)),
  stash: paused.stash,
};
const sourceArg = process.argv.indexOf('--source-worktree');
if (sourceArg >= 0) {
  const sourceWorktree = process.argv[sourceArg + 1];
  assert(sourceWorktree, 'Missing source worktree');
  const sourceGit = (...args: string[]) => execFileSync('git', args, { cwd: sourceWorktree });
  assert.equal(sourceGit('rev-parse', 'HEAD').toString('utf8').trim(), originalCommit);
  assert.equal(sourceGit('status', '--porcelain=v1').toString('utf8').trim(), '');
  for (const f of paused.originalFiles)
    assert.equal(hash(sourceGit('show', `${paused.stash}^3:${f.path}`)), f.sha256);
  assert(
    sourceGit('stash', 'list', '--format=%H')
      .toString('utf8')
      .split('\n')
      .includes(paused.priorB2Stash),
  );
  for (const f of snapshot.protectedFiles)
    assert.equal(hash(readFileSync(join(sourceWorktree, f.path))), f.sha256);
  assert.equal(
    hash(sourceGit('show', `${originalCommit}:${root}/alignment-audit.json`)),
    hash(readFileSync(originalAuditPath)),
  );
  assert.equal(
    hash(sourceGit('show', `${originalCommit}:${root}/report.md`)),
    hash(readFileSync(originalReportPath)),
  );
  localPreservation = {
    state: 'VERIFIED_AT_ORIGINAL_WORKTREE',
    originalCommit,
    pausedFileCount: paused.originalFiles.length,
    pausedBytesMatch: true,
    priorB2StashPreserved: true,
    frozenAndPolicyFilesMatchOriginalSnapshot: true,
  };
}
const registry = JSON.parse(read('docs/architecture/adr/adr-registry.json')) as {
  expectedRange: { end: number };
  ownerRules: { start: number; end: number }[];
};
assert.equal(registry.expectedRange.end, 173);
for (const id of [172, 173])
  assert.equal(registry.ownerRules.filter((r) => id >= r.start && id <= r.end).length, 1);
const result = {
  generator: 'node node_modules/tsx/dist/cli.mjs scripts/audit-development-strategy.ts',
  generatorRevision: 'PUBLICATION_MAIN_WITH_BOUNDED_SECURITY_PATCH_V2',
  generatorNormalizedLfSha256: hash(
    read('scripts/audit-development-strategy.ts').replaceAll('\r\n', '\n'),
  ),
  authority: 'DERIVED_PUBLICATION_SCOPE_INVENTORY_NOT_RUNTIME_OR_SEMANTIC_APPROVAL',
  publicationBase,
  sourceStrategyCommit: originalCommit,
  productionChanges: [],
  dependencyChanges,
  dependencyPatch:
    dependencyChanges.length > 0
      ? {
          package: 'source-map-js',
          from: '1.2.1',
          to: '1.2.2',
          advisory: 'GHSA-68fv-2mgg-jv7q',
          unrelatedManifestAndLockfileChanges: false,
        }
      : null,
  existingScriptsChanged: [],
  productionBaseCodeTreeSha256: codeTreeDigest,
  publishedMainRuntimePolicy: 'vp-deepseek-relation-v6-evidence-context',
  originalLocalSemanticDigest: {
    digest: snapshot.productionSemanticDigest,
    scope: 'LOCAL_VP_LINEAGE_ONLY_NOT_CURRENT_MAIN_RUNTIME',
  },
  inventoryCount: inventory.length,
  inventory,
  retainedPrefixes,
  wholeAdrsSuperseded: 0,
  sourceByteCopyVerified: source,
  localPreservation,
  providerCalls: 0,
  productionDataWrites: 0,
  goldB7Opened: false,
  vp06Started: false,
  merged: false,
};
writeFileSync(root + '/alignment-audit.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    inventory: inventory.length,
    publicationBase,
    productionChanges: [],
    dependencyChanges,
    codeTreeDigest,
    localPreservation,
    currentMainPolicy: result.publishedMainRuntimePolicy,
  }),
);
