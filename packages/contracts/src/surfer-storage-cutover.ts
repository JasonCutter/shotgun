import type { SurferHistoryPins } from './surfer-history.js';
export type SurferCutoverProgress = {
  generationId: string;
  status: 'COPYING' | 'READY' | 'ACTIVE' | 'SUSPENDED' | 'ABORTED';
  cursor: number;
  total: number;
  routeRevision: number;
  routeMode: 'LEGACY' | 'COPYING' | 'ROWS' | 'SUSPENDED' | 'CONFLICT';
  routeGenerationId: string | null;
};
/** Server admin only; no implicit Source authority, operating activation or destructive downgrade. */
export interface SurferStorageCutoverPort {
  inspect(id: string): Promise<SurferCutoverProgress>;
  begin(pins: SurferHistoryPins, archiveGeneration?: string): Promise<SurferCutoverProgress>;
  copyBatch(id: string, cursor: number, limit: number): Promise<SurferCutoverProgress>;
  seal(id: string): Promise<SurferCutoverProgress>;
  activate(id: string, expectedRouteRevision: number): Promise<SurferCutoverProgress>;
  abort(id: string, expectedRouteRevision: number): Promise<SurferCutoverProgress>;
  suspend(id: string, expectedRouteRevision: number): Promise<SurferCutoverProgress>;
}
