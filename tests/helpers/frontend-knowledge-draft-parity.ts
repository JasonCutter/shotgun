import {
  FrontendKnowledgeDraftCommandError,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeOperationV1,
} from '../../packages/contracts/src/index.js';
import {
  appendFrontendKnowledgeDraftRevision,
  createInitialFrontendKnowledgeDraft,
  frontendKnowledgeDraftRevisionDigest,
  materializeFrontendKnowledgeDraft,
  persistFrontendKnowledgeDraftRevision,
  type DraftMaterializationRecordV1,
  type FrontendKnowledgeDraftProjectBindingV1,
  type FrontendKnowledgeDraftRepositoryBoundaryPort,
} from '../../modules/frontend-knowledge-draft/src/index.js';

export const pBase: FrontendKnowledgeDraftBaseV1 = {
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

export const pBinding: FrontendKnowledgeDraftProjectBindingV1 = {
  activeProjectId: 'project-1',
  resourceProjectId: 'project-1',
  draftProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  accessRevision: 'access-7',
  policyContextRevision: 'policy-7',
};

export const pOperation = (operationRevision: number): FrontendKnowledgeOperationV1 => ({
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

export type DraftFixtureOverrides = {
  readonly draftId?: string;
  readonly resourceId?: string;
  readonly base?: FrontendKnowledgeDraftBaseV1;
};

export const pDraft = (
  seedId?: string,
  operations: readonly FrontendKnowledgeOperationV1[] = [],
  overrides: DraftFixtureOverrides = {},
): FrontendKnowledgeDraftChangeSetV1 => {
  const draft = createInitialFrontendKnowledgeDraft({
    draftId: overrides.draftId ?? (seedId ? `draft-${seedId}` : 'draft-page-1'),
    ...(seedId === undefined ? {} : { seedId }),
    startMode: seedId === undefined ? 'KNOWLEDGE_PAGE' : 'SEED_MATERIALIZATION',
    binding: pBinding,
    resourceId: overrides.resourceId ?? 'resource-1',
    base: overrides.base ?? pBase,
    operations,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  });
  return draft;
};

export type MaterializationTargetOverride =
  | { readonly kind: 'SEED'; readonly seedId: string; readonly resourceId: string }
  | { readonly kind: 'RESOURCE'; readonly resourceId: string }
  | { readonly kind: 'PAGE'; readonly pageId: string; readonly resourceId: string };

export const pMaterialization = (
  draft: FrontendKnowledgeDraftChangeSetV1,
  seedId?: string,
  target?: MaterializationTargetOverride,
): DraftMaterializationRecordV1 => ({
  materializationId: `materialization-${draft.draftId}`,
  draftId: draft.draftId,
  target:
    target ??
    (seedId === undefined
      ? { kind: 'RESOURCE', resourceId: draft.resourceId }
      : { kind: 'SEED', seedId, resourceId: draft.resourceId }),
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

export type ParitySnapshot = {
  readonly drafts: {
    readonly draftId: string;
    readonly projectId: string;
    readonly revision: number;
    readonly status: string;
    readonly startMode: string;
    readonly seedId: string | null;
  }[];
  readonly revisions: {
    readonly draftId: string;
    readonly revision: number;
    readonly projectId: string;
    readonly status: string;
    readonly contentDigest: string;
  }[];
  readonly operations: {
    readonly draftId: string;
    readonly revision: number;
    readonly projectId: string;
    readonly operationId: string;
  }[];
  readonly materializations: {
    readonly materializationId: string;
    readonly draftId: string;
    readonly projectId: string;
    readonly seedId: string | null;
    readonly kind: string;
  }[];
  readonly artifacts: {
    readonly artifactId: string;
    readonly kind: string;
    readonly draftId: string;
    readonly draftRevision: number;
    readonly projectId: string;
    readonly status: string;
  }[];
};

export interface ParityBoundary extends FrontendKnowledgeDraftRepositoryBoundaryPort {
  failOperationAppend: boolean;
  snapshotState(): Promise<ParitySnapshot> | ParitySnapshot;
}

export const capture = async (boundary: ParityBoundary): Promise<ParitySnapshot> => {
  const snap = await boundary.snapshotState();
  return {
    drafts: [...snap.drafts]
      .map((row) => ({ ...row, seedId: row.seedId ?? null }))
      .sort((a, b) => (a.draftId < b.draftId ? -1 : a.draftId > b.draftId ? 1 : 0)),
    revisions: [...snap.revisions].sort(
      (a, b) => a.draftId.localeCompare(b.draftId) || a.revision - b.revision,
    ),
    operations: [...snap.operations].sort(
      (a, b) =>
        a.draftId.localeCompare(b.draftId) ||
        a.revision - b.revision ||
        a.operationId.localeCompare(b.operationId),
    ),
    materializations: [...snap.materializations]
      .map((row) => ({ ...row, seedId: row.seedId ?? null }))
      .sort((a, b) => a.draftId.localeCompare(b.draftId)),
    artifacts: [...snap.artifacts].sort(
      (a, b) => a.artifactId.localeCompare(b.artifactId) || a.kind.localeCompare(b.kind),
    ),
  };
};

const errorCode = (error: unknown): string =>
  error instanceof FrontendKnowledgeDraftCommandError ? error.apiCode : 'UNKNOWN';

export const scenarioSeedReplay = async (boundary: ParityBoundary) => {
  const firstDraft = pDraft('seed-1', [pOperation(1)]);
  const first = await materializeFrontendKnowledgeDraft(boundary, {
    draft: firstDraft,
    materialization: pMaterialization(firstDraft, 'seed-1'),
  });
  const replayDraft = { ...pDraft('seed-1'), draftId: 'draft-replay' };
  const replay = await materializeFrontendKnowledgeDraft(boundary, {
    draft: replayDraft,
    materialization: {
      ...pMaterialization(pDraft('seed-1'), 'seed-1'),
      draftId: 'draft-replay',
      materializationId: 'materialization-replay',
    },
  });
  const snap = await capture(boundary);
  return {
    firstReplayed: first.replayed,
    replayReplayed: replay.replayed,
    replayReturnedFirstDraft: replay.draft.draftId === firstDraft.draftId,
    materializationCount: snap.materializations.length,
    draftCount: snap.drafts.length,
    revisionCount: snap.revisions.length,
    operationCount: snap.operations.length,
  };
};

export const scenarioSeedless = async (boundary: ParityBoundary) => {
  const resourceDraft = pDraft(undefined, [], { draftId: 'draft-resource-1' });
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: resourceDraft,
    materialization: pMaterialization(resourceDraft, undefined),
  });
  const pageDraft = pDraft(undefined, [], { draftId: 'draft-page-1' });
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: pageDraft,
    materialization: pMaterialization(pageDraft, undefined, {
      kind: 'PAGE',
      pageId: 'page-1',
      resourceId: 'resource-1',
    }),
  });
  const snap = await capture(boundary);
  return {
    kinds: snap.materializations.map((row) => row.kind).sort(),
    seedIds: snap.materializations.map((row) => row.seedId).sort(),
    draftStartModes: snap.drafts.map((row) => row.startMode).sort(),
    draftCount: snap.drafts.length,
  };
};

export const scenarioDigestMismatch = async (boundary: ParityBoundary) => {
  const draft = pDraft('seed-3');
  await materializeFrontendKnowledgeDraft(boundary, {
    draft,
    materialization: pMaterialization(draft, 'seed-3'),
  });
  const baseMatrix = pMaterialization(draft, 'seed-3');
  try {
    await materializeFrontendKnowledgeDraft(boundary, {
      draft: { ...pDraft('seed-3') },
      materialization: {
        ...baseMatrix,
        commandIdentity: {
          ...baseMatrix.commandIdentity,
          semanticDigest: 'sha256:different',
        },
      },
    });
    return { error: null };
  } catch (error) {
    return { error: errorCode(error) };
  }
};

export const scenarioDriftRejection = async (boundary: ParityBoundary) => {
  const draft = pDraft('seed-4');
  await materializeFrontendKnowledgeDraft(boundary, {
    draft,
    materialization: pMaterialization(draft, 'seed-4'),
  });
  const driftedBase = { ...pBase, canonicalVersion: 8 };
  const driftedDraft = pDraft('seed-4', [], { base: driftedBase });
  try {
    await materializeFrontendKnowledgeDraft(boundary, {
      draft: driftedDraft,
      materialization: pMaterialization(driftedDraft, 'seed-4'),
    });
    return { error: null };
  } catch (error) {
    return { error: errorCode(error) };
  }
};

const persistNext = (
  boundary: ParityBoundary,
  current: FrontendKnowledgeDraftChangeSetV1,
  operations: readonly FrontendKnowledgeOperationV1[],
) =>
  persistFrontendKnowledgeDraftRevision(boundary, {
    projectId: current.resourceProjectId,
    draftId: current.draftId,
    expectedDraftRevision: current.revision,
    expectedBaseRevision: current.base.canonicalVersion,
    operationRevision: current.revision + 1,
    operations,
    contentDigest: frontendKnowledgeDraftRevisionDigest({
      draftId: current.draftId,
      revision: current.revision + 1,
      base: current.base,
      operations,
    }),
    updatedAt: '2026-08-03T00:01:00.000Z',
  });

export const scenarioCas = async (boundary: ParityBoundary) => {
  const seedDraft = pDraft('seed-5', [pOperation(1)]);
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: seedDraft,
    materialization: pMaterialization(seedDraft, 'seed-5'),
  });
  const current = await boundary.transaction((repos) =>
    repos.drafts.findById(seedDraft.resourceProjectId, seedDraft.draftId),
  );
  if (!current) return { successRevision: null, conflictError: null, notFoundError: null };
  const appended = await persistNext(boundary, current as FrontendKnowledgeDraftChangeSetV1, [
    pOperation(2),
  ]);
  let conflictError: string | null = null;
  try {
    await persistFrontendKnowledgeDraftRevision(boundary, {
      projectId: appended.resourceProjectId,
      draftId: appended.draftId,
      expectedDraftRevision: appended.revision + 1,
      expectedBaseRevision: appended.base.canonicalVersion,
      operationRevision: appended.revision + 2,
      operations: [pOperation(appended.revision + 2)],
      contentDigest: frontendKnowledgeDraftRevisionDigest({
        draftId: appended.draftId,
        revision: appended.revision + 2,
        base: appended.base,
        operations: [pOperation(appended.revision + 2)],
      }),
      updatedAt: '2026-08-03T00:01:30.000Z',
    });
  } catch (error) {
    conflictError = errorCode(error);
  }
  let notFoundError: string | null = null;
  try {
    await persistFrontendKnowledgeDraftRevision(boundary, {
      projectId: 'project-1',
      draftId: 'draft-missing',
      expectedDraftRevision: 1,
      expectedBaseRevision: 7,
      operationRevision: 2,
      operations: [pOperation(2)],
      contentDigest: frontendKnowledgeDraftRevisionDigest({
        draftId: 'draft-missing',
        revision: 2,
        base: pBase,
        operations: [pOperation(2)],
      }),
      updatedAt: '2026-08-03T00:01:30.000Z',
    });
  } catch (error) {
    notFoundError = errorCode(error);
  }
  return { successRevision: appended.revision, conflictError, notFoundError };
};

