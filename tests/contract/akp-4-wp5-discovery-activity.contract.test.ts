import { describe, expect, it } from 'vitest';

import {
  decodeActivityDomainAttemptViewV1,
  decodeActivityRootReferenceV1,
  FrontendContractError,
} from '../../packages/contracts/src/index.js';
import {
  decodeDiscoveryActivityCursor,
  encodeDiscoveryActivityCursor,
} from '../../modules/frontend-activity/src/index.js';

const discoveryRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: 'job-1',
  domainKind: 'DISCOVERY',
  domainResourceKind: 'DiscoveryJob',
  domainResourceId: 'job-1',
  resourceProjectId: 'project-1',
  resourceHref: '/activity?domain=DISCOVERY&activity=job-1',
  jobId: 'job-1',
  runId: 'run-1',
} as const;

describe('AKP-4 WP5 Discovery Activity contract', () => {
  it('accepts DISCOVERY as a durable JOB-root domain', () => {
    expect(decodeActivityRootReferenceV1(discoveryRoot)).toEqual(discoveryRoot);
  });

  it('rejects malformed Discovery identity and browser authority fields', () => {
    expect(() =>
      decodeActivityRootReferenceV1({ ...discoveryRoot, rootKind: 'RUN', jobId: undefined }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeActivityRootReferenceV1({ ...discoveryRoot, resourceProjectId: 'project-other' }),
    ).not.toThrow();
    expect(() =>
      decodeActivityRootReferenceV1({ ...discoveryRoot, principalId: 'spoofed' }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeActivityRootReferenceV1({ ...discoveryRoot, domainResourceId: '   ' }),
    ).toThrow(FrontendContractError);
  });

  it('keeps previous Sources/Ask/External Action root discriminants valid', () => {
    for (const domainKind of ['SOURCES', 'EXTERNAL_ACTION'] as const) {
      expect(decodeActivityRootReferenceV1({ ...discoveryRoot, domainKind })).toMatchObject({
        domainKind,
        rootKind: 'JOB',
      });
    }
    expect(
      decodeActivityRootReferenceV1({
        ...discoveryRoot,
        rootKind: 'RUN',
        domainKind: 'ASK',
        domainResourceKind: 'AnswerRun',
        jobId: undefined,
      }),
    ).toMatchObject({ domainKind: 'ASK', rootKind: 'RUN' });
  });

  it('accepts a Discovery domain-attempt kind and keeps it separate from transport attempts', () => {
    expect(
      decodeActivityDomainAttemptViewV1({
        schemaVersion: '1.0.0',
        attemptId: 'attempt-1',
        runId: 'run-1',
        attemptNumber: 1,
        attemptKind: 'DISCOVERY_EXECUTION',
        state: 'FAILED',
        retryability: 'RETRYABLE',
        failure: {
          schemaVersion: '1.0.0',
          kind: 'TRANSIENT',
          code: 'PROVIDER_TIMEOUT',
          message: 'The Discovery attempt can be retried.',
          occurredAt: '2026-08-30T00:00:01.000Z',
        },
        startedAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:01.000Z',
        completedAt: '2026-08-30T00:00:01.000Z',
        stageRefs: [],
      }),
    ).toMatchObject({ attemptKind: 'DISCOVERY_EXECUTION' });
  });

  it('uses a deterministic cursor encoding and fails closed on malformed cursors', () => {
    const cursor = encodeDiscoveryActivityCursor({
      updatedAt: '2026-08-30T00:00:01.000Z',
      jobId: 'job-1',
    });
    expect(decodeDiscoveryActivityCursor(cursor)).toEqual({
      updatedAt: '2026-08-30T00:00:01.000Z',
      jobId: 'job-1',
    });
    expect(() => decodeDiscoveryActivityCursor('not-a-cursor')).toThrow(
      /DISCOVERY_ACTIVITY_INVALID_CURSOR/,
    );
  });
});
