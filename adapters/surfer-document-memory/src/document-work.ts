import type { SurferDocumentWorkPort } from '../../../packages/contracts/src/surfer-document-work.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import { SurferProviderExecutor } from '../../../modules/surfer-execution/src/provider-executor.js';
import { SurferDirectiveExtractionCodecV3 } from '../../surfer-structure-extraction/src/directive-v3.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
/** Trusted server job. The provider phase never holds a Source transaction. */
export class SurferDocumentMemoryWorker {
  private readonly executor: SurferProviderExecutor<SurferDirectiveExtractionV2>;
  constructor(
    private readonly owner: SurferDocumentWorkPort,
    source: SurferCognitiveSourcePort,
    ledger: SurferExecutionLedger,
    gateway: SurferProviderGatewayPort,
    profile: SurferProviderProfile,
  ) {
    this.executor = new SurferProviderExecutor(
      source,
      ledger,
      gateway,
      profile,
      new SurferDirectiveExtractionCodecV3(),
    );
  }
  prepare(actor: unknown, input: unknown) {
    return this.owner.prepare(actor, input);
  }
  prepareIndexed(actor: unknown, input: unknown) {
    return this.owner.prepareIndexed(actor, input);
  }
  async run(actor: unknown, prepared: unknown) {
    const done = await this.owner.completed(actor, prepared);
    if (done) return { status: 'COMPLETED' as const, receipt: done, replayed: true };
    const work = await this.owner.read(actor, prepared),
      execution = await this.executor.interpret(actor, work.task);
    if (
      !execution.frame ||
      execution.frame.clauses.proposal.interpretation.state !== 'RESOLVED' ||
      !execution.frame.meaning
    )
      return {
        status: 'INCOMPLETE' as const,
        receipt: null,
        replayed: execution.replayed,
        executionStatus: execution.status,
      };
    return {
      status: 'COMPLETED' as const,
      receipt: await this.owner.complete(actor, { prepared, frame: execution.frame }),
      replayed: execution.replayed,
    };
  }
}