export const scenarioAppendOnly = async (boundary: ParityBoundary) => {
  const seedDraft = pDraft('seed-8', [pOperation(1)]);
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: seedDraft,
    materialization: pMaterialization(seedDraft, 'seed-8'),
  });
  const current = await boundary.transaction((repos) =>
    repos.drafts.findById(seedDraft.resourceProjectId, seedDraft.draftId),
  );
  if (!current) return { revisions: [], drafts: [], operationCount: 0 };
  await persistNext(boundary, current as FrontendKnowledgeDraftChangeSetV1, [pOperation(2)]);
  const snap = await capture(boundary);
  return {
    revisions: snap.revisions
      .filter((row) => row.draftId === seedDraft.draftId)
      .map((row) => row.revision)
      .sort(),
    drafts: snap.drafts
      .filter((row) => row.draftId === seedDraft.draftId)
      .map((row) => row.revision)
      .sort(),
    operationCount: snap.operations.filter((row) => row.draftId === seedDraft.draftId).length,
  };
};

export const scenarioOperationOrdering = async (boundary: ParityBoundary) => {
  const seedDraft = pDraft('seed-9', [pOperation(1)]);
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: seedDraft,
    materialization: pMaterialization(seedDraft, 'seed-9'),
  });
  const listed = await boundary.transaction((repos) =>
    repos.operations.list(seedDraft.resourceProjectId, seedDraft.draftId, 1),
  );
  let duplicateError: string | null = null;
  try {
    await boundary.transaction((repos) =>
      repos.operations.append({
        projectId: seedDraft.resourceProjectId,
        draftId: seedDraft.draftId,
        revision: 1,
        operations: [pOperation(1)],
      }),
    );
  } catch (error) {
    duplicateError = errorCode(error);
  }
  return {
    ids: listed.map((operation) => operation.operationId),
    count: listed.length,
    duplicateError,
  };
};

