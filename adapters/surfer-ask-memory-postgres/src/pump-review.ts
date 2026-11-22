import type { Pool } from 'pg';
import type { AskExecutionEvidence } from '../../../modules/frontend-ask-execution/src/index.js';
import { evaluateSurferRule } from '../../../modules/surfer-learning/src/rule-interpreter.js';
import { sha256Text } from '../../../packages/contracts/src/document-evidence.js';
import {
  readSurferPumpReviewQuestion,
  type SurferAskPumpReview,
  type SurferPumpReviewEvidence,
} from '../../../packages/contracts/src/surfer-ask-pump-review.js';
import type { SurferAskSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { PostgresSurferSourceSession } from '../../surfer-shotgun-source-postgres/src/index.js';

// Exact, versioned exports of the registered hypothesis and measured FS1 archive.
const approvedRecords = new Map<string, SurferPumpReviewEvidence['kind']>([
  ['sha256:c1bf7d45208e23e7e8b0d980b95fc216fc4f57b4c54cc9ba30ba0834eb6dcd39', 'HYPOTHESIS'],
  ['sha256:6ee535709b3df6ae545911fd6a62dc47d7b370e54e78e3ff0ef16b66970f31bb', 'MEASUREMENTS'],
]);

type HypothesisRecord = {
  expression: { right: { value: number } };
  supportedFlowSpreads: number[];
};
type MeasurementRecord = {
  measurements: { cycle: number; cooler: number; stable: boolean; flowSpread: number }[];
};

export async function pumpReviewFor(
  pool: Pool,
  request: SurferAskSourceRequest,
  evidence: readonly AskExecutionEvidence[],
  question: string,
): Promise<SurferAskPumpReview | undefined> {
  const target = readSurferPumpReviewQuestion(question);
  if (!target) return undefined;
  const { cycle } = target;
  const base = { revision: 'surfer.ask-pump-review.v1' as const, cycle };
  if (target.rig !== 'zema')
    return { ...base, outcome: 'UNKNOWN', reason: 'RIG_OUT_OF_SCOPE', evidence: [] };

  const pins: SurferPumpReviewEvidence[] = [];
  const candidates = evidence.flatMap((e) => {
    if (e.exactQuote.length > 2048) return [];
    const record = e.exactQuote.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const kind = approvedRecords.get(sha256Text(record));
    return kind ? [{ e, record, kind }] : [];
  });
  let hypothesis: HypothesisRecord | undefined;
  let measurements: MeasurementRecord | undefined;
  if (candidates.length)
    await new PostgresSurferSourceSession(pool).withRoutedSnapshot(
      request,
      'READ',
      async ({ session }) => {
        for (const { e, record, kind } of candidates) {
          if (pins.some((pin) => pin.kind === kind || pin.source.sourceId === e.sourceId)) continue;
          if (
            !session.snapshot.heads.some(
              (head) =>
                head.sourceId === e.sourceId &&
                head.sourceVersionId === e.sourceVersionId &&
                head.readiness === 'INDEXED',
            )
          )
            continue;
          const { material } = await session.readMaterialV2(e.sourceId);
          if (
            material.scope.sensitivity !== e.sensitivity ||
            material.sourceVersionId !== e.sourceVersionId ||
            material.rootEvidenceId !== e.evidenceId ||
            sha256Text(e.exactQuote) !== material.sourceContentHash ||
            !material.evidence.some(
              (span) => span.evidenceId === e.evidenceId && span.quote.exact === e.exactQuote,
            )
          )
            continue;
          const { sourceId, sourceVersionId, revisionId, indexingResultId } = material;
          pins.push({
            kind,
            evidenceId: e.evidenceId,
            source: { sourceId, sourceVersionId, revisionId, indexingResultId },
          });
          if (kind === 'HYPOTHESIS') hypothesis = JSON.parse(record) as HypothesisRecord;
          else measurements = JSON.parse(record) as MeasurementRecord;
        }
      },
    );
  pins.sort((a, b) => a.kind.localeCompare(b.kind));
  if (!hypothesis || !measurements)
    return { ...base, outcome: 'UNKNOWN', reason: 'MISSING_EVIDENCE', evidence: pins };
  const measured = measurements.measurements.find((row) => row.cycle === cycle);
  if (
    !measured?.stable ||
    measured.cooler !== 20 ||
    !hypothesis.supportedFlowSpreads.includes(measured.flowSpread)
  )
    return { ...base, outcome: 'UNKNOWN', reason: 'CYCLE_OUT_OF_SCOPE', evidence: pins };
  const { outcome } = evaluateSurferRule(hypothesis.expression, {
    spreadFS1Flow: { value: measured.flowSpread, unit: 'L/min' },
  });
  if (outcome === 'UNKNOWN')
    return { ...base, outcome, reason: 'CYCLE_OUT_OF_SCOPE', evidence: pins };
  return {
    ...base,
    outcome,
    flowSpread: measured.flowSpread,
    limit: hypothesis.expression.right.value,
    evidence: pins,
  };
}
