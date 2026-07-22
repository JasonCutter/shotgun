import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createEvaluationRun,
  evaluateClaimPredictions,
  validateCorpus,
  validateEvaluationRun,
  validateRecordedPredictionSet,
} from '../packages/quality-evaluation/src/index.js';
import { stableJson } from '../packages/contracts/src/index.js';
import {
  loadQualityCorpus,
  loadRecordedClaimPredictions,
} from '../tests/helpers/quality-evaluation.js';

const outputFile = path.resolve(
  'docs',
  'engineering',
  'baselines',
  'claim-extraction-baseline.v1.json',
);

const applicationCommitSha = (): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const corpus = await loadQualityCorpus();
const predictions = await loadRecordedClaimPredictions();
validateCorpus(corpus, 'baseline');
validateRecordedPredictionSet(corpus, predictions);
const results = evaluateClaimPredictions(corpus, predictions);
const run = createEvaluationRun(corpus.manifest, results, {
  runId: `claim:${corpus.manifest.corpusDigest}`,
  runMode: 'deterministic-recorded',
  evaluationKind: 'CLAIM_EXTRACTION',
  applicationCommitSha: applicationCommitSha(),
  startedAt: corpus.manifest.updatedAt,
  completedAt: corpus.manifest.updatedAt,
  moduleVersions: { 'candidate-generation': '1.0.0' },
  adapterVersions: { 'recorded-fixture': predictions.providerAdapterVersion },
  provider: predictions,
  deterministicSettings: `recorded-output:${predictions.outputDigest};stable-id-order`,
  environmentSummary: {
    node: process.version,
    platform: process.platform,
    source: 'synthetic-reviewed-labels',
    thresholdPolicy: 'none-baseline-only',
  },
});
validateEvaluationRun(run);

if (process.argv.includes('--write')) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
}

console.log(
  stableJson({
    runId: run.runId,
    corpusDigest: run.corpusDigest,
    aggregateResults: run.aggregateResults,
    failedCases: run.caseResults
      .filter((entry) => !entry.passed)
      .map((entry) => entry.evaluationUnitId),
    runDigest: run.runDigest,
    ...(process.argv.includes('--write') ? { outputFile } : {}),
  }),
);
