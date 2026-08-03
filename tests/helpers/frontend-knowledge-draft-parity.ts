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
  type MaterializeFrontendKnowledgeDraftResultV1,
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

export const scenarioRollbackIsolation = async (boundary: ParityBoundary) => {
  // Two transactions run concurrently on the same adapter. A commits with no
  // operations (the failpoint never fires for it); B appends an operation so
  // the failpoint fires and B must roll back only its own writes. A's data
  // must survive B's rollback (PostgreSQL-equivalent rollback isolation).
  const original = boundary.failOperationAppend;
  boundary.failOperationAppend = true;
  const aDraft = pDraft('seed-iso-a', []);
  const bDraft = pDraft('seed-iso-b', [pOperation(1)]);
  const [aResult, bResult] = await Promise.allSettled([
    materializeFrontendKnowledgeDraft(boundary, {
      draft: aDraft,
      materialization: pMaterialization(aDraft, 'seed-iso-a'),
    }),
    materializeFrontendKnowledgeDraft(boundary, {
      draft: bDraft,
      materialization: pMaterialization(bDraft, 'seed-iso-b'),
    }),
  ]);
  boundary.failOperationAppend = original;
  const snap = await capture(boundary);
  return {
    aSucceeded: aResult.status === 'fulfilled',
    bRejected: bResult.status === 'rejected',
    bError:
      bResult.status === 'rejected' && bResult.reason instanceof Error
        ? bResult.reason.message
        : null,
    survivingDraftCount: snap.drafts.filter((row) => row.draftId === aDraft.draftId).length,
    failedDraftCount: snap.drafts.filter((row) => row.draftId === bDraft.draftId).length,
    survivingMaterializationCount: snap.materializations.filter(
      (row) => row.draftId === aDraft.draftId,
    ).length,
  };
};

export const scenarioConcurrentReplay = async (boundary: ParityBoundary) => {
  // Two concurrent materializations of the same Seed + same command replay
  // key + same semantic digest. Both must resolve to the same existing Draft
  // and the store must contain exactly one Draft and one Materialization.
  const aDraft = pDraft('seed-rep', [], { draftId: 'draft-concurrent-a' });
  const bDraft = pDraft('seed-rep', [], { draftId: 'draft-concurrent-b' });
  const commandIdentity = {
    principalId: 'principal-1',
    clientRequestId: 'request-concurrent',
    idempotencyKey: 'key-concurrent',
    semanticDigest: 'sha256:command',
  };
  const [aResult, bResult] = await Promise.allSettled([
    materializeFrontendKnowledgeDraft(boundary, {
      draft: aDraft,
      materialization: { ...pMaterialization(aDraft, 'seed-rep'), commandIdentity },
    }),
    materializeFrontendKnowledgeDraft(boundary, {
      draft: bDraft,
      materialization: { ...pMaterialization(bDraft, 'seed-rep'), commandIdentity },
    }),
  ]);
  const snap = await capture(boundary);
  const fulfilled = [aResult, bResult].filter(
    (result): result is PromiseFulfilledResult<MaterializeFrontendKnowledgeDraftResultV1> =>
      result.status === 'fulfilled',
  );
  const draftIds = new Set(fulfilled.map((result) => result.value.draft.draftId));
  return {
    bothFulfilled: fulfilled.length === 2,
    sameDraftReturned: fulfilled.length === 2 && draftIds.size === 1,
    draftCount: snap.drafts.length,
    materializationCount: snap.materializations.length,
    replayFlags: fulfilled.map((result) => result.value.replayed).sort(),
  };
};

export const scenarioConcurrentReplayDigestMismatch = async (boundary: ParityBoundary) => {
  // Two concurrent materializations of the same Seed + same replay key but
  // DIFFERENT semantic digests. Exactly one commits; the other fails closed
  // with DIGEST_MISMATCH. The store keeps exactly one Draft + Materialization.
  const aDraft = pDraft('seed-repm', [], { draftId: 'draft-mismatch-a' });
  const bDraft = pDraft('seed-repm', [], { draftId: 'draft-mismatch-b' });
  const baseIdentity = {
    principalId: 'principal-1',
    clientRequestId: 'request-mismatch',
    idempotencyKey: 'key-mismatch',
  };
  const [aResult, bResult] = await Promise.allSettled([
    materializeFrontendKnowledgeDraft(boundary, {
      draft: aDraft,
      materialization: {
        ...pMaterialization(aDraft, 'seed-repm'),
        commandIdentity: { ...baseIdentity, semanticDigest: 'sha256:command-a' },
      },
    }),
    materializeFrontendKnowledgeDraft(boundary, {
      draft: bDraft,
      materialization: {
        ...pMaterialization(bDraft, 'seed-repm'),
        commandIdentity: { ...baseIdentity, semanticDigest: 'sha256:command-b' },
      },
    }),
  ]);
  const snap = await capture(boundary);
  const fulfilledCount = [aResult, bResult].filter(
    (result) => result.status === 'fulfilled',
  ).length;
  const digestMismatchCount = [aResult, bResult].filter(
    (result) => result.status === 'rejected' && errorCode(result.reason) === 'DIGEST_MISMATCH',
  ).length;
  return {
    fulfilledCount,
    digestMismatchCount,
    draftCount: snap.drafts.length,
    materializationCount: snap.materializations.length,
  };
};

