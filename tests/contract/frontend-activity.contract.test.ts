import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_BROWSER_AUTHORITY_FIELDS,
  FrontendContractError,
  decodeActivityDimensionsV1,
  decodeActivityDomainAttemptViewV1,
  decodeActivityEventViewV1,
  decodeActivityProjectionMetadataV1,
  decodeActivityRootReferenceV1,
  decodeActivityRunViewV1,
  decodeActivitySnapshotV1,
  decodeActivityStageViewV1,
  decodeActivityTransportAttemptViewV1,
  findBrowserAuthoredAuthorityFields,
} from '../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 WP1 — Typed Activity contract decoders.
 * Decoders are strict, reject browser-authored authority, and enforce the
 * identity and cross-field invariants of Contract Snapshot §4–§5 and ADR-130.
 */

const timestamp = (iso: string): string => iso;

const sourcesRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: 'activity-1',
  domainKind: 'SOURCES',
  domainResourceKind: 'IntakeSubmission',
  domainResourceId: 'submission-1',
  resourceProjectId: 'project-1',
  resourceHref: '/activity/sources/submission-1',
  jobId: 'job-1',
  runId: 'run-1',
};

const askRunRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'RUN',
  activityId: 'activity-2',
  domainKind: 'ASK',
  domainResourceKind: 'AnswerRun',
  domainResourceId: 'answer-run-1',
  resourceProjectId: 'project-1',
  resourceHref: '/activity/ask/answer-run-1',
  runId: 'run-2',
};

const validRun = {
  schemaVersion: '1.0.0',
  runId: 'run-1',
  jobId: 'job-1',
  sequence: 1,
  state: 'RUNNING',
  startedAt: timestamp('2026-08-06T00:00:00.000Z'),
  updatedAt: timestamp('2026-08-06T00:01:00.000Z'),
  domainAttemptRefs: [
    { schemaVersion: '1.0.0', resourceKind: 'IntakeAttempt', resourceId: 'attempt-1' },
  ],
  correlationRefs: [
    {
      schemaVersion: '1.0.0',
      refType: 'CORRELATION',
      refKind: 'commandId',
      refId: 'command-1',
    },
  ],
  causationRefs: [],
};

const validAttempt = {
  schemaVersion: '1.0.0',
  attemptId: 'attempt-1',
  runId: 'run-1',
  attemptNumber: 1,
  attemptKind: 'SOURCES_INTAKE',
  state: 'RUNNING',
  retryability: 'RETRYABLE',
  startedAt: timestamp('2026-08-06T00:00:10.000Z'),
  updatedAt: timestamp('2026-08-06T00:00:20.000Z'),
  stageRefs: [{ schemaVersion: '1.0.0', resourceKind: 'stage', resourceId: 'stage-1' }],
};

const validTransportAttempt = {
  schemaVersion: '1.0.0',
  transportAttemptId: 'transport-1',
  transportKind: 'CONNECTOR_HTTP',
  commandOrMessageRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'command',
    resourceId: 'command-1',
  },
  deliverySequence: 2,
  deliveryResult: 'DELIVERED',
  deliveredAt: timestamp('2026-08-06T00:00:15.000Z'),
};

const validStage = {
  schemaVersion: '1.0.0',
  stageId: 'stage-1',
  stageKey: 'transform',
  label: 'Transform evidence',
  sequence: 1,
  state: 'RUNNING',
  progress: {
    schemaVersion: '1.0.0',
    current: 3,
    total: 10,
    percent: 30,
  },
  startedAt: timestamp('2026-08-06T00:00:10.000Z'),
  updatedAt: timestamp('2026-08-06T00:00:20.000Z'),
};

const validEvent = {
  schemaVersion: '1.0.0',
  eventId: 'event-1',
  relatedRef: { schemaVersion: '1.0.0', resourceKind: 'run', resourceId: 'run-1' },
  category: 'STARTED',
  sequence: 1,
  occurredAt: timestamp('2026-08-06T00:00:05.000Z'),
  summary: 'Intake processing started',
};

