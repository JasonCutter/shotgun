import {
  ActivityProjectionBuilder,
  type ActivityAdapterRegistryPort,
  type ActivityAdapterScopeV1,
  type ActivityReadModelStorePort,
} from '../../../modules/frontend-activity/src/index.js';
import type { KnowledgeResetOwnerContext } from '../../../modules/source-knowledge-reset/src/index.js';
import type { ActivityResetProjection, ProjectActivityResetRebuilder } from './activity-owner.js';

const CAPTURE_PAGE_SIZE = 100;

/**
 * Reuses the production Activity projection builder with server-derived scope,
 * then captures the complete result for the executor-only T3 database writer.
 */
export const createProjectActivityResetRebuilder = (input: {
  readonly registry: ActivityAdapterRegistryPort;
  readonly createCaptureStore: () => ActivityReadModelStorePort;
  readonly resolveScope: (context: KnowledgeResetOwnerContext) => Promise<ActivityAdapterScopeV1>;
  readonly now?: () => Date;
}): ProjectActivityResetRebuilder => ({
  async rebuildProjectActivity(context): Promise<ActivityResetProjection> {
    const scope = await input.resolveScope(context);
    if (scope.activeProjectId !== context.projectId) {
      throw new Error('T3 Activity scope resolver returned a different Project.');
    }

    const store = input.createCaptureStore();
    const builder = new ActivityProjectionBuilder(input.registry, store, input.now);
    const result = await builder.buildProjectProjection(scope);
    const records = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const page = await store.index.queryProject({
        resourceProjectId: context.projectId,
        limit: CAPTURE_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      records.push(...page.records);
      if (page.nextCursor === undefined) break;
      if (seenCursors.has(page.nextCursor)) {
        throw new Error('T3 Activity capture store returned a repeating cursor.');
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    const watermarks = await store.watermarks.readByProject(context.projectId);
    if (records.length !== result.indexCount) {
      throw new Error('T3 Activity capture store did not return the complete committed snapshot.');
    }
    return {
      records,
      watermarks,
      partial: result.partial,
      failures: result.failures,
    };
  },
});