export const scenarioConcurrentCas = async (boundary: ParityBoundary) => {
  // Two concurrent saves against the same Draft revision. Both read the same
  // current revision and race on the CAS update: exactly one commits and the
  // other receives DRAFT_REVISION_CONFLICT. The aggregate revision increments
  // once and no revision/operation row is duplicated.
  const seedDraft = pDraft('seed-cas-concurrent', []);
  await materializeFrontendKnowledgeDraft(boundary, {
    draft: seedDraft,
    materialization: pMaterialization(seedDraft, 'seed-cas-concurrent'),
  });
  const current = await boundary.transaction((repos) =>
    repos.drafts.findById(seedDraft.resourceProjectId, seedDraft.draftId),
  );
  if (!current) {
    return {
      successCount: 0,
      conflictCount: 0,
      finalRevision: null,
      revisionRows: [],
      operationCount: 0,
    };
  }
  const base = (current as FrontendKnowledgeDraftChangeSetV1).base;
  const draftId = seedDraft.draftId;
  const opA = pOperation(2);
  const opB: FrontendKnowledgeOperationV1 = {
    ...pOperation(2),
    operationId: 'operation-2-b',
    contentDigest: 'sha256:operation-2-b',
  };
  const digestFor = (operations: readonly FrontendKnowledgeOperationV1[]): string =>
    frontendKnowledgeDraftRevisionDigest({ draftId, revision: 2, base, operations });
  const save = (
    operations: readonly FrontendKnowledgeOperationV1[],
  ): Promise<FrontendKnowledgeDraftChangeSetV1> =>
    persistFrontendKnowledgeDraftRevision(boundary, {
      projectId: 'project-1',
      draftId,
      expectedDraftRevision: 1,
      expectedBaseRevision: base.canonicalVersion,
      operationRevision: 2,
      operations,
      contentDigest: digestFor(operations),
      updatedAt: '2026-08-03T00:01:00.000Z',
    });
  const results = await Promise.allSettled([save([opA]), save([opB])]);
  const snap = await capture(boundary);
  return {
    successCount: results.filter((result) => result.status === 'fulfilled').length,
    conflictCount: results.filter(
      (result) =>
        result.status === 'rejected' && errorCode(result.reason) === 'DRAFT_REVISION_CONFLICT',
    ).length,
    finalRevision: snap.drafts.find((row) => row.draftId === draftId)?.revision ?? null,
    revisionRows: snap.revisions
      .filter((row) => row.draftId === draftId)
      .map((row) => row.revision)
      .sort(),
    operationCount: snap.operations.filter((row) => row.draftId === draftId).length,
  };
};

export const scenarioArtifactRetention = async (boundary: ParityBoundary) => {
  // Revision 1 carries Validation + Impact references. Authoring revision 2
  // (with no validation/impact) must remove them from the current aggregate
  // while preserving revision 1's artifact history intact.
  const seedDraft: FrontendKnowledgeDraftChangeSetV1 = {
    ...pDraft('seed-ret', []),
    validation: {
      artifactId: 'validation-ret',
      artifactRevision: 1,
      digest: 'sha256:validation-ret',
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
      artifactId: 'impact-ret',
      artifactRevision: 1,
      digest: 'sha256:impact-ret',
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
    materialization: pMaterialization(seedDraft, 'seed-ret'),
  });
  const current = await boundary.transaction((repos) =>
    repos.drafts.findById(seedDraft.resourceProjectId, seedDraft.draftId),
  );
  if (!current) {
    return {
      currentRevision: null,
      currentHasValidation: null,
      currentHasImpact: null,
      retainedArtifacts: [],
    };
  }
  await persistNext(boundary, current as FrontendKnowledgeDraftChangeSetV1, [pOperation(2)]);
  const snap = await capture(boundary);
  const currentAggregate = await boundary.transaction((repos) =>
    repos.drafts.findById(seedDraft.resourceProjectId, seedDraft.draftId),
  );
  return {
    currentRevision: currentAggregate?.revision ?? null,
    currentHasValidation: currentAggregate?.validation !== undefined,
    currentHasImpact: currentAggregate?.impactPreview !== undefined,
    retainedArtifacts: snap.artifacts
      .filter((row) => row.draftId === seedDraft.draftId)
      .map((row) => ({
        artifactId: row.artifactId,
        kind: row.kind,
        draftRevision: row.draftRevision,
      }))
      .sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
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
