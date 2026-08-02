import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeDraftCommandEnvelopeV1,
  decodeFrontendKnowledgeDraftBaseV1,
  decodeFrontendKnowledgeDraftChangeSetV1,
  decodeFrontendKnowledgeDraftCommandOutcomeV1,
  decodeFrontendKnowledgeOperationV1,
  mapFrontendKnowledgeDraftFailure,
} from '../../packages/contracts/src/index.js';

const now = '2026-08-02T08:00:00.000Z';

const existingBase = {
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
  revisionIdentityKind: 'RESOURCE_REVISION' as const,
  canonicalResourceId: 'canonical-resource-1',
  canonicalRevisionId: 'canonical-revision-7',
};

const policyContext = {
  activeProjectId: 'project-1',
  resourceProjectId: 'project-1',
  draftProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  accessRevision: 'access-7',
  policyContextRevision: 'policy-7',
};

const artifact = {
  artifactId: 'artifact-1',
  artifactRevision: 1,
  digest: 'sha256:artifact',
  status: 'COMPLETE' as const,
  projectPolicyContext: policyContext,
};

const payloadFor = (kind: string) => {
  switch (kind) {
    case 'FACT_ADD':
    case 'FACT_UPDATE':
    case 'FACT_REMOVE':
      return {
        schemaVersion: 'fact.v1',
        subjectRef: 'entity-1',
        predicate: 'status',
        value: 'active',
      };
    case 'CLAIM_ADD':
    case 'CLAIM_UPDATE':
    case 'CLAIM_REMOVE':
      return { schemaVersion: 'claim.v1', statement: 'The claim is supported.' };
    case 'ENTITY_ADD':
    case 'ENTITY_UPDATE':
    case 'ENTITY_REFERENCE':
      return { schemaVersion: 'entity.v1', entityType: 'person', displayName: 'Ada' };
    case 'RELATION_ADD':
    case 'RELATION_UPDATE':
    case 'RELATION_REMOVE':
      return {
        schemaVersion: 'relation.v1',
        relationType: 'KNOWS',
        fromEntityRef: 'entity-1',
        toEntityRef: 'entity-2',
      };
    case 'EVENT_ADD':
    case 'EVENT_UPDATE':
    case 'EVENT_REMOVE':
      return { schemaVersion: 'event.v1', eventType: 'meeting', subjectRef: 'entity-1' };
    case 'DECISION_ADD':
    case 'DECISION_UPDATE':
    case 'DECISION_REMOVE':
      return { schemaVersion: 'decision.v1', decisionType: 'policy', decision: 'retain' };
    case 'EVIDENCE_ATTACH':
    case 'EVIDENCE_DETACH':
      return {
        schemaVersion: 'evidence-link.v1',
        sourceId: 'source-1',
        sourceVersionId: 'source-version-1',
        evidenceSpanId: 'span-1',
      };
    case 'TEMPORAL_VALIDITY_CHANGE':
      return { schemaVersion: 'temporal-validity.v1', status: 'KNOWN' };
    case 'CONFLICT_PROPOSAL_ADD':
    case 'CONFLICT_PROPOSAL_UPDATE':
      return {
        schemaVersion: 'conflict-proposal.v1',
        conflictType: 'contradiction',
        competingTargetIds: ['target-1', 'target-2'],
        summary: 'Competing values require review.',
      };
    case 'KNOWLEDGE_GAP_PROPOSAL_ADD':
    case 'KNOWLEDGE_GAP_PROPOSAL_UPDATE':
      return {
        schemaVersion: 'knowledge-gap-proposal.v1',
        gapType: 'missing-source',
        description: 'A source is needed.',
      };
    case 'NO_OP':
      return {
        schemaVersion: 'no-op-review-result.v1',
        result: 'NO_CHANGE_REQUIRED',
        reason: 'The author reviewed the item.',
      };
    default:
      throw new Error(`Unhandled operation fixture: ${kind}`);
  }
};

