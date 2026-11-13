import type { Pool, PoolClient } from 'pg';
import type {
  SurferAskCrossReviewPin,
  SurferAskMeaningReview,
} from '../../../packages/contracts/src/surfer-ask-adoption.js';
import type { SurferSourceSessionV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  decodeSurferMeaningVerificationWork,
  type SurferMeaningVerificationResult,
} from '../../../packages/contracts/src/surfer-meaning-verification.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeSlice } from '../../../packages/contracts/src/document-evidence.js';

/** Serialize job registration/completion with publishing an answer that used the review set. */
export async function lockAskCrossReviews(client: PoolClient, projectId: string) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('surfer-ask-cross-review:'||$1,0))",
    [projectId],
  );
}

export async function readAskCrossReview(
  pool: Pool,
  session: Pick<SurferSourceSessionV2, 'snapshot' | 'readContentProofV2'>,
  candidate: SurferAskMeaningReview['candidate'],
  documents: SurferAskMeaningReview['sources'],
): Promise<SurferAskCrossReviewPin> {
  const { projectId, principalId, knowledgeEpoch, accessDigest, policyRevision } = session.snapshot;
  const { rule, source, field, label } = candidate;
  const { rows } = await pool.query(
    `SELECT job_id,work,work_digest,state,code,result,result_digest FROM surfer_meaning.job
      WHERE project_id=$1 AND principal_id=$2 AND work->'candidate' @> $3::jsonb
        AND (state <> 'COMPLETED' OR result->>'revision' IS DISTINCT FROM 'surfer.meaning-cross-review.v1')
      ORDER BY job_id COLLATE "C" LIMIT 9`,
    [projectId, principalId, JSON.stringify({ rule, source, field, label })],
  );
  const jobIds = rows.map((row) => row.job_id as string);
  const digest = surferDigest(
    rows.map((r) => ({
      jobId: r.job_id,
      work: r.work_digest,
      result: r.result_digest,
      state: ['READY', 'RUNNING'].includes(r.state) ? 'PENDING' : r.state,
      code: r.code,
    })),
  );
  if (!rows.length) return { state: 'ABSENT', jobIds, digest };
  const withheld = { state: 'WITHHELD' as const, jobIds, digest };
  if (rows.length > 8) return withheld;

  let supported = false;
  for (const row of rows) {
    const work = decodeSurferMeaningVerificationWork(row.work);
    if (
      work.digest !== row.work_digest ||
      work.basis.queries.length ||
      work.basis.dependencies.length
    )
      return withheld;
    if (
      surferDigest(work.basis.authority) !==
      surferDigest({
        projectId,
        principalId,
        knowledgeEpoch,
        accessDigest,
        policyRevision,
      })
    )
      continue;
    const current = await Promise.all(
      work.basis.sources.map(
        async (pin) =>
          session.snapshot.heads.some(
            (h) =>
              h.sourceId === pin.sourceId &&
              h.readiness === 'INDEXED' &&
              h.fingerprint === pin.fingerprint,
          ) && (await session.readContentProofV2(pin.sourceId)) === pin.materialProof,
      ),
    );
    if (current.some((valid) => !valid)) continue;
    if (
      !work.selections.every((s) =>
        documents.some((d) => d.sourceId === s.sourceId && d.evidenceId === s.evidenceId),
      )
    )
      return withheld;
    if (row.state !== 'COMPLETED' || !row.result) return withheld;
    const result = row.result as SurferMeaningVerificationResult;
    const { digest: resultDigest, ...body } = result;
    if (
      result.revision !== 'surfer.meaning-cross-review.v2' ||
      resultDigest !== row.result_digest ||
      resultDigest !== surferDigest(body) ||
      result.workDigest !== work.digest ||
      result.viewDigest !== work.viewDigest ||
      surferDigest(result.proposal) !== surferDigest(work.proposal) ||
      result.effect !== 'NO_RULE_OR_KNOWLEDGE_CHANGE' ||
      result.semanticAssessment !== 'MODEL_REVIEW_NOT_TRUTH_VALIDATED' ||
      result.assessment !== 'MODEL_SUPPORTED_UNVERIFIED' ||
      !Array.isArray(result.interpretationLimits) ||
      result.interpretationLimits.length !== 0
    )
      return withheld;
    const f = result.findings;
    if (
      !f ||
      !f.facets ||
      Object.keys(f.facets).sort().join(',') !== 'condition,exception,subject,time' ||
      !Array.isArray(f.support) ||
      !Array.isArray(f.roleCitations) ||
      !Array.isArray(f.counter) ||
      !Array.isArray(f.counterKinds) ||
      !Array.isArray(f.typeCitations) ||
      !Array.isArray(f.unitCitations) ||
      f.relation !== 'EQUIVALENT' ||
      f.relationBasis !== 'EXPLICIT_TERM_RELATION' ||
      f.documentRole !== 'DEFINITION' ||
      f.typeAssessment !== 'MATCH' ||
      f.unitAssessment !== 'MATCH' ||
      f.counter.length ||
      f.counterKinds.length ||
      Object.values(f.facets).some((facet) => facet.state !== 'UNSTATED') ||
      new Set(f.support.map((quote) => quote.sourceId)).size < 2 ||
      !f.typeCitations.length ||
      !f.unitCitations.length ||
      !f.roleCitations.length ||
      ![...f.support, ...f.typeCitations, ...f.unitCitations, ...f.roleCitations].every(
        (quote) =>
          work.selections.some(
            (s) =>
              s.sourceId === quote.sourceId &&
              s.evidenceId === quote.evidenceId &&
              s.start <= quote.start &&
              quote.end <= s.end,
          ) &&
          documents.some(
            (d) =>
              d.sourceId === quote.sourceId &&
              d.evidenceId === quote.evidenceId &&
              d.sourceVersionId === quote.sourceVersionId &&
              d.revisionId === quote.revisionId &&
              unicodeSlice(d.quote, quote.start, quote.end) === quote.quote,
          ),
      )
    )
      return withheld;
    supported = true;
  }
  return { state: supported ? 'SUPPORTED' : 'WITHHELD', jobIds, digest };
}
