import Ajv, { type ValidateFunction } from 'ajv';

import { sha256Text, stableJson, unicodeSlice } from '../../contracts/src/index.js';
import caseSchema from '../schemas/golden-corpus-case.v1.schema.json';
import manifestSchema from '../schemas/golden-corpus-manifest.v1.schema.json';
import runSchema from '../schemas/quality-evaluation-run.v1.schema.json';
import { computeCorpusDigest, computeRecordedOutputDigest, computeRunDigest } from './digest.js';
import type {
  EvaluationLane,
  GoldenCorpus,
  GoldenCorpusCase,
  GoldenCorpusManifest,
  LiveProviderDescriptor,
  QualityEvaluationRun,
  RecordedClaimPredictionSet,
  RunMode,
} from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('date-time', (value: string) => !Number.isNaN(Date.parse(value)));

const manifestValidator = ajv.compile(manifestSchema);
const caseValidator = ajv.compile(caseSchema);
const runValidator = ajv.compile(runSchema);

const assertSchema = (validator: ValidateFunction, payload: unknown, label: string): void => {
  if (!validator(payload)) {
    throw new Error(`${label} schema validation failed: ${ajv.errorsText(validator.errors)}`);
  }
};

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const assertSameSet = (actual: readonly string[], expected: readonly string[], label: string) => {
  if (stableJson(sortedUnique(actual)) !== stableJson(sortedUnique(expected))) {
    throw new Error(`${label} must contain the complete closed set exactly once.`);
  }
};

const assertCaseSemantics = (entry: GoldenCorpusCase): void => {
  if (entry.sourceContentHash !== sha256Text(entry.sourceContent)) {
    throw new Error(`Case '${entry.caseId}' sourceContentHash does not match sourceContent.`);
  }
  for (const claim of entry.expectedClaims) {
    const { start, end } = claim.evidence.position;
    if (start >= end || unicodeSlice(entry.sourceContent, start, end) !== claim.evidence.exact) {
      throw new Error(
        `Claim '${claim.goldenClaimId}' Evidence position does not match exact text.`,
      );
    }
    if (!claim.evidence.exact.includes(claim.claimText.trim())) {
      throw new Error(`Claim '${claim.goldenClaimId}' is not directly contained in its Evidence.`);
    }
  }
};

export const validateCorpus = (corpus: GoldenCorpus, lane: EvaluationLane): void => {
  assertSchema(manifestValidator, corpus.manifest, 'Golden Corpus Manifest');
  corpus.cases.forEach((entry) => assertSchema(caseValidator, entry, `Case '${entry.caseId}'`));

  const caseIds = corpus.cases.map((entry) => entry.caseId);
  assertSameSet(caseIds, corpus.manifest.caseIds, 'Manifest caseIds');
  if (caseIds.length !== new Set(caseIds).size) throw new Error('Duplicate caseId is not allowed.');

  const allowedStatuses = lane === 'gate' ? ['APPROVED'] : ['REVIEWED', 'APPROVED'];
  for (const entry of corpus.cases) {
    if (!allowedStatuses.includes(entry.labelReviewStatus)) {
      throw new Error(
        `Case '${entry.caseId}' label status '${entry.labelReviewStatus}' is not allowed in the ${lane} lane.`,
      );
    }
    assertCaseSemantics(entry);
  }

  const claimIds = corpus.cases.flatMap((entry) =>
    entry.expectedClaims.map((claim) => claim.goldenClaimId),
  );
  if (claimIds.length !== new Set(claimIds).size) {
    throw new Error('Duplicate goldenClaimId is not allowed across the corpus.');
  }
  const queries = corpus.cases.flatMap((entry) => entry.queries);
  const queryIds = queries.map((query) => query.queryId);
  if (queryIds.length !== new Set(queryIds).size) {
    throw new Error('Duplicate queryId is not allowed across the corpus.');
  }
  for (const query of queries) {
    assertSameSet(
      query.judgments.map((judgment) => judgment.goldenClaimId),
      claimIds,
      `Query '${query.queryId}' judgments`,
    );
    if (query.expectedNoResult && query.judgments.some((judgment) => judgment.relevance !== 0)) {
      throw new Error(`No-result query '${query.queryId}' cannot have a relevant judgment.`);
    }
  }

  const observedDigest = computeCorpusDigest(corpus.manifest, corpus.cases);
  if (corpus.manifest.corpusDigest !== observedDigest) {
    throw new Error(`Corpus digest mismatch: expected '${observedDigest}'.`);
  }
};

export const validateRecordedPredictionSet = (
  corpus: GoldenCorpus,
  predictionSet: RecordedClaimPredictionSet,
): void => {
  assertProviderBoundary('deterministic-recorded', predictionSet);
  assertSameSet(
    predictionSet.cases.map((entry) => entry.caseId),
    corpus.manifest.caseIds,
    'Recorded prediction caseIds',
  );
  const predictionIds = predictionSet.cases.flatMap((entry) =>
    entry.predictions.map((prediction) => prediction.predictionId),
  );
  if (predictionIds.length !== new Set(predictionIds).size) {
    throw new Error('Duplicate predictionId is not allowed.');
  }
  const observedDigest = computeRecordedOutputDigest(predictionSet);
  if (predictionSet.outputDigest !== observedDigest) {
    throw new Error(`Recorded output digest mismatch: expected '${observedDigest}'.`);
  }
};

export const validateEvaluationRun = (run: QualityEvaluationRun): void => {
  assertSchema(runValidator, run, 'Quality Evaluation Run');
  const observedDigest = computeRunDigest(run);
  if (run.runDigest !== observedDigest) {
    throw new Error(`Run digest mismatch: expected '${observedDigest}'.`);
  }
};

export const assertProviderBoundary = (
  runMode: RunMode,
  provider: RecordedClaimPredictionSet | LiveProviderDescriptor,
): void => {
  if (runMode !== provider.runMode) {
    throw new Error(`Provider mode '${provider.runMode}' cannot execute in '${runMode}' lane.`);
  }
  if (runMode === 'deterministic-recorded' && provider.providerName !== 'recorded-fixture') {
    throw new Error('The deterministic-recorded lane accepts only immutable recorded fixtures.');
  }
};

export const validateManifestSchema = (manifest: GoldenCorpusManifest): void =>
  assertSchema(manifestValidator, manifest, 'Golden Corpus Manifest');
