import { randomUUID } from 'node:crypto';

import {
  ShotgunError,
  typedPropositionConflictAssertionIdentity,
  typedPropositionConflictRuleMatches,
  typedPropositionConflictRuleSemanticKey,
  type DiscoveryCanonicalBaseIdentityV1,
  type DiscoveryProjectionBaseIdentityV1,
  type DiscoveryResourceRefV1,
  type DiscoveryServerSecurityInputV1,
  type KnowledgeReviewGroup,
  type RelationCandidate,
  type TypedPropositionConflictAssertionV1,
  type TypedPropositionConflictDirectionSemanticsV1,
  type TypedPropositionConflictRuleCommandPayloadV1,
  type TypedPropositionConflictRuleV1,
  type TypedPropositionConflictRuleViewV1,
} from '../../../packages/contracts/src/index.js';
import {
  semanticStableJson,
  utf16OrdinalCompare,
} from '../../../packages/contracts/src/semantic-representation.js';
import type { KnowledgeModelRepositoryPort } from './index.js';

export type TypedPropositionConflictRuleRepositoryPort = {
  listRuleRevisions(projectId: string): Promise<readonly TypedPropositionConflictRuleV1[]>;
  findRule(
    projectId: string,
    ruleId: string,
    revision?: number,
  ): Promise<TypedPropositionConflictRuleV1 | undefined>;
  saveRule(rule: TypedPropositionConflictRuleV1): Promise<TypedPropositionConflictRuleV1>;
  supersedeRule(
    projectId: string,
    ruleId: string,
    expectedRevision: number,
    supersededBy: { readonly ruleId: string; readonly ruleRevision: number },
  ): Promise<void>;
  retireRule(
    projectId: string,
    ruleId: string,
    expectedRevision: number,
    retiredAt: string,
  ): Promise<void>;
  transaction?<T>(
    action: (handle: TypedPropositionConflictRuleTransactionHandleV1) => Promise<T>,
  ): Promise<T>;
};

export type TypedPropositionConflictRuleTransactionHandleV1 = {
  readonly repository: TypedPropositionConflictRuleRepositoryPort;
  readonly rawTransaction: unknown;
  afterCommit(action: () => void): void;
};

export type TypedPropositionConflictAssertionRepositoryPort = {
  findByIdentity(
    projectId: string,
    identityKey: string,
  ): Promise<TypedPropositionConflictAssertionV1 | undefined>;
  listActiveAssertions(projectId: string): Promise<readonly TypedPropositionConflictAssertionV1[]>;
  saveAssertion(
    assertion: TypedPropositionConflictAssertionV1,
  ): Promise<TypedPropositionConflictAssertionV1>;
  supersedeAssertion(
    projectId: string,
    assertionId: string,
    expectedRevision: number,
  ): Promise<void>;
};

export type ApprovedRelationAuthorityV1 = {
  readonly relation: RelationCandidate;
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: DiscoveryServerSecurityInputV1['sensitivity'];
};

export type TypedPropositionConflictAuthorityReaderPort = {
  listApprovedRelationAuthorities(projectId: string): Promise<{
    readonly relations: readonly ApprovedRelationAuthorityV1[];
    readonly completeness: 'COMPLETE' | 'TRUNCATED';
  }>;
};

const sensitivityRank: Record<DiscoveryServerSecurityInputV1['sensitivity'], number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

const projectError = (message: string): never => {
  throw new ShotgunError({
    code: 'PROJECT_ACCESS_DENIED',
    safeMessage: message,
    module: 'stage9.knowledge-model',
    operation: 'typed-proposition-conflict',
  });
};

const staleError = (message: string): never => {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: message,
    module: 'stage9.knowledge-model',
    operation: 'typed-proposition-conflict',
  });
};

const conflictError = (message: string): never => {
  throw new ShotgunError({
    code: 'CONFLICT',
    safeMessage: message,
    module: 'stage9.knowledge-model',
    operation: 'typed-proposition-conflict',
  });
};

const requireText = (value: string | undefined, field: string): string => {
  if (!value || value.trim().length === 0) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: `${field} is required.`,
      module: 'stage9.knowledge-model',
      operation: 'typed-proposition-conflict',
    });
  }
  return value;
};