const validMetadata = {
  schemaVersion: '1.0.0',
  snapshotRevision: 4,
  generatedAt: timestamp('2026-08-06T00:01:00.000Z'),
  sourceUpdatedAt: timestamp('2026-08-06T00:00:55.000Z'),
  freshness: 'CURRENT',
  lagMilliseconds: 5000,
  adapterStatus: 'AVAILABLE',
  partial: false,
  cursor: 'cursor-1',
};

const validDimensions = {
  schemaVersion: '1.0.0',
  attention: 'NONE',
  retryability: 'RETRYABLE',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
};

const validSnapshot = {
  schemaVersion: '1.0.0',
  root: sourcesRoot,
  run: validRun,
  attempts: [validAttempt],
  stages: [validStage],
  events: [validEvent],
  transportAttempts: [validTransportAttempt],
  metadata: validMetadata,
  dimensions: validDimensions,
};

describe('FE-P5-S1 ActivityRootReferenceV1', () => {
  it('decodes a JOB root with a durable jobId', () => {
    expect(decodeActivityRootReferenceV1(sourcesRoot)).toEqual(sourcesRoot);
  });

  it('decodes a RUN root without a jobId', () => {
    expect(decodeActivityRootReferenceV1(askRunRoot)).toEqual(askRunRoot);
  });

  it('rejects a JOB root without jobId', () => {
    const withoutJob = { ...sourcesRoot };
    delete (withoutJob as Record<string, unknown>).jobId;
    expect(() => decodeActivityRootReferenceV1(withoutJob)).toThrow(FrontendContractError);
  });

  it('rejects a RUN root that carries a jobId', () => {
    expect(() => decodeActivityRootReferenceV1({ ...askRunRoot, jobId: 'job-2' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects empty activityId and domainResourceId', () => {
    expect(() => decodeActivityRootReferenceV1({ ...sourcesRoot, activityId: '   ' })).toThrow(
      FrontendContractError,
    );
    expect(() => decodeActivityRootReferenceV1({ ...sourcesRoot, domainResourceId: '' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects unknown fields (strict object)', () => {
    expect(() => decodeActivityRootReferenceV1({ ...sourcesRoot, extra: true })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects browser-authored authority fields', () => {
    for (const field of ACTIVITY_BROWSER_AUTHORITY_FIELDS) {
      expect(() => decodeActivityRootReferenceV1({ ...sourcesRoot, [field]: 'auth' })).toThrow(
        FrontendContractError,
      );
    }
  });

  it('rejects an unknown rootKind discriminant', () => {
    expect(() => decodeActivityRootReferenceV1({ ...sourcesRoot, rootKind: 'STAGE' })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P5-S1 ActivityRunViewV1', () => {
  it('decodes a valid run', () => {
    expect(decodeActivityRunViewV1(validRun)).toEqual(validRun);
  });

  it('rejects timestamp ordering violations', () => {
    expect(() =>
      decodeActivityRunViewV1({ ...validRun, completedAt: '2026-08-05T00:00:00.000Z' }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a non-ISO completedAt on a Run', () => {
    expect(() => decodeActivityRunViewV1({ ...validRun, completedAt: 'not-a-date' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a zero or negative sequence', () => {
    expect(() => decodeActivityRunViewV1({ ...validRun, sequence: 0 })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects browser-authored authority fields', () => {
    expect(() => decodeActivityRunViewV1({ ...validRun, principalId: 'principal-1' })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P5-S1 ActivityDomainAttemptViewV1 and TransportAttemptV1', () => {
  it('decodes a valid domain attempt', () => {
    expect(decodeActivityDomainAttemptViewV1(validAttempt)).toEqual(validAttempt);
  });

  it('rejects a non-positive attemptNumber', () => {
    expect(() => decodeActivityDomainAttemptViewV1({ ...validAttempt, attemptNumber: 0 })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects an unknown attemptKind', () => {
    expect(() =>
      decodeActivityDomainAttemptViewV1({ ...validAttempt, attemptKind: 'TRANSPORT' }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a non-ISO completedAt on a Domain Attempt', () => {
    expect(() =>
      decodeActivityDomainAttemptViewV1({ ...validAttempt, completedAt: 'not-a-date' }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a transport attempt as a distinct type', () => {
    expect(decodeActivityTransportAttemptViewV1(validTransportAttempt)).toEqual(
      validTransportAttempt,
    );
  });

  it('rejects a transport attempt payload passed as a domain attempt (unknown fields)', () => {
    expect(() => decodeActivityDomainAttemptViewV1(validTransportAttempt)).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P5-S1 ActivityStageViewV1 and bounded progress', () => {
  it('decodes a valid stage with bounded progress', () => {
    expect(decodeActivityStageViewV1(validStage)).toEqual(validStage);
  });

  it('rejects progress percent outside 0..100', () => {
    expect(() =>
      decodeActivityStageViewV1({
        ...validStage,
        progress: { schemaVersion: '1.0.0', current: 3, total: 10, percent: 101 },
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects progress current above total', () => {
    expect(() =>
      decodeActivityStageViewV1({
        ...validStage,
        progress: { schemaVersion: '1.0.0', current: 11, total: 10 },
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a non-ISO completedAt on a Stage', () => {
    expect(() => decodeActivityStageViewV1({ ...validStage, completedAt: 'not-a-date' })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P5-S1 ActivityEventViewV1', () => {
  it('decodes a valid bounded operational event', () => {
    expect(decodeActivityEventViewV1(validEvent)).toEqual(validEvent);
  });

  it('rejects an unknown event category', () => {
    expect(() => decodeActivityEventViewV1({ ...validEvent, category: 'PERSISTED' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects an empty summary', () => {
    expect(() => decodeActivityEventViewV1({ ...validEvent, summary: ' ' })).toThrow(
      FrontendContractError,
    );
  });
});

describe('FE-P5-S1 ActivityProjectionMetadataV1 and dimensions', () => {
  it('decodes valid projection metadata', () => {
    expect(decodeActivityProjectionMetadataV1(validMetadata)).toEqual(validMetadata);
  });

  it('rejects a negative lagMilliseconds', () => {
    expect(() =>
      decodeActivityProjectionMetadataV1({ ...validMetadata, lagMilliseconds: -1 }),
    ).toThrow(FrontendContractError);
  });

  it('rejects an unknown freshness value', () => {
    expect(() =>
      decodeActivityProjectionMetadataV1({ ...validMetadata, freshness: 'OLD' }),
    ).toThrow(FrontendContractError);
  });

  it('decodes separate projection dimensions', () => {
    expect(decodeActivityDimensionsV1(validDimensions)).toEqual(validDimensions);
  });
});

describe('FE-P5-S1 ActivitySnapshotV1 composite', () => {
  it('decodes a full valid snapshot', () => {
    expect(decodeActivitySnapshotV1(validSnapshot)).toEqual(validSnapshot);
  });

  it('rejects a snapshot whose run.runId does not match root.runId', () => {
    expect(() =>
      decodeActivitySnapshotV1({
        ...validSnapshot,
        run: { ...validRun, runId: 'run-other' },
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects a snapshot whose run.jobId does not match root.jobId', () => {
    expect(() =>
      decodeActivitySnapshotV1({ ...validSnapshot, run: { ...validRun, jobId: 'job-other' } }),
    ).toThrow(FrontendContractError);
  });

  it('rejects an attempt bound to another run', () => {
    expect(() =>
      decodeActivitySnapshotV1({
        ...validSnapshot,
        attempts: [{ ...validAttempt, runId: 'run-other' }],
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects browser-authored authority anywhere in the snapshot', () => {
    expect(() =>
      decodeActivitySnapshotV1({ ...validSnapshot, actor: { principalId: 'p' } }),
    ).toThrow(FrontendContractError);
  });
});

describe('FE-P5-S1 browser authority field detection', () => {
  it('reports only the authority fields actually present', () => {
    expect(findBrowserAuthoredAuthorityFields({ principalId: 'p', label: 'x' })).toEqual([
      'principalId',
    ]);
    expect(findBrowserAuthoredAuthorityFields({ actor: {}, budget: {} })).toEqual([
      'actor',
      'budget',
    ]);
    expect(findBrowserAuthoredAuthorityFields({ label: 'x' })).toEqual([]);
  });
});
