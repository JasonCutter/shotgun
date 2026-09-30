export const VP_RELATION_CHOICES = [
  'EQUIVALENT',
  'SUPPORTS',
  'QUALIFIES',
  'CONTRADICTS',
  'RELATED',
  'UNRESOLVED',
] as const;

export type VPRelationChoice = (typeof VP_RELATION_CHOICES)[number];

export const VP_RELATION_DIRECTIONS = ['NONE', 'LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'] as const;

export type VPRelationDirection = (typeof VP_RELATION_DIRECTIONS)[number];

export type VPDecisionAssertion = {
  readonly assertionId: string;
  readonly sourceVersionId: string;
  readonly evidenceId: string;
  readonly text: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
};

export type VPRelationDecisionRequest = {
  readonly projectId: string;
  readonly left: VPDecisionAssertion;
  readonly right: VPDecisionAssertion;
  readonly allowedAccessScope: readonly string[];
  readonly authorizedSensitivities: readonly VPDecisionAssertion['sensitivity'][];
  /** Computed by the server from the project and provider privacy policy. */
  readonly externalEgressAllowed: boolean;
  readonly policyRevision: string;
  /** Present for durable background relation jobs. Interactive corpus probes may omit it. */
  readonly execution?: {
    readonly jobId: string;
    readonly leaseToken: string;
  };
};

export type VPRelationDecision = {
  readonly choice: VPRelationChoice;
  /** Required for SUPPORTS/QUALIFIES; direction is relative to request.left/right. */
  readonly direction?: VPRelationDirection;
  readonly confidence: number;
  readonly probabilities: Readonly<Partial<Record<VPRelationChoice, number>>>;
  readonly deepAnalysisScore: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly providerRequestId?: string;
};

export type VPDecisionProviderPort = {
  decideRelation(input: VPRelationDecisionRequest): Promise<VPRelationDecision>;
};

export type VPDecisionExecutionClaim =
  | { readonly status: 'STARTED' }
  | { readonly status: 'OUTPUT_STORED'; readonly decision: VPRelationDecision }
  | { readonly status: 'OUTCOME_UNKNOWN' };

/** Durable provider-call boundary owned by the VP relation job Adapter. */
export type VPDecisionExecutionRepositoryPort = {
  claim(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly executionKey: string;
    readonly requestDigest: string;
    readonly providerIdentity: string;
  }): Promise<VPDecisionExecutionClaim>;
  storeOutput(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly executionKey: string;
    readonly requestDigest: string;
    readonly decision: VPRelationDecision;
  }): Promise<VPRelationDecision>;
  markOutcomeUnknown(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly executionKey: string;
    readonly requestDigest: string;
    readonly code: string;
  }): Promise<void>;
};

export class VPDecisionOutcomeUnknownError extends Error {
  readonly code = 'VP_PROVIDER_OUTCOME_UNKNOWN';

  constructor(
    message = 'The provider outcome is unknown and will not be sent again automatically.',
  ) {
    super(message);
    this.name = 'VPDecisionOutcomeUnknownError';
  }
}

export const validVPRelationDecision = (value: VPRelationDecision): boolean => {
  if (
    !VP_RELATION_CHOICES.includes(value.choice) ||
    (value.choice === 'SUPPORTS' || value.choice === 'QUALIFIES'
      ? value.direction !== 'LEFT_TO_RIGHT' && value.direction !== 'RIGHT_TO_LEFT'
      : value.direction !== undefined && value.direction !== 'NONE') ||
    !value.model ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !Number.isFinite(value.deepAnalysisScore) ||
    value.deepAnalysisScore < 0 ||
    value.deepAnalysisScore > 1 ||
    !Number.isSafeInteger(value.inputTokens) ||
    value.inputTokens < 0 ||
    !Number.isSafeInteger(value.outputTokens) ||
    value.outputTokens < 0
  ) {
    return false;
  }
  let total = 0;
  for (const choice of VP_RELATION_CHOICES) {
    const probability = value.probabilities[choice];
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      return false;
    }
    total += probability;
  }
  return Math.abs(total - 1) <= 0.02;
};

export type VPDecisionPolicy = {
  readonly revision: string;
  /** Calibrated on the Shotgun relation Golden Corpus for this task and model. */
  readonly minimumChoiceProbability: number;
  readonly maximumDeepAnalysisScore: number;
  readonly maximumInputTokens: number;
  readonly maximumOutputTokens: number;
};

