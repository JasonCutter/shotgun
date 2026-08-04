import { describe, expect, it } from 'vitest';

import type {
  GraphProjectionHealthV1,
  GraphResultCompletenessV1,
  GraphUnavailableReasonV1,
} from '../../packages/contracts/src/index.js';
import {
  GRAPH_ANNOUNCEMENTS,
  completenessAnnouncement,
  failureAnnouncement,
  healthAnnouncement,
} from '../../apps/shotgun-web/src/knowledge/graph-workspace-state.js';

/**
 * AC-15: STALE, PARTIAL, TRUNCATED, FAILED, UNAVAILABLE and
 * ACCESS_RESTRICTED responses carry the exact health/completeness
 * discriminant and render a frozen non-success announcement. This unit suite
 * pins the discriminant → announcement mapping for every health and
 * completeness value and the FAILED-phase reasons.
 */

const HEALTH_CASES: ReadonlyArray<{
  readonly health: GraphProjectionHealthV1;
  readonly announcement: string;
}> = [
  { health: 'COMPLETE', announcement: '' },
  { health: 'STALE', announcement: GRAPH_ANNOUNCEMENTS.STALE },
  { health: 'REBUILDING', announcement: GRAPH_ANNOUNCEMENTS.REBUILDING },
  { health: 'PARTIAL', announcement: GRAPH_ANNOUNCEMENTS.PARTIAL },
  { health: 'TRUNCATED', announcement: '결과가 잘렸습니다.' },
  { health: 'FAILED', announcement: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
  { health: 'UNAVAILABLE', announcement: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
  { health: 'ACCESS_RESTRICTED', announcement: GRAPH_ANNOUNCEMENTS.ACCESS_RESTRICTED },
];

const COMPLETENESS_CASES: ReadonlyArray<{
  readonly completeness: GraphResultCompletenessV1;
  readonly announcement: string;
}> = [
  { completeness: 'COMPLETE', announcement: '' },
  { completeness: 'PARTIAL', announcement: GRAPH_ANNOUNCEMENTS.PARTIAL },
  { completeness: 'TRUNCATED', announcement: '결과가 잘렸습니다.' },
];

describe('AC-15: health discriminant renders the exact frozen announcement', () => {
  it.each(HEALTH_CASES)('health $health -> "$announcement"', ({ health, announcement }) => {
    expect(healthAnnouncement(health)).toBe(announcement);
  });
});

describe('AC-15: completeness discriminant renders the exact frozen announcement', () => {
  it.each(COMPLETENESS_CASES)(
    'completeness $completeness -> "$announcement"',
    ({ completeness, announcement }) => {
      expect(completenessAnnouncement(completeness)).toBe(announcement);
    },
  );
});

describe('AC-15: FAILED-phase reasons render the exact frozen announcement', () => {
  const cases: ReadonlyArray<{
    readonly reason: GraphUnavailableReasonV1;
    readonly expected: string;
  }> = [
    { reason: 'ACCESS_CHANGED', expected: GRAPH_ANNOUNCEMENTS.ACCESS_RESTRICTED },
    { reason: 'SNAPSHOT_STALE', expected: GRAPH_ANNOUNCEMENTS.STALE },
    { reason: 'PROJECTION_REBUILDING', expected: GRAPH_ANNOUNCEMENTS.REBUILDING },
    { reason: 'DEEP_LINK_TARGET_UNAVAILABLE', expected: '딥링크 대상을 사용할 수 없습니다.' },
    { reason: 'CONTINUATION_EXPIRED', expected: '연속 토큰이 만료되었습니다.' },
    { reason: 'NETWORK_FAILURE', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'PROJECTION_UNAVAILABLE', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'PROJECT_CHANGED', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'POLICY_CHANGED', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'ROOT_RESOURCE_DELETED', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'ROOT_RESOURCE_ARCHIVED', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'OVERLAY_UNAVAILABLE', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
    { reason: 'ANALYZER_TIMEOUT', expected: GRAPH_ANNOUNCEMENTS.UNAVAILABLE },
  ];
  it.each(cases)('FAILED $reason -> "$expected"', ({ reason, expected }) => {
    expect(failureAnnouncement(reason)).toBe(expected);
  });
});
