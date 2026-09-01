import { randomUUID } from 'node:crypto';

import knowledgeCandidateSchema from '../../../packages/contracts/schemas/knowledge-candidate.v1.schema.json';
import {
  assertJsonSchema,
  entityVaultImportDigest,
  type EntityCandidate,
  type EntityVaultImport,
  type EvidenceSpan,
  type KnowledgeCandidate,
  type KnowledgeGraphView,
  type KnowledgeImpactResult,
  type KnowledgeReentryPhase,
  type KnowledgeReviewDecision,
  type KnowledgeReviewGroup,
  knowledgeCandidateDigest,
  modelDisagreementView,
  ShotgunError,
  type CommandEnvelope,
  type QueryEnvelope,
} from '../../../packages/contracts/src/index.js';
import type { HandlerContext, ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export * from './typed-proposition-conflict.js';

export type KnowledgeReviewWrite = {
  readonly projectId: string;
  readonly groupId: string;
  readonly expectedRevisionNumber: number;
  readonly expectedContentDigest: string;
  readonly updated: KnowledgeReviewGroup;
};

export type EntityVaultReviewWrite = {
  readonly projectId: string;
  readonly importId: string;
  readonly expectedContentDigest: string;
  readonly updated: EntityVaultImport;
};

export type KnowledgeModelRepositoryPort = {
  saveGroup(group: KnowledgeReviewGroup): Promise<KnowledgeReviewGroup>;
  findGroup(projectId: string, groupId: string): Promise<KnowledgeReviewGroup | undefined>;
  listGroups(projectId: string): Promise<readonly KnowledgeReviewGroup[]>;
  reviewGroup(write: KnowledgeReviewWrite): Promise<KnowledgeReviewGroup>;
  listApprovedItems(projectId: string): Promise<readonly KnowledgeCandidate[]>;
  saveEntityVaultImport(value: EntityVaultImport): Promise<EntityVaultImport>;
  findEntityVaultImport(
    projectId: string,
    importId: string,
  ): Promise<EntityVaultImport | undefined>;
  reviewEntityVaultImport(write: EntityVaultReviewWrite): Promise<EntityVaultImport>;
};

type ClockPort = { now(): string };
const systemClock: ClockPort = { now: () => new Date().toISOString() };

const candidateSchema = knowledgeCandidateSchema as Parameters<typeof assertJsonSchema>[0];
const candidateOneOf = knowledgeCandidateSchema.oneOf;
const candidateDefs = knowledgeCandidateSchema.$defs;

const stageGroupSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $defs: candidateDefs,
  type: 'object',
  additionalProperties: false,
  required: ['groupId', 'sourceVersionId', 'items'],
  properties: {
    groupId: { type: 'string', minLength: 1 },
    sourceVersionId: { type: 'string', minLength: 1 },
    items: { type: 'array', minItems: 1, items: { oneOf: candidateOneOf } },
  },
};

const idQuerySchema = (property: string) => ({
  type: 'object',
  additionalProperties: false,
  required: [property],
  properties: { [property]: { type: 'string', minLength: 1 } },
});

const reviewGroupSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'decisionId',
    'groupId',
    'expectedRevisionNumber',
    'expectedContentDigest',
    'decision',
    'reason',
    'itemIds',
  ],
  properties: {
    decisionId: { type: 'string', minLength: 1 },
    groupId: { type: 'string', minLength: 1 },
    expectedRevisionNumber: { type: 'integer', minimum: 1 },
    expectedContentDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    decision: { enum: ['APPROVE', 'HOLD', 'REJECT', 'EDIT'] },
    reason: { type: 'string', minLength: 1 },
    itemIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    editKind: {
      enum: ['WORDING_LAYOUT', 'FACTUAL_CORRECTION', 'NEW_KNOWLEDGE', 'REFERENCE_CHANGE'],
    },
  },
  allOf: [
    {
      if: { properties: { decision: { const: 'EDIT' } }, required: ['decision'] },
      then: { properties: { editKind: {} }, required: ['editKind'] },
    },
  ],
};

const impactQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rootCandidateId'],
  properties: {
    rootCandidateId: { type: 'string', minLength: 1 },
    maxDepth: { type: 'integer', minimum: 1, maximum: 10 },
    maxNodes: { type: 'integer', minimum: 1, maximum: 500 },
  },
};

const graphQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const stageVaultSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $defs: candidateDefs,
  type: 'object',
  additionalProperties: false,
  required: ['importId', 'sourceVersionId', 'entities'],
  properties: {
    importId: { type: 'string', minLength: 1 },
    sourceVersionId: { type: 'string', minLength: 1 },
    entities: { type: 'array', minItems: 1, items: { oneOf: candidateOneOf } },
  },
};

const reviewVaultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['importId', 'expectedContentDigest', 'decision'],
  properties: {
    importId: { type: 'string', minLength: 1 },
    expectedContentDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    decision: { enum: ['APPROVE', 'REJECT'] },
  },
};

const listGroupsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const assertContext = (envelope: CommandEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Knowledge Model access requires complete security context.',
      module: 'stage9.knowledge-model',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    actor: envelope.actor,
    security: envelope.security,
  };
};

const assertScope = (
  group: KnowledgeReviewGroup,
  actualScopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(actualScopes);
  if (group.accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Knowledge Review Group.',
      module: 'stage9.knowledge-model',
      operation: 'read-group',
      correlationId,
    });
  }
};

const hasScope = (group: KnowledgeReviewGroup, actualScopes: readonly string[]): boolean => {
  const actual = new Set(actualScopes);
  return group.accessScope.every((scope) => actual.has(scope));
};

const accessibleApprovedItems = async (
  repository: KnowledgeModelRepositoryPort,
  projectId: string,
  actualScopes: readonly string[],
): Promise<readonly KnowledgeCandidate[]> =>
  (await repository.listGroups(projectId))
    .filter((group) => group.status === 'APPROVED' && hasScope(group, actualScopes))
    .flatMap((group) => group.items)
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));

const temporalEvidenceIds = (candidate: KnowledgeCandidate): readonly string[] => {
  if (candidate.candidateType === 'RELATION' || candidate.candidateType === 'EVENT') {
    return candidate.temporalEvidenceIds ?? [];
  }
  if (candidate.candidateType === 'ACTION') return candidate.temporalEvidenceIds ?? [];
  return [];
};

const references = (candidate: KnowledgeCandidate): readonly string[] => {
  switch (candidate.candidateType) {
    case 'RELATION':
      return [candidate.fromCandidateId, candidate.toCandidateId];
    case 'EVENT':
      return candidate.participantCandidateIds;
    case 'DECISION':
    case 'ACTION':
      return candidate.actorCandidateId ? [candidate.actorCandidateId] : [];
    case 'CONFLICT':
      return candidate.subjectCandidateIds;
    case 'KNOWLEDGE_GAP':
      return candidate.relatedCandidateIds;
    case 'ENTITY':
      return [];
  }
};

const assertCandidates = (
  items: readonly KnowledgeCandidate[],
  sourceVersionId: string,
  existingApproved: readonly KnowledgeCandidate[],
) => {
  const ids = new Set<string>();
  for (const item of items) {
    assertJsonSchema(candidateSchema, item, item.candidateType);
    if (ids.has(item.candidateId)) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Knowledge Candidate IDs must be unique inside an Atomic Group.',
        module: 'stage9.knowledge-model',
        operation: 'validate-group',
      });
    }
    ids.add(item.candidateId);
    if (item.sourceVersionId !== sourceVersionId) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Every Knowledge Candidate must bind to the staged Source Version.',
        module: 'stage9.knowledge-model',
        operation: 'validate-evidence-binding',
      });
    }
    const evidence = new Set(item.evidenceIds);
    const modelEvidence = item.modelOutputs.flatMap((output) => output.evidenceIds);
    if ([...modelEvidence, ...temporalEvidenceIds(item)].some((id) => !evidence.has(id))) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Model and temporal values must cite Evidence attached to the Candidate.',
        module: 'stage9.knowledge-model',
        operation: 'validate-evidence-binding',
      });
    }
    if (item.candidateType === 'RELATION' && item.fromCandidateId === item.toCandidateId) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'A Typed Relation cannot point to itself.',
        module: 'stage9.knowledge-model',
        operation: 'validate-references',
      });
    }
  }

  const known = new Map(
    [...existingApproved, ...items].map((item) => [item.candidateId, item] as const),
  );
  for (const item of items) {
    for (const reference of references(item)) {
      const target = known.get(reference);
      if (!target) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'Atomic Group contains a dangling Candidate reference.',
          module: 'stage9.knowledge-model',
          operation: 'validate-references',
        });
      }
      if (
        ['RELATION', 'EVENT', 'DECISION', 'ACTION'].includes(item.candidateType) &&
        target.candidateType !== 'ENTITY'
      ) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage:
            'Relation, Event, Decision and Action entity references must target Entities.',
          module: 'stage9.knowledge-model',
          operation: 'validate-references',
        });
      }
    }
  }
};

