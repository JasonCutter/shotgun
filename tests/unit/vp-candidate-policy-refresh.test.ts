import { describe, expect, it, vi } from 'vitest';

import { createVPCandidatePolicyRefreshCommand } from '../../assemblies/shotgun-app/src/vp-candidate-policy-refresh.js';
import {
  VPCandidatePolicyRefreshWorker,
  type VPCandidatePolicyRefreshTarget,
} from '../../modules/vp-candidate-policy-refresh/src/index.js';

const target: VPCandidatePolicyRefreshTarget = {
  projectId: 'project-1',
  sourceVersionId: 'source-version-1',
  revisionId: 'revision-1',
  accessScope: ['owner'],
  sensitivity: 'private',
};

describe('VP candidate policy refresh', () => {
  it('dispatches only outdated targets through the pinned SourceVersion and security scope', async () => {
    const nextOutdated = vi.fn().mockResolvedValueOnce(target).mockResolvedValueOnce(undefined);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const worker = new VPCandidatePolicyRefreshWorker(
      { nextOutdated },
      dispatch,
      'direct-claim-v2',
    );

    expect(await worker.dispatchOnce()).toBe('REFRESHED');
    expect(await worker.dispatchOnce()).toBe('EMPTY');
    expect(nextOutdated).toHaveBeenCalledWith('direct-claim-v2');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(target);

    const command = createVPCandidatePolicyRefreshCommand(target, 'direct-claim-v2');
    expect(command).toMatchObject({
      messageType: 'ReextractCandidateMaterialization',
      idempotencyKey: 'vp-policy-refresh:direct-claim-v2:source-version-1:revision-1',
      projectId: 'project-1',
      actor: { type: 'service', id: 'vp-candidate-policy-refresh' },
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'source-content',
      },
      payload: {
        sourceVersionId: 'source-version-1',
        revisionId: 'revision-1',
        requestId: 'vp-policy-refresh:direct-claim-v2:source-version-1:revision-1',
      },
    });
  });
});
