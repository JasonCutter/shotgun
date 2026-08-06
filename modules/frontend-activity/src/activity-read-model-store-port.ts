import type { ActivityIndexStorePort } from './activity-index-store-port.js';
import type { ActivityWatermarkStorePort } from './activity-watermark-store-port.js';

/**
 * FE-P5-S1 Activity read-model store boundary.
 *
 * Combines the two frozen additive tables (`activity_index` and
 * `projection_watermarks`) into one project-scoped boundary. The projection
 * builder (WP3) uses this boundary for deterministic rebuilds and watermark
 * observations without owning any Domain execution store.
 */

export type ActivityReadModelStorePort = {
  readonly index: ActivityIndexStorePort;
  readonly watermarks: ActivityWatermarkStorePort;
};

export const createActivityReadModelStore = (input: {
  readonly index: ActivityIndexStorePort;
  readonly watermarks: ActivityWatermarkStorePort;
}): ActivityReadModelStorePort => input;
