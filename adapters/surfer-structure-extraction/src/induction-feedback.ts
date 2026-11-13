import { SurferInductionCodec } from './induction.js';
import { assessSurferInductionDevelopment } from '../../../modules/surfer-learning/src/development-assessment.js';
import {
  decodeSurferRuleCandidate,
  type SurferRuleCandidate,
} from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferProviderCodec } from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferObservedProviderResponse,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';

export class SurferInductionFeedbackCodec implements SurferProviderCodec<SurferRuleCandidate> {
  readonly revision = 'surfer-induction-development-feedback-v1';
  private readonly base: SurferInductionCodec;
  private readonly feedback: unknown;
  constructor(development: unknown, previous: SurferRuleCandidate | null) {
    this.base = new SurferInductionCodec(development);
    if (previous) {
      const c = decodeSurferRuleCandidate(previous),
        a = assessSurferInductionDevelopment(development, c);
      this.feedback = {
        candidateDigest: a.candidateDigest,
        expression: c.expression,
        total: a.total,
        correct: a.correct,
        unknown: a.unknown,
        mismatches: a.mismatches,
        evidenceLevel: a.evidenceLevel,
      };
    } else this.feedback = null;
  }
  generation(view: SurferCognitiveView, profile: SurferProviderProfile) {
    const g = this.base.generation(view, profile);
    return {
      ...g,
      systemInstruction:
        g.systemInstruction +
        ' Check consistency against EVERY supplied development case. If feedback is present, revise your previous hypothesis to address the provided development contradictions. Feedback contains only already-public development observations, not independent evaluation results. Do not copy a guessed pattern without checking all cases. No hidden target rule or evaluation data is available.',
      prompt: JSON.stringify({
        ...JSON.parse(g.prompt),
        phase: 'DEVELOPMENT_CONSISTENCY',
        feedback: this.feedback,
      }),
    };
  }
  decode(
    response: SurferObservedProviderResponse,
    view: SurferCognitiveView,
    reservationId: string,
    profile: SurferProviderProfile,
  ) {
    return this.base.decode(response, view, reservationId, profile);
  }
}
