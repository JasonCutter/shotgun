import {
  FrontendKnowledgeDraftCommandError,
  sha256Text,
  stableJson,
  type FrontendKnowledgeDraftBaseV1,
  type FrontendKnowledgeDraftChangeSetV1,
  type FrontendKnowledgeOperationV1,
} from '../../../packages/contracts/src/index.js';

export const FRONTEND_KNOWLEDGE_DRAFT_DOMAIN_VERSION = '1.0.0' as const;

export type DraftCommandIdentityV1 = {
  readonly principalId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly semanticDigest: string;
};

export type FrontendKnowledgeDraftCommandReplayKeyV1 = Pick<
  DraftCommandIdentityV1,
  'principalId' | 'clientRequestId' | 'idempotencyKey'
>;

export type DraftMaterializationTargetV1 =
  | { readonly kind: 'SEED'; readonly seedId: string; readonly resourceId: string }
  | { readonly kind: 'RESOURCE'; readonly resourceId: string }
  | { readonly kind: 'PAGE'; readonly pageId: string; readonly resourceId: string };

export type DraftMaterializationRecordV1 = {
  readonly materializationId: string;
  readonly draftId: string;
  readonly target: DraftMaterializationTargetV1;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
  readonly commandIdentity: DraftCommandIdentityV1;
  readonly createdAt: string;
};

