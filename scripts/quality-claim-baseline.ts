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
import { loadQualityCorpus } from '../tests/helpers/quality-evaluation.js';
import { executeStage4ClaimBaseline } from '../tests/helpers/quality-stage4.js';

const outputFile = path.resolve(
  'docs',
  'engineering',
  'baselines',
  'claim-extraction-baseline.v1.json',
);

const applicationCommitSha = (): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const corpus = await loadQualityCorpus();
validateCorpus(corpus, 'baseline');
const { predictions, trace } = await executeStage4ClaimBaseline(corpus);
validateRecordedPredictionSet(corpus, predictions);
const results = evaluateClaimPredictions(corpus, predictions);
const run = createEvaluationRun(corpus.manifest, results, {
  runId: `claim:${corpus.manifest.corpusDigest}`,
  runMode: 'deterministic-recorded',
  evaluationKind: 'CLAIM_EXTRACTION',
  applicationCommitSha: applicationCommitSha(),
  startedAt: corpus.manifest.updatedAt,
  completedAt: corpus.manifest.updatedAt,
  moduleVersions: {
    intake: '1.0.0',
    'original-asset': '1.0.0',
    transformation: '1.0.0',
    evidence: '1.0.0',
    'ai-provider': '1.0.0',
    'candidate-generation': '1.0.0',
    validation: '1.0.0',
  },
  adapterVersions: {
    'fake-ai-provider': predictions.providerAdapterVersion,
    'lucas-augmented-plain-text': '1.0.0',
    'stage2-in-memory': '1.0.0',
    'stage3-in-memory': '1.0.0',
    'stage4-in-memory': '1.0.0',
  },
  provider: predictions,
  deterministicSettings: `stage4-command-handler;fake-direct-copy;normalized-runtime-identifiers;output:${predictions.outputDigest}`,
  environmentSummary: {
    node: process.version,
    platform: process.platform,
    source: 'synthetic-reviewed-labels',
    thresholdPolicy: 'none-baseline-only',
    executionPath:
      'SubmitIntake->EvidenceIndexed->GenerateStructured->ClaimCandidate->Validation->Metric',
    providerOutput: 'generated-from-production-stage4-prompt-by-deterministic-fake-adapter',
    commandCount: String(trace.commandCount),
    providerCallCount: String(trace.providerCallCount),
    candidateCount: String(trace.candidateCount),
    readyCandidateCount: String(trace.readyCandidateCount),
    rejectedCandidateCount: String(trace.rejectedCandidateCount),
    validationCount: String(trace.validationCount),
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
