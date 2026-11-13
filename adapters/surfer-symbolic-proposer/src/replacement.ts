import {
  decodeSurferRepairRequest,
  decodeSurferRepairProposal,
  type SurferRepairProposerPort,
  type SurferRepairRequest,
} from '../../../packages/contracts/src/surfer-rule-replacement.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  zeroSurferUsage,
  type SurferLocalWorkerPort,
} from '../../../packages/contracts/src/surfer-execution.js';
import {
  SurferLocalScheduler,
  type SurferExecutionLedger,
} from '../../../modules/surfer-execution/src/index.js';
export class SurferReplacementLocalProposer implements SurferRepairProposerPort {
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
      throw surferFailure('Replacement proposer requires a zero-provider single-worker allowance.');
    this.scheduler = new SurferLocalScheduler(ledger, worker);
  }
  async propose(input: SurferRepairRequest, signal?: AbortSignal) {
    const request = decodeSurferRepairRequest(input),
      payload = { request },
      execution = await this.scheduler.submit(
        {
          schemaVersion: '1.0.0',
          operationId: request.operationId,
          runId: request.runId,
          stepId: 'replacement-propose',
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
    const proposal = decodeSurferRepairProposal(execution.checkpoint, request);
    if (execution.resultRef !== surferDigest(proposal))
      throw surferFailure('Replacement checkpoint differs.');
    return { execution, proposal };
  }
  close() {
    this.scheduler.close();
  }
}
