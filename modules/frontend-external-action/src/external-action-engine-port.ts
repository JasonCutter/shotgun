import type {
  ActionManifestV1,
  ExecutionAttemptV1,
  ExternalActionActorV1,
  ExternalActionOperationV1,
  ExternalActionTargetRefV1,
  PreflightV1,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S2 External Action engine port — a structural subset of the Stage 11
 * engine surface (candidate staging, risk decision, preview/manifest,
 * approval, preflight, execute, verify). The Product module declares this port
 * locally and never imports `modules/action-execution`; Stage 11 records,
 * `record_json` and DB IDs never cross this boundary. The concrete adapter is
 * wired at the assembly boundary.
 *
 * All results are Product V1 safe views; provider payloads are never returned.
 */

/** Server-derived scope the engine may use for connector identity. */
export type ExternalActionEngineScopeV1 = {
  readonly principalId: string;
  readonly actor: ExternalActionActorV1;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type ExternalActionPreflightRequestV1 = {
  readonly scope: ExternalActionEngineScopeV1;
  readonly actionId: string;
  readonly actionRevision: number;
  readonly operation: ExternalActionOperationV1;
  readonly targetRef: ExternalActionTargetRefV1;
  readonly manifest: ActionManifestV1;
  readonly preflight: PreflightV1;
  /** True when the preflight revalidates a rollback (state reversal) target. */
  readonly rollback?: boolean;
};

export type ExternalActionPreflightOutcomeV1 = {
  readonly status: 'READY' | 'ALREADY_APPLIED' | 'DENIED';
  readonly reason?: string;
  readonly targetStateRevalidated: boolean;
  readonly externalRevisionRevalidated: boolean;
};

export type ExternalActionExecuteRequestV1 = {
  readonly scope: ExternalActionEngineScopeV1;
  readonly actionId: string;
  readonly actionRevision: number;
  readonly operation: ExternalActionOperationV1;
  readonly targetRef: ExternalActionTargetRefV1;
  readonly manifest: ActionManifestV1;
  readonly attempt: ExecutionAttemptV1;
  /** True when the execution is a rollback (state reversal) execution. */
  readonly rollback?: boolean;
};

export type ExternalActionExecuteOutcomeV1 = {
  readonly status: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';
  readonly externalId?: string;
  readonly observedDigest?: string;
  readonly correlationId: string;
};

export type ExternalActionVerifyRequestV1 = {
  readonly scope: ExternalActionEngineScopeV1;
  readonly actionId: string;
  readonly actionRevision: number;
  readonly targetRef: ExternalActionTargetRefV1;
  readonly expectedTargetRevision: string;
  readonly expectedExternalRevision: string;
  readonly executionId: string;
  readonly attemptId?: string;
  readonly observedDigest?: string;
  /** True when the verification confirms a rollback (state reversal) target. */
  readonly rollback?: boolean;
};

export type ExternalActionVerifyOutcomeV1 = {
  readonly status: 'APPLIED' | 'NOT_APPLIED' | 'MISMATCH';
  readonly observedDigest?: string;
};

export type ExternalActionConnectorIdentityV1 = {
  readonly connectorId: string;
  readonly name: string;
  readonly provider: string;
  readonly secretBoundary: 'ADAPTER_INTERNAL';
};

/**
 * Structural subset of the Stage 11 engine used by the External Action Product.
 * The adapter (assembly boundary) translates Product V1 inputs to Stage 11
 * internals and back, keeping Stage 11 records internal.
 */
export type ExternalActionEnginePort = {
  readonly identity: ExternalActionConnectorIdentityV1;
  preflight(request: ExternalActionPreflightRequestV1): Promise<ExternalActionPreflightOutcomeV1>;
  execute(request: ExternalActionExecuteRequestV1): Promise<ExternalActionExecuteOutcomeV1>;
  verify(request: ExternalActionVerifyRequestV1): Promise<ExternalActionVerifyOutcomeV1>;
};
