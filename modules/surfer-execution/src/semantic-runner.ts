import { randomUUID } from 'node:crypto';
import {
  decodeSurferSemanticBatch,
  type SurferSemanticBatchSpec,
  type SurferSemanticApprovalPort,
  type SurferSemanticApproval,
  type SurferSemanticDatasetPort,
  type SurferSemanticRunStorePort,
  type SurferSemanticRunState,
} from '../../../packages/contracts/src/surfer-semantic-run.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  decodeSurferProviderProfile,
  type SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferExecutionLedger } from './index.js';
import type { SurferProviderExecutor, SurferInterpretationTask } from './provider-executor.js';

export type SurferSemanticRunResult = {
  status:
    'COMPLETED' | 'STOPPED' | 'RECOVERY_REQUIRED' | 'SOURCE_UNAVAILABLE' | 'APPROVAL_UNAVAILABLE';
  runId: string;
  mode: 'LIVE' | 'ISOLATED_CONTRACT';
  completedCases: number | null;
  uncommittedCases: number | null;
  possibleProviderCalls: number | null;
  confirmedProviderResponses: number | null;
  evidenceKind: 'LIVE_PROFILE_REQUIRES_TRANSPORT_AUDIT' | 'ISOLATED_CONTRACT_NOT_MODEL_EVALUATION';
  stopReason: string | null;
  evaluation: unknown | null;
};
/** Trusted coordinator: no HTTP loop, no rule learning, no automatic unknown retry. */
export class SurferSemanticBatchRunner {
  private readonly profile: SurferProviderProfile;
  constructor(
    private readonly store: SurferSemanticRunStorePort,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly interpreter: Pick<SurferProviderExecutor<unknown>, 'interpret'>,
    private readonly dataset: SurferSemanticDatasetPort,
    private readonly approval: SurferSemanticApprovalPort,
    private readonly pins: {
      profile: unknown;
      codeDigest: string;
      metadataDigest: string;
      pricingDigest: string;
    },
    private readonly clock = Date.now,
  ) {
    this.profile = decodeSurferProviderProfile(pins.profile);
  }
  private validate(input: unknown): SurferSemanticBatchSpec {
    const s = decodeSurferSemanticBatch(input),
      p = s.protocol,
      m = this.dataset.manifest;
    if (
      p.mode !== this.profile.mode ||
      p.profileDigest !== surferDigest(this.profile) ||
      p.budgetPolicyDigest !== surferDigest(this.ledger.policy) ||
      this.ledger.policy.limits.calls !== p.maxProviderCalls ||
      p.codeDigest !== this.pins.codeDigest ||
      p.metadataDigest !== this.pins.metadataDigest ||
      p.pricingDigest !== this.pins.pricingDigest ||
      p.datasetDigest !== surferDigest(m) ||
      p.sourceDigest !== m.sourceDigest ||
      p.oracleDigest !== m.oracleDigest ||
      p.evaluatorRevision !== m.evaluatorRevision ||
      surferDigest(p.caseIds) !== surferDigest(m.records.map((r) => r.id)) ||
      p.expiresAtMs > this.ledger.policy.deadlineAtMs ||
      this.ledger.policy.maxConcurrent !== 1 ||
      s.cases.some((c) => c.textDigest !== this.dataset.input(c.caseId).textDigest)
    )
      throw surferFailure('Semantic protocol/source/profile/evaluator pin changed.');
    return s;
  }
  private async approved(s: SurferSemanticBatchSpec): Promise<SurferSemanticApproval> {
    const a = await this.approval.verify(structuredClone(s));
    assertSurferJson(a);
    if (
      Object.keys(a).sort().join(',') !==
        'approvalRef,expiresAtMs,mode,profileDigest,reviewDigest,specDigest' ||
      typeof a.approvalRef !== 'string' ||
      !a.approvalRef ||
      a.approvalRef.length > 256 ||
      a.mode !== s.protocol.mode ||
      a.specDigest !== surferDigest(s) ||
      a.reviewDigest !== s.protocol.reviewDigest ||
      a.profileDigest !== s.protocol.profileDigest ||
      !Number.isSafeInteger(a.expiresAtMs) ||
      !Number.isSafeInteger(this.clock()) ||
      this.clock() >= Math.min(a.expiresAtMs, s.protocol.expiresAtMs)
    )
      throw surferFailure('Semantic run approval unavailable or expired.');
    return structuredClone(a);
  }
  private async current(s: SurferSemanticBatchSpec, actor: unknown): Promise<void> {
    await this.source.withCurrent(
      actor,
      s.basis,
      s.cases.map((c) => c.selection),
      (view) => {
        if (
          view.anchors.length !== s.cases.length ||
          view.anchors.some((a, i) => surferDigest(a.rawLiteral) !== s.cases[i]!.textDigest)
        )
          throw surferFailure('Semantic source content changed.');
        return null;
      },
    );
  }
  private task(s: SurferSemanticBatchSpec, caseId: string): SurferInterpretationTask {
    const c = s.cases.find((c) => c.caseId === caseId)!;
    return {
      schemaVersion: '1.0.0',
      operationId: `semantic:${s.protocol.runId}:${caseId}`,
      runId: s.protocol.runId,
      stepId: caseId,
      attempt: 1,
      priority: 'FOREGROUND',
      basis: s.basis,
      selections: [c.selection],
    };
  }
  private summary(
    s: SurferSemanticBatchSpec,
    state: SurferSemanticRunState,
    status: SurferSemanticRunResult['status'],
  ): SurferSemanticRunResult {
    const confirmed = state.rows.filter((r) => r.observedResponse).length;
    return {
      status,
      runId: s.protocol.runId,
      mode: s.protocol.mode,
      completedCases: state.rows.filter((r) =>
        ['CANDIDATE_NOT_SEMANTICALLY_VALIDATED', 'INVALID_OUTPUT'].includes(r.status),
      ).length,
      uncommittedCases: s.cases.length - state.rows.length,
      possibleProviderCalls:
        state.rows.filter((r) => r.possibleCall).length + (state.inflight ? 1 : 0),
      confirmedProviderResponses: confirmed,
      evidenceKind:
        s.protocol.mode === 'LIVE'
          ? 'LIVE_PROFILE_REQUIRES_TRANSPORT_AUDIT'
          : 'ISOLATED_CONTRACT_NOT_MODEL_EVALUATION',
      stopReason: state.stopReason,
      evaluation: status === 'COMPLETED' ? state.evaluation : null,
    };
  }
  async run(
    actor: unknown,
    input: unknown,
    options: { recover?: boolean; signal?: AbortSignal } = {},
  ): Promise<SurferSemanticRunResult> {
    const s = this.validate(input),
      runId = s.protocol.runId;
    let authorization: SurferSemanticApproval;
    try {
      authorization = await this.approved(s);
    } catch {
      return {
        status: 'APPROVAL_UNAVAILABLE',
        runId,
        mode: s.protocol.mode,
        completedCases: null,
        uncommittedCases: null,
        possibleProviderCalls: null,
        confirmedProviderResponses: null,
        evidenceKind:
          s.protocol.mode === 'LIVE'
            ? 'LIVE_PROFILE_REQUIRES_TRANSPORT_AUDIT'
            : 'ISOLATED_CONTRACT_NOT_MODEL_EVALUATION',
        stopReason: 'APPROVAL_UNAVAILABLE',
        evaluation: null,
      };
    }
    try {
      await this.current(s, actor);
    } catch {
      const state = await this.store.transaction(runId, (row) => {
        if (row.specDigest && row.specDigest !== surferDigest(s))
          throw surferFailure('Semantic run id changed meaning.');
        return row;
      });
      return this.summary(s, state, 'SOURCE_UNAVAILABLE');
    }
    const owner = randomUUID();
    const initial = await this.store.transaction(runId, (state) => {
      if (state.specDigest && state.specDigest !== surferDigest(s))
        throw surferFailure('Semantic run id changed meaning.');
      if (state.approvalRef && state.approvalRef !== authorization.approvalRef)
        throw surferFailure('Semantic run approval reference changed.');
      if (state.stage === 'NEW') {
        state.specDigest = surferDigest(s);
        state.approvalRef = authorization.approvalRef;
        state.stage = 'RUNNING';
        state.owner = owner;
        state.sequence++;
        return { state, acquired: true };
      }
      return { state, acquired: false };
    });
    if (initial.state.stage === 'COMPLETED' || initial.state.stage === 'STOPPED')
      return this.summary(s, initial.state, initial.state.stage);
    if (!initial.acquired) {
      if (!options.recover || !this.approval.recover)
        return this.summary(s, initial.state, 'RECOVERY_REQUIRED');
      await this.approval.recover(structuredClone(s), initial.state.owner!);
      const acquired = await this.store.transaction(runId, (state) => {
        if (state.owner !== initial.state.owner || state.stage !== 'RUNNING') return false;
        state.owner = owner;
        state.sequence++;
        return true;
      });
      if (!acquired)
        return this.summary(
          s,
          await this.store.transaction(runId, (state) => state),
          'RECOVERY_REQUIRED',
        );
    }
    const stop = async (reason: string) =>
      this.store.transaction(runId, (state) => {
        if (state.owner === owner && state.stage === 'RUNNING') {
          state.stage = 'STOPPED';
          state.stopReason = reason;
          // An interrupted provider dispatch remains a possible call until reconciled.
          state.sequence++;
        }
        return state;
      });
    for (;;) {
      try {
        await this.approved(s);
      } catch {
        return this.summary(s, await stop('APPROVAL_UNAVAILABLE'), 'STOPPED');
      }
      try {
        await this.current(s, actor);
      } catch {
        return this.summary(s, await stop('SOURCE_UNAVAILABLE'), 'SOURCE_UNAVAILABLE');
      }
      if (options.signal?.aborted) return this.summary(s, await stop('CANCELLED'), 'STOPPED');
      const next = await this.store.transaction(runId, (state) => {
        if (state.owner !== owner || state.stage !== 'RUNNING') return null;
        const c = s.cases[state.rows.length];
        if (!c) return { caseId: null };
        if (state.inflight && state.inflight !== c.caseId)
          throw surferFailure('Semantic cursor changed.');
        if (!state.inflight) {
          state.inflight = c.caseId;
          state.sequence++;
        }
        return { caseId: c.caseId };
      });
      if (next === null)
        return this.summary(
          s,
          await this.store.transaction(runId, (state) => state),
          'RECOVERY_REQUIRED',
        );
      if (next.caseId === null) break;
      const task = this.task(s, next.caseId);
      let out;
      try {
        out = await this.interpreter.interpret(actor, task, options.signal);
      } catch {
        return this.summary(s, await stop('EXECUTION_OR_BUDGET_UNAVAILABLE'), 'STOPPED');
      }
      let possibleCall = out.reservationId !== null,
        observedResponse = false;
      if (out.reservationId) {
        try {
          const r = await this.ledger.read(out.reservationId, s.basis.authority.projectId);
          possibleCall =
            r.state !== 'RESERVED' &&
            r.state !== 'CANCELLED_BEFORE_DISPATCH' &&
            (r.usage ? r.usage.calls > 0 : true);
          observedResponse =
            !!r.checkpoint &&
            typeof r.checkpoint === 'object' &&
            'kind' in r.checkpoint &&
            r.checkpoint.kind === 'SURFER_PROVIDER_RESPONSE';
        } catch {
          /* Unavailable accounting remains a possible call, never an invented zero. */
        }
      }
      const stored = await this.store.transaction(runId, (state) => {
        if (state.owner !== owner || state.stage !== 'RUNNING' || state.inflight !== next.caseId)
          return false;
        state.rows.push({
          caseId: next.caseId!,
          operationId: task.operationId,
          reservationId: out.reservationId,
          status: out.status,
          frameDigest: out.frame ? surferDigest(out.frame) : null,
          possibleCall,
          observedResponse,
        });
        state.inflight = null;
        if (!['CANDIDATE_NOT_SEMANTICALLY_VALIDATED', 'INVALID_OUTPUT'].includes(out.status)) {
          state.stage = 'STOPPED';
          state.stopReason = out.status;
        }
        state.sequence++;
        return true;
      });
      if (!stored)
        return this.summary(
          s,
          await this.store.transaction(runId, (state) => state),
          'RECOVERY_REQUIRED',
        );
      const state = await this.store.transaction(runId, (state) => state);
      if (state.stage === 'STOPPED') return this.summary(s, state, 'STOPPED');
    }
    // Reconstruct candidates exclusively from previously observed durable provider output.
    const state = await this.store.transaction(runId, (state) => state),
      rows: { caseId: string; frame: unknown }[] = [];
    for (const row of state.rows) {
      if (!row.reservationId) return this.summary(s, await stop('RESULT_UNAVAILABLE'), 'STOPPED');
      const record = await this.ledger.read(row.reservationId, s.basis.authority.projectId);
      if (!['SETTLED', 'FAILED_KNOWN'].includes(record.state) || !record.checkpoint)
        return this.summary(s, await stop('RESULT_UNAVAILABLE'), 'STOPPED');
      const replay = await this.interpreter.interpret(actor, this.task(s, row.caseId));
      if (
        !replay.replayed ||
        replay.status !== row.status ||
        (replay.frame ? surferDigest(replay.frame) : null) !== row.frameDigest
      )
        return this.summary(s, await stop('RESULT_CHANGED'), 'STOPPED');
      rows.push({ caseId: row.caseId, frame: replay.frame ?? {} });
    }
    try {
      await this.current(s, actor);
      await this.approved(s);
    } catch {
      return this.summary(
        s,
        await stop('CURRENTNESS_OR_APPROVAL_UNAVAILABLE'),
        'SOURCE_UNAVAILABLE',
      );
    }
    const evaluation = this.dataset.evaluate(rows);
    assertSurferJson(evaluation);
    const done = await this.store.transaction(runId, (draft) => {
      if (draft.owner !== owner || draft.stage !== 'RUNNING') return draft;
      draft.stage = 'COMPLETED';
      draft.evaluation = structuredClone(evaluation);
      draft.sequence++;
      return draft;
    });
    return this.summary(s, done, done.stage === 'COMPLETED' ? 'COMPLETED' : 'RECOVERY_REQUIRED');
  }
}
