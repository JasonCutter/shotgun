import { describe, expect, it } from 'vitest';

import {
  REVIEW_ANNOUNCEMENTS,
  aggregateAnnouncement,
  createInitialReviewWorkspaceState,
  reduceReviewWorkspaceState,
} from './review-workspace-state.js';
import {
  reviewContextPhaseQueryKey,
  reviewDisabledQueryKey,
  reviewQueueQueryKey,
  reviewScopeFromShell,
} from '../app/query-keys.js';

describe('FE-P4-S1 review workspace state (AC-24, AC-25)', () => {
  it('selects a context and tracks an unsent draft without browser authority', () => {
    let state = createInitialReviewWorkspaceState();
    state = reduceReviewWorkspaceState(state, {
      type: 'SELECT_CONTEXT',
      reviewContextId: 'context-1',
      contextRevision: 2,
    });
    expect(state.selectedContextId).toBe('context-1');
    expect(state.contextRevision).toBe(2);
    expect(state.drafts).toEqual({});

    state = reduceReviewWorkspaceState(state, {
      type: 'SET_DRAFT',
      reviewItemId: 'item-1',
      intent: 'APPROVE',
      reason: 'Matches evidence.',
    });
    expect(state.drafts['item-1']).toEqual({ intent: 'APPROVE', reason: 'Matches evidence.' });

    state = reduceReviewWorkspaceState(state, { type: 'DECISION_RESOLVED' });
    // Unsent input is cleared after a decision resolves; authority stays with the server.
    expect(state.drafts).toEqual({});
    expect(state.phase.kind).toBe('CONTEXT_READY');
  });

  it('tracks OUTCOME_UNKNOWN with the original command identity for recovery', () => {
    let state = createInitialReviewWorkspaceState();
    state = reduceReviewWorkspaceState(state, {
      type: 'OUTCOME_UNKNOWN',
      clientRequestId: 'client-1',
      idempotencyKey: 'idem-1',
      semanticDigest: 'digest-1',
    });
    if (state.phase.kind !== 'OUTCOME_UNKNOWN') throw new Error('expected OUTCOME_UNKNOWN');
    expect(state.phase.clientRequestId).toBe('client-1');
    expect(state.recovery.kind).toBe('RESOLVING');
    state = reduceReviewWorkspaceState(state, { type: 'RECOVERY_FINISHED' });
    expect(state.recovery.kind).toBe('NONE');
  });

  it('freezes the aggregate announcements used by E2E (AC-27)', () => {
    expect(aggregateAnnouncement('STALE')).toBe('검토 대상이 변경되었습니다. 재검증이 필요합니다.');
    expect(aggregateAnnouncement('ACCEPTED_FOR_AUTHORING')).toBe('작성 후보로 승인되었습니다.');
    expect(aggregateAnnouncement('UNAVAILABLE')).toBe('검토 정보를 사용할 수 없습니다.');
    expect(REVIEW_ANNOUNCEMENTS.OUTCOME_UNKNOWN).toBe(
      '결정 결과를 확인할 수 없습니다. 원래 요청으로 복구합니다.',
    );
  });
});

describe('FE-P4-S1 review cache isolation (AC-16/AC-21)', () => {
  const scope = reviewScopeFromShell({
    principalId: 'p-1',
    sessionId: 's-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    projectionRevision: 'proj-1',
    activeProject: {
      id: 'project-1',
      label: 'Project 1',
      sensitivityClearance: 'private',
    },
  } as never);
  if (!scope) throw new Error('scope expected');

  it('keeps queue reads bound to the full request (filters, page size)', () => {
    const a = reviewQueueQueryKey(scope, { pageSize: 50 });
    const b = reviewQueueQueryKey(scope, { pageSize: 50, aggregateStates: ['PENDING'] });
    expect(a).not.toEqual(b);
  });

  it('keeps context reads bound to the immutable context revision', () => {
    const a = reviewContextPhaseQueryKey(scope, 'context-1', 1, ['read']);
    const b = reviewContextPhaseQueryKey(scope, 'context-1', 2, ['read']);
    expect(a).not.toEqual(b);
    expect(a).toEqual(reviewContextPhaseQueryKey(scope, 'context-1', 1, ['read']));
  });

  it('falls back to a disabled key when unscoped', () => {
    expect(reviewDisabledQueryKey('queue')).toEqual(['review', 'disabled', 'queue']);
  });
});
