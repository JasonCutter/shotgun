import { describe, expect, it } from 'vitest';

import {
  buildTypedPropositionConflictAssertion,
  InMemoryTypedPropositionConflictAssertionRepository,
  InMemoryTypedPropositionConflictRuleRepository,
  KnowledgeModelTypedPropositionConflictAuthorityReader,
  TypedPropositionConflictEvaluatorV1,
  TypedPropositionConflictRuleService,
} from '../../modules/knowledge-model/src/index.js';
import { InMemoryKnowledgeModelRepository } from '../../adapters/stage9-in-memory/src/index.js';
import {
  knowledgeCandidateDigest,
  typedPropositionConflictAssertionIdentity,
  validateTypedPropositionConflictRuleCommandRequest,
  TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE,
  typedPropositionConflictRuleMatches,
  typedPropositionConflictRuleSemanticKey,
  type DiscoveryResourceRefV1,
  type KnowledgeReviewGroup,
  type RelationCandidate,
} from '../../packages/contracts/src/index.js';

const projectId = 'project-1';
const relation = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  direction?: RelationCandidate['direction'];
}): RelationCandidate => ({
  candidateId: input.id,
  candidateType: 'RELATION',
  revisionNumber: 1,
  sourceVersionId: `source-${input.id}`,
  evidenceIds: [`evidence-${input.id}`],
  modelOutputs: [],
  fromCandidateId: input.from,
  toCandidateId: input.to,
  relationType: input.type,
  direction: input.direction ?? 'DIRECTED',
});

const group = (groupId: string, item: RelationCandidate): KnowledgeReviewGroup => ({
  groupId,
  projectId,
  sourceVersionId: item.sourceVersionId,
  revisionNumber: 1,
  status: 'APPROVED',
  contentDigest: knowledgeCandidateDigest([item]),
  items: [item],
  decisions: [],
  accessScope: ['project:read'],
  sensitivity: 'public',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const base = {
  schemaVersion: '1.0.0' as const,
  projectId,
  accessScope: ['project:read'],
  sensitivity: 'public' as const,
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 1,
    snapshotDigest: 'canonical-1',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'projection-1',
    projectionDigest: 'projection-digest',
  },
  sourceProjectionDigest: 'projection-digest',
  semanticGenerationId: 'semantic-generation-1',
  maxResourcesRead: 10,
};

const resource = (candidate: RelationCandidate): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_RELATION',
  resourceId: candidate.candidateId,
  projectId,
  resourceState: 'APPROVED',
  resourceRevision: String(candidate.revisionNumber),
});

