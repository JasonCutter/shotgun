import { describe, expect, it } from 'vitest';

import {
  GRAPH_READ_FAILURE_MAPPINGS,
  GRAPH_UNAVAILABLE_REASONS,
  graphFailureApiCode,
  graphFailureForReason,
  type GraphUnavailableReasonV1,
} from '../../packages/contracts/src/index.js';
import { ShotgunApiError } from '../../packages/shotgun-api-client/src/index.js';
import {
  graphCanManuallyRetry,
  graphQueryRetry,
} from '../../apps/shotgun-web/src/knowledge/graph-queries.js';
import {
  GRAPH_ANNOUNCEMENTS,
  createInitialGraphWorkspaceState,
  failureAnnouncement,
  reduceGraphWorkspaceState,
} from '../../apps/shotgun-web/src/knowledge/graph-workspace-state.js';

/**
 * AC-24 data-driven unit suite. The thirteen `GraphUnavailableReasonV1`
 * values are each asserted against an explicit expected table for:
 * 1. mapping  — normalized code, HTTP status, retryability, human message;
 * 2. SAFE/UNSAFE — whether the client retry policy retries the failure;
 * 3. recovery — the browser state machine's recovery transitions, which issue
 *    read-only recovery (refresh/restore) and never a graph write;
 * 4. announcements — the frozen per-reason non-success announcement string.
 */

const FAILURE_CASES: ReadonlyArray<{
  readonly reason: GraphUnavailableReasonV1;
  readonly normalizedCode: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
}> = [
  {
    reason: 'PROJECTION_UNAVAILABLE',
    normalizedCode: 'GRAPH_PROJECTION_UNAVAILABLE',
    httpStatus: 503,
    retryable: true,
  },
  {
    reason: 'PROJECTION_REBUILDING',
    normalizedCode: 'GRAPH_PROJECTION_REBUILDING',
    httpStatus: 202,
    retryable: true,
  },
  {
    reason: 'SNAPSHOT_STALE',
    normalizedCode: 'GRAPH_SNAPSHOT_STALE',
    httpStatus: 409,
    retryable: true,
  },
  {
    reason: 'CONTINUATION_EXPIRED',
    normalizedCode: 'GRAPH_CONTINUATION_EXPIRED',
    httpStatus: 410,
    retryable: false,
  },
  {
    reason: 'ACCESS_CHANGED',
    normalizedCode: 'GRAPH_ACCESS_CHANGED',
    httpStatus: 403,
    retryable: false,
  },
  {
    reason: 'PROJECT_CHANGED',
    normalizedCode: 'GRAPH_PROJECT_CHANGED',
    httpStatus: 403,
    retryable: false,
  },
  {
    reason: 'POLICY_CHANGED',
    normalizedCode: 'GRAPH_POLICY_CHANGED',
    httpStatus: 403,
    retryable: false,
  },
  {
    reason: 'ROOT_RESOURCE_DELETED',
    normalizedCode: 'GRAPH_ROOT_RESOURCE_DELETED',
    httpStatus: 410,
    retryable: false,
  },
  {
    reason: 'ROOT_RESOURCE_ARCHIVED',
    normalizedCode: 'GRAPH_ROOT_RESOURCE_ARCHIVED',
    httpStatus: 410,
    retryable: false,
  },
  {
    reason: 'OVERLAY_UNAVAILABLE',
    normalizedCode: 'GRAPH_OVERLAY_UNAVAILABLE',
    httpStatus: 503,
    retryable: true,
  },
  {
    reason: 'ANALYZER_TIMEOUT',
    normalizedCode: 'GRAPH_ANALYZER_TIMEOUT',
    httpStatus: 504,
    retryable: true,
  },
  {
    reason: 'DEEP_LINK_TARGET_UNAVAILABLE',
    normalizedCode: 'GRAPH_DEEP_LINK_TARGET_UNAVAILABLE',
    httpStatus: 410,
    retryable: false,
  },
  {
    reason: 'NETWORK_FAILURE',
    normalizedCode: 'GRAPH_NETWORK_FAILURE',
    httpStatus: 502,
    retryable: true,
  },
];

const shotGunApiErrorFor = (mapping: {
  readonly normalizedCode: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly message: string;
}): ShotgunApiError =>
  new ShotgunApiError({
    status: mapping.httpStatus,
    code: mapping.normalizedCode,
    category: mapping.retryable ? 'DEPENDENCY' : 'AUTHORIZATION',
    retryability: mapping.retryable ? 'SAFE' : 'NEVER',
    recovery: mapping.retryable ? 'RETRY' : 'REQUEST_ACCESS',
    message: mapping.message,
  });

describe('AC-24: graph read failure mapping is complete and typed', () => {
  it('covers exactly the thirteen GraphUnavailableReasonV1 values', () => {
    const mappedReasons = GRAPH_READ_FAILURE_MAPPINGS.map((entry) => entry.reason).sort();
    const allReasons = [...GRAPH_UNAVAILABLE_REASONS].sort();
    expect(mappedReasons).toEqual(allReasons);
    expect(mappedReasons).toHaveLength(13);
  });

  it.each(FAILURE_CASES)(
    '$reason maps to $normalizedCode (HTTP $httpStatus, retryable=$retryable)',
    ({ reason, normalizedCode, httpStatus, retryable }) => {
      const mapping = graphFailureForReason(reason);
      expect(mapping.normalizedCode).toBe(normalizedCode);
      expect(mapping.httpStatus).toBe(httpStatus);
      expect(mapping.retryable).toBe(retryable);
      expect(mapping.message.length).toBeGreaterThan(0);
      expect(graphFailureApiCode(reason)).toBe(normalizedCode);
    },
  );

  it('rejects an unknown reason instead of guessing a mapping', () => {
    expect(() => graphFailureForReason('NOT_A_REASON' as GraphUnavailableReasonV1)).toThrow(
      /No graph read failure mapping/,
    );
  });
});

