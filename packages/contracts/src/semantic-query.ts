import type { Actor, SecurityContext } from './types.js';

export const SEMANTIC_QUERY_CLASSIFICATION_REVISION = 'semantic-query-classification:v1' as const;

export type SemanticQuerySearchSurface = 'HYBRID_SEARCH';
export type SemanticQueryEgressClassification = SecurityContext['sensitivity'];

export type SemanticQueryClassificationInput = {
  readonly projectId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
  readonly query: string;
  readonly searchSurface: SemanticQuerySearchSurface;
};

export type SemanticQueryClassification = {
  readonly classification: SemanticQueryEgressClassification;
  readonly policyRevision: typeof SEMANTIC_QUERY_CLASSIFICATION_REVISION;
};

/**
 * Server-owned query egress classification. The caller's clearance is an
 * authorization input for returned knowledge, never the provider egress
 * classification itself.
 */
export type SemanticQueryClassificationPort = {
  classify(input: SemanticQueryClassificationInput): SemanticQueryClassification;
};

export type SemanticDataReadiness = 'NO_ACTIVE_GENERATION' | 'READY' | 'STALE';

export type SemanticExecutionReadiness =
  | 'NOT_CONFIGURED'
  | 'AVAILABLE'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'TEMPORARILY_UNAVAILABLE';

export type SemanticProjectionRefreshInput = {
  readonly projectId: string;
  readonly actor: Actor;
  readonly security: SecurityContext;
};

export type SemanticProjectionRefreshResult = {
  readonly projectId: string;
  readonly profileRevision: number;
  readonly status: 'ACTIVATED' | 'CONFLICT' | 'STALE';
  readonly generationId: string;
  readonly itemCount: number;
  readonly membershipDigest: string;
};

export type SemanticProjectionRefreshPort = {
  refresh(input: SemanticProjectionRefreshInput): Promise<SemanticProjectionRefreshResult>;
};