const verifyEvidence = async (
  context: HandlerContext,
  sourceVersionId: string,
  items: readonly KnowledgeCandidate[],
) => {
  const ids = [...new Set(items.flatMap((item) => item.evidenceIds))].sort();
  const spans = await Promise.all(
    ids.map(
      async (evidenceId) =>
        (
          await context.query<{ evidenceId: string }, EvidenceSpan>({
            messageType: 'GetEvidenceSpan',
            schemaVersion: '1.0.0',
            payload: { evidenceId },
          })
        ).payload,
    ),
  );
  if (spans.some((span) => span.sourceVersionId !== sourceVersionId)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Knowledge Candidate Evidence must come from its Source Version.',
      module: 'stage9.knowledge-model',
      operation: 'verify-evidence',
    });
  }
};

const reentryPhase = (
  kind: NonNullable<KnowledgeReviewDecision['editKind']>,
): KnowledgeReentryPhase =>
  ({
    WORDING_LAYOUT: 'PROJECTION_ONLY',
    FACTUAL_CORRECTION: 'VALIDATION',
    NEW_KNOWLEDGE: 'EVIDENCE',
    REFERENCE_CHANGE: 'COMPARISON_IMPACT',
  })[kind] as KnowledgeReentryPhase;

const exactAtomicSelection = (group: KnowledgeReviewGroup, itemIds: readonly string[]) => {
  const expected = group.items.map((item) => item.candidateId).sort();
  const actual = [...itemIds].sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'An Atomic Group must be approved, held or rejected as one complete unit.',
      module: 'stage9.knowledge-model',
      operation: 'review-atomic-group',
    });
  }
};

const candidateLabel = (candidate: KnowledgeCandidate): string => {
  switch (candidate.candidateType) {
    case 'ENTITY':
      return candidate.name;
    case 'RELATION':
      return candidate.relationType;
    case 'EVENT':
      return candidate.title;
    case 'DECISION':
      return candidate.decisionText;
    case 'ACTION':
      return candidate.actionText;
    case 'CONFLICT':
      return candidate.summary;
    case 'KNOWLEDGE_GAP':
      return candidate.question;
  }
};

const impactFrom = (
  rootCandidateId: string,
  items: readonly KnowledgeCandidate[],
  maxDepth: number,
  maxNodes: number,
): KnowledgeImpactResult => {
  const entities = new Set(items.map((item) => item.candidateId));
  if (!entities.has(rootCandidateId)) {
    throw new ShotgunError({
      code: 'NOT_FOUND',
      safeMessage: 'The Impact root Candidate was not found in approved knowledge.',
      module: 'stage9.knowledge-model',
      operation: 'impact',
    });
  }
  const relations = items
    .filter(
      (item): item is Extract<KnowledgeCandidate, { candidateType: 'RELATION' }> =>
        item.candidateType === 'RELATION',
    )
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const adjacency = new Map<string, { edgeId: string; nodeId: string }[]>();
  const add = (from: string, edgeId: string, nodeId: string) => {
    const values = adjacency.get(from) ?? [];
    values.push({ edgeId, nodeId });
    adjacency.set(from, values);
  };
  relations.forEach((relation) => {
    add(relation.fromCandidateId, relation.candidateId, relation.toCandidateId);
    if (relation.direction === 'UNDIRECTED') {
      add(relation.toCandidateId, relation.candidateId, relation.fromCandidateId);
    }
  });
  adjacency.forEach((values) =>
    values.sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId) || left.edgeId.localeCompare(right.edgeId),
    ),
  );

  const visited = new Set([rootCandidateId]);
  const traversed = new Set<string>();
  const paths: KnowledgeImpactResult['paths'][number][] = [];
  const queue: { nodeId: string; nodeIds: string[]; edgeIds: string[] }[] = [
    { nodeId: rootCandidateId, nodeIds: [rootCandidateId], edgeIds: [] },
  ];
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.edgeIds.length >= maxDepth) {
      if ((adjacency.get(current.nodeId)?.length ?? 0) > 0) truncated = true;
      continue;
    }
    for (const next of adjacency.get(current.nodeId) ?? []) {
      if (visited.has(next.nodeId)) continue;
      if (visited.size >= maxNodes) {
        truncated = true;
        break;
      }
      visited.add(next.nodeId);
      traversed.add(next.edgeId);
      const nodeIds = [...current.nodeIds, next.nodeId];
      const edgeIds = [...current.edgeIds, next.edgeId];
      paths.push({ nodeIds, edgeIds, depth: edgeIds.length });
      queue.push({ nodeId: next.nodeId, nodeIds, edgeIds });
    }
    if (visited.size >= maxNodes && queue.length > 0) truncated = true;
  }
  return {
    rootCandidateId,
    paths,
    visitedNodeIds: [...visited],
    traversedEdgeIds: [...traversed],
    truncated,
    cycleSafe: true,
    source: 'APPROVED_TYPED_EDGES',
  };
};

