import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import type {
  SurferExperimentClaim,
  SurferExperimentReceipt,
  SurferExperimentReservation,
  SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';

type Record = SurferExperimentReservation & {
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  receipt?: SurferExperimentReceipt;
};
/** Atomic within one process only; durable/multi-process storage is a later adapter. */
export class InMemorySurferExperimentStore implements SurferExperimentStorePort {
  private readonly records = new Map<string, Record>();
  private readonly selections = new Map<string, string>();
  /** Read-only capability: never reserves/releases a holdout or changes its state. */
  async readCompleted(experimentId: string): Promise<SurferExperimentReceipt | null> {
    if (typeof experimentId !== 'string' || !experimentId.length || experimentId.length > 256)
      throw surferFailure('Invalid completed experiment reference.');
    const row = this.records.get(experimentId);
    return row?.state === 'SUCCEEDED' ? structuredClone(row.receipt!) : null;
  }
  private existing(input: SurferExperimentReservation): Record | undefined {
    const row = this.records.get(input.experimentId);
    if (
      row &&
      (row.meaningDigest !== input.meaningDigest || row.selectionKey !== input.selectionKey)
    )
      throw surferFailure('Experiment idempotency key was reused with different input.');
    return row;
  }
  async claim(input: SurferExperimentReservation): Promise<SurferExperimentClaim> {
    const existing = this.existing(input);
    if (existing) {
      return existing.state === 'SUCCEEDED'
        ? { state: 'COMPLETED', receipt: structuredClone(existing.receipt!) }
        : { state: existing.state };
    }
    if (this.selections.has(input.selectionKey))
      throw surferFailure(
        'This holdout partition has already been reserved; create a new evaluation generation.',
      );
    this.records.set(input.experimentId, { ...input, state: 'RUNNING' });
    this.selections.set(input.selectionKey, input.experimentId);
    return { state: 'CLAIMED' };
  }
  async complete(
    input: SurferExperimentReservation,
    receipt: SurferExperimentReceipt,
  ): Promise<void> {
    const row = this.existing(input);
    if (!row || row.state !== 'RUNNING' || receipt.experimentId !== row.experimentId)
      throw surferFailure('Invalid experiment completion.');
    row.receipt = structuredClone(receipt);
    row.state = 'SUCCEEDED';
  }
  async fail(
    input: SurferExperimentReservation,
    status: 'FAILED' | 'OUTCOME_UNKNOWN',
  ): Promise<void> {
    const row = this.existing(input);
    if (row?.state === 'RUNNING') row.state = status;
  }
}