const targetTypeFor = (kind: string) => {
  if (kind.startsWith('FACT')) return 'FACT';
  if (kind.startsWith('CLAIM')) return 'CLAIM';
  if (kind.startsWith('ENTITY')) return 'ENTITY';
  if (kind.startsWith('RELATION')) return 'RELATION';
  if (kind.startsWith('EVENT')) return 'EVENT';
  if (kind.startsWith('DECISION')) return 'DECISION';
  if (kind.startsWith('EVIDENCE')) return 'EVIDENCE';
  if (kind.startsWith('TEMPORAL')) return 'TEMPORAL';
  if (kind.startsWith('CONFLICT')) return 'CONFLICT';
  if (kind.startsWith('KNOWLEDGE_GAP')) return 'KNOWLEDGE_GAP';
  return 'REVIEW_RESULT';
};

const operationFor = (kind: string) => {
  const payload = payloadFor(kind);
  const operation = {
    kind,
    target: { targetType: targetTypeFor(kind), targetId: 'target-1', resourceId: 'resource-1' },
    operationId: `operation-${kind.toLowerCase()}`,
    baseRevision: 1,
    rationale: 'Author rationale.',
    evidenceReferences: [
      { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
    ],
    expectedImpact: { summary: 'A bounded change is expected.', targetIds: ['target-1'] },
    operationRevision: 1,
    contentDigest: 'sha256:operation',
  } as Record<string, unknown>;
  if (kind.endsWith('_UPDATE') || kind === 'TEMPORAL_VALIDITY_CHANGE') {
    operation.before = payload;
    operation.after = payload;
  } else if (kind.endsWith('_REMOVE') || kind === 'EVIDENCE_DETACH') {
    operation.before = payload;
  } else {
    operation.after = payload;
  }
  return operation;
};

const draftFor = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0.0',
  draftId: 'draft-1',
  seedId: 'seed-1',
  answerRunId: 'answer-run-1',
  startMode: 'SEED_MATERIALIZATION' as const,
  status: 'DRAFT' as const,
  revision: 1,
  activeProjectId: 'project-1',
  resourceProjectId: 'project-1',
  draftProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  resourceId: 'resource-1',
  base: existingBase,
  operations: [operationFor('FACT_ADD')],
  contentDigest: 'sha256:draft',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const expectContractError = (action: () => unknown, code?: string) => {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FrontendContractError);
  if (code !== undefined) expect((thrown as FrontendContractError).code).toBe(code);
};