export const scenarioRollback = async (boundary: ParityBoundary) => {
  const seedDraft = pDraft('seed-10', [pOperation(1)]);
  const original = boundary.failOperationAppend;
  boundary.failOperationAppend = true;
  let error: string | null = null;
  try {
    await materializeFrontendKnowledgeDraft(boundary, {
      draft: seedDraft,
      materialization: pMaterialization(seedDraft, 'seed-10'),
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'UNKNOWN';
  }
  boundary.failOperationAppend = original;
  const snap = await capture(boundary);
  return {
    error,
    totalRows:
      snap.drafts.length +
      snap.revisions.length +
      snap.operations.length +
      snap.materializations.length,
  };
};

export const scenarioArtifactRefs = async (boundary: ParityBoundary) => {
  const seedDraft: FrontendKnowledgeDraftChangeSetV1 = {
    ...pDraft('seed-11', []),
    validation: {
      artifactId: 'validation-1',
      artifactRevision: 1,
      digest: 'sha256:validation',
      status: 'COMPLETE',
      projectPolicyContext: {
        activeProjectId: 'project-1',
        resourceProjectId: 'project-1',
        draftProjectId: 'project-1',
        effectiveProjectId: 'project-1',
        accessRevision: 'access-7',
        policyContextRevision: 'policy-7',
      },
    },
    impactPreview: {
      artifactId: 'impact-1',
      artifactRevision: 1,
      digest: 'sha256:impact',
      status: 'COMPLETE',
      projectPolicyContext: {
        activeProjectId: 'project-1',
        resourceProjectId: 'project-1',
        draftProjectId: 'project-1',
        effectiveProjectId: 'project-1',
        accessRevision: 'access-7',
        policyContextRevision: 'policy-7',
      },
    },
  };
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: seedDraft,
    materialization: pMaterialization(seedDraft, 'seed-11'),
  });
  const snap = await capture(boundary);
  return {
    artifacts: snap.artifacts
      .map((row) => ({ artifactId: row.artifactId, kind: row.kind, status: row.status }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    artifactCount: snap.artifacts.length,
  };
};

export const scenarioAbandonment = async (boundary: ParityBoundary) => {
  const seedDraft = pDraft('seed-12', [pOperation(1)]);
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: seedDraft,
    materialization: pMaterialization(seedDraft, 'seed-12'),
  });
  const current = await boundary.transaction((repos) =>
    repos.drafts.findById(seedDraft.resourceProjectId, seedDraft.draftId),
  );
  if (!current)
    return { abandonResult: 'NOT_FOUND', status: null, counts: null, appendError: null };
  const appended = await persistNext(boundary, current as FrontendKnowledgeDraftChangeSetV1, [
    pOperation(2),
  ]);
  const abandonResult = await boundary.transaction((repos) =>
    repos.drafts.replaceIfRevision({
      projectId: appended.resourceProjectId,
      draft: { ...appended, status: 'ABANDONED' },
      expectedRevision: appended.revision,
    }),
  );
  let appendError: string | null = null;
  try {
    appendFrontendKnowledgeDraftRevision({
      current: { ...appended, status: 'ABANDONED' },
      expectedDraftRevision: appended.revision,
      expectedBaseRevision: appended.base.canonicalVersion,
      operationRevision: appended.revision + 1,
      operations: [pOperation(appended.revision + 1)],
      contentDigest: 'sha256:unused',
      updatedAt: '2026-08-03T00:02:00.000Z',
    });
  } catch (error) {
    appendError = errorCode(error);
  }
  const snap = await capture(boundary);
  return {
    abandonResult,
    status: snap.drafts.find((row) => row.draftId === seedDraft.draftId)?.status,
    counts: {
      drafts: snap.drafts.filter((row) => row.draftId === seedDraft.draftId).length,
      revisions: snap.revisions.filter((row) => row.draftId === seedDraft.draftId).length,
      operations: snap.operations.filter((row) => row.draftId === seedDraft.draftId).length,
      materializations: snap.materializations.filter((row) => row.draftId === seedDraft.draftId)
        .length,
    },
    appendError,
  };
};
