import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createKnowledgeResetCoordinator,
  type KnowledgeResetImpactCountsV1,
  type KnowledgeResetRequestV1,
} from '../../modules/source-knowledge-reset/src/index.js';

const counts: KnowledgeResetImpactCountsV1 = {
  sourceCount: 2,
  sourceVersionCount: 3,
  sourceDerivedRecordCount: 14,
  redactedHistoryRecordCount: 4,
  rebuildProjectionCount: 5,
  sharedAssetCount: 1,
  blockedRecordCount: 0,
};

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

const harness = () => {
  const state = { projectRevision: 4, knowledgeEpoch: 2, owner: true };
  const impact = {
    manifestDigest: digest('a'),
    counts,
    blockers: [] as 'ACTIVE_JOB_OUTCOME_UNKNOWN'[],
  };
  const configuration = { digest: digest('b') };
  const requests = new Map<string, KnowledgeResetRequestV1>();
  const requestByIdempotency = new Map<string, KnowledgeResetRequestV1>();
  let insertCount = 0;
  let now = new Date('2026-09-23T01:00:00.000Z');
  const coordinator = createKnowledgeResetCoordinator({
    id: randomUUID,
    now: () => now,
    projectState: {
      async readProjectResetContext({ projectId, actorPrincipalId }) {
        if (!state.owner || projectId !== 'project-1' || actorPrincipalId !== 'owner-1')
          return null;
        return {
          projectId,
          projectRevision: state.projectRevision,
          knowledgeEpoch: state.knowledgeEpoch,
          resetState: 'READY',
          actorPrincipalId,
        };
      },
      async readKnowledgeEpoch() {
        return state.knowledgeEpoch;
      },
    },
    impact: {
      async inspectProjectSourceKnowledge() {
        return { ...impact };
      },
    },
    configurationFingerprint: {
      async fingerprintPreservedProjectConfiguration() {
        return configuration.digest;
      },
    },
    requests: {
      async findByIdempotencyKey(projectId, key) {
        const request = requestByIdempotency.get(`${projectId}:${key}`);
        return request ?? null;
      },
      async findById(projectId, requestId) {
        const request = requests.get(requestId);
        return request?.projectId === projectId ? request : null;
      },
      async insertApproved(input) {
        insertCount += 1;
        const request: KnowledgeResetRequestV1 = {
          schemaVersion: '1.0.0',
          requestId: input.requestId,
          projectId: input.projectId,
          projectRevision: input.projectRevision,
          manifestDigest: input.manifestDigest,
          ownerManifestDigest: input.ownerManifestDigest,
          preservedConfigurationDigest: input.preservedConfigurationDigest,
          state: 'APPROVED',
          expectedKnowledgeEpoch: input.expectedKnowledgeEpoch,
          knowledgeEpoch: input.expectedKnowledgeEpoch + 1,
          blockerCodes: [],
          counts: input.counts,
          completedSteps: [],
          casStatus: 'NOT_STARTED',
          backupStatus: 'PENDING',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        requests.set(request.requestId, request);
        requestByIdempotency.set(`${input.projectId}:${input.idempotencyKey}`, request);
        return { request, replayed: false };
      },
    },
  });
  return {
    coordinator,
    state,
    impact,
    configuration,
    get insertCount() {
      return insertCount;
    },
    advance(ms = 1) {
      now = new Date(now.getTime() + ms);
    },
  };
};

const confirm = (
  preview: Awaited<ReturnType<ReturnType<typeof harness>['coordinator']['preview']>>,
) => ({
  previewId: preview.previewId,
  manifestDigest: preview.manifestDigest,
  expectedProjectRevision: preview.projectRevision,
  expectedKnowledgeEpoch: preview.knowledgeEpoch,
  idempotencyKey: randomUUID(),
  confirmIrreversibleReset: true as const,
});

describe('ADR-171 project Source knowledge reset coordinator', () => {
  it('creates a data-free preview bound to Project, revision, epoch, impact, and preserved configuration', async () => {
    const h = harness();
    const preview = await h.coordinator.preview({
      projectId: 'project-1',
      actorPrincipalId: 'owner-1',
    });
    expect(preview).toMatchObject({
      projectId: 'project-1',
      projectRevision: 4,
      knowledgeEpoch: 2,
      counts,
      canConfirm: true,
    });
    expect(preview.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(preview)).not.toContain('source text');
    expect(h.insertCount).toBe(0);
  });

  it('requires current Project Owner authority and blocks unknown impact', async () => {
    const h = harness();
    await expect(
      h.coordinator.preview({ projectId: 'project-1', actorPrincipalId: 'other-user' }),
    ).rejects.toMatchObject({ code: 'NOT_PROJECT_OWNER' });
    h.impact.blockers = ['ACTIVE_JOB_OUTCOME_UNKNOWN'];
    const preview = await h.coordinator.preview({
      projectId: 'project-1',
      actorPrincipalId: 'owner-1',
    });
    expect(preview.canConfirm).toBe(false);
    await expect(
      h.coordinator.confirm({
        projectId: 'project-1',
        actorPrincipalId: 'owner-1',
        confirmation: confirm(preview),
      }),
    ).rejects.toMatchObject({ code: 'ACTIVE_JOB_OUTCOME_UNKNOWN' });
  });

  it('rejects stale impact, preserved configuration, Project revision, and knowledge epoch', async () => {
    const changes: readonly ((h: ReturnType<typeof harness>) => void)[] = [
      (h) => {
        h.impact.manifestDigest = digest('c');
      },
      (h) => {
        h.configuration.digest = digest('d');
      },
      (h) => {
        h.state.projectRevision += 1;
      },
      (h) => {
        h.state.knowledgeEpoch += 1;
      },
    ];
    for (const change of changes) {
      const h = harness();
      const preview = await h.coordinator.preview({
        projectId: 'project-1',
        actorPrincipalId: 'owner-1',
      });
      change(h);
      await expect(
        h.coordinator.confirm({
          projectId: 'project-1',
          actorPrincipalId: 'owner-1',
          confirmation: confirm(preview),
        }),
      ).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
      expect(h.insertCount).toBe(0);
    }
  });

  it('persists one approved request and returns it on idempotent replay', async () => {
    const h = harness();
    const preview = await h.coordinator.preview({
      projectId: 'project-1',
      actorPrincipalId: 'owner-1',
    });
    const confirmation = confirm(preview);
    const first = await h.coordinator.confirm({
      projectId: 'project-1',
      actorPrincipalId: 'owner-1',
      confirmation,
    });
    const replay = await h.coordinator.confirm({
      projectId: 'project-1',
      actorPrincipalId: 'owner-1',
      confirmation,
    });
    expect(first.request.requestId).toBe(replay.request.requestId);
    expect(first.request.preservedConfigurationDigest).toBe(digest('b'));
    expect(replay.replayed).toBe(true);
    expect(h.insertCount).toBe(1);
    await expect(
      h.coordinator.confirm({
        projectId: 'project-1',
        actorPrincipalId: 'owner-1',
        confirmation: { ...confirmation, manifestDigest: digest('c') },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH' });
  });

  it('expires previews instead of accepting a stale destructive confirmation', async () => {
    const h = harness();
    const preview = await h.coordinator.preview({
      projectId: 'project-1',
      actorPrincipalId: 'owner-1',
    });
    h.advance(5 * 60_000);
    await expect(
      h.coordinator.confirm({
        projectId: 'project-1',
        actorPrincipalId: 'owner-1',
        confirmation: confirm(preview),
      }),
    ).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
  });
});