export const createKnowledgeModelModule = (
  repository: KnowledgeModelRepositoryPort,
  clock: ClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage9.knowledge-model',
    version: '1.0.0',
    owner: 'Shotgun Rich Knowledge Review',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'StageKnowledgeGroup', range: '>=1.0.0 <2.0.0' },
        { name: 'ReviewKnowledgeGroup', range: '>=1.0.0 <2.0.0' },
        { name: 'GetKnowledgeGroup', range: '>=1.0.0 <2.0.0' },
        { name: 'ListKnowledgeGroups', range: '>=1.0.0 <2.0.0' },
        { name: 'GetKnowledgeImpact', range: '>=1.0.0 <2.0.0' },
        { name: 'GetKnowledgeGraph', range: '>=1.0.0 <2.0.0' },
        { name: 'StageEntityVaultImport', range: '>=1.0.0 <2.0.0' },
        { name: 'ReviewEntityVaultImport', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEntityVaultImport', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['knowledge.review_groups', 'knowledge.review_items', 'knowledge.entity_vault_imports'],
      readsViaPorts: ['GetEvidenceSpan query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [
        { name: 'StageKnowledgeGroup', range: '>=1.0.0 <2.0.0' },
        { name: 'ReviewKnowledgeGroup', range: '>=1.0.0 <2.0.0' },
        { name: 'StageEntityVaultImport', range: '>=1.0.0 <2.0.0' },
        { name: 'ReviewEntityVaultImport', range: '>=1.0.0 <2.0.0' },
      ],
      events: [],
    },
    produces: { events: [] },
    provides: {
      queries: [
        { name: 'GetKnowledgeGroup', range: '>=1.0.0 <2.0.0' },
        { name: 'ListKnowledgeGroups', range: '>=1.0.0 <2.0.0' },
        { name: 'GetKnowledgeImpact', range: '>=1.0.0 <2.0.0' },
        { name: 'GetKnowledgeGraph', range: '>=1.0.0 <2.0.0' },
        { name: 'GetEntityVaultImport', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'rich-knowledge-review-provider', priority: 100 }],
    },
    requires: { capabilities: ['evidence-resolver'] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'StageKnowledgeGroup',
      version: '1.0.0',
      kind: 'command',
      inputSchema: stageGroupSchema,
    },
    {
      name: 'ReviewKnowledgeGroup',
      version: '1.0.0',
      kind: 'command',
      inputSchema: reviewGroupSchema,
    },
    {
      name: 'GetKnowledgeGroup',
      version: '1.0.0',
      kind: 'query',
      inputSchema: idQuerySchema('groupId'),
    },
    { name: 'ListKnowledgeGroups', version: '1.0.0', kind: 'query', inputSchema: listGroupsSchema },
    { name: 'GetKnowledgeImpact', version: '1.0.0', kind: 'query', inputSchema: impactQuerySchema },
    { name: 'GetKnowledgeGraph', version: '1.0.0', kind: 'query', inputSchema: graphQuerySchema },
    {
      name: 'StageEntityVaultImport',
      version: '1.0.0',
      kind: 'command',
      inputSchema: stageVaultSchema,
    },
    {
      name: 'ReviewEntityVaultImport',
      version: '1.0.0',
      kind: 'command',
      inputSchema: reviewVaultSchema,
    },
    {
      name: 'GetEntityVaultImport',
      version: '1.0.0',
      kind: 'query',
      inputSchema: idQuerySchema('importId'),
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'StageKnowledgeGroup',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const payload = envelope.payload as {
            groupId: string;
            sourceVersionId: string;
            items: readonly KnowledgeCandidate[];
          };
          const { projectId, security } = assertContext(envelope);
          const approved = await accessibleApprovedItems(
            repository,
            projectId,
            security.accessScope,
          );
          assertCandidates(payload.items, payload.sourceVersionId, approved);
          await verifyEvidence(context, payload.sourceVersionId, payload.items);
          const now = clock.now();
          return repository.saveGroup({
            groupId: payload.groupId,
            projectId,
            sourceVersionId: payload.sourceVersionId,
            revisionNumber: 1,
            status: 'PENDING_REVIEW',
            contentDigest: knowledgeCandidateDigest(payload.items),
            items: payload.items,
            decisions: [],
            accessScope: security.accessScope,
            sensitivity: security.sensitivity,
            createdAt: now,
            updatedAt: now,
          });
        },
      },
      {
        messageType: 'ReviewKnowledgeGroup',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const payload = envelope.payload as {
            decisionId: string;
            groupId: string;
            expectedRevisionNumber: number;
            expectedContentDigest: string;
            decision: KnowledgeReviewDecision['decision'];
            reason: string;
            itemIds: readonly string[];
            editKind?: NonNullable<KnowledgeReviewDecision['editKind']>;
          };
          const { projectId, actor, security } = assertContext(envelope);
          if (actor.type !== 'user') {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'Knowledge review decisions require a user actor.',
              module: 'stage9.knowledge-model',
              operation: 'review-group',
              correlationId: envelope.correlationId,
            });
          }
          const group = await repository.findGroup(projectId, payload.groupId);
          if (!group) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Knowledge Review Group was not found.',
              module: 'stage9.knowledge-model',
              operation: 'review-group',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(group, security.accessScope, envelope.correlationId);
          exactAtomicSelection(group, payload.itemIds);
          if (group.decisions.some((decision) => decision.decisionId === payload.decisionId)) {
            return group;
          }
          if (!['PENDING_REVIEW', 'ON_HOLD'].includes(group.status)) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The Knowledge Review Group already has a final decision.',
              module: 'stage9.knowledge-model',
              operation: 'review-group',
              correlationId: envelope.correlationId,
            });
          }
          const decidedAt = clock.now();
          const phase = payload.editKind ? reentryPhase(payload.editKind) : undefined;
          const decision: KnowledgeReviewDecision = {
            decisionId: payload.decisionId,
            decision: payload.decision,
            reason: payload.reason,
            actor,
            itemIds: payload.itemIds,
            decidedAt,
            ...(payload.editKind ? { editKind: payload.editKind } : {}),
            ...(phase ? { reentryPhase: phase } : {}),
          };
          const status =
            payload.decision === 'APPROVE'
              ? 'APPROVED'
              : payload.decision === 'HOLD'
                ? 'ON_HOLD'
                : payload.decision === 'REJECT'
                  ? 'REJECTED'
                  : 'EDIT_REENTRY';
          return repository.reviewGroup({
            projectId,
            groupId: group.groupId,
            expectedRevisionNumber: payload.expectedRevisionNumber,
            expectedContentDigest: payload.expectedContentDigest,
            updated: {
              ...group,
              status,
              decisions: [...group.decisions, decision],
              updatedAt: decidedAt,
            },
          });
        },
      },
      {
        messageType: 'StageEntityVaultImport',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const payload = envelope.payload as {
            importId: string;
            sourceVersionId: string;
            entities: readonly EntityCandidate[];
          };
          const { projectId } = assertContext(envelope);
          if (payload.entities.some((item) => item.candidateType !== 'ENTITY')) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Entity Vault staging accepts Entity Candidates only.',
              module: 'stage9.knowledge-model',
              operation: 'stage-entity-vault',
            });
          }
          assertCandidates(payload.entities, payload.sourceVersionId, []);
          await verifyEvidence(context, payload.sourceVersionId, payload.entities);
          const now = clock.now();
          return repository.saveEntityVaultImport({
            importId: payload.importId,
            projectId,
            sourceVersionId: payload.sourceVersionId,
            status: 'PENDING_APPROVAL',
            contentDigest: entityVaultImportDigest(payload.sourceVersionId, payload.entities),
            entityCount: payload.entities.length,
            entities: payload.entities,
            canonicalWrite: false,
            nextAction: 'REVIEW_AND_STAGE_KNOWLEDGE_GROUP',
            createdAt: now,
            updatedAt: now,
          });
        },
      },
      {
        messageType: 'ReviewEntityVaultImport',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const payload = envelope.payload as {
            importId: string;
            expectedContentDigest: string;
            decision: 'APPROVE' | 'REJECT';
          };
          const { projectId, actor } = assertContext(envelope);
          if (actor.type !== 'user') {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'Entity Vault review requires a user actor.',
              module: 'stage9.knowledge-model',
              operation: 'review-entity-vault',
              correlationId: envelope.correlationId,
            });
          }
          const value = await repository.findEntityVaultImport(projectId, payload.importId);
          if (!value) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The staged Entity Vault import was not found.',
              module: 'stage9.knowledge-model',
              operation: 'review-entity-vault',
            });
          }
          const now = clock.now();
          return repository.reviewEntityVaultImport({
            projectId,
            importId: payload.importId,
            expectedContentDigest: payload.expectedContentDigest,
            updated: {
              ...value,
              status: payload.decision === 'APPROVE' ? 'APPROVED_FOR_REVIEW' : 'REJECTED',
              canonicalWrite: false,
              updatedAt: now,
              ...(payload.decision === 'APPROVE' ? { approvedBy: actor.id } : {}),
            },
          });
        },
      },
    ],
    events: [],
    queries: [
      {
        messageType: 'GetKnowledgeGroup',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const group = await repository.findGroup(
            projectId,
            (envelope.payload as { groupId: string }).groupId,
          );
          if (!group) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Knowledge Review Group was not found.',
              module: 'stage9.knowledge-model',
              operation: 'get-group',
            });
          }
          assertScope(group, security.accessScope, envelope.correlationId);
          return {
            group,
            modelDisagreements: group.items.map(modelDisagreementView),
          };
        },
      },
      {
        messageType: 'ListKnowledgeGroups',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const items = (await repository.listGroups(projectId)).filter((group) => {
            const actual = new Set(security.accessScope);
            return group.accessScope.every((scope) => actual.has(scope));
          });
          return { items };
        },
      },
      {
        messageType: 'GetKnowledgeImpact',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as {
            rootCandidateId: string;
            maxDepth?: number;
            maxNodes?: number;
          };
          return impactFrom(
            payload.rootCandidateId,
            await accessibleApprovedItems(repository, projectId, security.accessScope),
            payload.maxDepth ?? 5,
            payload.maxNodes ?? 100,
          );
        },
      },
      {
        messageType: 'GetKnowledgeGraph',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope): Promise<KnowledgeGraphView> {
          const { projectId, security } = assertContext(envelope);
          const items = [
            ...(await accessibleApprovedItems(repository, projectId, security.accessScope)),
          ];
          const relations = items.filter(
            (item): item is Extract<KnowledgeCandidate, { candidateType: 'RELATION' }> =>
              item.candidateType === 'RELATION',
          );
          const visibleNodes = items.filter((item) => item.candidateType !== 'RELATION');
          return {
            nodes: visibleNodes.map((item) => ({
              id: item.candidateId,
              type: item.candidateType,
              label: candidateLabel(item),
              modelDisagreement: modelDisagreementView(item).present,
            })),
            edges: relations.map((item) => ({
              id: item.candidateId,
              from: item.fromCandidateId,
              to: item.toCandidateId,
              relationType: item.relationType,
              direction: item.direction,
            })),
            tableRows: items.map((item) => ({
              id: item.candidateId,
              type: item.candidateType,
              label: candidateLabel(item),
              evidenceCount: item.evidenceIds.length,
              modelDisagreement: modelDisagreementView(item).present,
            })),
            fallback: { available: true, modes: ['LIST', 'TABLE'] },
          };
        },
      },
      {
        messageType: 'GetEntityVaultImport',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const value = await repository.findEntityVaultImport(
            projectId,
            (envelope.payload as { importId: string }).importId,
          );
          if (!value) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The staged Entity Vault import was not found.',
              module: 'stage9.knowledge-model',
              operation: 'get-entity-vault-import',
            });
          }
          return value;
        },
      },
    ],
  },
});

export const newKnowledgeId = (prefix: string): string => `${prefix}:${randomUUID()}`;
