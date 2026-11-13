import {
  decodeSurferContinuationRequest,
  decodeSurferContinuationProposal,
  type SurferContinuationProposerPort,
  type SurferContinuationRequest,
} from '../../../packages/contracts/src/surfer-rule-continuation.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  zeroSurferUsage,
  type SurferLocalWorkerPort,
} from '../../../packages/contracts/src/surfer-execution.js';
import {
  SurferLocalScheduler,
  type SurferExecutionLedger,
} from '../../../modules/surfer-execution/src/index.js';
export class SurferContinuationLocalProposer implements SurferContinuationProposerPort {
  private readonly scheduler;
  constructor(
    private readonly ledger: SurferExecutionLedger,
    worker: SurferLocalWorkerPort,
  ) {
    if (
      ledger.policy.maxConcurrent !== 1 ||
      ['calls', 'inputTokens', 'outputTokens', 'moneyMicros'].some(
        (k) => ledger.policy.limits[k as 'calls'] !== 0,
      )
    )
      throw surferFailure(
        'Continuation proposer requires a zero-provider single-worker allowance.',
      );
    this.scheduler = new SurferLocalScheduler(ledger, worker);
  }
  async propose(input: SurferContinuationRequest, signal?: AbortSignal) {
    const request = decodeSurferContinuationRequest(input),
      payload = { request },
      execution = await this.scheduler.submit(
        {
          schemaVersion: '1.0.0',
          operationId: request.operationId,
          runId: request.runId,
          stepId: 'chain-propose',
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
    const proposal = decodeSurferContinuationProposal(execution.checkpoint, request);
    if (execution.resultRef !== surferDigest(proposal))
      throw surferFailure('Continuation checkpoint differs.');
    return { execution, proposal };
  }
  close() {
    this.scheduler.close();
  }
}
