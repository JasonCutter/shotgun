import type {
  CanonicalClaim,
  CanonicalSnapshot,
  CompiledTruthEdge,
  CompiledTruthItem,
  CompiledTruthProjection,
  CompiledTruthProjectionStatus,
  DerivedInferenceCandidate,
  DiscoveryRunResult,
  KnowledgeCandidate,
  KnowledgeReviewGroup,
  ProjectionBuildMode,
  ProjectionTemporalState,
  CommandEnvelope,
  QueryEnvelope,
} from '../../../packages/contracts/src/index.js';
import {
  compiledTruthLogicalDigest,
  decodeGetCompiledTruthReadSnapshotRequest,
  decodeGetCompiledTruthReadSnapshotResult,
  discoveryFingerprint,
  GET_COMPILED_TRUTH_READ_SNAPSHOT,
  sha256Text,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import getCompiledTruthReadSnapshotSchema from '../../../packages/contracts/schemas/get-compiled-truth-read-snapshot.v1.schema.json';
import getCompiledTruthReadSnapshotOutputSchema from '../../../packages/contracts/schemas/get-compiled-truth-read-snapshot-output.v1.schema.json';
import { hasSensitivityClearance } from '../../../packages/authentication/src/index.js';
import type { HandlerContext, ShotgunModule } from '../../../packages/module-sdk/src/index.js';
import type { GetCompiledTruthReadSnapshotResult } from '../../../packages/contracts/src/index.js';

export const COMPILED_TRUTH_PROJECTOR_VERSION = '1.0.0';
const COMPILED_TRUTH_BUILD_FAILED = 'COMPILED_TRUTH_BUILD_FAILED';

type ClockPort = { now(): string };
const systemClock: ClockPort = { now: () => new Date().toISOString() };

export type CompiledTruthRepositoryPort = {
  synchronize(projection: CompiledTruthProjection): Promise<CompiledTruthProjection>;
  findProjection(projectId: string): Promise<CompiledTruthProjection | undefined>;
  markDegraded(projectId: string, error: string, updatedAt: string): Promise<void>;
  degradedState(projectId: string): Promise<{ error: string; updatedAt: string } | undefined>;
  saveInferences(
    projectId: string,
    candidates: readonly DerivedInferenceCandidate[],
  ): Promise<{
    accepted: readonly DerivedInferenceCandidate[];
    suppressedFingerprints: readonly string[];
  }>;
  listInferences(projectId: string): Promise<readonly DerivedInferenceCandidate[]>;
};

const buildSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: { mode: { enum: ['FULL_REBUILD', 'INCREMENTAL'] } },
};

const discoverySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'maxNodes', 'maxSuggestions'],
  properties: {
    mode: { enum: ['INCREMENTAL', 'WEEKLY'] },
    maxNodes: { type: 'integer', minimum: 1, maximum: 1000 },
    maxSuggestions: { type: 'integer', minimum: 1, maximum: 100 },
  },
};

const emptySchema = { type: 'object', additionalProperties: false, properties: {} };
const derivedInferenceEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'candidateId',
    'fingerprint',
    'status',
    'candidateType',
    'question',
    'relatedNodeIds',
    'evidenceIds',
    'sourceProjectionDigest',
    'reentryPhase',
    'createdAt',
  ],
  properties: {
    candidateId: { type: 'string', minLength: 1 },
    fingerprint: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    status: { const: 'DERIVED_INFERENCE' },
    candidateType: { const: 'KNOWLEDGE_GAP' },
    question: { type: 'string', minLength: 1 },
    relatedNodeIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    evidenceIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    sourceProjectionDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    reentryPhase: { const: 'VALIDATION' },
    createdAt: { type: 'string', minLength: 1 },
  },
};

const assertContext = (envelope: CommandEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Compiled Truth access requires complete security context.',
      module: 'stage10.compiled-truth',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    accessScope: envelope.security.accessScope,
    sensitivity: envelope.security.sensitivity,
  };
};

