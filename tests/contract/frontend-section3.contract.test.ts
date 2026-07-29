import { describe, expect, it } from 'vitest';

import {
  buildFrontendCommandV2SemanticDigestInput,
  decodeGlobalShellView,
  decodeGlobalSearchRequest,
  decodeHomeActionCenterView,
  decodeProductSessionView,
  decodeProductSessionViewV2,
  decodeRouteGuardDecisionView,
  decodeTargetRouteView,
  validatePrincipalProjectCreateRequest,
} from '../../packages/contracts/src/index.js';

const principalProjectCreateRequest = () => ({
  envelopeVersion: '2.0.0',
  commandType: 'project.create.v1',
  commandSchemaVersion: '1.0.0',
  clientRequestId: 'bootstrap-request-1',
  idempotencyKey: 'bootstrap-idempotency-1',
  projectContext: {
    scope: 'PRINCIPAL',
    observedProjectAccessRevision: '0',
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions: [],
  clientIssuedAt: '2026-07-29T00:00:00.000Z',
  payload: { name: 'First Project', locale: 'ko-KR', timezone: 'Asia/Seoul' },
});

describe('Frontend Phase 1 Section 3 contracts', () => {
  it('decodes the authority-free zero-project Product Session V2 state', () => {
    const decoded = decodeProductSessionViewV2({
      apiVersion: '2.0.0',
      principal: {
        id: 'principal-1',
        actor: { type: 'user', id: 'principal-1' },
        authenticationMethod: 'session',
      },
      activeProject: null,
      accessibleProjects: [],
      session: { expiresAt: null },
      sessionReady: true,
      projectReady: false,
      projectAccessRevision: '0',
    });
    expect(decoded.activeProject).toBeNull();
    expect(decoded.projectReady).toBe(false);
  });

  it('fails closed when a null active Project has accessible Projects', () => {
    expect(() =>
      decodeProductSessionViewV2({
        apiVersion: '2.0.0',
        principal: {
          id: 'principal-1',
          actor: { type: 'user', id: 'principal-1' },
          authenticationMethod: 'session',
        },
        activeProject: null,
        accessibleProjects: [{ id: 'project-1', isOwner: true }],
        session: { expiresAt: null },
        sessionReady: true,
        projectReady: false,
        projectAccessRevision: '1',
      }),
    ).toThrow(expect.objectContaining({ code: 'LOCAL_PROJECT_SELECTION_REQUIRED' }));
  });

  it('retains the exact Product Session V1 decoder', () => {
    const decoded = decodeProductSessionView({
      apiVersion: '1.0.0',
      principal: {
        id: 'principal-1',
        actor: { type: 'user', id: 'principal-1' },
        authenticationMethod: 'session',
      },
      activeProject: { id: 'project-1' },
      accessibleProjects: [{ id: 'project-1', isOwner: true }],
      session: { expiresAt: null },
    });
    expect(decoded.apiVersion).toBe('1.0.0');
  });

  it('accepts only PRINCIPAL project.create.v1 with access revision zero and no Project ID', () => {
    const decoded = validatePrincipalProjectCreateRequest(principalProjectCreateRequest());
    expect(decoded.projectContext).toEqual({
      scope: 'PRINCIPAL',
      observedProjectAccessRevision: '0',
    });
    expect(decoded.payload).not.toHaveProperty('newProjectId');

    expect(() =>
      validatePrincipalProjectCreateRequest({
        ...principalProjectCreateRequest(),
        payload: { name: 'First Project', newProjectId: 'browser-project' },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      validatePrincipalProjectCreateRequest({
        ...principalProjectCreateRequest(),
        projectContext: { scope: 'PRINCIPAL' },
      }),
    ).toThrow(expect.objectContaining({ code: 'PROJECT_ACCESS_REVISION_CONFLICT' }));
  });

  it('binds the V2 semantic digest to Principal scope and accepted policy', () => {
    const request = validatePrincipalProjectCreateRequest(principalProjectCreateRequest());
    const acceptedAt = '2026-07-29T00:00:01.000Z';
    const first = buildFrontendCommandV2SemanticDigestInput(request, 'principal-1', {
      policyContextId: 'principal-project-bootstrap-policy',
      policyContextRevision: '1',
      acceptedAt,
    });
    const second = buildFrontendCommandV2SemanticDigestInput(request, 'principal-2', {
      policyContextId: 'principal-project-bootstrap-policy',
      policyContextRevision: '1',
      acceptedAt,
    });
    expect(first).not.toBe(second);
  });

  it('fails closed on unknown routes, route decisions, and unbounded search', () => {
    expect(() => decodeTargetRouteView({ routeId: 'admin-secret', href: '/admin-secret' })).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }),
    );
    expect(() =>
      decodeRouteGuardDecisionView({
        schemaVersion: '1.0.0',
        decision: 'CLIENT_ALLOW',
        masked: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    expect(() =>
      decodeGlobalSearchRequest({
        schemaVersion: '1.0.0',
        query: 'x'.repeat(501),
        scope: { kind: 'ACTIVE_PROJECT' },
        limit: 20,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      decodeGlobalSearchRequest({
        schemaVersion: '1.0.0',
        query: 'duplicate scope',
        scope: {
          kind: 'CROSS_PROJECT',
          projectIds: ['project-1', 'project-1'],
        },
        limit: 20,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() =>
      validatePrincipalProjectCreateRequest({
        ...principalProjectCreateRequest(),
        correlationContext: {
          causationRef: { kind: 'BROWSER_AUTHORITY', id: 'forged' },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });

  it('deep-decodes Shell and Home projection bindings', () => {
    const shell = decodeGlobalShellView({
      schemaVersion: '1.0.0',
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: {
        id: 'project-1',
        label: 'Project One',
        sensitivityClearance: 'private',
      },
      accessibleProjects: [
        {
          id: 'project-1',
          label: 'Project One',
          isOwner: true,
          sensitivityClearance: 'private',
        },
      ],
      navigation: [
        {
          id: 'home',
          label: 'Home',
          availability: 'AVAILABLE',
          targetRoute: { routeId: 'home', href: '/' },
        },
      ],
      features: [],
      readiness: [{ kind: 'SESSION_READY', ready: true, required: true }],
      background: { activeCount: 0, failedCount: 0 },
      notifications: { unreadCount: 0, presentationRevision: '1' },
      accessRevision: '1',
      policyContextRevision: '2',
      projectionRevision: 'shell-1',
      fetchedAt: '2026-07-29T00:00:00.000Z',
    });
    expect(shell.activeProject?.sensitivityClearance).toBe('private');

    expect(() =>
      decodeGlobalShellView({
        ...shell,
        accessibleProjects: [
          {
            ...shell.accessibleProjects[0],
            sensitivityClearance: 'client-invented',
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));

    const home = decodeHomeActionCenterView({
      schemaVersion: '1.0.0',
      principalId: 'principal-1',
      sessionId: 'session-1',
      activeProject: { id: 'project-1', label: 'Project One' },
      projectState: { lifecycle: 'ACTIVE', message: 'Ready.' },
      primaryActions: [],
      attention: [
        {
          stableId: 'attention-server-first',
          kind: 'review',
          label: 'Server first',
          priority: 8,
          reason: 'Server-ranked first.',
          projectId: 'project-1',
          resourceId: 'resource-1',
          targetRoute: { routeId: 'review', href: '/review' },
          createdAt: '2026-07-29T00:00:00.000Z',
        },
        {
          stableId: 'attention-server-second',
          kind: 'source',
          label: 'Server second',
          priority: 1,
          reason: 'Server-ranked second.',
          projectId: 'project-1',
          resourceId: 'resource-2',
          targetRoute: { routeId: 'sources', href: '/sources' },
          createdAt: '2026-07-29T00:00:01.000Z',
        },
      ],
      continueWorking: [
        {
          stableId: 'server-resource-1',
          origin: 'SERVER_RESOURCE',
          kind: 'source',
          label: 'Server resource',
          projectId: 'project-1',
          resourceId: 'resource-3',
          targetRoute: { routeId: 'sources', href: '/sources' },
          updatedAt: '2026-07-29T00:00:02.000Z',
        },
      ],
      recent: [
        {
          stableId: 'recent-1',
          kind: 'knowledge',
          label: 'Recent resource',
          projectId: 'project-1',
          resourceId: 'resource-4',
          targetRoute: { routeId: 'knowledge', href: '/knowledge' },
          updatedAt: '2026-07-29T00:00:03.000Z',
        },
      ],
      pinned: [
        {
          stableId: 'pinned-1',
          kind: 'ask',
          label: 'Pinned resource',
          projectId: 'project-1',
          resourceId: 'resource-5',
          targetRoute: { routeId: 'ask', href: '/ask' },
          updatedAt: '2026-07-29T00:00:04.000Z',
        },
      ],
      operationalSummary: {
        activeBackgroundCount: 0,
        failedBackgroundCount: 0,
        unreadNotificationCount: 0,
      },
      stale: false,
      accessRevision: '1',
      policyContextRevision: '2',
      projectionRevision: 'home-1',
      fetchedAt: '2026-07-29T00:00:00.000Z',
    });
    expect(home.activeProject.id).toBe('project-1');
    expect(home.attention.map((item) => item.stableId)).toEqual([
      'attention-server-first',
      'attention-server-second',
    ]);
    expect(home.continueWorking[0]?.origin).toBe('SERVER_RESOURCE');
  });
});
