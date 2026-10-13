import { describe, expect, it, vi } from 'vitest';
import {
  createSourceRefreshAuthorization,
  type SourceRefreshRuntimeOptions,
} from '../../assemblies/shotgun-app/src/source-refresh-runtime.js';
import type { SourceRefreshJob } from '../../modules/frontend-sources-write/src/source-refresh.js';
const job: SourceRefreshJob = {
  jobId: '00000000-0000-4000-8000-000000000001',
  projectId: 'p',
  sourceId: '00000000-0000-4000-8000-000000000002',
  sourceVersionId: 'v1',
  principalId: 'owner',
  sessionId: 'session',
  requestedUrl: 'https://example.org/a',
  label: 'URL',
  sensitivity: 'private',
  accessScope: ['owner'],
  phase: 'READY',
  submissionId: '00000000-0000-4000-8000-000000000003',
  itemId: '00000000-0000-4000-8000-000000000004',
  commandId: '00000000-0000-4000-8000-000000000005',
  leaseToken: 'lease',
};
function fixture() {
  const pool = { query: vi.fn(async () => ({ rows: [{ source_version_id: 'v1' }] })) };
  const auth = {
    findPrincipalByAccountId: vi.fn(async () => ({ principalId: 'owner' })),
    findMembership: vi.fn(async () => ({
      projectId: 'p',
      scopes: ['owner'],
      sensitivityClearance: 'private',
      isOwner: true,
    })),
  };
  const settings = { getSettingsSnapshot: vi.fn(async () => ({ policyContextRevision: 7 })) };
  const executionResolver = {
    resolve: vi.fn(async () => ({ adapter: { identity: { provider: 'deepseek' } } })),
  };
  const commandGateway = {
    accept: vi.fn(async () => ({
      outcome: { commandId: job.commandId, outcomeState: 'ACCEPTED' },
    })),
    complete: vi.fn(async () => ({
      commandId: job.commandId,
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      producedResources: [
        {
          resourceKind: 'source-intake-submission',
          resourceId: job.submissionId,
          resourceRevision: '1',
        },
      ],
    })),
  };
  const options = {
    pool,
    auth,
    settings,
    executionResolver,
    commandGateway,
    ownerAccountId: 'local-owner',
    staging: {},
    product: {},
  } as unknown as SourceRefreshRuntimeOptions;
  return { pool, auth, settings, executionResolver, commandGateway, options };
}
describe('application source refresh authority composition', () => {
  it('does not treat the old session as new authorization and denies missing/mismatched current owner', async () => {
    const f = fixture();
    const auth = createSourceRefreshAuthorization({ ...f.options, ownerAccountId: undefined });
    expect(await auth.authorize(job)).toBeUndefined();
    expect(f.executionResolver.resolve).not.toHaveBeenCalled();
    f.auth.findPrincipalByAccountId.mockResolvedValue({ principalId: 'other' });
    expect(await createSourceRefreshAuthorization(f.options).authorize(job)).toBeUndefined();
    expect(f.pool.query).not.toHaveBeenCalled();
  });
  it('requires current membership, same version and current standing/provider execution authority', async () => {
    const f = fixture();
    const auth = createSourceRefreshAuthorization(f.options);
    const scope = await auth.authorize(job);
    expect(scope).toMatchObject({
      principalId: 'owner',
      sessionId: 'session',
      projectId: 'p',
      policyContextRevision: '7',
    });
    expect(f.executionResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVersionId: 'v1',
        accessScope: ['owner'],
        sensitivity: 'private',
      }),
    );
    f.pool.query.mockResolvedValue({ rows: [{ source_version_id: 'v2' }] });
    expect(await auth.authorize(job)).toBeUndefined();
    expect(f.executionResolver.resolve).toHaveBeenCalledTimes(1);
    f.pool.query.mockResolvedValue({ rows: [{ source_version_id: 'v1' }] });
    f.executionResolver.resolve.mockRejectedValue(new Error('STANDING_DISABLED'));
    await expect(auth.authorize(job)).rejects.toThrow('STANDING_DISABLED');
    f.auth.findMembership.mockResolvedValue({
      projectId: 'p',
      scopes: ['reader'],
      sensitivityClearance: 'private',
      isOwner: false,
    });
    expect(await auth.authorize(job)).toBeUndefined();
  });
  it('allows exact submission readback after its own new version without another AI/URL authorization', async () => {
    const f = fixture();
    f.pool.query.mockResolvedValue({ rows: [{ source_version_id: 'v2' }] });
    expect(
      await createSourceRefreshAuthorization(f.options).authorize({ ...job, phase: 'SUBMITTING' }),
    ).toBeDefined();
    expect(f.executionResolver.resolve).not.toHaveBeenCalled();
  });
  it('uses validated principal-scoped gateway acceptance and rejects a different command binding', async () => {
    const f = fixture();
    const auth = createSourceRefreshAuthorization(f.options);
    const scope = (await auth.authorize(job))!;
    await auth.prepareSubmission(
      { ...job, phase: 'STAGED', stagingReference: 'sources-stage-v1.synthetic-test-reference' },
      scope,
    );
    expect(f.commandGateway.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: job.commandId,
        principalId: 'owner',
        request: expect.objectContaining({
          clientRequestId: job.submissionId,
          commandType: 'sources.intake.submit.v1',
        }),
      }),
    );
    f.commandGateway.accept.mockResolvedValue({
      outcome: { commandId: 'another', outcomeState: 'ACCEPTED' },
    });
    await expect(
      auth.prepareSubmission(
        { ...job, phase: 'STAGED', stagingReference: 'sources-stage-v1.synthetic-test-reference' },
        scope,
      ),
    ).rejects.toThrow('URL_REFRESH_COMMAND_BINDING_REJECTED');
  });
});