const normalizeRuleDefinition = (input: {
  readonly leftRelationType: string;
  readonly rightRelationType: string;
  readonly directionSemantics: TypedPropositionConflictDirectionSemanticsV1;
}) => {
  const [leftRelationType, rightRelationType] =
    utf16OrdinalCompare(input.leftRelationType, input.rightRelationType) <= 0
      ? [input.leftRelationType, input.rightRelationType]
      : [input.rightRelationType, input.leftRelationType];
  return { leftRelationType, rightRelationType, directionSemantics: input.directionSemantics };
};

const compareRelationParticipants = (left: RelationCandidate, right: RelationCandidate): number =>
  utf16OrdinalCompare(left.candidateId, right.candidateId) ||
  left.revisionNumber - right.revisionNumber ||
  utf16OrdinalCompare(left.sourceVersionId, right.sourceVersionId);

const assertionContentKey = (assertion: TypedPropositionConflictAssertionV1): string => {
  return semanticStableJson({
    ...assertion,
    assertionRevision: undefined,
    status: undefined,
    createdAt: undefined,
    supersededAt: undefined,
    retiredAt: undefined,
    provenance: { ...assertion.provenance, createdAt: undefined },
  });
};

export class TypedPropositionConflictRuleService {
  public constructor(private readonly repository: TypedPropositionConflictRuleRepositoryPort) {}

  public async listViews(
    projectId: string,
  ): Promise<readonly TypedPropositionConflictRuleViewV1[]> {
    requireText(projectId, 'projectId');
    const revisions = await this.repository.listRuleRevisions(projectId);
    const byRule = new Map<string, TypedPropositionConflictRuleV1[]>();
    for (const rule of revisions)
      byRule.set(rule.ruleId, [...(byRule.get(rule.ruleId) ?? []), rule]);
    return [...byRule.values()]
      .map((history) => {
        const sorted = [...history].sort((a, b) => b.ruleRevision - a.ruleRevision);
        const latest = sorted[0]!;
        const active = sorted.find((entry) => entry.status === 'ACTIVE');
        const retired = sorted.find((entry) => entry.status === 'RETIRED');
        const supersededBy = latest.supersedes;
        return {
          schemaVersion: latest.schemaVersion,
          ruleId: latest.ruleId,
          ruleRevision: latest.ruleRevision,
          leftRelationType: latest.leftRelationType,
          rightRelationType: latest.rightRelationType,
          directionSemantics: latest.directionSemantics,
          status: latest.status,
          createdAt: latest.createdAt,
          lifecycle: {
            currentRevision: latest.ruleRevision,
            ...(active ? { activeRevision: active.ruleRevision } : {}),
            ...(retired?.retiredAt ? { retiredAt: retired.retiredAt } : {}),
            ...(supersededBy ? { supersededBy } : {}),
          },
        } satisfies TypedPropositionConflictRuleViewV1;
      })
      .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  }

