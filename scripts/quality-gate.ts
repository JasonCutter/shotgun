import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { stableJson } from '../packages/contracts/src/index.js';
import {
  assertQualityGate,
  evaluateQualityGate,
  type QualityGatePolicy,
  type QualityGateRunSummary,
  validateCorpus,
  validateQualityGatePolicy,
} from '../packages/quality-evaluation/src/index.js';
import { loadQualityCorpus } from '../tests/helpers/quality-evaluation.js';

const policyPath = path.resolve(
  'packages',
  'quality-evaluation',
  'policies',
  'quality-gate.v1.json',
);
const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');

const runBaseline = (script: string): QualityGateRunSummary => {
  const output = execFileSync(process.execPath, [tsxCli, path.resolve('scripts', script)], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const line = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error(`Quality baseline '${script}' returned no summary.`);
  return JSON.parse(line) as QualityGateRunSummary;
};

try {
  const policy = JSON.parse(await readFile(policyPath, 'utf8')) as QualityGatePolicy;
  validateQualityGatePolicy(policy);
  const corpus = await loadQualityCorpus();
  validateCorpus(corpus, 'gate');
  if (
    corpus.manifest.corpusId !== policy.corpusId ||
    corpus.manifest.corpusVersion !== policy.corpusVersion ||
    corpus.manifest.corpusDigest !== policy.corpusDigest ||
    corpus.manifest.labelSetRevision !== policy.labelSetRevision
  ) {
    throw new Error('Approved Corpus identity does not match the Quality Gate Policy.');
  }

  const claim = runBaseline('quality-claim-baseline.ts');
  const search = runBaseline('quality-search-baseline.ts');
  const evaluation = evaluateQualityGate(policy, claim, search);
  assertQualityGate(evaluation);
  console.log(
    stableJson({
      status: 'PASS',
      policyVersion: evaluation.policyVersion,
      policyDigest: evaluation.policyDigest,
      corpusDigest: evaluation.corpusDigest,
      labelSetRevision: evaluation.labelSetRevision,
      claimRunDigest: evaluation.claimRunDigest,
      searchRunDigest: evaluation.searchRunDigest,
      comparisons: evaluation.comparisons,
      diagnostics: evaluation.diagnostics,
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(stableJson({ status: 'FAIL', error: message }));
  process.exitCode = 1;
}
