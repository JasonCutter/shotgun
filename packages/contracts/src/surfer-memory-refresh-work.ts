import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferDirectiveExtractionV2 } from './surfer-directive-v2.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferObservationSelection } from './surfer-cognition.js';
export type SurferRefreshPreparedWork = {
  contract: 'surfer.memory-refresh-work.v1';
  job: SurferArtifactRef;
  planDigest: string;
  runId: string;
  profileDigest: string;
  operationId: string;
  expectedActiveSnapshotId: string;
  targets: {
    replaces: SurferArtifactRef;
    recipe: SurferArtifactRef;
    task: {
      schemaVersion: '1.0.0';
      operationId: string;
      runId: string;
      stepId: string;
      attempt: 1;
      priority: 'FOREGROUND';
      basis: SurferSourceBasisV2;
      selections: SurferObservationSelection[];
    };
  }[];
};
export type SurferRefreshWorkReceipt = {
  prepared: SurferArtifactRef;
  profileDigest: string;
  artifacts: SurferArtifactRef[];
  snapshotId: string;
  snapshotDigest: string;
  memoryCount: number;
  nextRecipes: SurferArtifactRef[];
  framesDigest: string;
};
/** Trusted backend owner. Historical recipe text never appears in returned work or receipts. */
export interface SurferMemoryRefreshWorkPort {
  register(
    actor: unknown,
    input: unknown,
  ): Promise<{ recipe: SurferArtifactRef; replayed: boolean }>;
  prepare(
    actor: unknown,
    input: unknown,
  ): Promise<{ prepared: SurferArtifactRef; replayed: boolean }>;
  read(actor: unknown, ref: unknown): Promise<SurferRefreshPreparedWork>;
  completed(actor: unknown, ref: unknown): Promise<SurferRefreshWorkReceipt | null>;
  validate(actor: unknown, ref: unknown, frames: SurferDirectiveExtractionV2[]): Promise<void>;
  complete(actor: unknown, input: unknown): Promise<SurferRefreshWorkReceipt>;
}
