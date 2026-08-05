export {
  FrontendExternalActionProductCoordinator,
  FRONTEND_EXTERNAL_ACTION_RESOURCE_KIND,
  externalActionCapabilitiesForScope,
  isExternalActionProductCommandType,
} from './product-api.js';
export type {
  FrontendExternalActionCommandGatewayPort,
  FrontendExternalActionScopeV1,
} from './product-api.js';
export { ExternalActionCommandError, externalActionFailure } from './external-action-error.js';
export {
  EXTERNAL_ACTION_DOMAIN_VERSION,
  aggregateStatusAfter,
  approvalIsActive,
  approvalStatusFor,
  budgetViewFrom,
  credentialViewFrom,
  externalActionManifestDigestFor,
  externalActionResourceRef,
  isTerminalAttemptStatus,
  maskCredential,
  manifestDigestFor,
  preflightIsReady,
  preflightRevalidationFlags,
  targetRefsEqual,
} from './external-action-domain.js';
export type {
  ExternalActionConnectorIdentityV1,
  ExternalActionEnginePort,
  ExternalActionExecuteOutcomeV1,
  ExternalActionExecuteRequestV1,
  ExternalActionEngineScopeV1,
  ExternalActionPreflightOutcomeV1,
  ExternalActionPreflightRequestV1,
  ExternalActionVerifyOutcomeV1,
  ExternalActionVerifyRequestV1,
} from './external-action-engine-port.js';
export type {
  ExternalActionAggregateRecordV1,
  ExternalActionAggregateStorePort,
  ExternalActionApprovalStorePort,
  ExternalActionAttemptStorePort,
  ExternalActionAuditStorePort,
  ExternalActionBudgetStorePort,
  ExternalActionCandidateStorePort,
  ExternalActionCompensationStorePort,
  ExternalActionCredentialStorePort,
  ExternalActionExecutionStorePort,
  ExternalActionManifestStorePort,
  ExternalActionPreflightStorePort,
  ExternalActionRepositoryBoundaryPort,
  ExternalActionResultStorePort,
  ExternalActionRiskDecisionStorePort,
  ExternalActionRollbackStorePort,
  ExternalActionTransactionHandleV1,
  ExternalActionTransactionRepositoriesV1,
  ExternalActionVerificationStorePort,
} from './external-action-store-port.js';
