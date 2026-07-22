import { sha256Text, stableJson } from '../../contracts/src/index.js';

import type {
  GoldenCorpus,
  GoldenCorpusCase,
  GoldenCorpusManifest,
  QualityEvaluationRun,
  RecordedClaimPredictionSet,
} from './types.js';

const sortedCases = (cases: readonly GoldenCorpusCase[]): readonly GoldenCorpusCase[] =>
  [...cases].sort((left, right) => left.caseId.localeCompare(right.caseId));

export const computeCorpusDigest = (
  manifest: GoldenCorpusManifest,
  cases: readonly GoldenCorpusCase[],
): string => {
  const { corpusDigest: excludedCorpusDigest, ...digestibleManifest } = manifest;
  void excludedCorpusDigest;
  return sha256Text(
    stableJson({
      serializationVersion: manifest.contractVersion,
      manifest: digestibleManifest,
      cases: sortedCases(cases),
    }),
  );
};

export const computeRecordedOutputDigest = (predictionSet: RecordedClaimPredictionSet): string => {
  const { outputDigest: excludedOutputDigest, ...digestible } = predictionSet;
  void excludedOutputDigest;
  return sha256Text(stableJson(digestible));
};

export const computeRunDigest = (run: QualityEvaluationRun): string => {
  const { runDigest: excludedRunDigest, ...digestible } = run;
  void excludedRunDigest;
  return sha256Text(stableJson(digestible));
};

export const withCorpusDigest = (corpus: GoldenCorpus): GoldenCorpus => ({
  ...corpus,
  manifest: {
    ...corpus.manifest,
    corpusDigest: computeCorpusDigest(corpus.manifest, corpus.cases),
  },
});

export const withRunDigest = (
  run: Omit<QualityEvaluationRun, 'runDigest'>,
): QualityEvaluationRun => {
  const pending = { ...run, runDigest: `sha256:${'0'.repeat(64)}` };
  return { ...pending, runDigest: computeRunDigest(pending) };
};