const candidateLabel = (candidate: KnowledgeCandidate): string => {
  switch (candidate.candidateType) {
    case 'ENTITY':
      return candidate.name;
    case 'RELATION':
      return `${candidate.fromCandidateId} ${candidate.relationType} ${candidate.toCandidateId}`;
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

const temporalState = (candidate: KnowledgeCandidate, asOf: string): ProjectionTemporalState => {
  if (candidate.candidateType === 'CONFLICT') return 'CONFLICT';
  if (candidate.candidateType === 'EVENT' && candidate.occurredAt) {
    return candidate.occurredAt > asOf ? 'FUTURE' : 'PAST';
  }
  if (candidate.candidateType === 'ACTION' && candidate.dueAt) {
    return candidate.dueAt > asOf ? 'FUTURE' : 'CURRENT';
  }
  if (candidate.candidateType === 'RELATION') {
    if (candidate.validFrom && candidate.validFrom > asOf) return 'FUTURE';
    if (candidate.validTo && candidate.validTo < asOf) return 'PAST';
  }
  return 'CURRENT';
};

const sourceSnapshot = async (context: HandlerContext) => {
  const canonical = (
    await context.query<Record<string, never>, CanonicalSnapshot>({
      messageType: 'GetCanonicalSnapshot',
      schemaVersion: '1.0.0',
      payload: {},
    })
  ).payload;
  const groups = (
    await context.query<Record<string, never>, { items: readonly KnowledgeReviewGroup[] }>({
      messageType: 'ListKnowledgeGroups',
      schemaVersion: '1.0.0',
      payload: {},
    })
  ).payload.items
    .filter((group) => group.status === 'APPROVED')
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
  const claims = await Promise.all(
    canonical.claims.map(
      async ({ claimId }) =>
        (
          await context.query<{ claimId: string }, CanonicalClaim>({
            messageType: 'GetCanonicalClaim',
            schemaVersion: '1.0.0',
            payload: { claimId },
          })
        ).payload,
    ),
  );
  const effectiveAt = [
    '1970-01-01T00:00:00.000Z',
    ...claims.map((claim) => claim.createdAt),
    ...groups.map((group) => group.updatedAt),
  ]
    .sort()
    .at(-1)!;
  const claimItems: CompiledTruthItem[] = claims.map((claim) => ({
    id: claim.claimId,
    type: 'CLAIM',
    label: claim.claimText,
    state: 'CURRENT',
    source: 'CANONICAL_CLAIM',
    evidenceIds: [...claim.evidenceIds].sort(),
    accessScope: [...claim.accessScope].sort(),
    sensitivity: claim.sensitivity,
  }));
  const candidateItems: CompiledTruthItem[] = groups.flatMap((group) =>
    group.items.map((candidate) => ({
      id: candidate.candidateId,
      type: candidate.candidateType,
      label: candidateLabel(candidate),
      state: temporalState(candidate, effectiveAt),
      source: 'APPROVED_KNOWLEDGE' as const,
      evidenceIds: [...candidate.evidenceIds].sort(),
      accessScope: [...group.accessScope].sort(),
      sensitivity: group.sensitivity,
    })),
  );
  const items = [...claimItems, ...candidateItems].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const edges: CompiledTruthEdge[] = groups
    .flatMap((group) => group.items)
    .filter(
      (candidate): candidate is Extract<KnowledgeCandidate, { candidateType: 'RELATION' }> =>
        candidate.candidateType === 'RELATION',
    )
    .map((candidate) => ({
      id: candidate.candidateId,
      from: candidate.fromCandidateId,
      to: candidate.toCandidateId,
      relationType: candidate.relationType,
      direction: candidate.direction,
      source: 'APPROVED_TYPED_EDGE' as const,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    canonical,
    items,
    edges,
    digest: sha256Text(
      stableJson({
        canonicalDigest: canonical.digest,
        effectiveAt,
        approvedGroups: groups.map((group) => ({
          groupId: group.groupId,
          contentDigest: group.contentDigest,
          revisionNumber: group.revisionNumber,
        })),
      }),
    ),
  };
};

const canAccess = (required: readonly string[], actual: readonly string[]): boolean => {
  const granted = new Set(actual);
  return required.every((scope) => granted.has(scope));
};

const visibleProjection = (
  projection: CompiledTruthProjection,
  accessScope: readonly string[],
  sensitivity: CompiledTruthItem['sensitivity'],
): CompiledTruthProjection => {
  const items = projection.items.filter(
    (item) =>
      canAccess(item.accessScope, accessScope) &&
      hasSensitivityClearance(sensitivity, item.sensitivity),
  );
  const visibleIds = new Set(items.map((item) => item.id));
  const edges = projection.graph.edges.filter(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
  );
  return {
    ...projection,
    items,
    graph: {
      nodes: items.filter((item) => item.type !== 'RELATION'),
      edges,
      fallback: { available: true, modes: ['LIST', 'TABLE'] },
    },
  };
};

const statusFor = async (
  repository: CompiledTruthRepositoryPort,
  projectId: string,
  canonical: CanonicalSnapshot,
  currentSourceDigest: string,
): Promise<CompiledTruthProjectionStatus> => {
  const projection = await repository.findProjection(projectId);
  const degraded = await repository.degradedState(projectId);
  if (degraded) {
    return {
      status: 'DEGRADED',
      projectorVersion: COMPILED_TRUTH_PROJECTOR_VERSION,
      canonicalVersion: canonical.version,
      projectedCanonicalVersion: projection?.canonicalVersion ?? 0,
      lag: Math.max(0, canonical.version - (projection?.canonicalVersion ?? 0)),
      lastError: degraded.error,
      updatedAt: projection?.projectedAt ?? degraded.updatedAt,
      ...(projection === undefined
        ? {}
        : {
            sourceSnapshotDigest: projection.sourceSnapshotDigest,
            logicalDigest: projection.logicalDigest,
            lastBuildMode: projection.buildMode,
          }),
    };
  }
  if (!projection) {
    return {
      status: 'NOT_BUILT',
      projectorVersion: COMPILED_TRUTH_PROJECTOR_VERSION,
      canonicalVersion: canonical.version,
      projectedCanonicalVersion: 0,
      lag: canonical.version,
    };
  }
  const lag = Math.max(0, canonical.version - projection.canonicalVersion);
  const sourceChanged = projection.sourceSnapshotDigest !== currentSourceDigest;
  return {
    status:
      lag === 0 &&
      !sourceChanged &&
      projection.projectorVersion === COMPILED_TRUTH_PROJECTOR_VERSION
        ? 'READY'
        : 'STALE',
    projectorVersion: projection.projectorVersion,
    canonicalVersion: canonical.version,
    projectedCanonicalVersion: projection.canonicalVersion,
    lag,
    sourceSnapshotDigest: projection.sourceSnapshotDigest,
    logicalDigest: projection.logicalDigest,
    lastBuildMode: projection.buildMode,
    updatedAt: projection.projectedAt,
  };
};

export const createCompiledTruthModule = (
  repository: CompiledTruthRepositoryPort,
  clock: ClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage10.compiled-truth',
    version: '1.0.0',
    owner: 'Shotgun Projection and Discovery',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'BuildCompiledTruth', range: '>=1.0.0 <2.0.0' },
        { name: 'RunKnowledgeDiscovery', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCompiledTruth', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCompiledTruthStatus', range: '>=1.0.0 <2.0.0' },
        { name: GET_COMPILED_TRUTH_READ_SNAPSHOT, range: '>=1.0.0 <2.0.0' },
        { name: 'ListDerivedInferences', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['projection.compiled_truth', 'projection.discovery_suppressions'],
      readsViaPorts: ['GetCanonicalSnapshot', 'GetCanonicalClaim', 'ListKnowledgeGroups'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [
        { name: 'BuildCompiledTruth', range: '>=1.0.0 <2.0.0' },
        { name: 'RunKnowledgeDiscovery', range: '>=1.0.0 <2.0.0' },
      ],
      events: [],
    },
    produces: {
      events: [{ name: 'DerivedInferenceReady', range: '>=1.0.0 <2.0.0' }],
    },
    provides: {
      queries: [
        { name: 'GetCompiledTruth', range: '>=1.0.0 <2.0.0' },
        { name: 'GetCompiledTruthStatus', range: '>=1.0.0 <2.0.0' },
        { name: GET_COMPILED_TRUTH_READ_SNAPSHOT, range: '>=1.0.0 <2.0.0' },
        { name: 'ListDerivedInferences', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'compiled-truth-projector', priority: 100 }],
    },
    requires: {
      capabilities: ['canonical-knowledge-provider', 'rich-knowledge-review-provider'],
    },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    { name: 'BuildCompiledTruth', version: '1.0.0', kind: 'command', inputSchema: buildSchema },
    {
      name: 'RunKnowledgeDiscovery',
      version: '1.0.0',
      kind: 'command',
      inputSchema: discoverySchema,
    },
    { name: 'GetCompiledTruth', version: '1.0.0', kind: 'query', inputSchema: emptySchema },
    { name: 'GetCompiledTruthStatus', version: '1.0.0', kind: 'query', inputSchema: emptySchema },
    {
      name: GET_COMPILED_TRUTH_READ_SNAPSHOT,
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCompiledTruthReadSnapshotSchema,
      outputSchema: getCompiledTruthReadSnapshotOutputSchema,
    },
    {
      name: 'ListDerivedInferences',
      version: '1.0.0',
      kind: 'query',
      inputSchema: emptySchema,
    },
    {
      name: 'DerivedInferenceReady',
      version: '1.0.0',
      kind: 'event',
      inputSchema: derivedInferenceEventSchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'BuildCompiledTruth',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const { mode } = envelope.payload as { mode: ProjectionBuildMode };
          const projectedAt = clock.now();
          try {
            const source = await sourceSnapshot(context);
            const projection: CompiledTruthProjection = {
              projectId,
              projectorVersion: COMPILED_TRUTH_PROJECTOR_VERSION,
              sourceSnapshotDigest: source.digest,
              logicalDigest: compiledTruthLogicalDigest(source.items, source.edges),
              canonicalVersion: source.canonical.version,
              items: source.items,
              graph: {
                nodes: source.items.filter((item) => item.type !== 'RELATION'),
                edges: source.edges,
                fallback: { available: true, modes: ['LIST', 'TABLE'] },
              },
              projectedAt,
              buildMode: mode,
            };
            await repository.synchronize(projection);
            return projection;
          } catch (error) {
            await repository.markDegraded(projectId, COMPILED_TRUTH_BUILD_FAILED, projectedAt);
            throw error;
          }
        },
      },
      {
        messageType: 'RunKnowledgeDiscovery',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context): Promise<DiscoveryRunResult> {
          const { projectId, accessScope, sensitivity } = assertContext(envelope);
          const payload = envelope.payload as {
            mode: 'INCREMENTAL' | 'WEEKLY';
            maxNodes: number;
            maxSuggestions: number;
          };
          const source = await sourceSnapshot(context);
          const status = await statusFor(repository, projectId, source.canonical, source.digest);
          if (status.status !== 'READY') {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'Compiled Truth is not ready for Knowledge Discovery.',
              module: 'stage10.compiled-truth',
              operation: 'run-discovery',
            });
          }
          const stored = await repository.findProjection(projectId);
          const projection = visibleProjection(stored!, accessScope, sensitivity);
          const connected = new Set(projection.graph.edges.flatMap((edge) => [edge.from, edge.to]));
          const eligible = projection.graph.nodes
            .filter((node) => node.type === 'ENTITY' && !connected.has(node.id))
            .slice(0, payload.maxNodes);
          const now = clock.now();
          const proposed = eligible.slice(0, payload.maxSuggestions).map((node) => {
            const question = `What approved relationship is missing for ${node.label}?`;
            const fingerprint = discoveryFingerprint([node.id], question);
            return {
              candidateId: `inference:${fingerprint.slice('sha256:'.length, 31)}`,
              fingerprint,
              status: 'DERIVED_INFERENCE' as const,
              candidateType: 'KNOWLEDGE_GAP' as const,
              question,
              relatedNodeIds: [node.id],
              evidenceIds: node.evidenceIds,
              sourceProjectionDigest: projection.logicalDigest,
              reentryPhase: 'VALIDATION' as const,
              createdAt: now,
            };
          });
          const saved = await repository.saveInferences(projectId, proposed);
          for (const candidate of saved.accepted) {
            await context.publish({
              messageType: 'DerivedInferenceReady',
              schemaVersion: '1.0.0',
              idempotencyKey: candidate.fingerprint,
              payload: candidate,
            });
          }
          return {
            mode: payload.mode,
            scannedNodes: eligible.length,
            generated: saved.accepted,
            suppressedFingerprints: saved.suppressedFingerprints,
            budget: { maxNodes: payload.maxNodes, maxSuggestions: payload.maxSuggestions },
          };
        },
      },
    ],
    events: [],
    queries: [
      {
        messageType: 'GetCompiledTruth',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId, accessScope, sensitivity } = assertContext(envelope);
          const source = await sourceSnapshot(context);
          const status = await statusFor(repository, projectId, source.canonical, source.digest);
          if (status.status !== 'READY') {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'Compiled Truth is not ready.',
              module: 'stage10.compiled-truth',
              operation: 'get-compiled-truth',
            });
          }
          const projection = await repository.findProjection(projectId);
          return visibleProjection(projection!, accessScope, sensitivity);
        },
      },
      {
        messageType: GET_COMPILED_TRUTH_READ_SNAPSHOT,
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context): Promise<GetCompiledTruthReadSnapshotResult> {
          const { projectId, accessScope, sensitivity } = assertContext(envelope);
          decodeGetCompiledTruthReadSnapshotRequest(envelope.payload);
          const source = await sourceSnapshot(context);
          const status = await statusFor(repository, projectId, source.canonical, source.digest);
          const stored =
            status.status === 'NOT_BUILT' ? undefined : await repository.findProjection(projectId);
          if (status.status === 'READY' && !stored) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'Compiled Truth is not ready.',
              module: 'stage10.compiled-truth',
              operation: GET_COMPILED_TRUTH_READ_SNAPSHOT,
            });
          }
          const projection = stored
            ? visibleProjection(stored, accessScope, sensitivity)
            : undefined;
          return decodeGetCompiledTruthReadSnapshotResult({
            schemaVersion: '1.0.0',
            projectId,
            status,
            ...(projection === undefined ? {} : { projection }),
          });
        },
      },
      {
        messageType: 'GetCompiledTruthStatus',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const source = await sourceSnapshot(context);
          return statusFor(repository, projectId, source.canonical, source.digest);
        },
      },
      {
        messageType: 'ListDerivedInferences',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          return { items: await repository.listInferences(projectId) };
        },
      },
    ],
  },
});
