import type { SurferMemoryLanguageService } from '../../../modules/surfer-core/src/memory-language.js';
import {
  SurferProviderExecutor,
  type SurferInterpretationTask,
  type SurferProviderCodec,
} from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import { surferMemoryQuestionCodecForRevision } from './codec-registry.js';
import type {
  SurferMemoryLanguageContext,
  SurferNaturalQuestionProposal,
} from '../../../packages/contracts/src/surfer-memory-language.js';
/** Composition boundary: capture/finish own short transactions; executor owns the intervening model call. */
export class SurferNaturalMemoryAdapter {
  constructor(
    private readonly memory: SurferMemoryLanguageService,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly gateway: SurferProviderGatewayPort,
    private readonly profile: SurferProviderProfile,
    private readonly codecFactory: (
      context: SurferMemoryLanguageContext,
    ) => SurferProviderCodec<SurferNaturalQuestionProposal> = (context) =>
      surferMemoryQuestionCodecForRevision(context, profile.promptRevision),
  ) {}
  async ask(
    actor: unknown,
    request: unknown,
    task: Omit<SurferInterpretationTask, 'basis' | 'selections'>,
  ) {
    const context = await this.memory.capture(actor, request);
    const execution = await new SurferProviderExecutor(
      this.source,
      this.ledger,
      this.gateway,
      this.profile,
      this.codecFactory(context),
      { minimumSensitivity: 'private' },
    ).interpret(actor, { ...task, basis: context.basis, selections: context.selections });
    if (!execution.frame) return { execution, answer: null };
    return { execution, answer: await this.memory.finish(actor, context, execution.frame) };
  }
  resume(actor: unknown, input: unknown) {
    return this.memory.resume(actor, input);
  }
}