describe('FE-P3-S2 FrontendKnowledgeDraftChangeSet v1 contract', () => {
  it('decodes a complete Draft with pinned base and typed operation', () => {
    const draft = decodeFrontendKnowledgeDraftChangeSetV1(draftFor());
    expect(draft.schemaVersion).toBe('1.0.0');
    expect(draft.base.revisionIdentityKind).toBe('RESOURCE_REVISION');
    expect(draft.operations[0]?.kind).toBe('FACT_ADD');
  });

  it('covers every frozen operation discriminant', () => {
    const kinds = [
      'FACT_ADD',
      'FACT_UPDATE',
      'FACT_REMOVE',
      'CLAIM_ADD',
      'CLAIM_UPDATE',
      'CLAIM_REMOVE',
      'ENTITY_ADD',
      'ENTITY_UPDATE',
      'ENTITY_REFERENCE',
      'RELATION_ADD',
      'RELATION_UPDATE',
      'RELATION_REMOVE',
      'EVENT_ADD',
      'EVENT_UPDATE',
      'EVENT_REMOVE',
      'DECISION_ADD',
      'DECISION_UPDATE',
      'DECISION_REMOVE',
      'EVIDENCE_ATTACH',
      'EVIDENCE_DETACH',
      'TEMPORAL_VALIDITY_CHANGE',
      'CONFLICT_PROPOSAL_ADD',
      'CONFLICT_PROPOSAL_UPDATE',
      'KNOWLEDGE_GAP_PROPOSAL_ADD',
      'KNOWLEDGE_GAP_PROPOSAL_UPDATE',
      'NO_OP',
    ];
    for (const kind of kinds)
      expect(decodeFrontendKnowledgeOperationV1(operationFor(kind)).kind).toBe(kind);
  });

  it('rejects unknown fields and invalid discriminants', () => {
    expectContractError(() =>
      decodeFrontendKnowledgeOperationV1({ ...operationFor('FACT_ADD'), extra: true }),
    );
    expectContractError(() =>
      decodeFrontendKnowledgeOperationV1({ ...operationFor('FACT_ADD'), kind: 'FACT_UNKNOWN' }),
    );
    expectContractError(() =>
      decodeFrontendKnowledgeDraftChangeSetV1({ ...draftFor(), status: 'PARTIAL' }),
    );
  });

  it('rejects browser authority injection in command envelopes', () => {
    expectContractError(
      () =>
        decodeDraftCommandEnvelopeV1({
          schemaVersion: '1.0.0',
          clientRequestId: 'request-1',
          idempotencyKey: 'key-1',
          principalId: 'browser-principal',
        }),
      'PRECONDITION_ACCESS_DENIED',
    );
    expectContractError(() =>
      decodeDraftCommandEnvelopeV1({
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-1',
        effectiveProjectId: 'browser-project',
      }),
    );
  });

  it('requires a provable Existing Resource revision and rejects it for a New Resource snapshot', () => {
    expectContractError(() =>
      decodeFrontendKnowledgeDraftBaseV1({ ...existingBase, canonicalRevisionId: undefined }),
    );
    expectContractError(() =>
      decodeFrontendKnowledgeDraftBaseV1({
        ...existingBase,
        revisionIdentityKind: 'NEW_RESOURCE_SNAPSHOT',
      }),
    );
    expect(
      decodeFrontendKnowledgeDraftBaseV1({
        ...existingBase,
        revisionIdentityKind: 'NEW_RESOURCE_SNAPSHOT',
        canonicalResourceId: undefined,
        canonicalRevisionId: undefined,
      }).revisionIdentityKind,
    ).toBe('NEW_RESOURCE_SNAPSHOT');
  });

  it('requires Projection only when the authoring context declares it, and validates identity unions', () => {
    expectContractError(() =>
      decodeFrontendKnowledgeDraftBaseV1(existingBase, { projectionRequired: true }),
    );
    const projection = {
      projectionKind: 'COMPILED_TRUTH',
      projectionId: 'projection-1',
      projectionIdentity: { kind: 'VERSION', version: 7 },
      projectionDigest: 'sha256:projection',
      readiness: 'STALE',
      projectedCanonicalVersion: 6,
      sourceSnapshotDigest: 'sha256:snapshot',
    };
    expect(
      decodeFrontendKnowledgeDraftBaseV1(
        { ...existingBase, projection },
        { projectionRequired: true },
      ).projection,
    ).toBeDefined();
    expectContractError(() =>
      decodeFrontendKnowledgeDraftBaseV1({
        ...existingBase,
        projection: {
          ...projection,
          projectionIdentity: { kind: 'VERSION', version: 7, revision: 'bad' },
        },
      }),
    );
  });

  it('keeps lifecycle, artifact status and command outcome as separate contracts', () => {
    expect(decodeFrontendKnowledgeDraftChangeSetV1(draftFor({ status: 'STALE' })).status).toBe(
      'STALE',
    );
    expectContractError(() =>
      decodeFrontendKnowledgeDraftChangeSetV1(
        draftFor({
          status: 'READY_FOR_REVIEW',
          validation: { ...artifact, status: 'PARTIAL' },
          impactPreview: artifact,
        }),
      ),
    );
    expect(mapFrontendKnowledgeDraftFailure('OUTCOME_INDETERMINATE')).toBe('OUTCOME_UNKNOWN');
    expect(mapFrontendKnowledgeDraftFailure('STALE_BASE')).toBe('STALE_BASE');
    expect(mapFrontendKnowledgeDraftFailure('CONFLICT')).toBe('CONFLICT');
    expect(decodeFrontendKnowledgeDraftCommandOutcomeV1('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
    expectContractError(() => decodeFrontendKnowledgeDraftCommandOutcomeV1('STALE'));
  });

  it('rejects Ask Seed and Stage 5 DTOs instead of implicitly converting them', () => {
    expectContractError(() =>
      decodeDraftCommandEnvelopeV1({ seedId: 'seed-1', question: 'What is known?' }),
    );
    expectContractError(() =>
      decodeFrontendKnowledgeDraftChangeSetV1({
        id: 'stage-5-change-set',
        revision: 1,
        operations: [],
      }),
    );
  });
});
