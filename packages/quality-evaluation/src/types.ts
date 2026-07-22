export type LabelReviewStatus = 'CANDIDATE' | 'REVIEWED' | 'APPROVED' | 'RETIRED';
export type EvaluationLane = 'baseline' | 'gate';
export type RunMode = 'deterministic-recorded' | 'live-provider';
export type EvaluationKind = 'CLAIM_EXTRACTION' | 'SEARCH';

export type GoldenEvidence = {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly position: {
    readonly start: number;
    readonly end: number;
    readonly unit: 'unicode-code-point';
  };
  readonly selectors?: readonly {
    readonly type: string;
    readonly value: string;
  }[];
};

export type GoldenClaim = {
  readonly goldenClaimId: string;
  readonly claimText: string;
  readonly normalizedMeaning?: string;
  readonly evidence: GoldenEvidence;
  readonly expectedDisposition: 'EXTRACT';
  readonly semanticAliases?: readonly string[];
};

export type RelevanceJudgment = {
  readonly goldenClaimId: string;
  readonly relevance: 0 | 1 | 2;
  readonly rationale?: string;
};

export type GoldenSearchQuery = {
  readonly queryId: string;
  readonly queryText: string;
  readonly language: 'ko' | 'en' | 'ko-en-mixed';
  readonly queryType:
    | 'exact-keyword'
    | 'natural-language'
    | 'synonym'
    | 'notation-variation'
    | 'ko-inflection'
    | 'no-result';
  readonly kValues: readonly number[];
  readonly expectedNoResult: boolean;
  readonly judgments: readonly RelevanceJudgment[];
};

export type GoldenCorpusCase = {
  readonly caseId: string;
  readonly caseVersion: string;
  readonly title: string;
  readonly description: string;
  readonly language: 'ko' | 'en' | 'ko-en-mixed';
  readonly sourceFormat: 'plain-text' | 'markdown' | 'html-derived-text';
  readonly sourceContent: string;
  readonly sourceContentHash: string;
  readonly projectContext: {
    readonly projectKey: string;
    readonly accessScopes: readonly string[];
    readonly locale: string;
    readonly timezone: string;
  };
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly dataClassification: 'SYNTHETIC';
  readonly expectedClaims: readonly GoldenClaim[];
  readonly expectedNoClaimReason?: string;
  readonly queries: readonly GoldenSearchQuery[];
  readonly tags: readonly string[];
  readonly difficulty: 'basic' | 'intermediate' | 'adversarial';
  readonly riskCategory:
    | 'normal'
    | 'numeric'
    | 'temporal'
    | 'negation'
    | 'uncertainty'
    | 'duplicate'
    | 'no-claim'
    | 'evidence-gap';
  readonly labelAuthor: string;
  readonly labelReviewStatus: LabelReviewStatus;
  readonly labelReviewedAt: string;
  readonly labelRevision: number;
  readonly provenance: {
    readonly origin: 'SHOTGUN_SYNTHETIC';
    readonly license: string;
    readonly createdBy: string;
  };
  readonly notes?: string;
};

export type GoldenCorpusManifest = {
  readonly contractVersion: '1.0.0';
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly labelSetRevision: number;
  readonly title: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly digestAlgorithm: 'sha256';
  readonly corpusDigest: string;
  readonly caseIds: readonly string[];
  readonly licenseSummary: string;
  readonly dataPolicy: {
    readonly classification: 'SYNTHETIC';
    readonly containsProductionData: false;
    readonly liveProviderEligible: boolean;
  };
};

export type GoldenCorpus = {
  readonly manifest: GoldenCorpusManifest;
  readonly cases: readonly GoldenCorpusCase[];
};

export type PredictedClaim = {
  readonly predictionId: string;
  readonly claimText: string;
  readonly evidence: GoldenEvidence;
};

export type RecordedClaimPredictionSet = {
  readonly contractVersion: '1.0.0';
  readonly runMode: 'deterministic-recorded';
  readonly providerName: 'recorded-fixture';
  readonly providerAdapterVersion: string;
  readonly providerModel: string;
  readonly providerModelVersion: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly outputDigest: string;
  readonly cases: readonly {
    readonly caseId: string;
    readonly predictions: readonly PredictedClaim[];
  }[];
};

export type LiveProviderDescriptor = {
  readonly runMode: 'live-provider';
  readonly providerName: string;
  readonly providerAdapterVersion: string;
  readonly providerModel: string;
  readonly providerModelVersion: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
};

export type MetricValue = {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
};

export type ResultGroup = {
  readonly counts: Readonly<Record<string, number>>;
  readonly metrics: Readonly<Record<string, MetricValue>>;
};

export type EvaluationUnitResult = ResultGroup & {
  readonly evaluationUnitId: string;
  readonly passed: boolean;
  readonly failureCodes: readonly string[];
};

export type SliceResult = ResultGroup & {
  readonly slice: string;
  readonly evaluationUnitIds: readonly string[];
};

export type FailureDetail = {
  readonly evaluationUnitId: string;
  readonly code: string;
  readonly detailDigest: string;
};

export type QualityEvaluationRun = {
  readonly runId: string;
  readonly runMode: RunMode;
  readonly evaluationKind: EvaluationKind;
  readonly corpusId: string;
  readonly corpusVersion: string;
  readonly corpusDigest: string;
  readonly labelSetRevision: number;
  readonly evaluationContractVersion: '1.0.0';
  readonly applicationCommitSha: string;
  readonly moduleVersions: Readonly<Record<string, string>>;
  readonly adapterVersions: Readonly<Record<string, string>>;
  readonly projectorVersions: Readonly<Record<string, string>>;
  readonly databaseVersion: string;
  readonly databaseExtensionVersions: Readonly<Record<string, string>>;
  readonly databaseSearchConfiguration: Readonly<Record<string, string>>;
  readonly providerName: string;
  readonly providerAdapterVersion: string;
  readonly providerModel: string;
  readonly providerModelVersion: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
  readonly randomSeedOrDeterministicSettings: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly metricImplementationVersion: string;
  readonly caseResults: readonly EvaluationUnitResult[];
  readonly aggregateResults: ResultGroup;
  readonly sliceResults: readonly SliceResult[];
  readonly failureDetails: readonly FailureDetail[];
  readonly environmentSummary: Readonly<Record<string, string>>;
  readonly runDigest: string;
};

export type SearchResultObservation = {
  readonly goldenClaimId: string;
  readonly citationCorrect: boolean;
};

export type SearchQueryObservation = {
  readonly queryId: string;
  readonly results: readonly SearchResultObservation[];
};

export type StaleSearchObservation = {
  readonly trialId: string;
  readonly readinessStatus: 'STALE' | 'DEGRADED';
  readonly resultCount: number;
};
