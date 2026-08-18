import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { ProductSessionView, ShotgunApiClient } from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from './providers.js';
import { createFrontendQueryClient } from './query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import { createAppRouteObjects } from './router.js';

describe('Settings Parent and Child Route Guard Authorization', () => {
  const activeSession: ProductSessionView = {
    apiVersion: '2.0.0' as const,
    principal: {
      id: 'principal-1',
      actor: { type: 'user' as const, id: 'user-1' },
      authenticationMethod: 'session' as const,
    },
    activeProject: { id: 'project-1' },
    accessibleProjects: [{ id: 'project-1', isOwner: true }],
    session: { expiresAt: null },
    sessionReady: true,
    projectReady: true,
    projectAccessRevision: '1',
  };

  const bootstrapSession: ProductSessionView = {
    apiVersion: '2.0.0' as const,
    principal: {
      id: 'principal-1',
      actor: { type: 'user' as const, id: 'user-1' },
      authenticationMethod: 'session' as const,
    },
    activeProject: null,
    accessibleProjects: [],
    session: { expiresAt: null },
    sessionReady: true,
    projectReady: false,
    projectAccessRevision: '0',
  };

  const createRuntime = (
    apiClientOverrides: Partial<ShotgunApiClient>,
    session: ProductSessionView = activeSession,
  ): AppRuntime => {
    const apiClient = {
      getSession: vi.fn().mockResolvedValue(session),
      bootstrapLocalOwner: vi.fn().mockResolvedValue(session),
      getRouteGuardDecision: vi.fn(),
      getProjects: vi.fn().mockResolvedValue([]),
      getAISettings: vi.fn().mockResolvedValue({
        projectId: 'project-1',
        mode: 'PROJECT_MANAGED',
        defaultProviderId: 'deepseek',
        providers: [
          {
            providerId: 'deepseek',
            displayName: 'DeepSeek',
            status: 'active',
            models: [
              {
                providerId: 'deepseek',
                modelId: 'deepseek-chat',
                displayName: 'DeepSeek V3',
                shotgunUsableCapabilities: ['ASK'],
                capabilityRevision: 'c1',
              },
            ],
          },
        ],
        credentialStatuses: [],
        privacy: [],
        vaultAvailability: { state: 'AVAILABLE', keyVersion: 'v1' },
        legacyGeminiCredentialConfigured: false,
      }),
      getGlobalShell: vi.fn().mockResolvedValue({
        schemaVersion: '1.0.0',
        principalId: 'principal-1',
        sessionId: 'session-1',
        activeProject: session.activeProject
          ? { id: session.activeProject.id, label: 'Shotgun' }
          : null,
        accessibleProjects: session.accessibleProjects.map((p) => ({ id: p.id, label: 'Shotgun' })),
        navigation: [],
        features: [],
        readiness: [],
        background: { activeCount: 0, failedCount: 0 },
        notifications: { unreadCount: 0, presentationRevision: 'n1' },
        accessRevision: 'a1',
        policyContextRevision: 'p1',
        projectionRevision: 'pr1',
        fetchedAt: '2026-08-14T00:00:00.000Z',
      }),
      getPrincipalPreferences: vi.fn().mockResolvedValue({ preferences: { locale: 'en-US' } }),
      ...apiClientOverrides,
    } as unknown as ShotgunApiClient;

    return {
      apiClient,
      queryClient: createFrontendQueryClient(),
      sessionCycleState: createSessionCycleState(),
    };
  };

  it('invokes parent getRouteGuardDecision with settings routeId and renders AI workspace when ALLOWed', async () => {
    const getRouteGuardDecision = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      decision: 'ALLOW',
      masked: false,
    });
    const runtime = createRuntime({ getRouteGuardDecision });
    const router = createMemoryRouter(createAppRouteObjects(runtime), {
      initialEntries: ['/settings/ai'],
    });

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Settings & Preferences' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'AI', level: 2 })).toBeTruthy();
    expect(getRouteGuardDecision).toHaveBeenCalledWith(
      { routeId: 'settings', href: '/settings' },
      undefined,
      expect.any(Object),
    );
  });

  it('does NOT render child workspace and renders RouteError when parent settings route is DENIed', async () => {
    const getRouteGuardDecision = vi.fn().mockImplementation(async (targetRoute) => {
      if (targetRoute.routeId === 'settings') {
        return {
          schemaVersion: '1.0.0',
          decision: 'FEATURE_UNAVAILABLE',
          masked: false,
          message: 'Settings are restricted by policy.',
        };
      }
      return { schemaVersion: '1.0.0', decision: 'ALLOW', masked: false };
    });
    const runtime = createRuntime({ getRouteGuardDecision });
    const router = createMemoryRouter(createAppRouteObjects(runtime), {
      initialEntries: ['/settings/ai'],
    });

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Request error' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings & Preferences' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'AI' })).toBeNull();
    expect(getRouteGuardDecision).toHaveBeenCalledWith(
      { routeId: 'settings', href: '/settings' },
      undefined,
      expect.any(Object),
    );
  });

  it('invokes both parent settings and child settings-projects guards for /settings/projects', async () => {
    const getRouteGuardDecision = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      decision: 'ALLOW',
      masked: false,
    });
    const runtime = createRuntime({ getRouteGuardDecision }, bootstrapSession);
    const router = createMemoryRouter(createAppRouteObjects(runtime), {
      initialEntries: ['/settings/projects'],
    });

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Create your first Project' })).toBeTruthy();
    expect(getRouteGuardDecision).toHaveBeenCalledWith(
      { routeId: 'settings', href: '/settings' },
      undefined,
      expect.any(Object),
    );
    expect(getRouteGuardDecision).toHaveBeenCalledWith(
      { routeId: 'settings-projects', href: '/settings/projects' },
      undefined,
      expect.any(Object),
    );
  });

  it('renders RouteError when specific settings-projects child guard is DENIed even if parent is ALLOWed', async () => {
    const getRouteGuardDecision = vi.fn().mockImplementation(async (targetRoute) => {
      if (targetRoute.routeId === 'settings-projects') {
        return {
          schemaVersion: '1.0.0',
          decision: 'FEATURE_UNAVAILABLE',
          masked: false,
          message: 'Projects management is restricted.',
        };
      }
      return { schemaVersion: '1.0.0', decision: 'ALLOW', masked: false };
    });
    const runtime = createRuntime({ getRouteGuardDecision }, bootstrapSession);
    const router = createMemoryRouter(createAppRouteObjects(runtime), {
      initialEntries: ['/settings/projects'],
    });

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Request error' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Create your first Project' })).toBeNull();
    expect(getRouteGuardDecision).toHaveBeenCalledWith(
      { routeId: 'settings-projects', href: '/settings/projects' },
      undefined,
      expect.any(Object),
    );
  });
});
