import type { HistoryCursorV1 } from '../../../packages/contracts/src/index.js';
import {
  HistoryProjectionBuilder,
  type HistoryAdapterRegistryPort,
  type HistoryReadModelStorePort,
} from '../../../modules/frontend-history/src/index.js';
import type { HistoryResetProjection, ProjectHistoryResetRebuilder } from './history-owner.js';

const CAPTURE_PAGE_SIZE = 100;

/**
 * Reuses the production History projection builder while capturing its output
 * in a caller-supplied ephemeral store for the executor-only T3 writer.
 */
export const createProjectHistoryResetRebuilder = (input: {
  readonly registry: HistoryAdapterRegistryPort;
  readonly createCaptureStore: () => HistoryReadModelStorePort;
  readonly now?: () => Date;
}): ProjectHistoryResetRebuilder => ({
  async rebuildProjectHistory(context): Promise<HistoryResetProjection> {
    const store = input.createCaptureStore();
    const builder = new HistoryProjectionBuilder(input.registry, store, input.now);
    const result = await builder.buildProjectProjection(context.projectId);
    const entries = [];
    let cursor: HistoryCursorV1 | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const page = await store.index.queryProject({
        resourceProjectId: context.projectId,
        limit: CAPTURE_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      entries.push(...page.records);
      if (page.nextCursor === undefined) break;
      const key = JSON.stringify(page.nextCursor);
      if (seenCursors.has(key)) {
        throw new Error('T3 History capture store returned a repeating cursor.');
      }
      seenCursors.add(key);
      cursor = page.nextCursor;
    }

    const watermarks = await store.watermarks.readByProject(context.projectId);
    if (entries.length !== result.indexCount) {
      throw new Error('T3 History capture store did not return the complete committed snapshot.');
    }
    return {
      entries,
      watermarks,
      partial: result.partial,
      failures: result.failures,
    };
  },
});
