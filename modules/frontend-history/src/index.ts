export type {
  PayloadStateOwner,
  PayloadStateRecord,
  PayloadStateStorePort,
  PurgeAuditEventInput,
  PurgeByPolicyInput,
  SetPayloadStateInput,
} from './payload-state.js';
export { isPurgeTransitionValid, redactHistoryPayload } from './payload-state.js';

// FE-P5-S2 WP4 — Federated History Projection + Product API.
export type { HistoryAdapterPort, HistoryAdapterRegistryPort } from './history-adapter-port.js';
export {
  MANDATORY_HISTORY_ADAPTER_DOMAIN_KINDS,
  createHistoryAdapterRegistry,
} from './history-adapter-port.js';
export type {
  HistoryIndexPageV1,
  HistoryIndexQueryV1,
  HistoryIndexRecordV1,
  HistoryIndexStorePort,
} from './history-index-store-port.js';
export {
  assertHistoryRebuildRevisionNotLower,
  compareHistoryRecords,
  isHistoryRecordAfter,
  validateHistoryRebuildBatch,
} from './history-index-store-port.js';
export type { HistoryProjectionBuildResultV1 } from './history-projection-builder.js';
export { HistoryProjectionBuilder } from './history-projection-builder.js';
export type { HistoryReadModelStorePort } from './history-read-model-store-port.js';
export { createHistoryReadModelStore } from './history-read-model-store-port.js';
export type {
  HistoryAdapterStatusV1,
  HistoryWatermarkRecordV1,
  HistoryWatermarkStorePort,
} from './history-watermark-store-port.js';
export type { HistorySourceDomainKindV1 } from '../../../packages/contracts/src/index.js';
export type {
  GetHistoryEntryRequestV1,
  HistoryCapabilityV1,
  HistoryProductScopeV1,
  HistoryProjectionMetadataV1,
  ListHistoryWorkspaceRequestV1,
} from './product-api.js';
export {
  HISTORY_PAGE_SIZE_CAP,
  HistoryProductCoordinator,
  HistoryProductError,
  decodeHistoryWorkspaceCursorV1,
  historyCapabilitiesForScope,
  historyProjectionMetadataFrom,
} from './product-api.js';
export {
  decodeGetHistoryEntryRequestV1,
  decodeHistoryCursorV1,
  decodeListHistoryWorkspaceRequestV1,
} from '../../../packages/contracts/src/index.js';
