import { describe, expect, it } from 'vitest';

import {
  FrontendKnowledgeDraftCommandError,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeOperationV1,
} from '../../packages/contracts/src/index.js';
import {
  appendFrontendKnowledgeDraftRevision,
  assertFrontendKnowledgeDraftBaseBinding,
  assertFrontendKnowledgeDraftMaterializationBinding,
  assertFrontendKnowledgeDraftProjectBinding,
  createInitialFrontendKnowledgeDraft,
  frontendKnowledgeDraftRevisionDigest,
  materializeFrontendKnowledgeDraft,
  type DraftMaterializationRecordV1,
  type FrontendKnowledgeDraftOperationAppendV1,
  type FrontendKnowledgeDraftProjectBindingV1,
  type FrontendKnowledgeDraftRevisionRecordV1,
  type FrontendKnowledgeDraftRepositoryBoundaryPort,
} from '../../modules/frontend-knowledge-draft/src/index.js';

const base: FrontendKnowledgeDraftBaseV1 = {
  resourceProjectId: 'project-1',
  canonicalSnapshotId: 'snapshot-7',
  canonicalVersion: 7,
  canonicalSnapshotDigest: 'sha256:snapshot',
  accessRevision: 'access-7',
  policyContextRevision: 'policy-7',
  sourceLineage: [
    {
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceSpanIds: ['span-1'],
    },
  ],
  revisionIdentityKind: 'RESOURCE_REVISION',
  canonicalResourceId: 'canonical-resource-1',
  canonicalRevisionId: 'canonical-revision-7',
};

const binding: FrontendKnowledgeDraftProjectBindingV1 = {
  activeProjectId: 'project-1',
  resourceProjectId: 'project-1',
  draftProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  accessRevision: 'access-7',
  policyContextRevision: 'policy-7',
};

const operation = (operationRevision: number): FrontendKnowledgeOperationV1 => ({
  operationId: `operation-${operationRevision}`,
  kind: 'FACT_ADD',
  target: { targetType: 'FACT', resourceId: 'resource-1' },
  baseRevision: 7,
  rationale: 'Record the reviewed fact.',
  evidenceReferences: [
    { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
  ],
  expectedImpact: { summary: 'One fact is added.' },
  operationRevision,
  contentDigest: `sha256:operation-${operationRevision}`,
  after: {
    schemaVersion: 'fact.v1',
    subjectRef: 'entity-1',
    predicate: 'status',
    value: 'active',
  },
});

const draftFor = (
  seedId?: string,
  operations: readonly FrontendKnowledgeOperationV1[] = [],
): FrontendKnowledgeDraftChangeSetV1 =>
  createInitialFrontendKnowledgeDraft({
    draftId: seedId ? `draft-${seedId}` : 'draft-page-1',
    ...(seedId === undefined ? {} : { seedId }),
    startMode: seedId === undefined ? 'KNOWLEDGE_PAGE' : 'SEED_MATERIALIZATION',
    binding,
    resourceId: 'resource-1',
    base,
    operations,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  });

const materializationFor = (
  draft: FrontendKnowledgeDraftChangeSetV1,
  seedId?: string,
): DraftMaterializationRecordV1 => ({
  materializationId: `materialization-${draft.draftId}`,
  draftId: draft.draftId,
  target:
    seedId === undefined
      ? { kind: 'RESOURCE', resourceId: draft.resourceId }
      : { kind: 'SEED', seedId, resourceId: draft.resourceId },
  resourceProjectId: draft.resourceProjectId,
  draftProjectId: draft.draftProjectId,
  effectiveProjectId: draft.effectiveProjectId,
  base: draft.base,
  commandIdentity: {
    principalId: 'principal-1',
    clientRequestId: `request-${draft.draftId}`,
    idempotencyKey: `key-${draft.draftId}`,
    semanticDigest: 'sha256:command',
  },
  createdAt: draft.createdAt,
});

class FakeDraftBoundary implements FrontendKnowledgeDraftRepositoryBoundaryPort {
  readonly drafts = {
    findById: async (projectId: string, draftId: string) => {
      const draft = this.draftStore.get(draftId);
      return draft?.resourceProjectId === projectId ? draft : undefined;
    },
    insert: async (_transaction: unknown, draft: FrontendKnowledgeDraftChangeSetV1) => {
      this.draftStore.set(draft.draftId, draft);
      return draft;
    },
  };

  readonly revisions = {
    find: async () => undefined,
    append: async (_transaction: unknown, revision: FrontendKnowledgeDraftRevisionRecordV1) => {
      this.revisionStore.push(revision);
      return revision;
    },
  };

  readonly operations = {
    append: async (_transaction: unknown, input: FrontendKnowledgeDraftOperationAppendV1) => {
      this.operationStore.push(input);
    },
    list: async () => this.operationStore.flatMap((entry) => entry.operations),
  };

  readonly materializations = {
    findBySeed: async (seedId: string) =>
      this.materializationStore.find((item) =>
        item.target.kind === 'SEED' ? item.target.seedId === seedId : false,
      ),
    findByDraftId: async (projectId: string, draftId: string) =>
      this.materializationStore.find(
        (item) => item.resourceProjectId === projectId && item.draftId === draftId,
      ),
    findByCommandIdentity: async (
      projectId: string,
      identity: DraftMaterializationRecordV1['commandIdentity'],
    ) =>
      this.materializationStore.find(
        (item) =>
          item.resourceProjectId === projectId &&
          item.commandIdentity.principalId === identity.principalId &&
          item.commandIdentity.clientRequestId === identity.clientRequestId &&
          item.commandIdentity.idempotencyKey === identity.idempotencyKey,
      ),
    insert: async (_transaction: unknown, materialization: DraftMaterializationRecordV1) => {
      this.materializationStore.push(materialization);
      return materialization;
    },
  };

  readonly draftStore = new Map<string, FrontendKnowledgeDraftChangeSetV1>();
  readonly materializationStore: DraftMaterializationRecordV1[] = [];
  readonly revisionStore: FrontendKnowledgeDraftRevisionRecordV1[] = [];
  readonly operationStore: FrontendKnowledgeDraftOperationAppendV1[] = [];

  async transaction<T>(action: (transaction: unknown) => Promise<T>): Promise<T> {
    return action({});
  }
}

const expectApiError = (action: () => unknown, apiCode: string) => {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FrontendKnowledgeDraftCommandError);
  expect((thrown as FrontendKnowledgeDraftCommandError).apiCode).toBe(apiCode);
};

