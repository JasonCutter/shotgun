import { queryOptions } from '@tanstack/react-query';

import {
  ShotgunApiError,
  type FrontendExternalActionClient,
  type GetActionManifestRequestV1,
  type GetActionResultRequestV1,
  type GetExecutionAttemptsRequestV1,
  type GetExecutionRequestV1,
  type GetExternalActionApprovalRequestV1,
  type GetExternalActionDetailRequestV1,
  type GetExternalActionRequestV1,
  type GetPreflightRequestV1,
  type GetRiskDecisionRequestV1,
  type GetVerificationRequestV1,
  type ListExternalActionAuditRequestV1,
  type ListExternalActionsRequestV1,
} from '@shotgun/api-client';

import {
  externalActionDisabledQueryKey,
  externalActionQueueQueryKey,
  externalActionResourceQueryKey,
  type ExternalActionQueryScope,
} from '../app/query-keys.js';

/**
 * FE-P4-S2 WP5 External Action workspace read queries (ADR-119 ownership).
 *
 * React Query owns the server-state cache; keys are produced ONLY by the
 * scope-safe factories (Project/access/policy + action revision + external
 * revision) — no ad hoc key arrays (ADR-119 §4). Retry derives from ADR-118
 * Failure Descriptors; governed mutations are never auto-retried.
 */
export const externalActionCanManuallyRetry = (error: unknown): error is ShotgunApiError =>
  error instanceof ShotgunApiError && error.retryability === 'SAFE';

export const externalActionQueryRetry = (failureCount: number, error: unknown): boolean =>
  externalActionCanManuallyRetry(error) && failureCount < 2;

export const externalActionQueueQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  request: ListExternalActionsRequestV1,
) =>
  queryOptions({
    queryKey: scope
      ? externalActionQueueQueryKey(scope, request)
      : externalActionDisabledQueryKey('queue'),
    queryFn: ({ signal }) => client.listExternalActions(request, { signal }),
    enabled: scope !== null,
    retry: externalActionQueryRetry,
    staleTime: 15_000,
  });

type ActionIdentity = {
  readonly actionId: string;
  readonly actionRevision: number;
  readonly externalRevision: string;
};

export const externalActionDetailQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetExternalActionDetailRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return queryOptions({
    queryKey:
      scope && identity
        ? externalActionResourceQueryKey(
            scope,
            identity.actionId,
            identity.actionRevision,
            identity.externalRevision,
            ['detail'],
          )
        : externalActionDisabledQueryKey('detail'),
    queryFn: ({ signal }) => client.getExternalActionDetail(request, { signal }),
    enabled: scope !== null && identity !== null,
    retry: externalActionQueryRetry,
    staleTime: 30_000,
  });
};

export const externalActionReadQueryOptions = <
  TRequest extends {
    readonly schemaVersion: '1.0.0';
    readonly actionId: string;
  },
  TResult,
>(
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
  operation: readonly unknown[],
  request: TRequest,
  invoke: (req: TRequest, options: { readonly signal?: AbortSignal }) => Promise<TResult>,
) =>
  queryOptions({
    queryKey:
      scope && identity
        ? externalActionResourceQueryKey(
            scope,
            identity.actionId,
            identity.actionRevision,
            identity.externalRevision,
            operation,
          )
        : externalActionDisabledQueryKey(String(operation[0] ?? 'read')),
    queryFn: ({ signal }) => invoke(request, { signal }),
    enabled: scope !== null && identity !== null,
    retry: externalActionQueryRetry,
    staleTime: 30_000,
  });

export const externalActionManifestQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetActionManifestRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['manifest'],
    request,
    (req, options) => client.getActionManifest(req, options),
  );
};

export const externalActionRiskDecisionQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetRiskDecisionRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['risk-decision'],
    request,
    (req, options) => client.getRiskDecision(req, options),
  );
};

export const externalActionPreflightQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetPreflightRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['preflight'],
    request,
    (req, options) => client.getPreflight(req, options),
  );
};

export const externalActionExecutionQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetExecutionRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['execution'],
    request,
    (req, options) => client.getExecution(req, options),
  );
};

export const externalActionAttemptsQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetExecutionAttemptsRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
    pageSize: 50,
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['attempts'],
    request,
    (req, options) => client.getExecutionAttempts(req, options),
  );
};

export const externalActionVerificationQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetVerificationRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['verification'],
    request,
    (req, options) => client.getVerification(req, options),
  );
};

export const externalActionResultQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetActionResultRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['result'],
    request,
    (req, options) => client.getActionResult(req, options),
  );
};

export const externalActionAuditQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: ListExternalActionAuditRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
    pageSize: 50,
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['audit'],
    request,
    (req, options) => client.listExternalActionAudit(req, options),
  );
};

export const externalActionApprovalQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  identity: ActionIdentity | null,
) => {
  const request: GetExternalActionApprovalRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: identity?.actionId ?? 'disabled',
  };
  return externalActionReadQueryOptions(
    client,
    scope,
    identity,
    ['approval'],
    request,
    (req, options) => client.getExternalActionApproval(req, options),
  );
};

/** Single-action aggregate snapshot read used to bind the detail query key. */
export const externalActionSnapshotQueryOptions = (
  client: FrontendExternalActionClient,
  scope: ExternalActionQueryScope | null,
  actionId: string | null,
) => {
  const request: GetExternalActionRequestV1 = {
    schemaVersion: '1.0.0',
    actionId: actionId ?? 'disabled',
  };
  return queryOptions({
    queryKey:
      scope && actionId
        ? externalActionResourceQueryKey(scope, actionId, -1, '', ['snapshot'])
        : externalActionDisabledQueryKey('snapshot'),
    queryFn: ({ signal }) => client.getExternalAction(request, { signal }),
    enabled: scope !== null && actionId !== null,
    retry: externalActionQueryRetry,
    staleTime: 15_000,
  });
};