export type FrontendKnowledgeDraftRevisionRecordV1 = {
  readonly draftId: string;
  readonly revision: number;
  readonly status: FrontendKnowledgeDraftChangeSetV1['status'];
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
  readonly contentDigest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type FrontendKnowledgeDraftOperationAppendV1 = {
  readonly projectId: string;
  readonly draftId: string;
  readonly revision: number;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
};

export type FrontendKnowledgeDraftAggregateRepositoryPort = {
  findById(
    projectId: string,
    draftId: string,
  ): Promise<FrontendKnowledgeDraftChangeSetV1 | undefined>;
  insert(draft: FrontendKnowledgeDraftChangeSetV1): Promise<FrontendKnowledgeDraftChangeSetV1>;
  replaceIfRevision(input: {
    readonly projectId: string;
    readonly draft: FrontendKnowledgeDraftChangeSetV1;
    readonly expectedRevision: number;
  }): Promise<'UPDATED' | 'REVISION_CONFLICT' | 'NOT_FOUND'>;
};

export type FrontendKnowledgeDraftRevisionRepositoryPort = {
  find(
    projectId: string,
    draftId: string,
    revision: number,
  ): Promise<FrontendKnowledgeDraftRevisionRecordV1 | undefined>;
  append(
    revision: FrontendKnowledgeDraftRevisionRecordV1,
  ): Promise<FrontendKnowledgeDraftRevisionRecordV1>;
};

export type FrontendKnowledgeDraftOperationRepositoryPort = {
  append(input: FrontendKnowledgeDraftOperationAppendV1): Promise<void>;
  list(
    projectId: string,
    draftId: string,
    revision: number,
  ): Promise<readonly FrontendKnowledgeOperationV1[]>;
};

export type FrontendKnowledgeDraftMaterializationRepositoryPort = {
  findBySeed(seedId: string): Promise<DraftMaterializationRecordV1 | undefined>;
  findByDraftId(
    projectId: string,
    draftId: string,
  ): Promise<DraftMaterializationRecordV1 | undefined>;
  findByCommandReplayKey(
    projectId: string,
    replayKey: FrontendKnowledgeDraftCommandReplayKeyV1,
  ): Promise<DraftMaterializationRecordV1 | undefined>;
  insert(materialization: DraftMaterializationRecordV1): Promise<DraftMaterializationRecordV1>;
};

export type FrontendKnowledgeDraftTransactionRepositoriesV1 = {
  readonly drafts: FrontendKnowledgeDraftAggregateRepositoryPort;
  readonly revisions: FrontendKnowledgeDraftRevisionRepositoryPort;
  readonly operations: FrontendKnowledgeDraftOperationRepositoryPort;
  readonly materializations: FrontendKnowledgeDraftMaterializationRepositoryPort;
};

export type FrontendKnowledgeDraftRepositoryBoundaryPort = {
  transaction<T>(
    action: (repositories: FrontendKnowledgeDraftTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T>;
};

export type FrontendKnowledgeDraftProjectBindingV1 = {
  readonly activeProjectId: string;
  readonly resourceProjectId: string;
  readonly draftProjectId: string;
  readonly effectiveProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type CreateFrontendKnowledgeDraftInputV1 = {
  readonly draftId: string;
  readonly seedId?: string;
  readonly answerRunId?: string;
  readonly startMode: FrontendKnowledgeDraftChangeSetV1['startMode'];
  readonly binding: FrontendKnowledgeDraftProjectBindingV1;
  readonly resourceId: string;
  readonly base: FrontendKnowledgeDraftBaseV1;
  readonly operations?: readonly FrontendKnowledgeOperationV1[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AppendFrontendKnowledgeDraftRevisionInputV1 = {
  readonly current: FrontendKnowledgeDraftChangeSetV1;
  readonly expectedDraftRevision: number;
  readonly expectedBaseRevision: number;
  readonly operationRevision: number;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
  readonly contentDigest: string;
  readonly updatedAt: string;
};

export type MaterializeFrontendKnowledgeDraftInputV1 = {
  readonly draft: FrontendKnowledgeDraftChangeSetV1;
  readonly materialization: DraftMaterializationRecordV1;
};

export type MaterializeFrontendKnowledgeDraftResultV1 = {
  readonly draft: FrontendKnowledgeDraftChangeSetV1;
  readonly materialization: DraftMaterializationRecordV1;
  readonly replayed: boolean;
};

export type PersistFrontendKnowledgeDraftRevisionInputV1 = {
  readonly projectId: string;
  readonly draftId: string;
  readonly expectedDraftRevision: number;
  readonly expectedBaseRevision: number;
  readonly operationRevision: number;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
  readonly contentDigest: string;
  readonly updatedAt: string;
};

const requiredText = (value: string, field: string): string => {
  if (value.trim().length === 0) {
    throw new FrontendKnowledgeDraftCommandError('VALIDATION_FAILED', `${field} is required.`);
  }
  return value;
};

const domainFailure = (
  code:
    | 'DRAFT_NOT_FOUND'
    | 'DRAFT_REVISION_CONFLICT'
    | 'DIGEST_MISMATCH'
    | 'PROJECT_BINDING_CONFLICT'
    | 'STALE'
    | 'VALIDATION_FAILED',
  message: string,
): never => {
  throw new FrontendKnowledgeDraftCommandError(code, message);
};

const projectBinding = (draft: FrontendKnowledgeDraftChangeSetV1) => ({
  activeProjectId: draft.activeProjectId,
  resourceProjectId: draft.resourceProjectId,
  draftProjectId: draft.draftProjectId,
  effectiveProjectId: draft.effectiveProjectId,
  accessRevision: draft.base.accessRevision,
  policyContextRevision: draft.base.policyContextRevision,
});

const assertBindingValues = (binding: FrontendKnowledgeDraftProjectBindingV1): void => {
  for (const [field, value] of Object.entries(binding)) requiredText(value, field);
};

export const assertFrontendKnowledgeDraftProjectBinding = (
  draft: FrontendKnowledgeDraftChangeSetV1,
  binding: FrontendKnowledgeDraftProjectBindingV1,
): void => {
  assertBindingValues(binding);
  if (stableJson(projectBinding(draft)) !== stableJson(binding)) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Draft Project and policy binding are immutable.');
  }
  if (draft.base.resourceProjectId !== binding.resourceProjectId) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Draft base is bound to another Resource Project.');
  }
};

export const assertFrontendKnowledgeDraftBaseBinding = (
  current: FrontendKnowledgeDraftChangeSetV1,
  next: FrontendKnowledgeDraftChangeSetV1,
): void => {
  if (
    current.draftId !== next.draftId ||
    current.startMode !== next.startMode ||
    current.resourceId !== next.resourceId ||
    current.seedId !== next.seedId ||
    current.answerRunId !== next.answerRunId ||
    stableJson(current.base) !== stableJson(next.base) ||
    stableJson(projectBinding(current)) !== stableJson(projectBinding(next))
  ) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Draft identity or pinned base changed.');
  }
};

export const frontendKnowledgeDraftRevisionDigest = (input: {
  readonly draftId: string;
  readonly revision: number;
  readonly base: FrontendKnowledgeDraftBaseV1;
  readonly operations: readonly FrontendKnowledgeOperationV1[];
}): string =>
  sha256Text(
    stableJson({
      domain: 'frontend-knowledge-draft',
      version: FRONTEND_KNOWLEDGE_DRAFT_DOMAIN_VERSION,
      draftId: input.draftId,
      revision: input.revision,
      base: input.base,
      operations: input.operations,
    }),
  );

const assertOperationRevision = (
  operations: readonly FrontendKnowledgeOperationV1[],
  expectedBaseRevision: number,
  operationRevision: number,
): void => {
  const operationIds = new Set<string>();
  for (const operation of operations) {
    if (operationIds.has(operation.operationId)) {
      domainFailure('VALIDATION_FAILED', 'Operation IDs must be unique in a Draft revision.');
    }
    operationIds.add(operation.operationId);
    if (
      operation.baseRevision !== expectedBaseRevision ||
      operation.operationRevision !== operationRevision
    ) {
      domainFailure(
        'DRAFT_REVISION_CONFLICT',
        'Operation revision is not bound to the Draft base.',
      );
    }
    requiredText(operation.contentDigest, 'operation.contentDigest');
    requiredText(operation.rationale, 'operation.rationale');
  }
};

const commandReplayKey = (
  identity: DraftCommandIdentityV1,
): FrontendKnowledgeDraftCommandReplayKeyV1 => ({
  principalId: identity.principalId,
  clientRequestId: identity.clientRequestId,
  idempotencyKey: identity.idempotencyKey,
});

export const createInitialFrontendKnowledgeDraft = (
  input: CreateFrontendKnowledgeDraftInputV1,
): FrontendKnowledgeDraftChangeSetV1 => {
  requiredText(input.draftId, 'draftId');
  requiredText(input.resourceId, 'resourceId');
  requiredText(input.createdAt, 'createdAt');
  requiredText(input.updatedAt, 'updatedAt');
  assertBindingValues(input.binding);
  if (input.base.resourceProjectId !== input.binding.resourceProjectId) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Draft base must bind to the Resource Project.');
  }
  if (input.startMode === 'SEED_MATERIALIZATION') {
    requiredText(input.seedId ?? '', 'seedId');
  } else if (input.seedId !== undefined) {
    domainFailure('VALIDATION_FAILED', 'Knowledge Page drafts cannot carry a Seed ID.');
  }
  const operations = input.operations ?? [];
  assertOperationRevision(operations, input.base.canonicalVersion, 1);
  const draft: FrontendKnowledgeDraftChangeSetV1 = {
    schemaVersion: '1.0.0',
    draftId: input.draftId,
    ...(input.seedId === undefined ? {} : { seedId: input.seedId }),
    ...(input.answerRunId === undefined ? {} : { answerRunId: input.answerRunId }),
    startMode: input.startMode,
    status: 'DRAFT',
    revision: 1,
    activeProjectId: input.binding.activeProjectId,
    resourceProjectId: input.binding.resourceProjectId,
    draftProjectId: input.binding.draftProjectId,
    effectiveProjectId: input.binding.effectiveProjectId,
    resourceId: input.resourceId,
    base: input.base,
    operations,
    contentDigest: frontendKnowledgeDraftRevisionDigest({
      draftId: input.draftId,
      revision: 1,
      base: input.base,
      operations,
    }),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
  assertFrontendKnowledgeDraftProjectBinding(draft, input.binding);
  return draft;
};

export const appendFrontendKnowledgeDraftRevision = (
  input: AppendFrontendKnowledgeDraftRevisionInputV1,
): FrontendKnowledgeDraftChangeSetV1 => {
  const { current } = input;
  if (current.status === 'ABANDONED') {
    domainFailure('DRAFT_REVISION_CONFLICT', 'An abandoned Draft cannot receive a new revision.');
  }
  if (current.revision !== input.expectedDraftRevision) {
    domainFailure('DRAFT_REVISION_CONFLICT', 'Draft revision is stale.');
  }
  if (current.base.canonicalVersion !== input.expectedBaseRevision) {
    domainFailure('STALE', 'Draft base revision is stale.');
  }
  const nextRevision = current.revision + 1;
  if (input.operationRevision !== nextRevision) {
    domainFailure('DRAFT_REVISION_CONFLICT', 'Operation revision must follow Draft revision.');
  }
  assertOperationRevision(input.operations, input.expectedBaseRevision, input.operationRevision);
  const expectedDigest = frontendKnowledgeDraftRevisionDigest({
    draftId: current.draftId,
    revision: nextRevision,
    base: current.base,
    operations: input.operations,
  });
  if (input.contentDigest !== expectedDigest) {
    domainFailure('VALIDATION_FAILED', 'Draft content digest does not match its revision.');
  }
  const next: FrontendKnowledgeDraftChangeSetV1 = {
    schemaVersion: current.schemaVersion,
    draftId: current.draftId,
    ...(current.seedId === undefined ? {} : { seedId: current.seedId }),
    ...(current.answerRunId === undefined ? {} : { answerRunId: current.answerRunId }),
    startMode: current.startMode,
    status: 'DRAFT',
    revision: nextRevision,
    activeProjectId: current.activeProjectId,
    resourceProjectId: current.resourceProjectId,
    draftProjectId: current.draftProjectId,
    effectiveProjectId: current.effectiveProjectId,
    resourceId: current.resourceId,
    base: current.base,
    operations: input.operations,
    contentDigest: input.contentDigest,
    createdAt: current.createdAt,
    updatedAt: input.updatedAt,
  };
  assertFrontendKnowledgeDraftBaseBinding(current, next);
  return next;
};

const revisionRecord = (
  draft: FrontendKnowledgeDraftChangeSetV1,
): FrontendKnowledgeDraftRevisionRecordV1 => ({
  draftId: draft.draftId,
  revision: draft.revision,
  status: draft.status,
  resourceProjectId: draft.resourceProjectId,
  draftProjectId: draft.draftProjectId,
  effectiveProjectId: draft.effectiveProjectId,
  base: draft.base,
  operations: draft.operations,
  contentDigest: draft.contentDigest,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt,
});

export const assertFrontendKnowledgeDraftMaterializationBinding = (
  draft: FrontendKnowledgeDraftChangeSetV1,
  materialization: DraftMaterializationRecordV1,
): void => {
  assertFrontendKnowledgeDraftMaterializationValues(materialization);
  if (
    draft.draftId !== materialization.draftId ||
    draft.resourceProjectId !== materialization.resourceProjectId ||
    draft.draftProjectId !== materialization.draftProjectId ||
    draft.effectiveProjectId !== materialization.effectiveProjectId ||
    draft.resourceId !== materialization.target.resourceId ||
    stableJson(draft.base) !== stableJson(materialization.base)
  ) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Materialization is not bound to the Draft.');
  }
  if (materialization.target.kind === 'SEED' && draft.seedId !== materialization.target.seedId) {
    domainFailure(
      'PROJECT_BINDING_CONFLICT',
      'Seed materialization identity does not match Draft.',
    );
  }
  if (materialization.target.kind !== 'SEED' && draft.seedId !== undefined) {
    domainFailure('VALIDATION_FAILED', 'Seedless materialization cannot carry a Seed ID.');
  }
};

export const assertFrontendKnowledgeDraftMaterializationValues = (
  materialization: DraftMaterializationRecordV1,
): void => {
  requiredText(materialization.materializationId, 'materializationId');
  requiredText(materialization.draftId, 'materialization.draftId');
  requiredText(materialization.resourceProjectId, 'materialization.resourceProjectId');
  requiredText(materialization.draftProjectId, 'materialization.draftProjectId');
  requiredText(materialization.effectiveProjectId, 'materialization.effectiveProjectId');
  requiredText(materialization.createdAt, 'materialization.createdAt');
  requiredText(materialization.commandIdentity.principalId, 'commandIdentity.principalId');
  requiredText(materialization.commandIdentity.clientRequestId, 'commandIdentity.clientRequestId');
  requiredText(materialization.commandIdentity.idempotencyKey, 'commandIdentity.idempotencyKey');
  requiredText(materialization.commandIdentity.semanticDigest, 'commandIdentity.semanticDigest');
  requiredText(
    materialization.base.canonicalSnapshotId,
    'materialization.base.canonicalSnapshotId',
  );
  requiredText(
    materialization.base.canonicalSnapshotDigest,
    'materialization.base.canonicalSnapshotDigest',
  );
  if (materialization.target.kind === 'SEED') {
    requiredText(materialization.target.seedId, 'materialization.target.seedId');
    requiredText(materialization.target.resourceId, 'materialization.target.resourceId');
  } else if (materialization.target.kind === 'RESOURCE') {
    requiredText(materialization.target.resourceId, 'materialization.target.resourceId');
  } else {
    requiredText(materialization.target.pageId, 'materialization.target.pageId');
    requiredText(materialization.target.resourceId, 'materialization.target.resourceId');
  }
};

const assertFrontendKnowledgeDraftReplayBinding = (
  existing: FrontendKnowledgeDraftChangeSetV1,
  incoming: FrontendKnowledgeDraftChangeSetV1,
): void => {
  if (
    existing.startMode !== incoming.startMode ||
    existing.seedId !== incoming.seedId ||
    existing.answerRunId !== incoming.answerRunId ||
    existing.activeProjectId !== incoming.activeProjectId ||
    existing.resourceProjectId !== incoming.resourceProjectId ||
    existing.draftProjectId !== incoming.draftProjectId ||
    existing.effectiveProjectId !== incoming.effectiveProjectId ||
    existing.resourceId !== incoming.resourceId ||
    stableJson(existing.base) !== stableJson(incoming.base)
  ) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Draft replay binding does not match.');
  }
};

const assertMaterializationReplayIdentity = (
  existing: DraftMaterializationRecordV1,
  incoming: DraftMaterializationRecordV1,
): void => {
  if (
    stableJson(existing.target) !== stableJson(incoming.target) ||
    existing.resourceProjectId !== incoming.resourceProjectId ||
    existing.draftProjectId !== incoming.draftProjectId ||
    existing.effectiveProjectId !== incoming.effectiveProjectId ||
    stableJson(existing.base) !== stableJson(incoming.base) ||
    stableJson(existing.commandIdentity) !== stableJson(incoming.commandIdentity)
  ) {
    domainFailure('PROJECT_BINDING_CONFLICT', 'Materialization replay identity does not match.');
  }
};

export const persistFrontendKnowledgeDraftRevision = async (
  boundary: FrontendKnowledgeDraftRepositoryBoundaryPort,
  input: PersistFrontendKnowledgeDraftRevisionInputV1,
): Promise<FrontendKnowledgeDraftChangeSetV1> =>
  boundary.transaction(async ({ drafts, revisions, operations }) => {
    const current = await drafts.findById(input.projectId, input.draftId);
    if (!current) {
      domainFailure('DRAFT_NOT_FOUND', 'Draft was not found.');
    }
    const next = appendFrontendKnowledgeDraftRevision({
      current: current as FrontendKnowledgeDraftChangeSetV1,
      expectedDraftRevision: input.expectedDraftRevision,
      expectedBaseRevision: input.expectedBaseRevision,
      operationRevision: input.operationRevision,
      operations: input.operations,
      contentDigest: input.contentDigest,
      updatedAt: input.updatedAt,
    });
    const result = await drafts.replaceIfRevision({
      projectId: input.projectId,
      draft: next,
      expectedRevision: input.expectedDraftRevision,
    });
    if (result === 'NOT_FOUND') {
      domainFailure('DRAFT_NOT_FOUND', 'Draft was not found.');
    }
    if (result === 'REVISION_CONFLICT') {
      domainFailure('DRAFT_REVISION_CONFLICT', 'Draft revision is stale.');
    }
    await revisions.append(revisionRecord(next));
    if (next.operations.length > 0) {
      await operations.append({
        projectId: next.resourceProjectId,
        draftId: next.draftId,
        revision: next.revision,
        operations: next.operations,
      });
    }
    return next;
  });

export const materializeFrontendKnowledgeDraft = async (
  boundary: FrontendKnowledgeDraftRepositoryBoundaryPort,
  input: MaterializeFrontendKnowledgeDraftInputV1,
): Promise<MaterializeFrontendKnowledgeDraftResultV1> => {
  const { draft, materialization } = input;
  assertFrontendKnowledgeDraftMaterializationBinding(draft, materialization);
  return boundary.transaction(async (repositories) => {
    const { drafts, materializations, revisions, operations } = repositories;
    const existingBySeed =
      materialization.target.kind === 'SEED'
        ? await materializations.findBySeed(materialization.target.seedId)
        : undefined;
    const existingByCommand = await materializations.findByCommandReplayKey(
      materialization.resourceProjectId,
      commandReplayKey(materialization.commandIdentity),
    );
    if (
      existingByCommand !== undefined &&
      stableJson(existingByCommand.commandIdentity) !== stableJson(materialization.commandIdentity)
    ) {
      domainFailure('DIGEST_MISMATCH', 'Command identity was reused with different semantics.');
    }
    if (
      existingBySeed !== undefined &&
      existingByCommand !== undefined &&
      existingBySeed.materializationId !== existingByCommand.materializationId
    ) {
      domainFailure(
        'DRAFT_REVISION_CONFLICT',
        'Replay keys refer to conflicting materializations.',
      );
    }
    const existing = existingBySeed ?? existingByCommand;
    if (existing) {
      assertMaterializationReplayIdentity(existing, materialization);
      const existingDraft = await drafts.findById(
        materialization.resourceProjectId,
        existing.draftId,
      );
      if (!existingDraft) {
        domainFailure('DRAFT_NOT_FOUND', 'Materialization references a missing Draft.');
      }
      const replayedDraft = existingDraft as FrontendKnowledgeDraftChangeSetV1;
      assertFrontendKnowledgeDraftReplayBinding(replayedDraft, draft);
      return { draft: replayedDraft, materialization: existing, replayed: true };
    }
    const existingDraft = await materializations.findByDraftId(
      materialization.resourceProjectId,
      draft.draftId,
    );
    if (existingDraft) {
      domainFailure('DRAFT_REVISION_CONFLICT', 'Draft identity is already materialized.');
    }
    const storedDraft = await drafts.insert(draft);
    await revisions.append(revisionRecord(storedDraft));
    if (storedDraft.operations.length > 0) {
      await operations.append({
        projectId: storedDraft.resourceProjectId,
        draftId: storedDraft.draftId,
        revision: storedDraft.revision,
        operations: storedDraft.operations,
      });
    }
    const storedMaterialization = await materializations.insert(materialization);
    return { draft: storedDraft, materialization: storedMaterialization, replayed: false };
  });
};

export type TransitionFrontendKnowledgeDraftStatusInputV1 = {
  readonly current: FrontendKnowledgeDraftChangeSetV1;
  readonly expectedDraftRevision: number;
  readonly expectedBaseRevision: number;
  readonly nextStatus: FrontendKnowledgeDraftChangeSetV1['status'];
  readonly updatedAt: string;
};

const LEGAL_DRAFT_TRANSITIONS: Readonly<
  Record<
    FrontendKnowledgeDraftChangeSetV1['status'],
    readonly FrontendKnowledgeDraftChangeSetV1['status'][]
  >
> = {
  DRAFT: ['VALID', 'INVALID', 'READY_FOR_REVIEW', 'ABANDONED'],
  VALIDATING: ['VALID', 'INVALID', 'READY_FOR_REVIEW', 'ABANDONED'],
  VALID: ['VALID', 'INVALID', 'READY_FOR_REVIEW', 'ABANDONED'],
  INVALID: ['VALID', 'INVALID', 'READY_FOR_REVIEW', 'ABANDONED'],
  STALE: ['VALID', 'INVALID', 'ABANDONED'],
  CONFLICT: ['VALID', 'INVALID', 'ABANDONED'],
  READY_FOR_REVIEW: ['SUBMITTED', 'VALID', 'INVALID', 'ABANDONED'],
  SUBMITTING: ['SUBMITTED'],
  SUBMITTED: [],
  ABANDONED: [],
};

/**
 * Transitions the Draft lifecycle in place (the aggregate revision is the
 * authoring revision; lifecycle status is aggregate state). The pinned base,
 * identity and Project binding are immutable. A submitted or abandoned Draft
 * is terminal.
 */
export const transitionFrontendKnowledgeDraftStatus = (
  input: TransitionFrontendKnowledgeDraftStatusInputV1,
): FrontendKnowledgeDraftChangeSetV1 => {
  const { current, nextStatus } = input;
  if (current.status === 'ABANDONED') {
    domainFailure('DRAFT_REVISION_CONFLICT', 'An abandoned Draft is terminal.');
  }
  if (current.status === 'SUBMITTED') {
    domainFailure('DRAFT_REVISION_CONFLICT', 'A submitted Draft revision is immutable.');
  }
  if (current.revision !== input.expectedDraftRevision) {
    domainFailure('DRAFT_REVISION_CONFLICT', 'Draft revision is stale.');
  }
  if (current.base.canonicalVersion !== input.expectedBaseRevision) {
    domainFailure('STALE', 'Draft base revision is stale.');
  }
  const legal = LEGAL_DRAFT_TRANSITIONS[current.status] ?? [];
  if (!legal.includes(nextStatus)) {
    domainFailure(
      'DRAFT_REVISION_CONFLICT',
      `Draft status transition ${current.status} -> ${nextStatus} is not allowed.`,
    );
  }
  const next: FrontendKnowledgeDraftChangeSetV1 = {
    schemaVersion: current.schemaVersion,
    draftId: current.draftId,
    ...(current.seedId === undefined ? {} : { seedId: current.seedId }),
    ...(current.answerRunId === undefined ? {} : { answerRunId: current.answerRunId }),
    startMode: current.startMode,
    status: nextStatus,
    revision: current.revision,
    activeProjectId: current.activeProjectId,
    resourceProjectId: current.resourceProjectId,
    draftProjectId: current.draftProjectId,
    effectiveProjectId: current.effectiveProjectId,
    resourceId: current.resourceId,
    base: current.base,
    operations: current.operations,
    ...(current.validation === undefined ? {} : { validation: current.validation }),
    ...(current.impactPreview === undefined ? {} : { impactPreview: current.impactPreview }),
    ...(current.reviewResource === undefined ? {} : { reviewResource: current.reviewResource }),
    ...(current.reviewSubmission === undefined
      ? {}
      : { reviewSubmission: current.reviewSubmission }),
    contentDigest: current.contentDigest,
    createdAt: current.createdAt,
    updatedAt: input.updatedAt,
  };
  assertFrontendKnowledgeDraftBaseBinding(current, next);
  return next;
};

export type PersistFrontendKnowledgeDraftTransitionInputV1 = {
  readonly projectId: string;
  readonly draft: FrontendKnowledgeDraftChangeSetV1;
  readonly expectedRevision: number;
};

export const persistFrontendKnowledgeDraftTransition = async (
  boundary: FrontendKnowledgeDraftRepositoryBoundaryPort,
  input: PersistFrontendKnowledgeDraftTransitionInputV1,
): Promise<FrontendKnowledgeDraftChangeSetV1> =>
  boundary.transaction(async ({ drafts }) => {
    const result = await drafts.replaceIfRevision({
      projectId: input.projectId,
      draft: input.draft,
      expectedRevision: input.expectedRevision,
    });
    if (result === 'NOT_FOUND') {
      domainFailure('DRAFT_NOT_FOUND', 'Draft was not found.');
    }
    if (result === 'REVISION_CONFLICT') {
      domainFailure('DRAFT_REVISION_CONFLICT', 'Draft revision is stale.');
    }
    return input.draft;
  });

export const toFrontendKnowledgeDraftRevisionRecord = revisionRecord;
