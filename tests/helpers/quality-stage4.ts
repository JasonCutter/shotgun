import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import type {
  ClaimCandidate,
  EvidenceSpan,
  ValidationResult,
} from '../../packages/contracts/src/index.js';
import { stableJson } from '../../packages/contracts/src/index.js';
import {
  computeRecordedOutputDigest,
  type GoldenCorpus,
  type GoldenEvidence,
  type PredictedClaim,
  type RecordedClaimPredictionSet,
} from '../../packages/quality-evaluation/src/index.js';
import { evidenceQuery } from './stage-3.js';
import { fileCommand } from './stage-2.js';
import {
  candidatesQuery,
  createStage4Harness,
  directTextCommand,
  intakeResultQuery,
  validationQuery,
} from './stage-4.js';

export type Stage4ClaimBaselineTrace = {
  readonly commandCount: number;
  readonly providerCallCount: number;
  readonly candidateCount: number;
  readonly readyCandidateCount: number;
  readonly rejectedCandidateCount: number;
  readonly validationCount: number;
};

const metricEvidence = (evidence: EvidenceSpan): GoldenEvidence => ({
  exact: evidence.quote.exact,
  position: {
    start: evidence.position.start,
    end: evidence.position.end,
    unit: evidence.position.unit,
  },
  ...(evidence.selectors === undefined || evidence.selectors.length === 0
    ? {}
    : {
        selectors: evidence.selectors.map((selector) => ({
          type: selector.type,
          value: 'value' in selector ? selector.value : stableJson(selector),
        })),
      }),
});

const stablePredictions = (
  caseId: string,
  candidates: readonly {
    readonly candidate: ClaimCandidate;
    readonly validation: ValidationResult;
    readonly evidence: EvidenceSpan;
  }[],
): readonly PredictedClaim[] =>
  candidates
    .filter(({ candidate, validation }) => {
      if (candidate.status !== validation.status) {
        throw new Error(
          `Stage 4 candidate '${candidate.candidateId}' status does not match Validation.`,
        );
      }
      return validation.status === 'READY';
    })
    .sort(
      (left, right) =>
        left.evidence.position.start - right.evidence.position.start ||
        left.evidence.position.end - right.evidence.position.end ||
        left.candidate.claimText.localeCompare(right.candidate.claimText),
    )
    .map(({ candidate, evidence }, index) => ({
      predictionId: `${caseId}:stage4-ready:${index + 1}`,
      claimText: candidate.claimText,
      evidence: metricEvidence(evidence),
    }));

export const executeStage4ClaimBaseline = async (
  corpus: GoldenCorpus,
): Promise<{
  readonly predictions: RecordedClaimPredictionSet;
  readonly trace: Stage4ClaimBaselineTrace;
}> => {
  const provider = new FakeAIProviderAdapter();
  const { kernel } = await createStage4Harness({ aiProvider: provider });
  let candidateCount = 0;
  let readyCandidateCount = 0;
  let rejectedCandidateCount = 0;
  let validationCount = 0;
  const cases: RecordedClaimPredictionSet['cases'][number][] = [];

  for (const entry of corpus.cases) {
    const commandOptions = {
      projectId: `${entry.projectContext.projectKey}-${entry.caseId}`,
      accessScope: entry.projectContext.accessScopes,
    };
    const command =
      entry.sourceFormat === 'markdown'
        ? fileCommand(
            `quality-baseline:${entry.caseId}`,
            `${entry.caseId}.md`,
            'text/markdown',
            Buffer.from(entry.sourceContent, 'utf8'),
            commandOptions,
          )
        : directTextCommand(
            `quality-baseline:${entry.caseId}`,
            entry.sourceContent,
            commandOptions,
          );
    const securedCommand = {
      ...command,
      security: {
        ...command.security!,
        sensitivity: entry.sensitivity,
        dataClassification: 'synthetic',
      },
    };
    await kernel.connector.sendCommand(securedCommand);
    const intake = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(securedCommand))
    ).result.payload;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(securedCommand, intake.sourceVersionId),
      )
    ).result.payload.items;
    const evaluated = await Promise.all(
      candidates.map(async (candidate) => {
        const validation = (
          await kernel.connector.query<ValidationResult>(
            validationQuery(securedCommand, candidate.candidateId),
          )
        ).result.payload;
        const evidence = (
          await kernel.connector.query<EvidenceSpan>(
            evidenceQuery(securedCommand, candidate.evidenceIds[0]),
          )
        ).result.payload;
        return { candidate, validation, evidence };
      }),
    );
    candidateCount += evaluated.length;
    validationCount += evaluated.length;
    readyCandidateCount += evaluated.filter(
      ({ validation }) => validation.status === 'READY',
    ).length;
    rejectedCandidateCount += evaluated.filter(
      ({ validation }) => validation.status === 'REJECTED',
    ).length;
    cases.push({ caseId: entry.caseId, predictions: stablePredictions(entry.caseId, evaluated) });
  }

  const pending: RecordedClaimPredictionSet = {
    contractVersion: '1.0.0',
    runMode: 'deterministic-recorded',
    recordingSource: 'stage4-runtime',
    providerName: 'fake',
    providerAdapterVersion: provider.identity.adapterVersion,
    providerModel: provider.identity.model,
    providerModelVersion: provider.identity.model,
    promptVersion: 'direct-claim-v1',
    policyVersion: 'direct-only-v1',
    outputDigest: `sha256:${'0'.repeat(64)}`,
    cases,
  };
  const predictions = { ...pending, outputDigest: computeRecordedOutputDigest(pending) };
  return {
    predictions,
    trace: {
      commandCount: corpus.cases.length,
      providerCallCount: provider.calls(),
      candidateCount,
      readyCandidateCount,
      rejectedCandidateCount,
      validationCount,
    },
  };
};
