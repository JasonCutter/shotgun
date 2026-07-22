import { sha256Text, stableJson, unicodeSlice } from '../../contracts/src/index.js';

import type {
  EvaluationUnitResult,
  GoldenCorpus,
  GoldenCorpusCase,
  GoldenEvidence,
  GoldenSearchQuery,
  MetricValue,
  PredictedClaim,
  RecordedClaimPredictionSet,
  ResultGroup,
  SearchQueryObservation,
  SliceResult,
  StaleSearchObservation,
} from './types.js';

const rounded = (value: number): number => Number(value.toFixed(12));

export const ratio = (numerator: number, denominator: number): MetricValue => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : rounded(numerator / denominator),
});

const selectorFingerprint = (evidence: GoldenEvidence): string =>
  stableJson(
    [...(evidence.selectors ?? [])].sort((left, right) =>
      `${left.type}:${left.value}`.localeCompare(`${right.type}:${right.value}`),
    ),
  );

const evidenceFingerprint = (evidence: GoldenEvidence): string =>
  stableJson({
    exact: evidence.exact,
    prefix: evidence.prefix,
    suffix: evidence.suffix,
    position: evidence.position,
    selectors: selectorFingerprint(evidence),
  });

const claimFingerprint = (claim: { claimText: string; evidence: GoldenEvidence }): string =>
  stableJson({ claimText: claim.claimText.trim(), evidence: evidenceFingerprint(claim.evidence) });

const textFingerprint = (claim: { claimText: string }): string => claim.claimText.trim();

type ClaimCounts = {
  readonly expected: number;
  readonly predicted: number;
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly unsupported: number;
  readonly duplicates: number;
  readonly textMatched: number;
  readonly evidenceExact: number;
  readonly noClaimCases: number;
  readonly correctNoClaimCases: number;
  readonly exactCases: number;
  readonly cases: number;
};

const zeroClaimCounts = (): ClaimCounts => ({
  expected: 0,
  predicted: 0,
  tp: 0,
  fp: 0,
  fn: 0,
  unsupported: 0,
  duplicates: 0,
  textMatched: 0,
  evidenceExact: 0,
  noClaimCases: 0,
  correctNoClaimCases: 0,
  exactCases: 0,
  cases: 0,
});

const addClaimCounts = (left: ClaimCounts, right: ClaimCounts): ClaimCounts =>
  Object.fromEntries(
    Object.keys(left).map((key) => [
      key,
      left[key as keyof ClaimCounts] + right[key as keyof ClaimCounts],
    ]),
  ) as ClaimCounts;

