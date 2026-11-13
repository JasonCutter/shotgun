import { lockAskCrossReviews, readAskCrossReview } from './ask-cross-review.js';
import { selectSurferAskMeaningScope } from '../../../packages/contracts/src/surfer-ask-adoption.js';
import type { Pool, PoolClient } from 'pg';
import type {
  AskMemoryContextPort,
  AskExecutionScope,
  AskClaimedExecution,
  AskExecutionEvidence,
} from '../../../modules/frontend-ask-execution/src/index.js';
import { PostgresSurferSourceSession } from '../../surfer-shotgun-source-postgres/src/index.js';
import { authorizeSurferAskRead } from '../../surfer-shotgun-source-postgres/src/ask-authority.js';
import { ShotgunSurferRoutedMemorySession } from '../../surfer-shotgun-bridge/src/routed-memory.js';
import { SurferGuidedMemoryService } from '../../../modules/surfer-core/src/guided-memory.js';
import { SurferDirectiveMemoryService } from '../../../modules/surfer-core/src/directive-memory.js';
import { SurferScopedRuleMemoryService } from '../../../modules/surfer-learning/src/rule-memory.js';
import { SurferGuidedRuleMemoryService } from '../../../modules/surfer-learning/src/guided-rule-memory.js';
import { readSurferAskRulePremises } from '../../../modules/surfer-learning/src/ask-rule-premises.js';
import { groundSurferAskRulePremises } from '../../surfer-memory-query/src/ask-rule-grounding.js';
import {
  groundSurferAskRuleMeanings,
  readSurferRuleFieldLexicon,
  type SurferAskMeaningSource,
} from '../../surfer-memory-query/src/ask-rule-meaning.js';
import { SurferDirectiveScenarioEvaluatorV2 } from '../../surfer-memory-query/src/index.js';
import { PostgresOriginalAssetRepository } from '../../postgres/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import {
  pinSurferAskMemory,
  decodeSurferAskMemoryContext,
  type SurferAskMemoryContext,
  type SurferAskMemoryPacket,
} from '../../../packages/contracts/src/surfer-ask-memory.js';
import type { SurferAskSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import type {
  SurferAskDiscoveryPin,
  SurferAskMeaningProposalReceipt,
} from '../../../packages/contracts/src/surfer-ask-discovery.js';
import { assertAskMeaningProposalReceipt } from '../../surfer-memory-query/src/ask-meaning-discovery.js';
import { decodeSurferAskMeaningProposalReceipt } from '../../../packages/contracts/src/surfer-ask-discovery.js';
import type { SurferAskMeaningReview } from '../../../packages/contracts/src/surfer-ask-adoption.js';
import {
  reviewSurferMeaningProposal,
  groundSurferAskReviewedMeanings,
} from '../../surfer-memory-query/src/ask-meaning-review.js';

const stale = () =>
  new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'The pinned interpretation memory is no longer available for this AnswerRun.',
    module: 'surfer.ask',
    operation: 'memory-context',
    retryable: false,
  });
