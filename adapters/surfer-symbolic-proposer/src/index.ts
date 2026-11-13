import {
  decodeSurferBoundedRequest,
  decodeSurferBoundedLimits,
  decodeSurferBoundedProposal,
  SURFER_BOUNDED_LIMITS,
  type SurferBoundedProposerPort,
  type SurferBoundedRequest,
} from '../../../packages/contracts/src/surfer-bounded-induction.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  zeroSurferUsage,
  type SurferLocalWorkerPort,
} from '../../../packages/contracts/src/surfer-execution.js';
import {
  SurferLocalScheduler,
  type SurferExecutionLedger,
} from '../../../modules/surfer-execution/src/index.js';

export class SurferBoundedLocalProposer implements SurferBoundedProposerPort {
  private readonly scheduler: SurferLocalScheduler;
  private readonly limits;
  constructor(
    private readonly ledger: SurferExecutionLedger,
    worker: SurferLocalWorkerPort,
    limits: unknown = SURFER_BOUNDED_LIMITS,
  ) {
    this.limits = decodeSurferBoundedLimits(limits);
    if (
      ledger.policy.maxConcurrent !== 1 ||
      ledger.policy.limits.calls !== 0 ||
      ledger.policy.limits.inputTokens !== 0 ||
      ledger.policy.limits.outputTokens !== 0 ||
      ledger.policy.limits.moneyMicros !== 0
    )
      throw surferFailure('Local proposer requires a single-worker,zero-provider budget.');
    this.scheduler = new SurferLocalScheduler(ledger, worker);
  }
  async propose(input: SurferBoundedRequest, signal?: AbortSignal) {
    const request = decodeSurferBoundedRequest(input),
      payload = { request, limits: structuredClone(this.limits) };
    const execution = await this.scheduler.submit(
      {
        schemaVersion: '1.0.0',
        operationId: request.operationId,
        runId: request.runId,
        stepId: 'bounded-propose',
        attempt: 1,
        spaceId: request.spaceId,
        inputDigest: surferDigest(payload),
        priority: 'FOREGROUND',
        kind: 'PROPOSE',
        executionKind: 'LOCAL_DETERMINISTIC',
        dependsOn: [],
        maximum: { ...zeroSurferUsage(), elapsedMs: this.ledger.policy.unitMaxMs },
      },
      payload,
      signal,
    );
    if (execution.state !== 'SETTLED' || execution.outcome !== 'SUCCEEDED')
      return { execution, proposal: null };
    const proposal = decodeSurferBoundedProposal(execution.checkpoint, request, this.limits);
    if (execution.resultRef !== surferDigest(proposal))
      throw surferFailure('Local proposal checkpoint digest differs.');
    return { execution, proposal };
  }
  close() {
    this.scheduler.close();
  }
}
