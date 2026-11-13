import type { Pool } from 'pg';
import { decodeSurferAskMeaningProposalReceipt } from '../../../packages/contracts/src/surfer-ask-discovery.js';
import { decodeSurferAskMemoryContext } from '../../../packages/contracts/src/surfer-ask-memory.js';
import {
  decodeSurferMeaningVerificationWork,
  type SurferMeaningVerificationWork,
} from '../../../packages/contracts/src/surfer-meaning-verification.js';
import type {
  SurferCognitiveSourcePort,
  SurferCognitiveView,
  SurferObservationSelection,
} from '../../../packages/contracts/src/surfer-cognition.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeSlice } from '../../../packages/contracts/src/document-evidence.js';
import {
  decodeSurferProviderProfile,
  SurferProviderNotSentError,
  type SurferProviderGatewayPort,
  type SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import {
  SurferProviderExecutor,
  type SurferInterpretationTask,
} from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import { SurferMeaningVerificationCodec } from '../../surfer-structure-extraction/src/meaning-verification.js';

type Reference = { attemptId: string; candidateIndex: number };
/** Explicit server work only. Does not install a worker, alter Ask, or adopt knowledge. */
export class PostgresSurferMeaningVerification {
  private readonly profile: SurferProviderProfile;
  constructor(
    private readonly pool: Pool,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly gateway: SurferProviderGatewayPort,
    profile: unknown,
    private readonly authorizeBeforeSend?: (actor: unknown) => Promise<unknown>,
  ) {
    this.profile = decodeSurferProviderProfile(profile);
  }
  private async load(view: SurferCognitiveView, ref: Reference) {
    assertSurferJson(ref);
    if (
      !ref ||
      Object.keys(ref).sort().join(',') !== 'attemptId,candidateIndex' ||
      typeof ref.attemptId !== 'string' ||
      !ref.attemptId.length ||
      ref.attemptId.length > 256 ||
      !Number.isSafeInteger(ref.candidateIndex) ||
      ref.candidateIndex < 0 ||
      ref.candidateIndex > 7
    )
      throw surferFailure('Invalid saved meaning candidate reference.');
    const row = (
      await this.pool.query(
        `SELECT p.receipt,p.digest,c.context,c.digest AS context_digest FROM frontend_ask.surfer_meaning_proposals p JOIN frontend_ask.surfer_memory_context c ON c.attempt_id=p.attempt_id JOIN frontend_ask.answer_runs r ON r.answer_run_id=p.answer_run_id JOIN frontend_command.command_ledger command ON command.command_id=r.create_command_id WHERE p.attempt_id=$1 AND p.project_id=$2 AND r.state='SUCCEEDED' AND command.principal_id=$3 AND command.command_type='SUBMIT_QUESTION' AND command.target_project_id=p.project_id AND command.outcome_state='COMPLETED' AND command.completion_disposition='SUCCEEDED'`,
        [ref.attemptId, view.basis.authority.projectId, view.basis.authority.principalId],
      )
    ).rows[0];
    if (!row) throw surferFailure('Saved candidate is not available to this Source actor.');
    const receipt = decodeSurferAskMeaningProposalReceipt(row.receipt),
      context = decodeSurferAskMemoryContext(row.context),
      candidate = receipt.candidates[ref.candidateIndex];
    if (
      receipt.digest !== row.digest ||
      receipt.contextDigest !== context.digest ||
      context.digest !== row.context_digest ||
      !candidate
    )
      throw surferFailure('Saved candidate or context changed.');
    const rule = context.packet?.rules?.find(
        (r) => surferDigest(r.memory) === surferDigest(candidate.rule),
      ),
      field = rule?.fields.find((f) => f.name === candidate.field);
    if (
      !rule ||
      !field ||
      view.anchors.length < 2 ||
      view.anchors.length > 8 ||
      view.anchors.reduce((n, a) => n + a.rawLiteral.length, 0) > 8192
    )
      throw surferFailure('No bounded field contract or review passages.');
    const origin = view.anchors.find(
      (a) =>
        a.source.sourceId === candidate.source.sourceId &&
        a.source.sourceVersionId === candidate.source.sourceVersionId &&
        a.source.evidenceId === candidate.source.evidenceId &&
        a.source.revisionId === candidate.source.revisionId &&
        a.source.pointer === '' &&
        a.position.start <= candidate.sourceSpan.start &&
        a.position.end >= candidate.sourceSpan.end &&
        unicodeSlice(
          a.rawLiteral,
          candidate.sourceSpan.start - a.position.start,
          candidate.sourceSpan.end - a.position.start,
        ) === candidate.sourceSpan.quote,
    );
    const normalized = (s: string) =>
      s
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/[.!。]$/u, '');
    if (
      !origin ||
      !view.anchors.some(
        (a) =>
          a.source.sourceId !== origin.source.sourceId &&
          normalized(a.rawLiteral) !== normalized(origin.rawLiteral),
      )
    )
      throw surferFailure('Current origin and separate-content Source are required.');
    return {
      receipt,
      candidate,
      target: { domain: rule.domain, description: rule.description, field },
    };
  }
  private async bind(
    view: SurferCognitiveView,
    ref: Reference,
    selections: SurferObservationSelection[],
  ) {
    const loaded = await this.load(view, ref),
      body = {
        revision: 'surfer.meaning-verification-work.v1' as const,
        proposal: {
          ...ref,
          receiptDigest: loaded.receipt.digest,
          contextDigest: loaded.receipt.contextDigest,
        },
        candidate: loaded.candidate,
        target: loaded.target,
        proposer: loaded.receipt.producer,
        basis: view.basis,
        selections,
        viewDigest: view.viewDigest,
        profileDigest: surferDigest(this.profile),
      };
    return decodeSurferMeaningVerificationWork({ ...body, digest: surferDigest(body) });
  }
  async prepare(
    sourceRequest: unknown,
    reference: Reference,
    selections: SurferObservationSelection[],
  ): Promise<SurferMeaningVerificationWork> {
    const view = await this.source.observe(sourceRequest, { schemaVersion: '1.0.0', selections });
    const work = await this.bind(view, reference, selections);
    return this.source.withCurrent(sourceRequest, work.basis, work.selections, () => work);
  }
  async verify(
    sourceRequest: unknown,
    input: unknown,
    task: Omit<SurferInterpretationTask, 'basis' | 'selections'>,
    signal?: AbortSignal,
  ) {
    const work = decodeSurferMeaningVerificationWork(input),
      ref = { attemptId: work.proposal.attemptId, candidateIndex: work.proposal.candidateIndex };
    const current = async (view: SurferCognitiveView) => {
      if ((await this.bind(view, ref, work.selections)).digest !== work.digest)
        throw surferFailure('Meaning verification preparation is no longer current.');
    };
    const guarded: SurferCognitiveSourcePort = {
      observe: (r, s) => this.source.observe(r, s),
      withCurrent: async (r, b, s, apply) => {
        const view = await this.source.withCurrent(r, b, s, (v) => structuredClone(v));
        await current(view);
        const out = await this.source.withCurrent(r, b, s, apply);
        await current(view);
        return this.source.withCurrent(r, b, s, () => out);
      },
    };
    const authorize = this.authorizeBeforeSend;
    const gateway: SurferProviderGatewayPort = authorize
      ? {
          prepare: async (binding, generation) => {
            const prepared = await this.gateway.prepare(binding, generation);
            return {
              ...prepared,
              generate: async (signal) => {
                try {
                  await authorize(sourceRequest);
                } catch {
                  throw new SurferProviderNotSentError();
                }
                return prepared.generate(signal);
              },
            };
          },
          reconcile: (...args) => this.gateway.reconcile(...args),
        }
      : this.gateway;
    return new SurferProviderExecutor(
      guarded,
      this.ledger,
      gateway,
      this.profile,
      new SurferMeaningVerificationCodec(work, this.profile.promptRevision),
      { minimumSensitivity: 'private' },
    ).interpret(sourceRequest, { ...task, basis: work.basis, selections: work.selections }, signal);
  }
}