const actor = (
  projectId: string,
  attemptId: string,
  answerRunId: string,
  workerId: string,
): SurferAskSourceRequest => ({ projectId, ask: { attemptId, answerRunId, leaseOwner: workerId } });
const rank = { public: 0, internal: 1, private: 2, restricted: 3 };
/** Read-only Evidence-subset recall and scoped rule computation share one Source MVCC. */
async function packetFor(
  pool: Pool,
  a: SurferAskSourceRequest,
  evidence: readonly AskExecutionEvidence[],
  question: string,
  includeRules = true,
  groundedPremises = true,
  sourceMeanings = true,
  discoverMeanings = false,
  reviewedMeanings = false,
  semanticScopes = false,
  scopeReviews = false,
  crossReviews = false,
): Promise<SurferAskMemoryPacket | null> {
  if (!evidence.length) {
    await authorizeSurferAskRead(pool, a);
    return null;
  }
  return new PostgresSurferSourceSession(pool).withRoutedSnapshot(a, 'READ', async (routed) => {
    const sessions = new ShotgunSurferRoutedMemorySession({
      withRoutedSnapshot: async (_a, intent, fn) => {
        if (intent !== 'READ') throw stale();
        return fn(routed);
      },
    });
    return sessions.withReadSession(a, async (s) => {
      const read = await s.read(null);
      if (read.status !== 'CURRENT' || !read.result.isActive) return null;
      const bound = {
          withReadSession: <T>(_a: unknown, fn: (session: typeof s) => Promise<T>) => fn(s),
          withSession: <T>(_a: unknown, fn: (session: typeof s) => Promise<T>) => fn(s),
        },
        evaluator = new SurferDirectiveScenarioEvaluatorV2(),
        catalog = await new SurferGuidedMemoryService(bound, evaluator).catalog(a);
      if (catalog.status !== 'READY' || !catalog.snapshot) return null;
      const service = new SurferDirectiveMemoryService(bound, evaluator),
        items: SurferAskMemoryPacket['items'] = [],
        groups = new Set<string>();
      for (const c of catalog.items) {
        const key = surferDigest([c.subject, c.operation]);
        if (groups.has(key)) continue;
        groups.add(key);
        const result = await service.ask(a, {
          schemaVersion: '1.0.0',
          snapshotId: catalog.snapshot.snapshotId,
          kind: 'RECALL',
          subject: c.subject,
          operation: c.operation,
          observations: [],
          atDate: null,
        });
        if (!result.answers.length) continue;
        // Keep all peers together: omitting an unselected contradictory peer would hide a conflict.
        const eligible = result.answers.every((answer) => {
          const stored = read.result.artifacts.find(
            (x) => x.artifactId === answer.memory.artifactId && x.digest === answer.memory.digest,
          );
          return (
            !!stored &&
            answer.citations.every((citation) => {
              const e = evidence.find(
                (e) =>
                  e.evidenceId === citation.evidenceId &&
                  e.sourceId === citation.sourceId &&
                  e.sourceVersionId === citation.sourceVersionId,
              );
              return (
                !!e &&
                e.exactQuote.includes(citation.quote) &&
                rank[stored.scope.sensitivity] <= rank[e.sensitivity]
              );
            })
          );
        });
        if (!eligible) continue;
        for (const answer of result.answers)
          items.push({
            memory: answer.memory,
            subject: c.subject,
            operation: c.operation,
            declaredMode: answer.declaredMode,
            citations: answer.citations.map((x) => ({
              evidenceId: x.evidenceId,
              sourceId: x.sourceId,
              sourceVersionId: x.sourceVersionId,
              revisionId: x.revisionId,
              quote: x.quote,
            })),
          });
      }
      const rules: NonNullable<SurferAskMemoryPacket['rules']> = [];
      if (includeRules) {
        const definitions: SurferAskMeaningSource[] = [];
        if (sourceMeanings)
          for (const e of evidence) {
            if (!readSurferRuleFieldLexicon(e.exactQuote)) continue;
            const { material } = await routed.session.readMaterialV2(e.sourceId),
              root = material.evidence.find(
                (x) => x.evidenceId === e.evidenceId && x.pointer === '',
              );
            if (!root) continue;
            if (
              material.sourceVersionId !== e.sourceVersionId ||
              root.quote.exact !== e.exactQuote ||
              rank[material.scope.sensitivity] > rank[e.sensitivity]
            )
              throw stale();
            definitions.push({
              sourceId: e.sourceId,
              sourceVersionId: e.sourceVersionId,
              evidenceId: e.evidenceId,
              revisionId: material.revisionId,
              quote: e.exactQuote,
            });
          }
        const catalog = await new SurferGuidedRuleMemoryService(bound).catalog(a),
          consumer = new SurferScopedRuleMemoryService(bound);
        let reviewBudget = 2;
        for (const item of catalog.items) {
          const reviews: SurferAskMeaningReview[] = [];
          const reviewDocuments: SurferAskMeaningSource[] = [];
          if (reviewedMeanings && item.state === 'ACTIVE' && reviewBudget > 0) {
            const rows = await pool.query(
              `SELECT p.attempt_id,p.receipt,p.digest,c.digest AS context_digest FROM frontend_ask.surfer_meaning_proposals p JOIN frontend_ask.surfer_memory_context c ON c.attempt_id=p.attempt_id JOIN frontend_ask.answer_runs r ON r.answer_run_id=p.answer_run_id WHERE p.project_id=$1 AND r.state='SUCCEEDED' AND p.answer_run_id<>$2 ${crossReviews ? "AND EXISTS (SELECT 1 FROM frontend_command.command_ledger cmd WHERE cmd.command_id=r.create_command_id AND cmd.principal_id=$4 AND cmd.command_type='SUBMIT_QUESTION' AND cmd.target_project_id=p.project_id AND cmd.outcome_state='COMPLETED' AND cmd.completion_disposition='SUCCEEDED')" : ''} AND p.receipt->'candidates' @> $3::jsonb ORDER BY p.created_at DESC,p.attempt_id LIMIT 8`,
              [
                a.projectId,
                a.ask.answerRunId,
                JSON.stringify([{ rule: item.memory }]),
                ...(crossReviews ? [routed.session.snapshot.principalId] : []),
              ],
            );
            if (rows.rows.length) {
              for (const e of evidence) {
                if (e.exactQuote.length > 4096) continue;
                const { material } = await routed.session.readMaterialV2(e.sourceId),
                  root = material.evidence.find(
                    (x) => x.evidenceId === e.evidenceId && x.pointer === '',
                  );
                if (
                  !root ||
                  root.quote.exact !== e.exactQuote ||
                  material.sourceVersionId !== e.sourceVersionId ||
                  rank[material.scope.sensitivity] > rank[e.sensitivity]
                )
                  continue;
                reviewDocuments.push({
                  sourceId: e.sourceId,
                  sourceVersionId: e.sourceVersionId,
                  revisionId: material.revisionId,
                  evidenceId: e.evidenceId,
                  quote: e.exactQuote,
                });
              }
              for (const row of rows.rows) {
                const receipt = decodeSurferAskMeaningProposalReceipt(row.receipt);
                if (row.digest !== receipt.digest || row.context_digest !== receipt.contextDigest)
                  throw stale();
                for (const [candidateIndex, candidate] of receipt.candidates.entries()) {
                  if (
                    reviews.length >= reviewBudget ||
                    surferDigest(candidate.rule) !== surferDigest(item.memory) ||
                    !question.includes(candidate.label) ||
                    reviews.some(
                      (r) =>
                        r.candidate.field === candidate.field &&
                        r.candidate.label === candidate.label,
                    ) ||
                    evidence.some(
                      (e) => e.exactQuote.length > 4096 && e.exactQuote.includes(candidate.label),
                    ) ||
                    !reviewDocuments.some(
                      (d) =>
                        d.sourceId === candidate.source.sourceId &&
                        d.sourceVersionId === candidate.source.sourceVersionId &&
                        d.evidenceId === candidate.source.evidenceId &&
                        d.revisionId === candidate.source.revisionId,
                    )
                  )
                    continue;
                  reviews.push(
                    reviewSurferMeaningProposal({
                      proposal: {
                        attemptId: row.attempt_id,
                        receiptDigest: receipt.digest,
                        candidateIndex,
                      },
                      candidate,
                      ...(scopeReviews
                        ? { scope: selectSurferAskMeaningScope(receipt, candidateIndex) }
                        : {}),
                      ...(crossReviews
                        ? {
                            crossReview: await readAskCrossReview(
                              pool,
                              routed.session,
                              candidate,
                              reviewDocuments,
                            ),
                          }
                        : {}),
                      domain: item.domain,
                      fields: item.fields,
                      documents: reviewDocuments,
                    }),
                  );
                }
              }
            }
          }
          reviewBudget -= reviews.length;
          const parsed = reviews.length
            ? groundSurferAskReviewedMeanings(
                question,
                item.fields,
                item.domain,
                reviewDocuments,
                reviews,
              )
            : groundedPremises
              ? sourceMeanings
                ? groundSurferAskRuleMeanings(question, item.fields, item.domain, definitions)
                : groundSurferAskRulePremises(question, item.fields)
              : { ...readSurferAskRulePremises(question, item.fields), grounding: undefined };
          const result = await consumer.ask(a, {
            schemaVersion: '1.0.0',
            contract: 'surfer.scoped-rule-question.v1',
            snapshotId: read.result.snapshot.snapshotId,
            memoryId: item.memory.artifactId,
            kind: 'APPLY',
            features: parsed.features,
          });
          const answer = result.answers[0];
          if (!answer || answer.validation.status !== 'SCOPE_VALIDATED') continue;
          const stored = read.result.artifacts.find(
            (x) => x.artifactId === answer.memory.artifactId && x.digest === answer.memory.digest,
          );
          if (
            !stored ||
            !answer.citations.length ||
            !answer.citations.every((c) =>
              evidence.some(
                (e) =>
                  e.evidenceId === c.evidenceId &&
                  e.sourceId === c.sourceId &&
                  e.sourceVersionId === c.sourceVersionId &&
                  e.exactQuote.includes(c.quote) &&
                  rank[stored.scope.sensitivity] <= rank[e.sensitivity],
              ),
            )
          )
            continue;
          const reasons = [...new Set([...parsed.reasons, ...answer.reasons])];
          if (!item.applySupported && answer.state === 'ACTIVE')
            reasons.push('UNSUPPORTED_FIELD_CATALOG');
          rules.push({
            memory: answer.memory,
            description: item.description,
            domain: item.domain,
            state: item.state,
            qualification: {
              proofId: answer.proofId,
              receiptDigest: surferDigest(answer.validation),
              reviewDigest: surferDigest({
                reviews: answer.reviews,
                ...('parentReviews' in answer ? { parentReviews: answer.parentReviews } : {}),
              }),
              generationDigest: surferDigest({
                memory: answer.memory,
                ...('lineage' in answer ? { lineage: answer.lineage } : {}),
                ...('generation' in answer ? { generation: answer.generation } : {}),
              }),
              status: 'SCOPE_VALIDATED',
            },
            outcome: reasons.length ? 'UNKNOWN' : (answer.outcome as 'TRUE' | 'FALSE' | 'UNKNOWN'),
            reasons,
            fields: item.fields.map(({ name, type, unit }) => ({ name, type, unit })),
            premises: Object.entries(parsed.features).map(([name, v]) => ({
              name,
              value: v.value as string | number | boolean,
              unit: v.unit ?? null,
            })),
            ...(parsed.grounding ? { grounding: parsed.grounding } : {}),
            citations: [
              ...answer.citations.map(
                ({ sourceId, sourceVersionId, evidenceId, revisionId, quote }) => ({
                  sourceId,
                  sourceVersionId,
                  evidenceId,
                  revisionId,
                  quote,
                }),
              ),
              ...(parsed.grounding?.sources ?? []),
            ],
          });
        }
      }
      if (!items.length && !rules.length) return null;
      let discovery: SurferAskDiscoveryPin | undefined;
      if (
        discoverMeanings &&
        rules.some(
          (r) =>
            r.state === 'ACTIVE' &&
            r.outcome === 'UNKNOWN' &&
            r.reasons.some((x) => x.startsWith('MISSING_PREMISE:')),
        )
      ) {
        const pins: SurferAskDiscoveryPin['evidence'] = [];
        for (const e of evidence.slice(0, 12)) {
          const { material } = await routed.session.readMaterialV2(e.sourceId),
            original = material.evidence.find((x) => x.evidenceId === e.evidenceId);
          // Partial Evidence quotes remain ordinary answer context, not a new discovery request.
          if (original && original.quote.exact !== e.exactQuote) continue;
          if (
            !original ||
            material.sourceVersionId !== e.sourceVersionId ||
            original.quote.exact !== e.exactQuote ||
            rank[material.scope.sensitivity] > rank[e.sensitivity]
          )
            throw stale();
          pins.push({
            evidenceId: e.evidenceId,
            sourceId: e.sourceId,
            sourceVersionId: e.sourceVersionId,
            revisionId: material.revisionId,
            quoteDigest: surferDigest(e.exactQuote),
          });
        }
        if (pins.length)
          discovery = semanticScopes
            ? {
                revision: 'surfer.ask-meaning-discovery.v2',
                scopeProfile: 'surfer.ask-semantic-scopes.v1',
                evidence: pins,
              }
            : { revision: 'surfer.ask-meaning-discovery.v1', evidence: pins };
      }
      const ids = new Set(
          [...items, ...rules]
            .flatMap((i) => i.citations.map((c) => c.sourceId))
            .concat(discovery?.evidence.map((e) => e.sourceId) ?? []),
        ),
        sources = routed.session.snapshot.heads
          .filter((h) => ids.has(h.sourceId))
          .map((h) => {
            if (h.readiness !== 'INDEXED' || !h.revisionId || !h.indexingResultId) throw stale();
            return {
              sourceId: h.sourceId,
              sourceVersionId: h.sourceVersionId,
              revisionId: h.revisionId,
              indexingResultId: h.indexingResultId,
            };
          });
      return {
        storage: routed.profile,
        snapshot: catalog.snapshot,
        sources,
        items,
        ...(includeRules ? { rules } : {}),
        ...(discovery ? { discovery } : {}),
      };
    });
  });
}
export class PostgresSurferAskMemory implements AskMemoryContextPort {
  constructor(private readonly pool: Pool) {}
  private request(scope: AskExecutionScope, claimed: AskClaimedExecution) {
    return actor(
      scope.projectId,
      claimed.attempt.attemptId,
      claimed.context.snapshot.answerRunId,
      claimed.attempt.leaseOwner!,
    );
  }
  async prepare(scope: AskExecutionScope, claimed: AskClaimedExecution) {
    const a = this.request(scope, claimed),
      base = claimed.context.resolvedContextDigest;
    const prior = await this.pool.query(
      'SELECT context FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1',
      [a.ask.attemptId],
    );
    if (prior.rows[0]) {
      const pinned = decodeSurferAskMemoryContext(prior.rows[0].context);
      if (pinned.baseContextDigest !== base) throw stale();
      await this.validate(scope, claimed, pinned);
      return pinned;
    }
    let packet: SurferAskMemoryPacket | null;
    if (claimed.attempt.kind === 'RETRY_SAME_CONTEXT') {
      const old = await this.pool.query(
        'SELECT context FROM frontend_ask.surfer_memory_context WHERE project_id=$1 AND answer_run_id=$2 AND attempt_number<$3 ORDER BY attempt_number DESC LIMIT 1',
        [scope.projectId, a.ask.answerRunId, claimed.attempt.attemptNumber],
      );
      const previous = old.rows[0] ? decodeSurferAskMemoryContext(old.rows[0].context) : null;
      if (previous && previous.baseContextDigest !== base) throw stale();
      packet = previous?.packet ?? null;
    } else
      packet = await packetFor(
        this.pool,
        a,
        claimed.context.evidence,
        claimed.context.snapshot.question,
        true,
        true,
        true,
        !claimed.context.context.some((c) => c.kind === 'GENERATED_IMAGE_OBSERVATION'),
        !claimed.context.context.some((c) => c.kind === 'GENERATED_IMAGE_OBSERVATION'),
        !claimed.context.context.some((c) => c.kind === 'GENERATED_IMAGE_OBSERVATION'),
        !claimed.context.context.some((c) => c.kind === 'GENERATED_IMAGE_OBSERVATION'),
        !claimed.context.context.some((c) => c.kind === 'GENERATED_IMAGE_OBSERVATION'),
      );
    const context = pinSurferAskMemory(base, packet);
    await this.validate(scope, claimed, context);
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        await client.query(
          'SELECT answer_run_id FROM frontend_ask.answer_runs WHERE project_id=$1 AND answer_run_id=$2 FOR UPDATE',
          [scope.projectId, a.ask.answerRunId],
        );
        await this.assertPins(client, a, context);
        await client.query(
          `INSERT INTO frontend_ask.surfer_memory_context(attempt_id,answer_run_id,project_id,attempt_number,base_context_digest,context,digest) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(attempt_id) DO NOTHING`,
          [
            a.ask.attemptId,
            a.ask.answerRunId,
            scope.projectId,
            claimed.attempt.attemptNumber,
            base,
            JSON.stringify(context),
            context.digest,
          ],
        );
        const row = (
            await client.query(
              'SELECT context,digest FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1',
              [a.ask.attemptId],
            )
          ).rows[0],
          stored = decodeSurferAskMemoryContext(row?.context);
        if (stored.digest !== context.digest || row.digest !== stored.digest) throw stale();
        return stored;
      },
      { module: 'surfer.ask', operation: 'pin-memory-context' },
    );
  }
  async validate(
    scope: AskExecutionScope,
    claimed: AskClaimedExecution,
    input: SurferAskMemoryContext,
  ) {
    const context = decodeSurferAskMemoryContext(input),
      a = this.request(scope, claimed);
    if (context.baseContextDigest !== claimed.context.resolvedContextDigest) throw stale();
    await authorizeSurferAskRead(this.pool, a);
    if (context.packet) {
      const current = await packetFor(
        this.pool,
        a,
        claimed.context.evidence,
        claimed.context.snapshot.question,
        context.revision !== 'surfer.ask-memory.v1',
        [
          'surfer.ask-memory.v3',
          'surfer.ask-memory.v4',
          'surfer.ask-memory.v5',
          'surfer.ask-memory.v6',
          'surfer.ask-memory.v7',
          'surfer.ask-memory.v8',
          'surfer.ask-memory.v9',
        ].includes(context.revision),
        [
          'surfer.ask-memory.v4',
          'surfer.ask-memory.v5',
          'surfer.ask-memory.v6',
          'surfer.ask-memory.v7',
          'surfer.ask-memory.v8',
          'surfer.ask-memory.v9',
        ].includes(context.revision),
        !!context.packet?.discovery,
        [
          'surfer.ask-memory.v6',
          'surfer.ask-memory.v7',
          'surfer.ask-memory.v8',
          'surfer.ask-memory.v9',
        ].includes(context.revision),
        ['surfer.ask-memory.v7', 'surfer.ask-memory.v8', 'surfer.ask-memory.v9'].includes(
          context.revision,
        ),
        ['surfer.ask-memory.v8', 'surfer.ask-memory.v9'].includes(context.revision),
        context.revision === 'surfer.ask-memory.v9',
      );
      if (surferDigest(current) !== surferDigest(context.packet)) throw stale();
    }
  }
  /** Called inside the existing publication transaction, preserving all existing VP guards. */
  async assertPublication(
    client: PoolClient,
    input: {
      scope: AskExecutionScope;
      answerRunId: string;
      attemptId: string;
      workerId: string;
      resolvedContextDigest?: string;
      meaningProposal?: SurferAskMeaningProposalReceipt;
      provider?: SurferAskMeaningProposalReceipt['producer'];
    },
  ) {
    const row = (
      await client.query(
        'SELECT context,digest FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1 AND answer_run_id=$2 AND project_id=$3',
        [input.attemptId, input.answerRunId, input.scope.projectId],
      )
    ).rows[0];
    if (!row) return; // Historical/base-only attempts never gain a new memory pin retroactively.
    const context = decodeSurferAskMemoryContext(row.context);
    if (row.digest !== context.digest || context.baseContextDigest !== input.resolvedContextDigest)
      throw stale();
    await this.assertPins(
      client,
      actor(input.scope.projectId, input.attemptId, input.answerRunId, input.workerId),
      context,
    );
    if (context.revision === 'surfer.ask-memory.v9') {
      await lockAskCrossReviews(client, input.scope.projectId);
      const jobIds = [
        ...new Set(
          context.packet?.rules?.flatMap(
            (r) =>
              r.grounding?.reviews?.flatMap((v) =>
                v.revision === 'surfer.ask-meaning-review.v3' ? v.crossReview.jobIds : [],
              ) ?? [],
          ) ?? [],
        ),
      ].sort();
      if (jobIds.length) {
        const locked = await client.query(
          'SELECT job_id FROM surfer_meaning.job WHERE project_id=$1 AND job_id=ANY($2::text[]) ORDER BY job_id FOR SHARE',
          [input.scope.projectId, jobIds],
        );
        if (locked.rowCount !== jobIds.length) throw stale();
      }
    }
    for (const rule of context.packet?.rules ?? [])
      for (const review of rule.grounding?.reviews ?? []) {
        const prior = (
          await client.query(
            'SELECT receipt,digest FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1 AND project_id=$2 FOR SHARE',
            [review.proposal.attemptId, input.scope.projectId],
          )
        ).rows[0];
        if (!prior || prior.digest !== review.proposal.receiptDigest) throw stale();
        const receipt = decodeSurferAskMeaningProposalReceipt(prior.receipt);
        if (
          receipt.digest !== prior.digest ||
          surferDigest(receipt.candidates[review.proposal.candidateIndex]) !==
            surferDigest(review.candidate) ||
          (review.revision !== 'surfer.ask-meaning-review.v1' &&
            surferDigest(selectSurferAskMeaningScope(receipt, review.proposal.candidateIndex)) !==
              surferDigest(review.scope))
        )
          throw stale();
      }
    // Reuse the full Source/Core closure validator while the publication transaction holds
    // the mutable knowledge roots. A changed input/head/footprint need not change activeSnapshotId.
    if (context.packet) {
      const evidence = await client.query<AskExecutionEvidence>(
        `SELECT evidence_id AS "evidenceId",source_id AS "sourceId",source_version_id AS "sourceVersionId",exact_quote AS "exactQuote",sensitivity
         FROM frontend_ask.answer_attempt_evidence WHERE attempt_id=$1 ORDER BY evidence_ordinal`,
        [input.attemptId],
      );
      const question = (
        await client.query('SELECT question FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
          input.answerRunId,
        ])
      ).rows[0].question;
      const current = await packetFor(
        this.pool,
        actor(input.scope.projectId, input.attemptId, input.answerRunId, input.workerId),
        evidence.rows,
        question,
        context.revision !== 'surfer.ask-memory.v1',
        [
          'surfer.ask-memory.v3',
          'surfer.ask-memory.v4',
          'surfer.ask-memory.v5',
          'surfer.ask-memory.v6',
          'surfer.ask-memory.v7',
          'surfer.ask-memory.v8',
          'surfer.ask-memory.v9',
        ].includes(context.revision),
        [
          'surfer.ask-memory.v4',
          'surfer.ask-memory.v5',
          'surfer.ask-memory.v6',
          'surfer.ask-memory.v7',
          'surfer.ask-memory.v8',
          'surfer.ask-memory.v9',
        ].includes(context.revision),
        !!context.packet?.discovery,
        [
          'surfer.ask-memory.v6',
          'surfer.ask-memory.v7',
          'surfer.ask-memory.v8',
          'surfer.ask-memory.v9',
        ].includes(context.revision),
        ['surfer.ask-memory.v7', 'surfer.ask-memory.v8', 'surfer.ask-memory.v9'].includes(
          context.revision,
        ),
        ['surfer.ask-memory.v8', 'surfer.ask-memory.v9'].includes(context.revision),
        context.revision === 'surfer.ask-memory.v9',
      );
      if (surferDigest(current) !== surferDigest(context.packet)) throw stale();
      if (context.packet.discovery) {
        const receipt = input.meaningProposal;
        if (!receipt || !input.provider) throw stale();
        assertAskMeaningProposalReceipt(
          {
            context,
            question,
            evidence: evidence.rows,
            wire: receipt.wire,
            producer: {
              provider: input.provider.provider,
              model: input.provider.model,
              ...(input.provider.adapterVersion
                ? { adapterVersion: input.provider.adapterVersion }
                : {}),
            },
            responseDigest: receipt.responseDigest,
          },
          receipt,
        );
        await client.query(
          `INSERT INTO frontend_ask.surfer_meaning_proposals(attempt_id,answer_run_id,project_id,context_digest,receipt,digest) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(attempt_id) DO NOTHING`,
          [
            input.attemptId,
            input.answerRunId,
            input.scope.projectId,
            context.digest,
            JSON.stringify(receipt),
            receipt.digest,
          ],
        );
        const stored = (
          await client.query(
            'SELECT receipt,digest,answer_run_id,project_id,context_digest FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [input.attemptId],
          )
        ).rows[0];
        if (
          stored?.digest !== receipt.digest ||
          stored.answer_run_id !== input.answerRunId ||
          stored.project_id !== input.scope.projectId ||
          stored.context_digest !== context.digest ||
          surferDigest(stored.receipt) !== surferDigest(receipt)
        )
          throw stale();
      } else if (input.meaningProposal) throw stale();
    }
  }
  private async assertPins(
    client: PoolClient,
    a: SurferAskSourceRequest,
    context: SurferAskMemoryContext,
  ) {
    await authorizeSurferAskRead(client, a);
    const packet = context.packet;
    if (!packet) return;
    const route = (
      await client.query('SELECT mode FROM surfer_rows.route WHERE space_id=$1', [a.projectId])
    ).rows[0];
    const profile = route && ['ROWS', 'SUSPENDED'].includes(route.mode) ? 'ROWS' : 'LEGACY';
    if ((route && ['COPYING', 'CONFLICT'].includes(route.mode)) || profile !== packet.storage)
      throw stale();
    if (profile === 'LEGACY') {
      const core = (
          await client.query(
            'SELECT payload,digest FROM surfer_knowledge.space_state WHERE space_id=$1 FOR SHARE',
            [a.projectId],
          )
        ).rows[0],
        binding = (
          await client.query(
            'SELECT payload,digest FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1 FOR SHARE',
            [a.projectId],
          )
        ).rows[0];
      if (
        !core ||
        !binding ||
        surferDigest(core.payload) !== core.digest ||
        surferDigest(binding.payload) !== binding.digest ||
        // V2 publication deliberately preserves the V1 active pointer. The sidecar owns selection.
        binding.payload.activeSnapshotId !== packet.snapshot.snapshotId ||
        !core.payload.snapshots.some(
          (s: { snapshotId: string; digest: string }) =>
            s.snapshotId === packet.snapshot.snapshotId && s.digest === packet.snapshot.digest,
        )
      )
        throw stale();
    } else {
      const core = (
          await client.query(
            'SELECT payload,digest FROM surfer_rows.space WHERE space_id=$1 FOR SHARE',
            [a.projectId],
          )
        ).rows[0],
        snapshot = (
          await client.query(
            "SELECT payload FROM surfer_rows.record WHERE space_id=$1 AND kind='SNAPSHOT' AND record_id=$2",
            [a.projectId, packet.snapshot.snapshotId],
          )
        ).rows[0];
      if (
        !core ||
        surferDigest(core.payload) !== core.digest ||
        core.payload.activeSnapshotId !== packet.snapshot.snapshotId ||
        snapshot?.payload.digest !== packet.snapshot.digest
      )
        throw stale();
    }
    // Reuse the Source owner for latest versions and active indexing; no SQL client escapes.
    const bound = new Proxy(this.pool, {
        get: (target, property) => {
          if (property === 'query')
            return (...args: unknown[]) => {
              if (typeof args[0] !== 'string' || !/^\s*SELECT\b/i.test(args[0])) throw stale();
              return Reflect.apply(client.query, client, args);
            };
          if (property === 'connect' || property === 'end')
            return () => {
              throw stale();
            };
          const v = Reflect.get(target, property);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }),
      repository = new PostgresOriginalAssetRepository(bound),
      all = await repository.listProjectSourceVersions(a.projectId);
    for (const pin of packet.sources) {
      const latest = all
        .filter((r) => r.sourceId === pin.sourceId)
        .sort((x, y) => y.versionNumber - x.versionNumber)[0];
      if (
        !latest ||
        latest.sourceVersionId !== pin.sourceVersionId ||
        latest.externalSourceRefreshFailed ||
        latest.stage3State !== 'STAGE3_COMPLETED' ||
        !(await repository.validateActiveEvidenceRevision({ projectId: a.projectId, ...pin }))
      )
        throw stale();
    }
  }
}
