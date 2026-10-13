import { describe, expect, it, vi } from 'vitest';
import {
  SourceRefreshCoordinator,
  type SourceRefreshJob,
  type SourceRefreshStorePort,
} from '../../modules/frontend-sources-write/src/source-refresh.js';
import type {
  SourcesProductWriteScope,
  SourcesProductWriteServicePort,
  SourcesStagingServicePort,
} from '../../modules/frontend-sources-write/src/product-service.js';
import type { IntakeSubmissionSnapshot } from '../../packages/contracts/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';
import {
  FrontendSourcesReadCoordinator,
  type SourcesProjectionRecord,
} from '../../modules/frontend-sources-product/src/index.js';

const job: SourceRefreshJob = {
  jobId: 'job',
  projectId: 'project',
  sourceId: 'source',
  sourceVersionId: 'v1',
  principalId: 'owner',
  sessionId: 'session',
  requestedUrl: 'https://example.org/data.txt',
  label: 'URL',
  sensitivity: 'private',
  accessScope: ['owner'],
  phase: 'READY',
  submissionId: 'submission',
  itemId: 'item',
  commandId: 'command',
  leaseToken: 'lease',
};
const scope: SourcesProductWriteScope = {
  projectId: 'project',
  principalId: 'owner',
  sessionId: 'session',
  principalAccessScopes: ['owner'],
  sensitivityClearance: 'restricted',
  resourceSecurityPolicy: { allowedClassifications: ['private'], resourceAccessScope: ['owner'] },
  accessRevision: '1',
  policyContextRevision: '1',
  acceptedPolicyContextId: 'policy',
  acceptedPolicyBinding: {},
};
const snapshot = (
  state: IntakeSubmissionSnapshot['state'] = 'SUCCEEDED',
  version = 'v2',
): IntakeSubmissionSnapshot => ({
  schemaVersion: '1.0.0',
  submissionId: 'submission',
  principalId: 'owner',
  sessionId: 'session',
  projectId: 'project',
  state,
  items: [
    {
      itemId: 'item',
      manifest: {
        kind: 'URL',
        itemId: 'item',
        label: 'URL',
        requestedUrl: 'https://example.org/data.txt',
      },
      state: state === 'SUCCEEDED' ? 'SUCCEEDED' : 'RUNNING',
      validation: [],
      capabilities: [],
      producedResource: {
        projectId: 'project',
        sourceId: 'source',
        sourceVersionId: version,
        versionNumber: 2,
      },
    },
  ],
  capabilities: [],
  acceptedPolicyContextId: 'policy',
  submissionRevision: '1',
  accessRevision: '1',
  policyContextRevision: '1',
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  stale: false,
});

function fixture(initial: SourceRefreshJob = job) {
  let current = initial;
  const transitions: Parameters<SourceRefreshStorePort['transition']>[0][] = [];
  const store: SourceRefreshStorePort = {
    claimNext: vi.fn(async () => current),
    transition: vi.fn(async (input) => {
      expect(input.job.phase).toBe(current.phase);
      transitions.push(input);
      current = {
        ...current,
        phase: input.phase,
        ...(input.stagingReference ? { stagingReference: input.stagingReference } : {}),
      };
    }),
  };
  const authorization = {
    authorize: vi.fn(async () => scope as SourcesProductWriteScope | undefined),
    prepareSubmission: vi.fn(async () => {}),
  };
  const staging: SourcesStagingServicePort = {
    stageBytes: vi.fn(),
    stageUrl: vi.fn(
      async () =>
        ({
          schemaVersion: '1.0.0',
          draftId: 'job',
          itemId: 'item',
          kind: 'URL',
          label: 'URL',
          stagingReference: 'sealed',
          mediaType: 'text/plain',
          contentHash: 'sha256:body',
          sizeBytes: 4,
          expiresAt: '2026-11-12T00:00:00Z',
        }) as const,
    ),
    resolve: vi.fn(
      async () =>
        ({
          draftId: 'job',
          itemId: 'item',
          projectId: 'project',
          principalId: 'owner',
          kind: 'URL',
          label: 'URL',
          channel: 'url_acquisition',
          mediaType: 'text/plain',
          contentHash: 'sha256:body',
          sizeBytes: 4,
          storageKey: 'body',
          issuedAt: '2026-10-12T00:00:00Z',
          expiresAt: '2026-11-12T00:00:00Z',
        }) as const,
    ),
  };
  const product: SourcesProductWriteServicePort = {
    submit: vi.fn(async () => snapshot()),
    getSubmission: vi.fn(async () => snapshot()),
    getDuplicateDecision: vi.fn(),
    resolveDuplicate: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
  };
  return {
    coordinator: new SourceRefreshCoordinator(store, authorization, staging, product),
    store,
    authorization,
    staging,
    product,
    transitions,
  };
}

