import type { Pool } from 'pg';
import { decodeSurferAskMemoryContext } from '../../../packages/contracts/src/surfer-ask-memory.js';
import { decodeSurferAskMeaningProposalReceipt } from '../../../packages/contracts/src/surfer-ask-discovery.js';
import type { SurferMeaningQueueIdentity } from '../../../packages/contracts/src/surfer-meaning-queue.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import { unicodeLength } from '../../../packages/contracts/src/document-evidence.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

type Evidence = {
  evidenceId: string;
  sourceId: string;
  sourceVersionId: string;
  exactQuote: string;
  sensitivity: string;
};
type Saved = { attemptId: string; receipt: unknown; context: unknown; evidence: Evidence[] };
export function selectAutomaticMeaningInputs(saved: Saved) {
  const context = decodeSurferAskMemoryContext(saved.context),
    receipt = decodeSurferAskMeaningProposalReceipt(saved.receipt);
  if (receipt.contextDigest !== context.digest || !context.packet?.discovery)
    throw surferFailure('Unproven automatic meaning context.');
  const proofSources = new Set(
    context.packet.rules?.flatMap((r) => r.citations.map((c) => c.sourceId)) ?? [],
  );
  const pins = context.packet.discovery.evidence.filter((e) => !proofSources.has(e.sourceId));
  const passages = pins.map((p) => {
    const e = saved.evidence.find(
      (e) =>
        e.evidenceId === p.evidenceId &&
        e.sourceId === p.sourceId &&
        e.sourceVersionId === p.sourceVersionId &&
        surferDigest(e.exactQuote) === p.quoteDigest,
    );
    if (!e) throw surferFailure('Missing original Ask evidence.');
    return { ...e, revisionId: p.revisionId };
  });
  if (
    passages.length > 8 ||
    passages.some((e) => unicodeLength(e.exactQuote) > 2048) ||
    passages.reduce((n, e) => n + e.exactQuote.length, 0) > 8192
  )
    return { code: 'OUTSIDE_BOUNDS' as const };
  const normalize = (s: string) =>
    s
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/[.!。]$/u, '');
  if (
    new Set(passages.map((e) => e.sourceId)).size < 2 ||
    new Set(passages.map((e) => normalize(e.exactQuote))).size < 2
  )
    return { code: 'NO_SEPARATE_EVIDENCE' as const };
  // All eligible original passages, including counters; no label-based selection.
  const selections = passages.map((e) => ({
    sourceId: e.sourceId,
    evidenceId: e.evidenceId,
    start: 0,
    end: unicodeLength(e.exactQuote),
    targetUnit: null,
  }));
  const inputs = receipt.candidates.slice(0, 2).map((c, candidateIndex) => ({
    reference: { attemptId: saved.attemptId, candidateIndex },
    selections,
    origin: c.source,
  }));
  if (
    !inputs.length ||
    inputs.some(
      (i) =>
        !passages.some(
          (e) => e.sourceId === i.origin.sourceId && e.evidenceId === i.origin.evidenceId,
        ),
    )
  )
    return { code: 'NO_SEPARATE_EVIDENCE' as const };
  return { code: 'READY' as const, inputs, passages };
}
export function assertAutomaticMeaningView(
  view: SurferCognitiveView,
  passages: Extract<ReturnType<typeof selectAutomaticMeaningInputs>, { code: 'READY' }>['passages'],
) {
  if (
    view.anchors.length !== passages.length ||
    passages.some(
      (e) =>
        !view.anchors.some(
          (a) =>
            a.source.sourceId === e.sourceId &&
            a.source.evidenceId === e.evidenceId &&
            a.source.sourceVersionId === e.sourceVersionId &&
            a.source.revisionId === e.revisionId &&
            a.source.pointer === '' &&
            a.rawLiteral === e.exactQuote &&
            a.scope.sensitivity === e.sensitivity,
        ),
    )
  )
    throw surferFailure('Automatic meaning Source changed.');
}
export class PostgresSurferMeaningIntents {
  constructor(private readonly pool: Pool) {}
  async pending(
    i: SurferMeaningQueueIdentity,
    questionNotBeforeMs?: number,
  ): Promise<Saved | null> {
    const r = (
      await this.pool.query(
        `SELECT i.attempt_id AS "attemptId",p.receipt,c.context FROM surfer_meaning.intent i JOIN frontend_ask.surfer_meaning_proposals p ON p.attempt_id=i.attempt_id AND p.digest=i.proposal_digest JOIN frontend_ask.surfer_memory_context c ON c.attempt_id=i.attempt_id JOIN frontend_ask.answer_runs r ON r.answer_run_id=p.answer_run_id WHERE i.project_id=$1 AND i.principal_id=$2 AND r.state='SUCCEEDED' AND ($5::timestamptz IS NULL OR r.created_at >= $5) AND NOT EXISTS(SELECT 1 FROM surfer_meaning.intent_delivery d WHERE d.attempt_id=i.attempt_id AND d.run_id=$3 AND d.profile_digest=$4) ORDER BY i.created_at,i.attempt_id LIMIT 1`,
        [
          i.projectId,
          i.principalId,
          i.runId,
          i.profileDigest,
          questionNotBeforeMs === undefined ? null : new Date(questionNotBeforeMs),
        ],
      )
    ).rows[0];
    if (!r) return null;
    const evidence = (
      await this.pool.query(
        `SELECT evidence_id AS "evidenceId",source_id AS "sourceId",source_version_id AS "sourceVersionId",exact_quote AS "exactQuote",sensitivity FROM frontend_ask.answer_attempt_evidence WHERE attempt_id=$1 ORDER BY evidence_ordinal`,
        [r.attemptId],
      )
    ).rows as Evidence[];
    return { ...r, evidence };
  }
  async delivered(
    i: SurferMeaningQueueIdentity,
    attemptId: string,
    code: 'ENQUEUED' | 'NO_SEPARATE_EVIDENCE' | 'OUTSIDE_BOUNDS' | 'SOURCE_UNAVAILABLE',
    jobs: string[],
  ) {
    await this.pool.query(
      `INSERT INTO surfer_meaning.intent_delivery(attempt_id,run_id,profile_digest,code,job_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [attemptId, i.runId, i.profileDigest, code, jobs],
    );
  }
}