export type VPResolvedDecision =
  | {
      readonly status: 'DECIDED';
      readonly provider: 'JEV' | 'GENERAL_AI';
      readonly decision: VPRelationDecision;
    }
  | {
      readonly status: 'UNRESOLVED';
      readonly reason: 'NO_AUTHORIZED_PROVIDER' | 'PROVIDER_FAILED' | 'INSUFFICIENT_EVIDENCE';
    }
  | { readonly status: 'OUTCOME_UNKNOWN' };

/** The policy, rather than either provider, decides whether a result may proceed. */
export class VPRelationDecisionRouter {
  constructor(
    private readonly fast: VPDecisionProviderPort | undefined,
    private readonly deep: VPDecisionProviderPort | undefined,
    private readonly policy: VPDecisionPolicy,
  ) {
    if (
      !policy.revision ||
      policy.minimumChoiceProbability <= 0 ||
      policy.minimumChoiceProbability > 1 ||
      policy.maximumDeepAnalysisScore < 0 ||
      policy.maximumDeepAnalysisScore > 1 ||
      policy.maximumInputTokens <= 0 ||
      policy.maximumOutputTokens <= 0
    ) {
      throw new Error('VP relation decision policy requires calibrated, bounded limits.');
    }
  }

  async resolve(input: VPRelationDecisionRequest): Promise<VPResolvedDecision> {
    if (input.policyRevision !== this.policy.revision) {
      throw new Error('VP relation decision policy revision changed.');
    }
    if (!input.externalEgressAllowed) {
      return { status: 'UNRESOLVED', reason: 'NO_AUTHORIZED_PROVIDER' };
    }
    assertVPDecisionEgress(input);
    if (!this.fast && !this.deep) {
      return { status: 'UNRESOLVED', reason: 'NO_AUTHORIZED_PROVIDER' };
    }
    let fastFailed = false;
    if (this.fast) {
      try {
        const decision = await this.fast.decideRelation(input);
        if (
          validVPRelationDecision(decision) &&
          decision.choice !== 'UNRESOLVED' &&
          this.withinUsage(decision) &&
          (decision.probabilities[decision.choice] ?? 0) >= this.policy.minimumChoiceProbability &&
          decision.deepAnalysisScore <= this.policy.maximumDeepAnalysisScore
        ) {
          return { status: 'DECIDED', provider: 'JEV', decision };
        }
      } catch (error) {
        // An ambiguous result may already have been accepted and billed.
        // Never route the same pair to a second provider in that case.
        if (error instanceof VPDecisionOutcomeUnknownError) {
          return { status: 'OUTCOME_UNKNOWN' };
        }
        fastFailed = true;
      }
    }
    if (!this.deep) {
      return {
        status: 'UNRESOLVED',
        reason: fastFailed ? 'PROVIDER_FAILED' : 'INSUFFICIENT_EVIDENCE',
      };
    }
    try {
      const decision = await this.deep.decideRelation(input);
      if (
        validVPRelationDecision(decision) &&
        decision.choice !== 'UNRESOLVED' &&
        this.withinUsage(decision) &&
        (decision.probabilities[decision.choice] ?? 0) >= this.policy.minimumChoiceProbability
      ) {
        return { status: 'DECIDED', provider: 'GENERAL_AI', decision };
      }
      return { status: 'UNRESOLVED', reason: 'INSUFFICIENT_EVIDENCE' };
    } catch (error) {
      if (error instanceof VPDecisionOutcomeUnknownError) {
        return { status: 'OUTCOME_UNKNOWN' };
      }
      return { status: 'UNRESOLVED', reason: 'PROVIDER_FAILED' };
    }
  }

  private withinUsage(decision: VPRelationDecision): boolean {
    return (
      decision.inputTokens <= this.policy.maximumInputTokens &&
      decision.outputTokens <= this.policy.maximumOutputTokens
    );
  }
}

/** Reject a pair before any provider call, including internal test adapters. */
export const assertVPDecisionEgress = (input: VPRelationDecisionRequest): void => {
  if (!input.externalEgressAllowed) throw new Error('VP external decision egress is not allowed.');
  if (!input.projectId || !input.policyRevision)
    throw new Error('VP decision scope is incomplete.');
  for (const assertion of [input.left, input.right]) {
    if (
      !assertion.assertionId ||
      !assertion.sourceVersionId ||
      !assertion.evidenceId ||
      !assertion.text.trim() ||
      assertion.sensitivity === 'restricted' ||
      !input.authorizedSensitivities.includes(assertion.sensitivity) ||
      assertion.accessScope.length === 0 ||
      assertion.accessScope.some((entry) => !input.allowedAccessScope.includes(entry))
    ) {
      throw new Error('VP decision pair is outside its authorized evidence scope.');
    }
  }
};
