import { describe, expect, it } from 'vitest';

import { InMemoryRouteGuardProjection } from '../../adapters/frontend-product-read-in-memory/src/index.js';

const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    isOwner: true,
    sensitivityClearance: 'private' as const,
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    },
  ],
  accessRevision: '1',
  policyContextRevision: '2',
};

const reviewRoute = { routeId: 'review' as const, href: '/review' as const };

describe('InMemoryRouteGuardProjection', () => {
  it('allows Review and exposes its target route when review work is available', async () => {
    const projection = new InMemoryRouteGuardProjection(async () => true);

    await expect(
      projection.decide({ ...scope, requestedRoute: reviewRoute }),
    ).resolves.toMatchObject({
      decision: 'ALLOW',
      targetRoute: reviewRoute,
    });
  });

  it('returns a typed unavailable decision without a target route when Review is unavailable', async () => {
    const projection = new InMemoryRouteGuardProjection(async () => false);

    const decision = await projection.decide({ ...scope, requestedRoute: reviewRoute });

    expect(decision).toMatchObject({
      decision: 'FEATURE_UNAVAILABLE',
      masked: false,
      message: 'The requested workspace is not available in this Section.',
    });
    expect(decision).not.toHaveProperty('targetRoute');
  });
});