describe('AKP-8 WP2R typed proposition conflict authority', () => {
  it('normalizes A+B and B+A to one exact rule identity', () => {
    const a = typedPropositionConflictRuleSemanticKey({
      projectId,
      leftRelationType: 'supports',
      rightRelationType: 'contradicts',
      directionSemantics: 'DIRECTED_SAME_ORIENTATION',
    });
    const b = typedPropositionConflictRuleSemanticKey({
      projectId,
      leftRelationType: 'contradicts',
      rightRelationType: 'supports',
      directionSemantics: 'DIRECTED_SAME_ORIENTATION',
    });
    expect(a).toBe(b);
  });

  it('keeps assertion identity independent of security while binding revisions and bases', () => {
    const left = {
      candidateId: 'relation-a',
      revisionNumber: 1,
      sourceVersionId: 'source-a',
    } as const;
    const right = {
      candidateId: 'relation-b',
      revisionNumber: 1,
      sourceVersionId: 'source-b',
    } as const;
    const identityInput = {
      projectId,
      ruleId: 'rule-1',
      ruleRevision: 1,
      left,
      right,
      canonicalBase: base.canonicalBase,
      discoveryBase: base.discoveryBase,
    };
    const stable = typedPropositionConflictAssertionIdentity(identityInput);
    expect(
      typedPropositionConflictAssertionIdentity({
        ...identityInput,
        left: { ...left, revisionNumber: 2 },
      }),
    ).not.toBe(stable);
    expect(
      typedPropositionConflictAssertionIdentity({ ...identityInput, ruleRevision: 2 }),
    ).not.toBe(stable);
    expect(
      typedPropositionConflictAssertionIdentity({
        ...identityInput,
        canonicalBase: { ...base.canonicalBase, canonicalVersion: 2 },
      }),
    ).not.toBe(stable);
    expect(
      typedPropositionConflictAssertionIdentity({
        ...identityInput,
        discoveryBase: { ...base.discoveryBase, projectionRevision: 'projection-2' },
      }),
    ).not.toBe(stable);
  });

  it('rejects unsupported mappings and browser-owned authority fields', () => {
    const request = (payload: Record<string, unknown>) => ({
      envelopeVersion: '1.0.0',
      commandType: TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE,
      commandSchemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'idempotency-1',
      projectContext: {
        activeProjectId: projectId,
        targetProjectId: projectId,
        resourceProjectId: projectId,
      },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [],
      clientIssuedAt: '2026-09-01T00:00:00.000Z',
      payload,
    });

    expect(() =>
      validateTypedPropositionConflictRuleCommandRequest(
        request({
          operation: 'CREATE',
          leftRelationType: 'supports',
          rightRelationType: 'contradicts',
          directionSemantics: 'DIRECTED_SAME_ORIENTATION',
          kind: 'TEMPORAL',
        }),
      ),
    ).toThrow();
    expect(() =>
      validateTypedPropositionConflictRuleCommandRequest({
        ...request({
          operation: 'CREATE',
          leftRelationType: 'supports',
          rightRelationType: 'contradicts',
          directionSemantics: 'DIRECTED_SAME_ORIENTATION',
        }),
        projectId,
      }),
    ).toThrow();
  });

  it('enforces exact direction and endpoint semantics for directed and undirected rules', async () => {
    const rules = new InMemoryTypedPropositionConflictRuleRepository();
    const service = new TypedPropositionConflictRuleService(rules);
    const directed = await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: {
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: '2026-09-01T00:00:00.000Z',
    });
    const revised = await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: {
        operation: 'REVISE',
        ruleId: directed.ruleId,
        expectedRuleRevision: directed.ruleRevision,
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: '2026-09-01T00:00:00.500Z',
    });
    expect(revised.ruleRevision).toBe(2);
    expect((await rules.findRule(projectId, directed.ruleId, 1))?.status).toBe('SUPERSEDED');
    expect(
      (await rules.listRuleRevisions(projectId)).filter((rule) => rule.status === 'ACTIVE'),
    ).toHaveLength(1);
    const supports = relation({ id: 'r-a', type: 'supports', from: 'e-1', to: 'e-2' });
    const contradicts = relation({ id: 'r-b', type: 'contradicts', from: 'e-1', to: 'e-2' });
    const reversed = relation({ id: 'r-c', type: 'contradicts', from: 'e-2', to: 'e-1' });
    const otherPair = relation({ id: 'r-d', type: 'contradicts', from: 'e-1', to: 'e-3' });
    expect(typedPropositionConflictRuleMatches(revised, supports, contradicts)).toBe(true); // A
    expect(typedPropositionConflictRuleMatches(revised, supports, reversed)).toBe(false); // D
    expect(typedPropositionConflictRuleMatches(revised, supports, otherPair)).toBe(false); // C

    const undirected = await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: {
        operation: 'CREATE',
        leftRelationType: 'connects',
        rightRelationType: 'blocks',
        directionSemantics: 'UNDIRECTED_CANONICAL_PAIR',
      },
      now: '2026-09-01T00:00:01.000Z',
    });
    expect(
      typedPropositionConflictRuleMatches(
        undirected,
        relation({ id: 'u-a', type: 'connects', from: 'e-1', to: 'e-2', direction: 'UNDIRECTED' }),
        relation({ id: 'u-b', type: 'blocks', from: 'e-2', to: 'e-1', direction: 'UNDIRECTED' }),
      ),
    ).toBe(true); // E
    expect(
      typedPropositionConflictRuleMatches(
        undirected,
        relation({ id: 'u-c', type: 'connects', from: 'e-1', to: 'e-2', direction: 'DIRECTED' }),
        relation({ id: 'u-d', type: 'blocks', from: 'e-2', to: 'e-1', direction: 'UNDIRECTED' }),
      ),
    ).toBe(false); // F
  });

  it('evaluates a later approved/current exact pair, persists one assertion, and is idempotent', async () => {
    const knowledge = new InMemoryKnowledgeModelRepository();
    const first = relation({
      id: 'relation-a',
      type: 'supports',
      from: 'entity-1',
      to: 'entity-2',
    });
    const second = relation({
      id: 'relation-b',
      type: 'contradicts',
      from: 'entity-1',
      to: 'entity-2',
    });
    await knowledge.saveGroup(group('group-a', first));
    await knowledge.saveGroup(group('group-b', second));
    const rules = new InMemoryTypedPropositionConflictRuleRepository();
    const service = new TypedPropositionConflictRuleService(rules);
    await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: {
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: '2026-09-01T00:00:00.000Z',
    });
    const assertions = new InMemoryTypedPropositionConflictAssertionRepository();
    const evaluator = new TypedPropositionConflictEvaluatorV1(
      rules,
      assertions,
      new KnowledgeModelTypedPropositionConflictAuthorityReader(knowledge),
    );
    const input = {
      context: {
        ...base,
        resourceRefs: [resource(first), resource(second)],
        maxObservationsReturned: 10,
      },
    };
    const firstRead = await evaluator.read(input);
    const secondRead = await evaluator.read(input);
    expect(firstRead.competitions).toHaveLength(1); // A/F/G
    expect(secondRead.competitions[0]?.signalId).toBe(firstRead.competitions[0]?.signalId);
    expect(await assertions.listActiveAssertions(projectId)).toHaveLength(1);
  });

  it('keeps the assertion id stable when governed security content changes and appends a revision', async () => {
    const rules = new InMemoryTypedPropositionConflictRuleRepository();
    const service = new TypedPropositionConflictRuleService(rules);
    const rule = await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: {
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: '2026-09-01T00:00:00.000Z',
    });
    const left = relation({ id: 'relation-a', type: 'supports', from: 'entity-1', to: 'entity-2' });
    const right = relation({
      id: 'relation-b',
      type: 'contradicts',
      from: 'entity-1',
      to: 'entity-2',
    });
    const assertions = new InMemoryTypedPropositionConflictAssertionRepository();
    const first = buildTypedPropositionConflictAssertion({
      projectId,
      rule,
      left,
      right,
      leftResource: resource(left),
      rightResource: resource(right),
      canonicalBase: base.canonicalBase,
      discoveryBase: base.discoveryBase,
      accessScope: ['project:read'],
      sensitivity: 'public',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const changedSecurity = buildTypedPropositionConflictAssertion({
      ...first,
      projectId,
      rule,
      left,
      right,
      leftResource: resource(left),
      rightResource: resource(right),
      canonicalBase: base.canonicalBase,
      discoveryBase: base.discoveryBase,
      accessScope: ['project:write', 'project:read'],
      sensitivity: 'private',
      createdAt: '2026-09-01T00:00:01.000Z',
    });
    expect(changedSecurity.identityKey).toBe(first.identityKey);
    await assertions.saveAssertion(first);
    const saved = await assertions.saveAssertion(changedSecurity);
    expect(saved.assertionId).toBe(first.assertionId);
    expect(saved.assertionRevision).toBe(2);
    expect(saved.security).toEqual({
      projectId,
      accessScope: ['project:read', 'project:write'],
      sensitivity: 'private',
    });
    expect(assertions.listAssertionHistory(projectId, first.identityKey)).toEqual([
      expect.objectContaining({ assertionRevision: 1, status: 'SUPERSEDED' }),
      expect.objectContaining({ assertionRevision: 2, status: 'ACTIVE' }),
    ]);
  });

  it('fails closed for missing active rule, retired rule, and ambiguous approved authority', async () => {
    const knowledge = new InMemoryKnowledgeModelRepository();
    const first = relation({
      id: 'relation-a',
      type: 'supports',
      from: 'entity-1',
      to: 'entity-2',
    });
    const second = relation({
      id: 'relation-b',
      type: 'contradicts',
      from: 'entity-1',
      to: 'entity-2',
    });
    await knowledge.saveGroup(group('group-a', first));
    await knowledge.saveGroup(group('group-b', second));
    const rules = new InMemoryTypedPropositionConflictRuleRepository();
    const service = new TypedPropositionConflictRuleService(rules);
    const created = await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: {
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
      now: '2026-09-01T00:00:00.000Z',
    });
    const assertions = new InMemoryTypedPropositionConflictAssertionRepository();
    const evaluator = new TypedPropositionConflictEvaluatorV1(
      rules,
      assertions,
      new KnowledgeModelTypedPropositionConflictAuthorityReader(knowledge),
    );
    const input = {
      context: {
        ...base,
        resourceRefs: [resource(first), resource(second)],
        maxObservationsReturned: 10,
      },
    };
    const beforeRetire = await evaluator.read(input);
    expect(beforeRetire.competitions).toHaveLength(1);
    await service.execute({
      projectId,
      actorId: 'owner-1',
      payload: { operation: 'RETIRE', ruleId: created.ruleId, expectedRuleRevision: 1 },
      now: '2026-09-01T00:00:02.000Z',
    });
    expect((await evaluator.read(input)).competitions).toHaveLength(0); // H
    const history = assertions.listAssertionHistory(
      projectId,
      beforeRetire.competitions[0]!.signalId.replace(
        'typed-proposition-conflict-assertion:',
        'sha256:',
      ),
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe('SUPERSEDED');

    const ambiguous = relation({
      id: 'relation-a',
      type: 'supports',
      from: 'entity-9',
      to: 'entity-2',
    });
    await knowledge.saveGroup(group('group-a-ambiguous', ambiguous));
    const ambiguousResult = await evaluator.read(input);
    expect(ambiguousResult.completeness).toBe('TRUNCATED'); // incomplete authority
  });
});