  public async execute(
    input: {
      readonly projectId: string;
      readonly actorId: string;
      readonly payload: TypedPropositionConflictRuleCommandPayloadV1;
      readonly now: string;
    },
    repository: TypedPropositionConflictRuleRepositoryPort = this.repository,
  ): Promise<TypedPropositionConflictRuleV1> {
    requireText(input.projectId, 'projectId');
    requireText(input.actorId, 'actorId');
    if (input.payload.operation === 'CREATE') {
      const left = requireText(input.payload.leftRelationType, 'leftRelationType');
      const right = requireText(input.payload.rightRelationType, 'rightRelationType');
      const direction = input.payload.directionSemantics;
      if (!direction) return conflictError('directionSemantics is required.');
      const definition = normalizeRuleDefinition({
        leftRelationType: left,
        rightRelationType: right,
        directionSemantics: direction,
      });
      const semanticKey = typedPropositionConflictRuleSemanticKey({
        projectId: input.projectId,
        ...definition,
      });
      const duplicate = (await repository.listRuleRevisions(input.projectId)).find(
        (rule) => rule.semanticKey === semanticKey && rule.status === 'ACTIVE',
      );
      if (duplicate) return conflictError('An equivalent active conflict rule already exists.');
      const rule: TypedPropositionConflictRuleV1 = {
        schemaVersion: '1.0.0',
        ruleId: `typed-proposition-conflict-rule:${randomUUID()}`,
        ruleRevision: 1,
        projectId: input.projectId,
        ...definition,
        participantBinding: 'SAME_EXACT_ENDPOINT_PAIR',
        kind: 'FACTUAL',
        source: 'TYPED_PROPOSITION',
        status: 'ACTIVE',
        approval: {
          authority: 'USER_APPROVAL',
          actor: { type: 'user', id: input.actorId },
          approvedAt: input.now,
        },
        provenance: {
          authority: 'USER_DIRECTIVE',
          actor: { type: 'user', id: input.actorId },
          createdAt: input.now,
        },
        semanticKey,
        createdAt: input.now,
      };
      return repository.saveRule(rule);
    }

    const ruleId = requireText(input.payload.ruleId, 'ruleId');
    const expectedRevision = input.payload.expectedRuleRevision;
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      return staleError('expectedRuleRevision is required.');
    }
    const current = await repository.findRule(input.projectId, ruleId);
    if (!current || current.ruleRevision !== expectedRevision) {
      return staleError('The conflict rule changed before this command was applied.');
    }
    if (input.payload.operation === 'RETIRE') {
      if (current.status !== 'ACTIVE')
        return conflictError('Only an active conflict rule can be retired.');
      await repository.retireRule(input.projectId, ruleId, expectedRevision, input.now);
      return { ...current, status: 'RETIRED', retiredAt: input.now };
    }
    if (current.status !== 'ACTIVE')
      return conflictError('Only an active conflict rule can be revised.');
    const left = requireText(input.payload.leftRelationType, 'leftRelationType');
    const right = requireText(input.payload.rightRelationType, 'rightRelationType');
    const direction = input.payload.directionSemantics;
    if (!direction) return conflictError('directionSemantics is required.');
    const definition = normalizeRuleDefinition({
      leftRelationType: left,
      rightRelationType: right,
      directionSemantics: direction,
    });
    const semanticKey = typedPropositionConflictRuleSemanticKey({
      projectId: input.projectId,
      ...definition,
    });
    const duplicate = (await repository.listRuleRevisions(input.projectId)).find(
      (rule) =>
        rule.semanticKey === semanticKey && rule.status === 'ACTIVE' && rule.ruleId !== ruleId,
    );
    if (duplicate) return conflictError('An equivalent active conflict rule already exists.');
    const next: TypedPropositionConflictRuleV1 = {
      ...current,
      ...definition,
      ruleRevision: current.ruleRevision + 1,
      status: 'ACTIVE',
      approval: {
        authority: 'USER_APPROVAL',
        actor: { type: 'user', id: input.actorId },
        approvedAt: input.now,
      },
      provenance: {
        authority: 'USER_DIRECTIVE',
        actor: { type: 'user', id: input.actorId },
        createdAt: input.now,
      },
      semanticKey,
      createdAt: input.now,
      supersedes: { ruleId: current.ruleId, ruleRevision: current.ruleRevision },
    };
    // Migration 058 enforces one ACTIVE row per semantic key. When a revision
    // keeps the same semantic key, close the old row before inserting the new
    // row; both statements still run inside the caller's transaction, so a
    // failure cannot expose the intermediate state. A semantic change can use
    // the ordinary successor-first order and is covered by rollback tests.
    if (current.semanticKey === semanticKey) {
      await repository.supersedeRule(input.projectId, current.ruleId, current.ruleRevision, {
        ruleId: next.ruleId,
        ruleRevision: next.ruleRevision,
      });
      return repository.saveRule(next);
    }
    const saved = await repository.saveRule(next);
    await repository.supersedeRule(input.projectId, current.ruleId, current.ruleRevision, {
      ruleId: saved.ruleId,
      ruleRevision: saved.ruleRevision,
    });
    return saved;
  }
}

