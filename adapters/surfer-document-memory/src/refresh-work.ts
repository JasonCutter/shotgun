import type { SurferMemoryRefreshWorkPort } from '../../../packages/contracts/src/surfer-memory-refresh-work.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import { SurferProviderExecutor } from '../../../modules/surfer-execution/src/provider-executor.js';
import { SurferDirectiveExtractionCodecV3 } from '../../surfer-structure-extraction/src/directive-v3.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
/** One caller-triggered backend work item; no Source transaction spans provider execution. */
export class SurferMemoryRefreshWorker {
  constructor(
    private readonly owner: SurferMemoryRefreshWorkPort,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly gateway: SurferProviderGatewayPort,
    private readonly profile: SurferProviderProfile,
  ) {}
  async run(actor: unknown, prepared: unknown) {
    const done = await this.owner.completed(actor, prepared);
    if (done) {
      if (done.profileDigest !== surferDigest(this.profile))
        throw surferFailure('Completed refresh profile differs.');
      return { status: 'COMPLETED' as const, receipt: done, replayed: true, executions: [] };
    }
    const work = await this.owner.read(actor, prepared);
    if (work.profileDigest !== surferDigest(this.profile))
      throw surferFailure('Prepared refresh profile differs.');
    const executor = new SurferProviderExecutor(
      this.source,
      this.ledger,
      this.gateway,
      this.profile,
      new SurferDirectiveExtractionCodecV3(),
    );
    const frames: SurferDirectiveExtractionV2[] = [],
      executions = [];
    for (const target of work.targets) {
      const execution = await executor.interpret(actor, target.task);
      executions.push(execution);
      if (
        !execution.frame ||
        execution.frame.clauses.proposal.interpretation.state !== 'RESOLVED' ||
        !execution.frame.meaning
      )
        return { status: 'INCOMPLETE' as const, receipt: null, replayed: false, executions };
      frames.push(execution.frame);
      await this.owner.validate(actor, prepared, frames);
    }
    return {
      status: 'COMPLETED' as const,
      receipt: await this.owner.complete(actor, { prepared, frames }),
      replayed: false,
      executions,
    };
  }
}