const groupCounts = <T>(
  items: readonly T[],
  fingerprint: (item: T) => string,
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = fingerprint(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

const intersectionCount = <TLeft, TRight>(
  left: readonly TLeft[],
  right: readonly TRight[],
  leftFingerprint: (item: TLeft) => string,
  rightFingerprint: (item: TRight) => string,
): number => {
  const leftGroups = groupCounts(left, leftFingerprint);
  const rightGroups = groupCounts(right, rightFingerprint);
  return [...leftGroups.entries()].reduce(
    (total, [key, values]) => total + Math.min(values.length, rightGroups.get(key)?.length ?? 0),
    0,
  );
};

const supportedPrediction = (entry: GoldenCorpusCase, prediction: PredictedClaim): boolean => {
  const { start, end } = prediction.evidence.position;
  return (
    start < end &&
    unicodeSlice(entry.sourceContent, start, end) === prediction.evidence.exact &&
    prediction.evidence.exact.includes(prediction.claimText.trim())
  );
};

const claimCountsForCase = (
  entry: GoldenCorpusCase,
  predictions: readonly PredictedClaim[],
): ClaimCounts => {
  const tp = intersectionCount(
    entry.expectedClaims,
    predictions,
    claimFingerprint,
    claimFingerprint,
  );
  const textMatched = intersectionCount(
    entry.expectedClaims,
    predictions,
    textFingerprint,
    textFingerprint,
  );
  const predictedGroups = groupCounts(predictions, claimFingerprint);
  const duplicates = [...predictedGroups.values()].reduce(
    (total, values) => total + Math.max(0, values.length - 1),
    0,
  );
  const unsupported = predictions.filter(
    (prediction) => !supportedPrediction(entry, prediction),
  ).length;
  const fp = predictions.length - tp;
  const fn = entry.expectedClaims.length - tp;
  const noClaimCase = entry.expectedClaims.length === 0;
  return {
    expected: entry.expectedClaims.length,
    predicted: predictions.length,
    tp,
    fp,
    fn,
    unsupported,
    duplicates,
    textMatched,
    evidenceExact: tp,
    noClaimCases: noClaimCase ? 1 : 0,
    correctNoClaimCases: noClaimCase && predictions.length === 0 ? 1 : 0,
    exactCases: tp === entry.expectedClaims.length && fp === 0 && fn === 0 ? 1 : 0,
    cases: 1,
  };
};

const claimResultGroup = (counts: ClaimCounts): ResultGroup => {
  const precision = ratio(counts.tp, counts.tp + counts.fp);
  const recall = ratio(counts.tp, counts.tp + counts.fn);
  const f1 = ratio(2 * counts.tp, 2 * counts.tp + counts.fp + counts.fn);
  return {
    counts,
    metrics: {
      precision,
      recall,
      f1,
      exactClaimMatch: ratio(counts.exactCases, counts.cases),
      unsupportedClaimRate: ratio(counts.unsupported, counts.predicted),
      duplicateClaimRate: ratio(counts.duplicates, counts.predicted),
      evidenceExactMatch: ratio(counts.evidenceExact, counts.textMatched),
      evidenceCoverage: ratio(counts.evidenceExact, counts.expected),
      noClaimAccuracy: ratio(counts.correctNoClaimCases, counts.noClaimCases),
    },
  };
};

const claimFailureCodes = (counts: ClaimCounts): readonly string[] =>
  [
    ...(counts.fn > 0 ? ['CLAIM_MISSED'] : []),
    ...(counts.fp > 0 ? ['EXTRACTION_FALSE_POSITIVE'] : []),
    ...(counts.unsupported > 0 ? ['UNSUPPORTED_CLAIM'] : []),
    ...(counts.duplicates > 0 ? ['DUPLICATE_CLAIM'] : []),
    ...(counts.textMatched > counts.evidenceExact ? ['EVIDENCE_MISMATCH'] : []),
  ].sort();

export const evaluateClaimPredictions = (
  corpus: GoldenCorpus,
  predictionSet: RecordedClaimPredictionSet,
): {
  readonly caseResults: readonly EvaluationUnitResult[];
  readonly aggregateResults: ResultGroup;
  readonly sliceResults: readonly SliceResult[];
} => {
  const predictionsByCase = new Map(
    predictionSet.cases.map((entry) => [entry.caseId, entry.predictions] as const),
  );
  const countsByCase = new Map(
    corpus.cases.map((entry) => [
      entry.caseId,
      claimCountsForCase(entry, predictionsByCase.get(entry.caseId) ?? []),
    ]),
  );
  const caseResults = [...countsByCase.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, counts]): EvaluationUnitResult => ({
      evaluationUnitId: caseId,
      passed: counts.exactCases === 1,
      ...claimResultGroup(counts),
      failureCodes: claimFailureCodes(counts),
    }));
  const aggregateCounts = [...countsByCase.values()].reduce(addClaimCounts, zeroClaimCounts());

  const sliceMap = new Map<string, Set<string>>();
  for (const entry of corpus.cases) {
    const slices = [
      `language:${entry.language}`,
      `format:${entry.sourceFormat}`,
      `difficulty:${entry.difficulty}`,
      `risk:${entry.riskCategory}`,
      ...entry.tags.map((tag) => `tag:${tag}`),
    ];
    for (const slice of slices) {
      const ids = sliceMap.get(slice) ?? new Set<string>();
      ids.add(entry.caseId);
      sliceMap.set(slice, ids);
    }
  }
  const sliceResults = [...sliceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slice, ids]): SliceResult => {
      const counts = [...ids].reduce(
        (total, id) => addClaimCounts(total, countsByCase.get(id) ?? zeroClaimCounts()),
        zeroClaimCounts(),
      );
      return {
        slice,
        evaluationUnitIds: [...ids].sort(),
        ...claimResultGroup(counts),
      };
    });
  return { caseResults, aggregateResults: claimResultGroup(aggregateCounts), sliceResults };
};

const dcg = (grades: readonly number[]): number =>
  grades.reduce((total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2), 0);

type SearchQueryMetrics = {
  readonly result: EvaluationUnitResult;
  readonly relevant: number;
  readonly retrieved: number;
  readonly relevantRetrievedByK: Readonly<Record<number, number>>;
  readonly firstRelevantRank: number;
  readonly citations: number;
  readonly correctCitations: number;
};