export const currentApprovedRelationAuthorities = (
  groups: readonly KnowledgeReviewGroup[],
  projectId: string,
): {
  readonly relations: readonly ApprovedRelationAuthorityV1[];
  readonly completeness: 'COMPLETE' | 'TRUNCATED';
} => {
  const byCandidate = new Map<string, ApprovedRelationAuthorityV1[]>();
  for (const group of groups) {
    if (group.projectId !== projectId || group.status !== 'APPROVED') continue;
    for (const candidate of group.items) {
      if (candidate.candidateType !== 'RELATION') continue;
      const authority: ApprovedRelationAuthorityV1 = {
        relation: candidate,
        projectId,
        accessScope: group.accessScope,
        sensitivity: group.sensitivity,
      };
      byCandidate.set(candidate.candidateId, [
        ...(byCandidate.get(candidate.candidateId) ?? []),
        authority,
      ]);
    }
  }
  const relations: ApprovedRelationAuthorityV1[] = [];
  let complete = true;
  for (const entries of byCandidate.values()) {
    const first = entries[0]!;
    const sameAuthority = entries.every(
      (entry) =>
        JSON.stringify(entry.relation) === JSON.stringify(first.relation) &&
        entry.sensitivity === first.sensitivity &&
        [...entry.accessScope].sort().join('\u0000') ===
          [...first.accessScope].sort().join('\u0000'),
    );
    if (!sameAuthority) {
      complete = false;
      continue;
    }
    relations.push(first);
  }
  relations.sort((left, right) =>
    left.relation.candidateId.localeCompare(right.relation.candidateId),
  );
  return { relations, completeness: complete ? 'COMPLETE' : 'TRUNCATED' };
};

export class KnowledgeModelTypedPropositionConflictAuthorityReader implements TypedPropositionConflictAuthorityReaderPort {
  public constructor(
    private readonly knowledgeModel: Pick<KnowledgeModelRepositoryPort, 'listGroups'>,
  ) {}

  public async listApprovedRelationAuthorities(projectId: string) {
    return currentApprovedRelationAuthorities(
      await this.knowledgeModel.listGroups(projectId),
      projectId,
    );
  }
}

export const buildTypedPropositionConflictAssertion = (input: {
  readonly projectId: string;
  readonly rule: TypedPropositionConflictRuleV1;
  readonly left: RelationCandidate;
  readonly right: RelationCandidate;
  readonly leftResource: DiscoveryResourceRefV1;
  readonly rightResource: DiscoveryResourceRefV1;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: DiscoveryServerSecurityInputV1['sensitivity'];
  readonly createdAt: string;
}): TypedPropositionConflictAssertionV1 => {
  const identityKey = typedPropositionConflictAssertionIdentity({
    projectId: input.projectId,
    ruleId: input.rule.ruleId,
    ruleRevision: input.rule.ruleRevision,
    left: input.left,
    right: input.right,
    canonicalBase: input.canonicalBase,
    discoveryBase: input.discoveryBase,
  });
  return {
    schemaVersion: '1.0.0',
    assertionId: `typed-proposition-conflict-assertion:${identityKey.slice('sha256:'.length)}`,
    assertionRevision: 1,
    identityKey,
    projectId: input.projectId,
    ruleId: input.rule.ruleId,
    ruleRevision: input.rule.ruleRevision,
    kind: 'FACTUAL',
    source: 'TYPED_PROPOSITION',
    leftRelationCandidateId: input.left.candidateId,
    leftRelationRevision: input.left.revisionNumber,
    leftSourceVersionId: input.left.sourceVersionId,
    rightRelationCandidateId: input.right.candidateId,
    rightRelationRevision: input.right.revisionNumber,
    rightSourceVersionId: input.right.sourceVersionId,
    resourceRefs: [input.leftResource, input.rightResource],
    evidenceIds: [...new Set([...input.left.evidenceIds, ...input.right.evidenceIds])].sort(),
    canonicalBase: input.canonicalBase,
    discoveryBase: input.discoveryBase,
    security: {
      projectId: input.projectId,
      accessScope: [...input.accessScope].sort(),
      sensitivity: input.sensitivity,
    },
    status: 'ACTIVE',
    sourceAuthorityId: 'stage9.typed-proposition-conflict-evaluator',
    sourceAuthorityRevision: '1.0.0',
    createdAt: input.createdAt,
    provenance: {
      evaluatorVersion: 'typed-proposition-conflict-evaluator:v1',
      createdAt: input.createdAt,
      sourceAuthorityId: 'stage9.typed-proposition-conflict-evaluator',
      sourceAuthorityRevision: '1.0.0',
    },
  };
};

export class TypedPropositionConflictEvaluatorV1 {
  public constructor(
    private readonly rules: TypedPropositionConflictRuleRepositoryPort,
    private readonly assertions: TypedPropositionConflictAssertionRepositoryPort,
    private readonly authority: TypedPropositionConflictAuthorityReaderPort,
  ) {}