describe('FE-P3-S2 Domain/Repository boundary', () => {
  it('creates seed and seedless Drafts with immutable server bindings', () => {
    const seedDraft = draftFor('seed-1');
    const pageDraft = draftFor();

    expect(seedDraft.revision).toBe(1);
    expect(seedDraft.seedId).toBe('seed-1');
    expect(pageDraft.seedId).toBeUndefined();
    assertFrontendKnowledgeDraftProjectBinding(seedDraft, binding);
    assertFrontendKnowledgeDraftBaseBinding(seedDraft, { ...seedDraft });
    assertFrontendKnowledgeDraftMaterializationBinding(
      seedDraft,
      materializationFor(seedDraft, 'seed-1'),
    );
  });

  it('rejects Project/base drift and stale Draft or operation revisions', () => {
    const draft = draftFor('seed-1');
    expectApiError(
      () =>
        assertFrontendKnowledgeDraftProjectBinding(draft, {
          ...binding,
          effectiveProjectId: 'project-2',
        }),
      'PROJECT_BINDING_CONFLICT',
    );
    expectApiError(
      () =>
        appendFrontendKnowledgeDraftRevision({
          current: draft,
          expectedDraftRevision: 0,
          expectedBaseRevision: 7,
          operationRevision: 2,
          operations: [operation(2)],
          contentDigest: 'sha256:unused',
          updatedAt: '2026-08-03T00:01:00.000Z',
        }),
      'DRAFT_REVISION_CONFLICT',
    );
    expectApiError(
      () =>
        appendFrontendKnowledgeDraftRevision({
          current: draft,
          expectedDraftRevision: 1,
          expectedBaseRevision: 6,
          operationRevision: 2,
          operations: [operation(2)],
          contentDigest: 'sha256:unused',
          updatedAt: '2026-08-03T00:01:00.000Z',
        }),
      'STALE',
    );
  });

  it('appends an immutable revision and clears derived artifacts', () => {
    const current = draftFor('seed-1');
    const operations = [operation(2)];
    const contentDigest = frontendKnowledgeDraftRevisionDigest({
      draftId: current.draftId,
      revision: 2,
      base: current.base,
      operations,
    });
    const next = appendFrontendKnowledgeDraftRevision({
      current: { ...current, status: 'READY_FOR_REVIEW', validation: undefined },
      expectedDraftRevision: 1,
      expectedBaseRevision: 7,
      operationRevision: 2,
      operations,
      contentDigest,
      updatedAt: '2026-08-03T00:01:00.000Z',
    });

    expect(next.revision).toBe(2);
    expect(next.status).toBe('DRAFT');
    expect(next.base).toEqual(current.base);
    expect(next.operations).toEqual(operations);
    expect(next.validation).toBeUndefined();
  });

  it('materializes once and replays the same Seed identity through repository ports', async () => {
    const boundary = new FakeDraftBoundary();
    const firstDraft = draftFor('seed-1', [operation(1)]);
    const first = await materializeFrontendKnowledgeDraft(boundary, {
      draft: firstDraft,
      materialization: materializationFor(firstDraft, 'seed-1'),
    });
    const replayDraft = draftFor('seed-1');
    const replay = await materializeFrontendKnowledgeDraft(boundary, {
      draft: { ...replayDraft, draftId: 'draft-created-by-retry' },
      materialization: {
        ...materializationFor(replayDraft, 'seed-1'),
        draftId: 'draft-created-by-retry',
        materializationId: 'materialization-retry',
      },
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.draft.draftId).toBe(first.draft.draftId);
    expect(boundary.draftStore.size).toBe(1);
    expect(boundary.revisionStore).toHaveLength(1);
    expect(boundary.operationStore).toHaveLength(1);
    expect(boundary.operationStore[0]?.operations).toEqual([operation(1)]);
  });
});
