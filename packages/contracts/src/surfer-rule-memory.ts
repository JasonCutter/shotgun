import type { SurferCognitiveView, SurferObservationSelection } from './surfer-cognition.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferInductionDevelopment } from './surfer-induction.js';
import type { SurferRuleCandidate } from './surfer-learning.js';
import type { SurferExperimentReceipt } from './surfer-experiment.js';
import type { SurferDirectiveMemorySession } from './surfer-directive-memory.js';
import type { SurferBindingCaptureV2 } from './surfer-source-binding-v2.js';
export type SurferScopedRuleMemorySession = SurferDirectiveMemorySession & {
  captureChain(input: SurferBindingCaptureV2): ReturnType<SurferDirectiveMemorySession['capture']>;
  captureRule(input: SurferBindingCaptureV2): ReturnType<SurferDirectiveMemorySession['capture']>;
};
export interface SurferScopedRuleMemorySessionPort {
  withReadSession?<T>(
    actor: unknown,
    apply: (session: SurferScopedRuleMemorySession) => Promise<T>,
  ): Promise<T>;
  withSession<T>(
    actor: unknown,
    apply: (session: SurferScopedRuleMemorySession) => Promise<T>,
  ): Promise<T>;
}
export function readSurferRuleMemorySession<T>(
  port: SurferScopedRuleMemorySessionPort,
  actor: unknown,
  apply: (session: SurferScopedRuleMemorySession) => Promise<T>,
): Promise<T> {
  return port.withReadSession ? port.withReadSession(actor, apply) : port.withSession(actor, apply);
}
export interface SurferCompletedExperimentPort {
  readCompleted(experimentId: string): Promise<SurferExperimentReceipt | null>;
}
export type SurferScopedRuleProof = {
  contract: 'surfer.scoped-rule-proof.v1';
  proofId: string;
  basis: SurferSourceBasisV2;
  selections: SurferObservationSelection[];
  development: SurferInductionDevelopment;
  candidate: SurferRuleCandidate;
  receipt: SurferExperimentReceipt;
  proposalDigest: string;
  executionRequestDigest: string;
};
/** Server-owned capability. No raw client candidate/score, worker or holdout-read Port. */
export interface SurferScopedRuleProofPort {
  prepared(proofId: string): {
    basis: SurferSourceBasisV2;
    selections: SurferObservationSelection[];
  };
  read(proofId: string, currentView: SurferCognitiveView): Promise<SurferScopedRuleProof>;
}