  public async read(input: {
    readonly context: {
      readonly projectId: string;
      readonly accessScope: readonly string[];
      readonly sensitivity: DiscoveryServerSecurityInputV1['sensitivity'];
      readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
      readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
      readonly sourceProjectionDigest: string;
      readonly semanticGenerationId: string;
      readonly resourceRefs: readonly DiscoveryResourceRefV1[];
      readonly maxResourcesRead: number;
      readonly maxObservationsReturned: number;
    };
  }): Promise<{
    readonly competitions: readonly {
      readonly left: DiscoveryResourceRefV1;
      readonly right: DiscoveryResourceRefV1;
      readonly kind: 'FACTUAL';
      readonly source: 'TYPED_PROPOSITION';
      readonly signalId: string;
    }[];
    readonly completeness: 'COMPLETE' | 'TRUNCATED';
  }> {
    if (!input.context.projectId) return projectError('Conflict rule project is unavailable.');
    if (
      !input.context.sourceProjectionDigest ||
      input.context.sourceProjectionDigest !== input.context.discoveryBase.projectionDigest ||
      input.context.resourceRefs.length > input.context.maxResourcesRead
    ) {
      return { competitions: [], completeness: 'TRUNCATED' };
    }
    const refs = input.context.resourceRefs.filter(
      (ref) =>
        ref.projectId === input.context.projectId &&
        ref.resourceKind === 'CANONICAL_RELATION' &&
        ref.resourceState === 'APPROVED' &&
        ref.resourceRevision !== undefined,
    );
    const authority = await this.authority.listApprovedRelationAuthorities(input.context.projectId);
    if (authority.completeness !== 'COMPLETE') {
      return { competitions: [], completeness: 'TRUNCATED' };
    }
    const relationByRef = new Map(
      authority.relations
        .filter((entry) =>
          refs.some(
            (ref) =>
              ref.resourceId === entry.relation.candidateId &&
              ref.resourceRevision === String(entry.relation.revisionNumber),
          ),
        )
        .map((entry) => [entry.relation.candidateId, entry]),
    );
    const validRefs = refs.filter((ref) => relationByRef.has(ref.resourceId));
    const activeRules = (await this.rules.listRuleRevisions(input.context.projectId)).filter(
      (rule) => rule.status === 'ACTIVE',
    );
    const competitions: {
      readonly left: DiscoveryResourceRefV1;
      readonly right: DiscoveryResourceRefV1;
      readonly kind: 'FACTUAL';
      readonly source: 'TYPED_PROPOSITION';
      readonly signalId: string;
    }[] = [];
    const observedIdentityKeys = new Set<string>();
    for (let leftIndex = 0; leftIndex < validRefs.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < validRefs.length; rightIndex += 1) {
        const leftRef = validRefs[leftIndex]!;
        const rightRef = validRefs[rightIndex]!;
        const left = relationByRef.get(leftRef.resourceId)!.relation;
        const right = relationByRef.get(rightRef.resourceId)!.relation;
        const rule = activeRules.find((candidate) =>
          typedPropositionConflictRuleMatches(candidate, left, right),
        );
        if (!rule) continue;
        const leftAuthority = relationByRef.get(leftRef.resourceId)!;
        const rightAuthority = relationByRef.get(rightRef.resourceId)!;
        const accessScope = [...new Set(leftAuthority.accessScope)].filter(
          (scope) =>
            rightAuthority.accessScope.includes(scope) && input.context.accessScope.includes(scope),
        );
        const sensitivity =
          sensitivityRank[leftAuthority.sensitivity] >= sensitivityRank[rightAuthority.sensitivity]
            ? leftAuthority.sensitivity
            : rightAuthority.sensitivity;
        if (
          accessScope.length === 0 ||
          sensitivityRank[sensitivity] > sensitivityRank[input.context.sensitivity]
        )
          continue;
        const [assertionLeft, assertionRight] =
          compareRelationParticipants(left, right) <= 0 ? [left, right] : [right, left];
        const [assertionLeftRef, assertionRightRef] =
          compareRelationParticipants(left, right) <= 0 ? [leftRef, rightRef] : [rightRef, leftRef];
        const assertion = buildTypedPropositionConflictAssertion({
          projectId: input.context.projectId,
          rule,
          left: assertionLeft,
          right: assertionRight,
          leftResource: assertionLeftRef,
          rightResource: assertionRightRef,
          canonicalBase: input.context.canonicalBase,
          discoveryBase: input.context.discoveryBase,
          accessScope,
          sensitivity,
          createdAt: new Date().toISOString(),
        });
        const saved = await this.assertions.saveAssertion(assertion);
        observedIdentityKeys.add(saved.identityKey);
        competitions.push({
          left: leftRef,
          right: rightRef,
          kind: 'FACTUAL',
          source: 'TYPED_PROPOSITION',
          signalId: saved.assertionId,
        });
        if (competitions.length >= input.context.maxObservationsReturned) {
          return {
            competitions,
            completeness: 'TRUNCATED',
          };
        }
      }
    }
    // Reconciliation is bounded to the exact refs supplied by Discovery. An
    // omitted ref is not evidence of disappearance, but a fully read pair or
    // a retired rule can safely stop its active derived signal. History stays
    // in the assertion store.
    const currentRuleIds = new Set(activeRules.map((rule) => rule.ruleId));
    for (const existing of await this.assertions.listActiveAssertions(input.context.projectId)) {
      const pairIsInReadSet = existing.resourceRefs.every((ref) =>
        validRefs.some(
          (candidate) =>
            candidate.resourceId === ref.resourceId &&
            candidate.resourceRevision === ref.resourceRevision,
        ),
      );
      const sameBase =
        existing.canonicalBase.snapshotDigest === input.context.canonicalBase.snapshotDigest &&
        existing.canonicalBase.canonicalVersion === input.context.canonicalBase.canonicalVersion &&
        existing.discoveryBase.projectionDigest === input.context.discoveryBase.projectionDigest &&
        existing.discoveryBase.projectionRevision ===
          input.context.discoveryBase.projectionRevision;
      if (
        (existing.ruleId !== undefined && !currentRuleIds.has(existing.ruleId)) ||
        (pairIsInReadSet && sameBase && !observedIdentityKeys.has(existing.identityKey))
      ) {
        await this.assertions.supersedeAssertion(
          input.context.projectId,
          existing.assertionId,
          existing.assertionRevision,
        );
      }
    }
    return {
      competitions,
      completeness: authority.completeness === 'COMPLETE' ? 'COMPLETE' : 'TRUNCATED',
    };
  }
}

