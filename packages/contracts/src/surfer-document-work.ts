import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import type { SurferObservationSelection } from './surfer-cognition.js';
import type { SurferDirectiveExtractionV2 } from './surfer-directive-v2.js';
export type SurferDocumentPreparation = {
  schemaVersion: '1.0.0';
  requestId: string;
  sourceId: string;
  expectedActiveSnapshotId: string | null;
};
export type SurferIndexedDocumentPreparation = {
  schemaVersion: '1.0.0';
  requestId: string;
  sourceId: string;
  sourceVersionId: string;
  revisionId: string;
};
export type SurferDocumentPreparedWork = {
  contract: 'surfer.document-work.v1';
  requestDigest: string;
  profileDigest: string;
  runId: string;
  task: {
    schemaVersion: '1.0.0';
    runId: string;
    operationId: string;
    stepId: string;
    attempt: number;
    priority: 'FOREGROUND';
    basis: SurferSourceBasisV2;
    selections: SurferObservationSelection[];
  };
  command: { memoryId: string; expectedRevision: null; expectedActiveSnapshotId: string | null };
};
export type SurferDocumentWorkReceipt = {
  contract: 'surfer.document-done.v1';
  prepared: SurferArtifactRef;
  profileDigest: string;
  artifact: SurferArtifactRef;
  snapshotId: string;
  snapshotDigest: string;
  memoryCount: number;
  frameDigest: string;
};
/** Trusted backend capability. Public triggers cannot supply provider authority or frames. */
export interface SurferDocumentWorkPort {
  prepareIndexed(
    actor: unknown,
    input: unknown,
  ): Promise<{ prepared: SurferArtifactRef; replayed: boolean }>;
  prepare(
    actor: unknown,
    input: unknown,
  ): Promise<{ prepared: SurferArtifactRef; replayed: boolean }>;
  read(actor: unknown, prepared: unknown): Promise<SurferDocumentPreparedWork>;
  completed(actor: unknown, prepared: unknown): Promise<SurferDocumentWorkReceipt | null>;
  complete(
    actor: unknown,
    input: { prepared: unknown; frame: SurferDirectiveExtractionV2 },
  ): Promise<SurferDocumentWorkReceipt>;
}
