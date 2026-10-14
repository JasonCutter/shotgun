import type {
  VPImageObservationDerivationProofV1,
  VPImageObservationV1,
} from '../../../packages/contracts/src/vp-image-observation.js';
import type { VPAssertionReadScope } from './index.js';

/** This is a read port to the existing AI execution owner, not a new provider,
 * credential, budget or success authority. UNKNOWN never supplies this proof. */
export type VPImageObservationDerivationReaderPort = {
  findCompleted(input: {
    readonly projectId: string;
    readonly callId: string;
    readonly attemptId: string;
  }): Promise<VPImageObservationDerivationProofV1 | undefined>;
};
export type VPImageObservationReadScope = VPAssertionReadScope & {
  readonly sourceVersionIds?: readonly string[];
  readonly limit?: number;
  /** Optional Ask lexical query; absence preserves general authorized listing. */
  readonly question?: string;
  /** Reuses the caller's authoritative snapshot transaction; never grants access. */
  readonly queryExecutor?: {
    query<T extends Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ readonly rows: readonly T[] }>;
  };
};
export type VPImageObservationLedgerPort = {
  append(
    observation: VPImageObservationV1,
  ): Promise<{ readonly observation: VPImageObservationV1; readonly reused: boolean }>;
  listCurrent(scope: VPImageObservationReadScope): Promise<readonly VPImageObservationV1[]>;
  findHistorical(
    scope: VPImageObservationReadScope,
    observationId: string,
  ): Promise<VPImageObservationV1 | undefined>;
};