export class InMemoryTypedPropositionConflictRuleRepository implements TypedPropositionConflictRuleRepositoryPort {
  private readonly history = new Map<string, TypedPropositionConflictRuleV1[]>();
  private transactionTail: Promise<void> = Promise.resolve();

  async listRuleRevisions(projectId: string): Promise<readonly TypedPropositionConflictRuleV1[]> {
    return [...this.history.values()]
      .flat()
      .filter((rule) => rule.projectId === projectId)
      .sort(
        (left, right) =>
          left.ruleId.localeCompare(right.ruleId) || left.ruleRevision - right.ruleRevision,
      );
  }

  async findRule(projectId: string, ruleId: string, revision?: number) {
    const history = (this.history.get(ruleId) ?? []).filter((rule) => rule.projectId === projectId);
    return revision === undefined
      ? history.sort((left, right) => right.ruleRevision - left.ruleRevision)[0]
      : history.find((rule) => rule.ruleRevision === revision);
  }

  async transaction<T>(
    action: (handle: TypedPropositionConflictRuleTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const transactional = new InMemoryTypedPropositionConflictRuleRepository();
      for (const [ruleId, history] of this.history.entries()) {
        transactional.history.set(
          ruleId,
          history.map((rule) => ({ ...rule })),
        );
      }
      const afterCommit: (() => void)[] = [];
      const result = await action({
        repository: transactional,
        rawTransaction: undefined,
        afterCommit: (callback) => afterCommit.push(callback),
      });
      this.history.clear();
      for (const [ruleId, history] of transactional.history.entries()) {
        this.history.set(ruleId, history);
      }
      for (const callback of afterCommit) callback();
      return result;
    } finally {
      release();
    }
  }

  async saveRule(rule: TypedPropositionConflictRuleV1) {
    const history = this.history.get(rule.ruleId) ?? [];
    if (history.some((entry) => entry.ruleRevision === rule.ruleRevision)) {
      return conflictError('Conflict rule revision already exists.');
    }
    this.history.set(rule.ruleId, [...history, rule]);
    return rule;
  }