describe('URL refresh execution boundary', () => {
  it('shows failed refresh as historical before age TTL without rewriting prior check time', async () => {
    const checkedAt = '2026-10-12T00:00:00.000Z';
    const record: SourcesProjectionRecord = {
      projectId: 'project',
      sourceId: 'source',
      sourceVersionId: 'v1',
      versionNumber: 1,
      mediaType: 'text/plain',
      contentHash: 'sha256:body',
      sizeBytes: 4,
      storageKey: 'body',
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: checkedAt,
      externalSourceLastCheckedAt: checkedAt,
      externalSourceRefreshFailed: true,
    };
    const coordinator = new FrontendSourcesReadCoordinator(
      { listProjectSourceVersions: async () => [record] },
      { read: async () => undefined },
      { listBySourceVersion: async () => [] },
      undefined,
      () => new Date('2026-10-12T01:00:00.000Z'),
    );
    expect(
      (
        await coordinator.detail(
          {
            principalId: 'owner',
            sessionId: 'session',
            authorizedProjectId: 'project',
            accessScopes: ['owner'],
            sensitivityClearance: 'private',
            accessRevision: '1',
            policyContextRevision: '1',
          },
          'source',
        )
      )?.externalSourceFreshness,
    ).toMatchObject({ lastCheckedAt: checkedAt, state: 'EXPIRED' });
  });
  it('reauthorizes before fetch and submit and preserves Source/security identity', async () => {
    const f = fixture();
    expect(await f.coordinator.drainOnce('worker')).toBe('SUCCEEDED');
    expect(f.authorization.authorize).toHaveBeenCalledTimes(2);
    expect(f.authorization.prepareSubmission).toHaveBeenCalledOnce();
    expect(f.transitions.map((t) => t.phase)).toEqual([
      'ACQUIRING',
      'STAGED',
      'SUBMITTING',
      'SUCCEEDED',
    ]);
    expect(f.product.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: job.submissionId,
        commandId: job.commandId,
        items: [
          expect.objectContaining({
            requestedSourceId: job.sourceId,
            requestedClassification: 'private',
          }),
        ],
      }),
    );
  });
  it('makes no fetch or submission when standing/egress authority is absent', async () => {
    const f = fixture();
    f.authorization.authorize.mockResolvedValue(undefined);
    expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
    expect(f.staging.stageUrl).not.toHaveBeenCalled();
    expect(f.product.submit).not.toHaveBeenCalled();
  });
  it('denies a different project or source security scope before acquisition', async () => {
    for (const denied of [
      { ...scope, projectId: 'other' },
      {
        ...scope,
        resourceSecurityPolicy: {
          allowedClassifications: ['private'] as const,
          resourceAccessScope: ['other'],
        },
      },
    ]) {
      const f = fixture();
      f.authorization.authorize.mockResolvedValue(denied);
      expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
      expect(f.staging.stageUrl).not.toHaveBeenCalled();
    }
  });
  it('persists a safe failure and retains the prior version when acquisition fails', async () => {
    const f = fixture();
    vi.mocked(f.staging.stageUrl).mockRejectedValue(
      new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'Synthetic acquisition failed',
        module: 'url-acquisition-node',
        operation: 'request',
        retryable: true,
      }),
    );
    expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
    expect(f.transitions.at(-1)?.safeFailureCode).toBe('URL_REFRESH_ACQUISITION_FAILED');
    expect(f.product.submit).not.toHaveBeenCalled();
  });
  it('never turns a committed STAGED checkpoint ACK loss into another acquisition', async () => {
    const f = fixture();
    const persist = vi.mocked(f.store.transition).getMockImplementation()!;
    vi.mocked(f.store.transition).mockImplementation(async (input) => {
      await persist(input);
      if (input.phase === 'STAGED') throw new Error('Checkpoint acknowledgement lost');
    });
    await expect(f.coordinator.drainOnce('worker')).rejects.toThrow(
      'Checkpoint acknowledgement lost',
    );
    expect(f.transitions.map((t) => t.phase)).toEqual(['ACQUIRING', 'STAGED']);
    vi.mocked(f.store.transition).mockImplementation(persist);
    expect(await f.coordinator.drainOnce('restart')).toBe('SUCCEEDED');
    expect(f.staging.stageUrl).toHaveBeenCalledOnce();
    expect(f.product.submit).toHaveBeenCalledOnce();
  });
  it('holds uncertain staging/storage outcomes and does not retry a terminal acquisition rejection', async () => {
    const unknown = fixture();
    vi.mocked(unknown.staging.stageUrl).mockRejectedValue(
      new Error('Storage acknowledgement unknown'),
    );
    expect(await unknown.coordinator.drainOnce('worker')).toBe('FAILED');
    expect(unknown.transitions.at(-1)).toMatchObject({
      phase: 'OUTCOME_UNKNOWN',
      safeFailureCode: 'URL_REFRESH_STAGING_OUTCOME_UNKNOWN',
    });
    const rejected = fixture();
    vi.mocked(rejected.staging.stageUrl).mockRejectedValue(
      new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Unsupported charset',
        module: 'url-acquisition',
        operation: 'validate-text-encoding',
        retryable: false,
      }),
    );
    expect(await rejected.coordinator.drainOnce('worker')).toBe('FAILED');
    expect(rejected.transitions.at(-1)).toMatchObject({
      phase: 'FAILED',
      safeFailureCode: 'URL_REFRESH_ACQUISITION_REJECTED',
    });
    expect(rejected.product.submit).not.toHaveBeenCalled();
  });
  it('resumes STAGED without fetching again', async () => {
    const f = fixture({ ...job, phase: 'STAGED', stagingReference: 'sealed' });
    expect(await f.coordinator.drainOnce('worker')).toBe('SUCCEEDED');
    expect(f.staging.stageUrl).not.toHaveBeenCalled();
  });
  it('does not overwrite a concurrent Source revision or revoked policy after acquisition', async () => {
    const f = fixture();
    // The current-source authority reader returns no scope when the source
    // advanced from the pinned version or policy no longer allows continuation.
    f.authorization.authorize.mockResolvedValueOnce(scope).mockResolvedValueOnce(undefined);
    expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
    expect(f.staging.stageUrl).toHaveBeenCalledOnce();
    expect(f.product.submit).not.toHaveBeenCalled();
    expect(f.authorization.prepareSubmission).not.toHaveBeenCalled();
  });
  it('reads committed submission after lost ACK without resubmitting', async () => {
    const f = fixture();
    vi.mocked(f.product.submit).mockRejectedValue(new Error('ACK lost'));
    expect(await f.coordinator.drainOnce('worker')).toBe('PENDING');
    expect(await f.coordinator.drainOnce('worker')).toBe('SUCCEEDED');
    expect(f.product.submit).toHaveBeenCalledOnce();
    expect(f.staging.stageUrl).toHaveBeenCalledOnce();
  });
  it('holds missing SUBMITTING outcome without repeating network work', async () => {
    const f = fixture({ ...job, phase: 'SUBMITTING', stagingReference: 'sealed' });
    vi.mocked(f.product.getSubmission).mockResolvedValue(undefined);
    expect(await f.coordinator.drainOnce('worker')).toBe('FAILED');
    expect(f.transitions.at(-1)?.phase).toBe('OUTCOME_UNKNOWN');
    expect(f.product.submit).not.toHaveBeenCalled();
    expect(f.staging.stageUrl).not.toHaveBeenCalled();
  });
  it('does not turn pending extraction into refresh success', async () => {
    const f = fixture();
    vi.mocked(f.product.submit).mockResolvedValue(snapshot('OUTCOME_INDETERMINATE'));
    expect(await f.coordinator.drainOnce('worker')).toBe('PENDING');
    expect(f.transitions.at(-1)?.phase).toBe('SUBMITTING');
  });
  it('rejects readback for another Source', async () => {
    const f = fixture({ ...job, phase: 'SUBMITTING', stagingReference: 'sealed' });
    const other = snapshot();
    vi.mocked(f.product.getSubmission).mockResolvedValue({
      ...other,
      items: [
        {
          ...other.items[0]!,
          producedResource: {
            projectId: 'project',
            sourceId: 'other',
            sourceVersionId: 'v2',
            versionNumber: 2,
          },
        },
      ],
    });
    await expect(f.coordinator.drainOnce('worker')).rejects.toThrow('different Source');
    expect(f.product.submit).not.toHaveBeenCalled();
  });
});
