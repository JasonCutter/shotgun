import { withRunDigest } from './digest.js';
import { failureDetailsFor } from './metrics.js';
import type {
  EvaluationKind,
  GoldenCorpusManifest,
  QualityEvaluationRun,
  ResultGroup,
  RunMode,
  SliceResult,
  EvaluationUnitResult,
} from './types.js';

export type RunMetadata = {
  readonly runId: string;
  readonly runMode: RunMode;
  readonly evaluationKind: EvaluationKind;
  readonly applicationCommitSha: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly moduleVersions?: Readonly<Record<string, string>>;
  readonly adapterVersions?: Readonly<Record<string, string>>;
  readonly projectorVersions?: Readonly<Record<string, string>>;
  readonly databaseVersion?: string;
  readonly databaseExtensionVersions?: Readonly<Record<string, string>>;
  readonly databaseSearchConfiguration?: Readonly<Record<string, string>>;
  readonly provider: {
    readonly providerName: string;
    readonly providerAdapterVersion: string;
    readonly providerModel: string;
    readonly providerModelVersion: string;
    readonly promptVersion: string;
    readonly policyVersion: string;
  };
  readonly deterministicSettings: string;
  readonly environmentSummary: Readonly<Record<string, string>>;
};

export const createEvaluationRun = (
  manifest: GoldenCorpusManifest,
  results: {
    readonly caseResults: readonly EvaluationUnitResult[];
    readonly aggregateResults: ResultGroup;
    readonly sliceResults: readonly SliceResult[];
  },
  metadata: RunMetadata,
): QualityEvaluationRun =>
  withRunDigest({
    runId: metadata.runId,
    runMode: metadata.runMode,
    evaluationKind: metadata.evaluationKind,
    corpusId: manifest.corpusId,
    corpusVersion: manifest.corpusVersion,
    corpusDigest: manifest.corpusDigest,
    labelSetRevision: manifest.labelSetRevision,
    evaluationContractVersion: '1.0.0',
    applicationCommitSha: metadata.applicationCommitSha,
    moduleVersions: metadata.moduleVersions ?? {},
    adapterVersions: metadata.adapterVersions ?? {},
    projectorVersions: metadata.projectorVersions ?? {},
    databaseVersion: metadata.databaseVersion ?? '',
    databaseExtensionVersions: metadata.databaseExtensionVersions ?? {},
    databaseSearchConfiguration: metadata.databaseSearchConfiguration ?? {},
    providerName: metadata.provider.providerName,
    providerAdapterVersion: metadata.provider.providerAdapterVersion,
    providerModel: metadata.provider.providerModel,
    providerModelVersion: metadata.provider.providerModelVersion,
    promptVersion: metadata.provider.promptVersion,
    policyVersion: metadata.provider.policyVersion,
    randomSeedOrDeterministicSettings: metadata.deterministicSettings,
    startedAt: metadata.startedAt,
    completedAt: metadata.completedAt,
    metricImplementationVersion: '1.0.0',
    caseResults: results.caseResults,
    aggregateResults: results.aggregateResults,
    sliceResults: results.sliceResults,
    failureDetails: failureDetailsFor(results.caseResults),
    environmentSummary: metadata.environmentSummary,
  });
