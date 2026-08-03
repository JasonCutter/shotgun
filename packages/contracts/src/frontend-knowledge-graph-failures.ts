import { FrontendContractError } from './frontend-foundation.js';
import type { GraphUnavailableReasonV1 } from './frontend-knowledge-graph.js';
import { GRAPH_UNAVAILABLE_REASONS } from './frontend-knowledge-graph.js';

/**
 * FE-P3-S3 graph read typed failure mapping. Every `GraphUnavailableReasonV1`
 * maps to a typed failure with a normalized code, an HTTP status, retryability
 * and a human message. No write command is ever introduced to recover a graph
 * read.
 */

export type GraphFailureKind = 'GRAPH_READ';

export type GraphReadFailureMapping = {
  readonly reason: GraphUnavailableReasonV1;
  readonly normalizedCode: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly message: string;
};

export const GRAPH_READ_FAILURE_MAPPINGS: readonly GraphReadFailureMapping[] = [
  {
    reason: 'PROJECTION_UNAVAILABLE',
    normalizedCode: 'GRAPH_PROJECTION_UNAVAILABLE',
    httpStatus: 503,
    retryable: true,
    message: 'The graph projection is currently unavailable.',
  },
  {
    reason: 'PROJECTION_REBUILDING',
    normalizedCode: 'GRAPH_PROJECTION_REBUILDING',
    httpStatus: 202,
    retryable: true,
    message: 'The graph projection is being rebuilt.',
  },
  {
    reason: 'SNAPSHOT_STALE',
    normalizedCode: 'GRAPH_SNAPSHOT_STALE',
    httpStatus: 409,
    retryable: true,
    message: 'The snapshot revision does not match the server projection revision.',
  },
  {
    reason: 'CONTINUATION_EXPIRED',
    normalizedCode: 'GRAPH_CONTINUATION_EXPIRED',
    httpStatus: 410,
    retryable: false,
    message: 'The continuation token has expired; re-issue the initial request.',
  },
  {
    reason: 'ACCESS_CHANGED',
    normalizedCode: 'GRAPH_ACCESS_CHANGED',
    httpStatus: 403,
    retryable: false,
    message: 'The access scope changed since the snapshot was issued.',
  },
  {
    reason: 'PROJECT_CHANGED',
    normalizedCode: 'GRAPH_PROJECT_CHANGED',
    httpStatus: 403,
    retryable: false,
    message: 'The active Project changed; the snapshot context no longer applies.',
  },
  {
    reason: 'POLICY_CHANGED',
    normalizedCode: 'GRAPH_POLICY_CHANGED',
    httpStatus: 403,
    retryable: false,
    message: 'The policy context changed since the snapshot was issued.',
  },
  {
    reason: 'ROOT_RESOURCE_DELETED',
    normalizedCode: 'GRAPH_ROOT_RESOURCE_DELETED',
    httpStatus: 410,
    retryable: false,
    message: 'The snapshot root resource was deleted.',
  },
  {
    reason: 'ROOT_RESOURCE_ARCHIVED',
    normalizedCode: 'GRAPH_ROOT_RESOURCE_ARCHIVED',
    httpStatus: 410,
    retryable: false,
    message: 'The snapshot root resource was archived.',
  },
  {
    reason: 'OVERLAY_UNAVAILABLE',
    normalizedCode: 'GRAPH_OVERLAY_UNAVAILABLE',
    httpStatus: 503,
    retryable: true,
    message: 'The requested overlay is unavailable.',
  },
  {
    reason: 'ANALYZER_TIMEOUT',
    normalizedCode: 'GRAPH_ANALYZER_TIMEOUT',
    httpStatus: 504,
    retryable: true,
    message: 'The impact analyzer timed out.',
  },
  {
    reason: 'DEEP_LINK_TARGET_UNAVAILABLE',
    normalizedCode: 'GRAPH_DEEP_LINK_TARGET_UNAVAILABLE',
    httpStatus: 410,
    retryable: false,
    message: 'The deep-link target snapshot or node is no longer available.',
  },
  {
    reason: 'NETWORK_FAILURE',
    normalizedCode: 'GRAPH_NETWORK_FAILURE',
    httpStatus: 502,
    retryable: true,
    message: 'A network failure occurred while reading the graph projection.',
  },
];

export const graphFailureForReason = (
  reason: GraphUnavailableReasonV1,
): GraphReadFailureMapping => {
  const mapping = GRAPH_READ_FAILURE_MAPPINGS.find((entry) => entry.reason === reason);
  if (!mapping) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `No graph read failure mapping for ${reason}`,
    );
  }
  return mapping;
};

export const graphFailureApiCode = (reason: GraphUnavailableReasonV1): string =>
  graphFailureForReason(reason).normalizedCode;

export const isGraphUnavailableReason = (value: unknown): value is GraphUnavailableReasonV1 =>
  typeof value === 'string' && GRAPH_UNAVAILABLE_REASONS.includes(value as GraphUnavailableReasonV1);