const evaluateSearchQuery = (
  query: GoldenSearchQuery,
  observation: SearchQueryObservation,
): SearchQueryMetrics => {
  const judgment = new Map(query.judgments.map((item) => [item.goldenClaimId, item.relevance]));
  const relevant = query.judgments.filter((item) => item.relevance >= 1).length;
  const maxK = Math.max(...query.kValues);
  const results = observation.results.slice(0, maxK);
  const relevantRanks = results
    .map((item, index) => ({ rank: index + 1, relevance: judgment.get(item.goldenClaimId) ?? 0 }))
    .filter((item) => item.relevance >= 1);
  const firstRelevantRank = relevantRanks[0]?.rank ?? 0;
  const metrics: Record<string, MetricValue> = {};
  const relevantRetrievedByK: Record<number, number> = {};
  for (const k of [...query.kValues].sort((left, right) => left - right)) {
    const top = results.slice(0, k);
    const relevantRetrieved = top.filter(
      (item) => (judgment.get(item.goldenClaimId) ?? 0) >= 1,
    ).length;
    relevantRetrievedByK[k] = relevantRetrieved;
    metrics[`precisionAt${k}`] = ratio(relevantRetrieved, k);
    metrics[`recallAt${k}`] = ratio(relevantRetrieved, relevant);
    metrics[`hitRateAt${k}`] = ratio(relevantRetrieved > 0 ? 1 : 0, relevant > 0 ? 1 : 0);
    const observedGrades = top.map((item) => judgment.get(item.goldenClaimId) ?? 0);
    const idealGrades = query.judgments
      .map((item) => item.relevance)
      .sort((left, right) => right - left)
      .slice(0, k);
    const ideal = dcg(idealGrades);
    metrics[`ndcgAt${k}`] = ratio(dcg(observedGrades), ideal);
  }
  metrics.reciprocalRank =
    firstRelevantRank > 0 ? ratio(1, firstRelevantRank) : ratio(0, relevant > 0 ? 1 : 0);
  metrics.noResultAccuracy = ratio(
    query.expectedNoResult && results.length === 0 ? 1 : 0,
    query.expectedNoResult ? 1 : 0,
  );
  metrics.citationCorrectness = ratio(
    results.filter((item) => item.citationCorrect).length,
    results.length,
  );
  const failureCodes = [
    ...(relevant > 0 && firstRelevantRank === 0 ? ['RELEVANT_CLAIM_NOT_RETRIEVED'] : []),
    ...(query.expectedNoResult && results.length > 0 ? ['UNEXPECTED_SEARCH_RESULT'] : []),
    ...(results.some((item) => !item.citationCorrect) ? ['CITATION_BINDING_MISMATCH'] : []),
  ].sort();
  return {
    result: {
      evaluationUnitId: query.queryId,
      passed: failureCodes.length === 0,
      counts: {
        relevant,
        retrieved: results.length,
        firstRelevantRank,
        citations: results.length,
        correctCitations: results.filter((item) => item.citationCorrect).length,
      },
      metrics,
      failureCodes,
    },
    relevant,
    retrieved: results.length,
    relevantRetrievedByK,
    firstRelevantRank,
    citations: results.length,
    correctCitations: results.filter((item) => item.citationCorrect).length,
  };
};

