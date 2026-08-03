import { describe, expect, it } from 'vitest';

import { graphScopeFromShell } from './graph-queries.js';
import {
  graphDisabledQueryKey,
  graphScopeQueryKey,
  graphSnapshotPhaseQueryKey,
  type GraphQueryScope,
} from '../app/query-keys.js';

const scope: GraphQueryScope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProjectId: 'project-1',
  resourceProjectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivity: 'private',
  projectionRevision: 'projection-1',
};

const request = (viewKind: 'KNOWLEDGE_SEMANTIC' | 'GOVERNANCE_IMPACT', overlayKinds: string[]) => ({
  schemaVersion: '1.0.0' as const,
  viewKind,
  overlayKinds: overlayKinds as never,
});

describe('FE-P3-S3 graph cache isolation (AC-16)', () => {
  it('distinguishes the scope-phase key from every snapshot-phase key', () => {
    const scopeKey = graphScopeQueryKey(scope, request('KNOWLEDGE_SEMANTIC', []));
    const snapshotKey = graphSnapshotPhaseQueryKey(scope, 'snapshot-1', 'proj-1', ['neighborhood']);
    expect(scopeKey).not.toEqual(snapshotKey);
  });

  it('never reuses a cached result across projects, revisions or snapshots', () => {
    const otherProject = { ...scope, activeProjectId: 'project-2', resourceProjectId: 'project-2' };
    const otherAccess = { ...scope, accessRevision: 'access-2' };
    const otherPolicy = { ...scope, policyContextRevision: 'policy-2' };
    const otherProjection = { ...scope, projectionRevision: 'projection-2' };
    const otherSnapshot = { ...scope };

    const base = graphScopeQueryKey(scope, request('KNOWLEDGE_SEMANTIC', []));
    const keys = [
      graphScopeQueryKey(otherProject, request('KNOWLEDGE_SEMANTIC', [])),
      graphScopeQueryKey(otherAccess, request('KNOWLEDGE_SEMANTIC', [])),
      graphScopeQueryKey(otherPolicy, request('KNOWLEDGE_SEMANTIC', [])),
      graphScopeQueryKey(otherProjection, request('KNOWLEDGE_SEMANTIC', [])),
      graphScopeQueryKey(scope, request('GOVERNANCE_IMPACT', [])),
      graphScopeQueryKey(scope, request('KNOWLEDGE_SEMANTIC', ['CONFLICT'])),
      graphSnapshotPhaseQueryKey(otherSnapshot, 'snapshot-2', 'proj-1', ['neighborhood']),
      graphSnapshotPhaseQueryKey(scope, 'snapshot-1', 'proj-2', ['neighborhood']),
      graphSnapshotPhaseQueryKey(scope, 'snapshot-1', 'proj-1', ['path']),
    ];
    for (const key of keys) {
      expect(key).not.toEqual(base);
    }
  });

  it('derives the scope from the server shell only when a project is active', () => {
    const shell = {
      schemaVersion: '1.0.0' as const,
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: {
        id: 'project-1',
        label: 'Project One',
        sensitivityClearance: 'private',
      },
      accessibleProjects: [],
      navigation: [],
      features: [],
      readiness: [],
      background: { activeCount: 0, failedCount: 0 },
      notifications: { unreadCount: 0, presentationRevision: '1' },
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      projectionRevision: 'projection-1',
      fetchedAt: '2026-08-04T08:00:00.000Z',
    };
    expect(graphScopeFromShell(shell)?.activeProjectId).toBe('project-1');
    expect(graphScopeFromShell({ ...shell, activeProject: null })).toBeNull();
    expect(graphDisabledQueryKey('snapshot')).toEqual(['graph', 'disabled', 'snapshot']);
  });
});
