import type {
  SurferArtifactRef,
  SurferFootprintDependency,
  SurferKnowledgeArtifact,
  SurferKnowledgeBasis,
  SurferKnowledgeCommand,
  SurferKnowledgeCommit,
  SurferKnowledgeInput,
  SurferKnowledgeSnapshot,
  SurferKnowledgeState,
  SurferQueryFootprint,
} from './surfer-knowledge.js';

/** Explicit synchronous lookup contract. Never represents a partial SurferKnowledgeState. */
export type SurferKnowledgeLookupView = {
  readonly spaceId: string;
  readonly sequence: number;
  readonly authorityEpoch: number;
  readonly activeSnapshotId: string | null;
  input(id: string): SurferKnowledgeInput | undefined;
  artifact(ref: SurferArtifactRef): SurferKnowledgeArtifact | undefined;
  head(id: string): SurferArtifactRef | undefined;
  epoch(domain: string, predicate: string): number;
  receipt(id: string): SurferKnowledgeState['commands'][number] | undefined;
  snapshot(id: string): SurferKnowledgeSnapshot | undefined;
};
export type SurferKnowledgeTransition = {
  result: { commit: SurferKnowledgeCommit; replayed: boolean };
  input?: SurferKnowledgeInput;
  artifact?: SurferKnowledgeArtifact;
  snapshot?: SurferKnowledgeSnapshot;
  epochs: { domain: string; predicate: string; epoch: number }[];
  authorityEpoch?: number;
  activeSnapshotId?: string;
  command?: SurferKnowledgeState['commands'][number];
};
export type SurferRowsMetadata = {
  contract: 'surfer.knowledge-rows.v1';
  spaceId: string;
  sequence: number;
  authorityEpoch: number;
  activeSnapshotId: string | null;
};
export type SurferRowsClosure = {
  contract: 'surfer.knowledge-rows.v1';
  mode: 'CURRENT_KERNEL' | 'HISTORICAL';
  isActive: boolean;
  sourceCurrentness: 'NOT_ASSESSED';
  artifacts: SurferKnowledgeArtifact[];
  staleReasons: string[];
  kernelCurrent: boolean;
  snapshot: SurferKnowledgeSnapshot | null;
};
/** Isolated Core owner only; Source binding/Fact/Action/product authority is external. */
export interface SurferKnowledgeRowsPort {
  execute(
    command: SurferKnowledgeCommand,
  ): Promise<{ commit: SurferKnowledgeCommit; replayed: boolean }>;
  captureBasis(request: {
    inputIds: readonly string[];
    artifacts: readonly SurferArtifactRef[];
    footprints: readonly SurferQueryFootprint[];
  }): Promise<SurferKnowledgeBasis>;
  readClosure(
    request: { artifacts: readonly SurferArtifactRef[] } | { snapshotId: string | null },
  ): Promise<SurferRowsClosure>;
}
// Keep these contract dependencies explicit for consumers of typed footprint rows.
export type SurferRowsFootprint = SurferFootprintDependency;