describe('AC-24: SAFE/UNSAFE retry classification per reason', () => {
  it.each(FAILURE_CASES)(
    'classifies $reason as $retryable (SAFE=retry, UNSAFE=never retry)',
    ({ reason, retryable }) => {
      const mapping = graphFailureForReason(reason);
      const error = shotGunApiErrorFor(mapping);
      const classifiedSafe = error.retryability === 'SAFE' && graphCanManuallyRetry(error);
      const classifiedUnsafe = error.retryability === 'NEVER' && !graphCanManuallyRetry(error);
      expect(classifiedSafe || classifiedUnsafe).toBe(true);
      expect(classifiedSafe).toBe(retryable);

      // Retry policy: SAFE failures retry up to the configured budget
      // (failureCount < 2); UNSAFE failures never retry at any count.
      if (retryable) {
        expect(graphQueryRetry(0, error)).toBe(true);
        expect(graphQueryRetry(1, error)).toBe(true);
        expect(graphQueryRetry(2, error)).toBe(false);
        expect(error.recovery).toBe('RETRY');
      } else {
        expect(graphQueryRetry(0, error)).toBe(false);
        expect(graphQueryRetry(1, error)).toBe(false);
        expect(graphQueryRetry(2, error)).toBe(false);
        expect(error.recovery).not.toBe('RETRY');
      }
    },
  );

  it('never retries untyped failures', () => {
    expect(graphQueryRetry(0, new Error('untyped browser failure'))).toBe(false);
    expect(graphCanManuallyRetry(new Error('untyped'))).toBe(false);
  });
});

describe('AC-24: recovery issues read-only state transitions, never a write', () => {
  it('FAILED phase carries the reason, message and retryability', () => {
    for (const { reason, retryable } of FAILURE_CASES) {
      const state = reduceGraphWorkspaceState(createInitialGraphWorkspaceState(), {
        type: 'FAILED',
        reason,
        message: `message for ${reason}`,
        retryable,
      });
      expect(state.phase).toMatchObject({
        kind: 'FAILED',
        reason,
        message: `message for ${reason}`,
        retryable,
      });
    }
  });

  it('RECOVERY_STARTED transitions to REFRESHING (no target) or RESTORING (target)', () => {
    const base = reduceGraphWorkspaceState(createInitialGraphWorkspaceState(), {
      type: 'FAILED',
      reason: 'NETWORK_FAILURE',
      message: 'Graph read failed.',
      retryable: true,
    });

    const refreshing = reduceGraphWorkspaceState(base, { type: 'RECOVERY_STARTED' });
    expect(refreshing.recovery).toEqual({ kind: 'REFRESHING' });
    expect(refreshing.phase.kind).toBe('OPERATION_LOADING');

    const targetRef = {
      schemaVersion: '1.0.0' as const,
      resourceKind: 'ENTITY' as const,
      resourceId: 'entity-1',
    };
    const restoring = reduceGraphWorkspaceState(base, {
      type: 'RECOVERY_STARTED',
      targetRef,
    });
    expect(restoring.recovery).toEqual({ kind: 'RESTORING', targetRef });
    expect(restoring.phase.kind).toBe('OPERATION_LOADING');
  });

  it('RECOVERY_FINISHED returns recovery to NONE', () => {
    const state = reduceGraphWorkspaceState(createInitialGraphWorkspaceState(), {
      type: 'RECOVERY_FINISHED',
    });
    expect(state.recovery).toEqual({ kind: 'NONE' });
  });
});

describe('AC-24: per-reason frozen non-success announcements', () => {
  it.each(FAILURE_CASES)('$reason renders a non-success announcement', ({ reason }) => {
    const announcement = failureAnnouncement(reason);
    expect(announcement.length).toBeGreaterThan(0);
    if (reason === 'ACCESS_CHANGED')
      expect(announcement).toBe(GRAPH_ANNOUNCEMENTS.ACCESS_RESTRICTED);
    if (reason === 'SNAPSHOT_STALE') expect(announcement).toBe(GRAPH_ANNOUNCEMENTS.STALE);
    if (reason === 'PROJECTION_REBUILDING')
      expect(announcement).toBe(GRAPH_ANNOUNCEMENTS.REBUILDING);
    if (reason === 'DEEP_LINK_TARGET_UNAVAILABLE')
      expect(announcement).toBe('딥링크 대상을 사용할 수 없습니다.');
    if (reason === 'CONTINUATION_EXPIRED') expect(announcement).toBe('연속 토큰이 만료되었습니다.');
  });

  it('falls back to the UNAVAILABLE announcement for the remaining reasons', () => {
    const specialized = new Set([
      'ACCESS_CHANGED',
      'SNAPSHOT_STALE',
      'PROJECTION_REBUILDING',
      'DEEP_LINK_TARGET_UNAVAILABLE',
      'CONTINUATION_EXPIRED',
    ]);
    for (const reason of GRAPH_UNAVAILABLE_REASONS) {
      if (!specialized.has(reason)) {
        expect(failureAnnouncement(reason as GraphUnavailableReasonV1)).toBe(
          GRAPH_ANNOUNCEMENTS.UNAVAILABLE,
        );
      }
    }
  });
});
