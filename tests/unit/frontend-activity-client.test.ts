import { describe, expect, it } from 'vitest';

import {
  createFrontendActivityClient,
  type GetActivityDetailRequestV1,
} from '../../packages/shotgun-api-client/src/index.js';
import { FrontendContractError } from '../../packages/contracts/src/index.js';

const request: GetActivityDetailRequestV1 = {
  schemaVersion: '1.0.0',
  domainKind: 'SOURCES',
  activityId: 'activity-1',
  domainResourceKind: 'IntakeSubmission',
  domainResourceId: 'submission-1',
};

const snapshot = {
  schemaVersion: '1.0.0' as const,
  root: {
    schemaVersion: '1.0.0' as const,
    rootKind: 'JOB' as const,
    activityId: 'activity-1',
    domainKind: 'SOURCES' as const,
    domainResourceKind: 'IntakeSubmission',
    domainResourceId: 'submission-1',
    resourceProjectId: 'project-1',
    resourceHref: '/activity/sources/submission-1',
    jobId: 'submission-1',
    runId: 'submission-1',
  },
  run: {
    schemaVersion: '1.0.0' as const,
    runId: 'submission-1',
    jobId: 'submission-1',
    sequence: 1,
    state: 'SUCCEEDED' as const,
    startedAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:01:00.000Z',
    completedAt: '2026-09-11T00:01:00.000Z',
    domainAttemptRefs: [],
    correlationRefs: [],
    causationRefs: [],
  },
  attempts: [],
  stages: [],
  events: [],
  transportAttempts: [],
  metadata: {
    schemaVersion: '1.0.0' as const,
    snapshotRevision: 1,
    generatedAt: '2026-09-11T00:01:00.000Z',
    sourceUpdatedAt: '2026-09-11T00:01:00.000Z',
    freshness: 'CURRENT' as const,
    adapterStatus: 'AVAILABLE' as const,
    partial: false,
  },
  dimensions: {
    schemaVersion: '1.0.0' as const,
    attention: 'NONE' as const,
    retryability: 'UNKNOWN' as const,
    freshness: 'CURRENT' as const,
    adapterStatus: 'AVAILABLE' as const,
  },
  availableActions: [],
};

const clientFor = (body: unknown) =>
  createFrontendActivityClient({
    fetch: async (input) => {
      if (String(input) === '/api/v1/security/csrf') {
        return new Response(JSON.stringify({ csrfToken: 'test-csrf-token' }), { status: 200 });
      }
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

describe('frontend Activity detail client wire contract', () => {
  it('round-trips a canonical detail response through the strict client decoder', async () => {
    await expect(clientFor(snapshot).getActivityDetail(request)).resolves.toEqual(snapshot);
  });

  it.each([
    ['activityId', { ...snapshot, root: { ...snapshot.root, activityId: 'other-activity' } }],
    ['domainKind', { ...snapshot, root: { ...snapshot.root, domainKind: 'COMPARISON' } }],
    [
      'domainResourceKind',
      { ...snapshot, root: { ...snapshot.root, domainResourceKind: 'OtherResource' } },
    ],
    ['domainResourceId', { ...snapshot, root: { ...snapshot.root, domainResourceId: 'other-id' } }],
  ])('rejects a detail whose requested identity differs (%s)', async (_field, body) => {
    await expect(clientFor(body).getActivityDetail(request)).rejects.toMatchObject({
      code: 'UNSUPPORTED_SCHEMA',
    });
  });

  it('rejects a missing or unsupported top-level schemaVersion', async () => {
    const missing = { ...snapshot } as Record<string, unknown>;
    delete missing.schemaVersion;
    await expect(clientFor(missing).getActivityDetail(request)).rejects.toBeInstanceOf(
      FrontendContractError,
    );
    const unsupported = { ...snapshot, schemaVersion: '2.0.0' };
    await expect(clientFor(unsupported).getActivityDetail(request)).rejects.toBeInstanceOf(
      FrontendContractError,
    );
  });
});