  async supersedeRule(
    projectId: string,
    ruleId: string,
    expectedRevision: number,
    supersededBy: { readonly ruleId: string; readonly ruleRevision: number },
  ) {
    const history = this.history.get(ruleId) ?? [];
    const current = history.find(
      (rule) => rule.projectId === projectId && rule.ruleRevision === expectedRevision,
    );
    if (!current || current.status !== 'ACTIVE')
      return staleError('Conflict rule revision is stale.');
    this.history.set(
      ruleId,
      history.map((rule) =>
        rule.ruleRevision === expectedRevision
          ? { ...rule, status: 'SUPERSEDED', supersededBy }
          : rule,
      ),
    );
  }

  async retireRule(projectId: string, ruleId: string, expectedRevision: number, retiredAt: string) {
    const history = this.history.get(ruleId) ?? [];
    const current = history.find(
      (rule) => rule.projectId === projectId && rule.ruleRevision === expectedRevision,
    );
    if (!current || current.status !== 'ACTIVE')
      return staleError('Conflict rule revision is stale.');
    this.history.set(
      ruleId,
      history.map((rule) =>
        rule.ruleRevision === expectedRevision ? { ...rule, status: 'RETIRED', retiredAt } : rule,
      ),
    );
  }
}

export class InMemoryTypedPropositionConflictAssertionRepository implements TypedPropositionConflictAssertionRepositoryPort {
  private readonly assertions = new Map<string, TypedPropositionConflictAssertionV1[]>();

  async findByIdentity(projectId: string, identityKey: string) {
    const history = this.assertions.get(`${projectId}:${identityKey}`) ?? [];
    return [...history]
      .sort((left, right) => right.assertionRevision - left.assertionRevision)
      .find((assertion) => assertion.status === 'ACTIVE');
  }

  async listActiveAssertions(projectId: string) {
    return [...this.assertions.values()]
      .flat()
      .filter((assertion) => assertion.projectId === projectId && assertion.status === 'ACTIVE');
  }

  public listAssertionHistory(projectId: string, identityKey: string) {
    return [...(this.assertions.get(`${projectId}:${identityKey}`) ?? [])].sort(
      (left, right) => left.assertionRevision - right.assertionRevision,
    );
  }

  async saveAssertion(assertion: TypedPropositionConflictAssertionV1) {
    const key = `${assertion.projectId}:${assertion.identityKey}`;
    const history = this.assertions.get(key) ?? [];
    const existing = history.find((entry) => entry.status === 'ACTIVE');
    if (existing) {
      if (assertionContentKey(existing) === assertionContentKey(assertion)) return existing;
      const superseded = {
        ...existing,
        status: 'SUPERSEDED' as const,
        supersededAt: assertion.createdAt,
      };
      const next = {
        ...assertion,
        assertionId: existing.assertionId,
        assertionRevision: existing.assertionRevision + 1,
        status: 'ACTIVE' as const,
      };
      this.assertions.set(key, [
        ...history.map((entry) => (entry === existing ? superseded : entry)),
        next,
      ]);
      return next;
    }
    const matchingRevision = history.find(
      (entry) => entry.assertionRevision === assertion.assertionRevision,
    );
    if (matchingRevision) return matchingRevision;
    const latestRevision = history.reduce(
      (latest, entry) => Math.max(latest, entry.assertionRevision),
      0,
    );
    const stored = {
      ...assertion,
      assertionId: history.at(-1)?.assertionId ?? assertion.assertionId,
      assertionRevision: Math.max(assertion.assertionRevision, latestRevision + 1),
      status: 'ACTIVE' as const,
    };
    this.assertions.set(key, [...history, stored]);
    return stored;
  }

  async supersedeAssertion(projectId: string, assertionId: string, expectedRevision: number) {
    for (const [key, history] of this.assertions.entries()) {
      const index = history.findIndex(
        (assertion) =>
          assertion.projectId === projectId &&
          assertion.assertionId === assertionId &&
          assertion.assertionRevision === expectedRevision &&
          assertion.status === 'ACTIVE',
      );
      if (index >= 0) {
        const assertion = history[index]!;
        const next = [...history];
        next[index] = {
          ...assertion,
          status: 'SUPERSEDED',
          supersededAt: new Date().toISOString(),
        };
        this.assertions.set(key, next);
        return;
      }
    }
  }
}
