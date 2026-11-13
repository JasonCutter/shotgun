import type { SurferKnowledgeRowsPort } from './surfer-knowledge-rows.js';
import type {
  SurferArtifactRef,
  SurferKnowledgeInput,
  SurferKnowledgeCommit,
} from './surfer-knowledge.js';
import type {
  SurferSourceBasisV2,
  SurferBindingRecordV2,
  SurferSourceSessionV2,
} from './surfer-source-binding-v2.js';
import type { SurferSourceRequest } from './surfer-source.js';

export interface SurferRowsCoreSessionPort extends SurferKnowledgeRowsPort {
  initialize(): Promise<unknown>;
  lookupInput(id: string): Promise<SurferKnowledgeInput | undefined>;
  hasOperation(id: string): Promise<boolean>;
  findCommit(id: string): Promise<SurferKnowledgeCommit | null>;
  priorCreatedAt(id: string): Promise<string | null>;
  currentSnapshotId(): Promise<string | null>;
}
export interface SurferRowsBindingPort {
  captureIssued(basis: SurferSourceBasisV2): Promise<boolean>;
  issueCapture(basis: SurferSourceBasisV2): Promise<SurferSourceBasisV2>;
  binding(ref: SurferArtifactRef): Promise<SurferBindingRecordV2 | undefined>;
  bind(record: SurferBindingRecordV2): Promise<void>;
}
/** Server-only Source snapshot. Never exposes a client, connection or transaction controls. */
export type SurferRowsSourceSession = Pick<
  SurferSourceSessionV2,
  'snapshot' | 'readMaterialV2' | 'readContentProofV2' | 'metrics'
> & {
  readonly core: SurferRowsCoreSessionPort;
  readonly bindings: SurferRowsBindingPort;
};
export interface SurferRowsSourceSessionsPort {
  withRowsSnapshot<T>(
    request: SurferSourceRequest,
    mode: 'READ' | 'WRITE',
    action: (session: SurferRowsSourceSession) => Promise<T>,
  ): Promise<T>;
}
export type SurferRoutedSourceSession =
  | { profile: 'LEGACY'; session: SurferSourceSessionV2 }
  | { profile: 'ROWS'; session: SurferRowsSourceSession };
export interface SurferRoutedSourceSessionsPort {
  withRoutedSnapshot<T>(
    request: SurferSourceRequest,
    intent: 'READ' | 'WRITE',
    apply: (session: SurferRoutedSourceSession) => Promise<T>,
  ): Promise<T>;
}