export const evaluateSearchObservations = (
  corpus: GoldenCorpus,
  observations: readonly SearchQueryObservation[],
  staleObservations: readonly StaleSearchObservation[],
): {
  readonly caseResults: readonly EvaluationUnitResult[];
  readonly aggregateResults: ResultGroup;
  readonly sliceResults: readonly SliceResult[];
} => {
  const queries = corpus.cases.flatMap((entry) => entry.queries);
  const observationById = new Map(observations.map((entry) => [entry.queryId, entry]));
  const evaluated = queries
    .map((query) => {
      const observation = observationById.get(query.queryId);
      if (!observation) throw new Error(`Missing search observation for '${query.queryId}'.`);
      return { query, metrics: evaluateSearchQuery(query, observation) };
    })
    .sort((left, right) => left.query.queryId.localeCompare(right.query.queryId));
  const kValues = sortedNumbers(queries.flatMap((query) => query.kValues));
  const aggregateMetrics: Record<string, MetricValue> = {};
  for (const k of kValues) {
    const eligible = evaluated.filter((entry) => entry.metrics.relevant > 0);
    aggregateMetrics[`precisionAt${k}`] = meanMetric(
      eligible.map((entry) => entry.metrics.result.metrics[`precisionAt${k}`]),
    );
    aggregateMetrics[`recallAt${k}`] = meanMetric(
      eligible.map((entry) => entry.metrics.result.metrics[`recallAt${k}`]),
    );
    aggregateMetrics[`hitRateAt${k}`] = meanMetric(
      eligible.map((entry) => entry.metrics.result.metrics[`hitRateAt${k}`]),
    );
    aggregateMetrics[`ndcgAt${k}`] = meanMetric(
      eligible.map((entry) => entry.metrics.result.metrics[`ndcgAt${k}`]),
    );
  }
  const relevantQueries = evaluated.filter((entry) => entry.metrics.relevant > 0);
  aggregateMetrics.mrr = meanMetric(
    relevantQueries.map((entry) => entry.metrics.result.metrics.reciprocalRank),
  );
  aggregateMetrics.noResultAccuracy = meanMetric(
    evaluated
      .filter((entry) => entry.query.expectedNoResult)
      .map((entry) => entry.metrics.result.metrics.noResultAccuracy),
  );
  const citationCount = evaluated.reduce((total, entry) => total + entry.metrics.citations, 0);
  const correctCitationCount = evaluated.reduce(
    (total, entry) => total + entry.metrics.correctCitations,
    0,
  );
  aggregateMetrics.citationCorrectness = ratio(correctCitationCount, citationCount);
  const rejectedStale = staleObservations.filter(
    (entry) =>
      (entry.readinessStatus === 'STALE' || entry.readinessStatus === 'DEGRADED') &&
      entry.resultCount === 0,
  ).length;
  aggregateMetrics.staleResultRejectionRate = ratio(rejectedStale, staleObservations.length);

  const aggregateResults: ResultGroup = {
    counts: {
      queries: evaluated.length,
      relevantQueries: relevantQueries.length,
      noResultQueries: evaluated.filter((entry) => entry.query.expectedNoResult).length,
      retrieved: evaluated.reduce((total, entry) => total + entry.metrics.retrieved, 0),
      citations: citationCount,
      correctCitations: correctCitationCount,
      staleTrials: staleObservations.length,
      rejectedStaleTrials: rejectedStale,
    },
    metrics: aggregateMetrics,
  };

  const sliceGroups = new Map<string, typeof evaluated>();
  for (const item of evaluated) {
    for (const slice of [`language:${item.query.language}`, `query-type:${item.query.queryType}`]) {
      sliceGroups.set(slice, [...(sliceGroups.get(slice) ?? []), item]);
    }
  }
  const sliceResults = [...sliceGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slice, entries]): SliceResult => ({
      slice,
      evaluationUnitIds: entries.map((entry) => entry.query.queryId).sort(),
      counts: {
        queries: entries.length,
        retrieved: entries.reduce((total, entry) => total + entry.metrics.retrieved, 0),
      },
      metrics: {
        mrr: meanMetric(entries.map((entry) => entry.metrics.result.metrics.reciprocalRank)),
        citationCorrectness: ratio(
          entries.reduce((total, entry) => total + entry.metrics.correctCitations, 0),
          entries.reduce((total, entry) => total + entry.metrics.citations, 0),
        ),
      },
    }));
  return {
    caseResults: evaluated.map((entry) => entry.metrics.result),
    aggregateResults,
    sliceResults,
  };
};

const sortedNumbers = (values: readonly number[]): readonly number[] =>
  [...new Set(values)].sort((left, right) => left - right);

const meanMetric = (values: readonly (MetricValue | undefined)[]): MetricValue => {
  const available = values.flatMap((value) =>
    value?.value === null || value === undefined ? [] : [value.value],
  );
  return ratio(
    available.reduce((total, value) => total + value, 0),
    available.length,
  );
};

export const failureDetailsFor = (
  caseResults: readonly EvaluationUnitResult[],
): readonly { evaluationUnitId: string; code: string; detailDigest: string }[] =>
  caseResults.flatMap((result) =>
    result.failureCodes.map((code) => ({
      evaluationUnitId: result.evaluationUnitId,
      code,
      detailDigest: sha256Text(stableJson({ evaluationUnitId: result.evaluationUnitId, code })),
    })),
  );
