import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  FrontendKnowledgeDraftCommandError,
  decodeDraftCommandEnvelopeV1,
  decodeGenerateKnowledgeDraftImpactRequestV1,
  decodeGenerateKnowledgeDraftImpactResultV1,
  decodeFrontendKnowledgeDraftFailureV1,
  decodeMaterializeDraftRequestV1,
  decodeMaterializeDraftResultV1,
  decodeFrontendKnowledgeDraftBaseV1,
  decodeFrontendKnowledgeDraftChangeSetV1,
  decodeFrontendKnowledgeDraftCommandOutcomeV1,
  decodeFrontendKnowledgeOperationV1,
  decodeResolveKnowledgeDraftCommandOutcomeRequestV1,
  decodeResolveKnowledgeDraftCommandOutcomeResultV1,
  decodeSaveKnowledgeDraftRequestV1,
  decodeSaveKnowledgeDraftResultV1,
  decodeStartSeedlessDraftRequestV1,
  decodeStartSeedlessDraftResultV1,
  decodeSubmitKnowledgeDraftForReviewRequestV1,
  decodeSubmitKnowledgeDraftForReviewResultV1,
  decodeValidateKnowledgeDraftRequestV1,
  decodeValidateKnowledgeDraftResultV1,
  mapFrontendKnowledgeDraftFailure,
  normalizeFrontendKnowledgeDraftFailure,
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

const reviewResource = {
  reviewResourceId: 'review-resource-1',
  draftId: 'draft-1',
  draftRevision: 1,
  resourceProjectId: 'project-1',
  draftProjectId: 'project-1',
  effectiveProjectId: 'project-1',
  policyContextRevision: 'policy-7',
  digest: 'sha256:review-resource',
};

const reviewSubmission = {
  reviewSubmissionId: 'review-submission-1',
  draftId: 'draft-1',
  draftRevision: 1,
  operationDigest: 'sha256:operations',
  contentDigest: 'sha256:draft',
  validationArtifact: artifact,
  impactArtifact: artifact,
  evidenceLineage: [
    { sourceId: 'source-1', sourceVersionId: 'source-version-1', evidenceSpanId: 'span-1' },
  ],
  projectPolicyContext: policyContext,
  reviewResource,
};

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

const expectDraftCommandError = (action: () => unknown, apiCode: string) => {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(FrontendKnowledgeDraftCommandError);
  expect((thrown as FrontendKnowledgeDraftCommandError).apiCode).toBe(apiCode);
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

  it('decodes all seven frozen command request and result contracts', () => {
    const envelope = {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-1',
      expectedDraftRevision: 1,
      expectedCanonicalVersion: 7,
      semanticDigest: 'sha256:semantic',
    };
    const materializeRequest = { ...envelope, seedId: 'seed-1' };
    const seedlessRequest = {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-2',
      idempotencyKey: 'key-2',
      resourceId: 'resource-1',
    };
    const saveRequest = {
      ...envelope,
      draftId: 'draft-1',
      operations: [operationFor('FACT_ADD')],
      expectedBaseRevision: 7,
      operationRevision: 1,
      contentDigest: 'sha256:draft',
    };
    const validateRequest = { ...envelope, draftId: 'draft-1', expectedBaseRevision: 7 };
    const impactRequest = {
      ...validateRequest,
      options: { maxDepth: 3, maxNodes: 50 },
    };
    const submitRequest = {
      ...validateRequest,
      validationArtifact: artifact,
      impactArtifact: artifact,
    };
    const resolveRequest = {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-1',
      semanticDigest: 'sha256:semantic',
    };

    expect(decodeMaterializeDraftRequestV1(materializeRequest).seedId).toBe('seed-1');
    expect(decodeStartSeedlessDraftRequestV1(seedlessRequest).resourceId).toBe('resource-1');
    expect(decodeSaveKnowledgeDraftRequestV1(saveRequest).draftId).toBe('draft-1');
    expect(decodeValidateKnowledgeDraftRequestV1(validateRequest).expectedBaseRevision).toBe(7);
    expect(decodeGenerateKnowledgeDraftImpactRequestV1(impactRequest).options?.maxNodes).toBe(50);
    expect(decodeSubmitKnowledgeDraftForReviewRequestV1(submitRequest).draftId).toBe('draft-1');
    expect(decodeResolveKnowledgeDraftCommandOutcomeRequestV1(resolveRequest).semanticDigest).toBe(
      'sha256:semantic',
    );

    const draft = draftFor();
    const resultBase = {
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-1',
    };
    expect(decodeMaterializeDraftResultV1({ ...resultBase, draft }).draft.draftId).toBe('draft-1');
    expect(decodeStartSeedlessDraftResultV1({ ...resultBase, draft }).draft.draftId).toBe(
      'draft-1',
    );
    expect(decodeSaveKnowledgeDraftResultV1({ ...resultBase, draft }).draft.draftId).toBe(
      'draft-1',
    );
    expect(
      decodeValidateKnowledgeDraftResultV1({
        ...resultBase,
        draftStatus: 'VALID',
        validation: artifact,
      }).validation.status,
    ).toBe('COMPLETE');
    expect(
      decodeGenerateKnowledgeDraftImpactResultV1({
        ...resultBase,
        draftStatus: 'VALID',
        impactPreview: artifact,
      }).impactPreview.status,
    ).toBe('COMPLETE');
    expect(
      decodeSubmitKnowledgeDraftForReviewResultV1({ ...resultBase, reviewSubmission })
        .reviewSubmission.draftId,
    ).toBe('draft-1');
    expect(
      decodeResolveKnowledgeDraftCommandOutcomeResultV1({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: 'request-1',
        originalIdempotencyKey: 'key-1',
        draft,
      }).draft?.draftId,
    ).toBe('draft-1');

    const authorityInjectedRequests = [
      materializeRequest,
      seedlessRequest,
      saveRequest,
      validateRequest,
      impactRequest,
      submitRequest,
      resolveRequest,
    ].map((request) => ({ ...request, activeProjectId: 'browser-project' }));
    const decoders = [
      decodeMaterializeDraftRequestV1,
      decodeStartSeedlessDraftRequestV1,
      decodeSaveKnowledgeDraftRequestV1,
      decodeValidateKnowledgeDraftRequestV1,
      decodeGenerateKnowledgeDraftImpactRequestV1,
      decodeSubmitKnowledgeDraftForReviewRequestV1,
      decodeResolveKnowledgeDraftCommandOutcomeRequestV1,
    ];
    for (const [index, decoder] of decoders.entries()) {
      expectContractError(() => decoder(authorityInjectedRequests[index]));
    }
  });

  it('rejects command omissions, invalid revisions/digests, incomplete Submit artifacts and bad outcome identity', () => {
    const envelope = {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-1',
      expectedDraftRevision: 1,
    };
    const withoutExpectedDraftRevision = {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-1',
    };
    expectContractError(() => decodeMaterializeDraftRequestV1(envelope));
    expectContractError(() =>
      decodeStartSeedlessDraftRequestV1({
        ...withoutExpectedDraftRevision,
        resourceId: 'resource-1',
        pageId: 'page-1',
      }),
    );
    expectContractError(() =>
      decodeSaveKnowledgeDraftRequestV1({
        ...withoutExpectedDraftRevision,
        draftId: 'draft-1',
        operations: [operationFor('FACT_ADD')],
        expectedBaseRevision: 7,
        operationRevision: 1,
        contentDigest: 'sha256:draft',
      }),
    );
    expectContractError(() =>
      decodeSaveKnowledgeDraftRequestV1({
        ...envelope,
        draftId: 'draft-1',
        operations: [operationFor('FACT_ADD')],
        expectedBaseRevision: -1,
        operationRevision: 1,
        contentDigest: 'sha256:draft',
      }),
    );
    expectContractError(() =>
      decodeValidateKnowledgeDraftRequestV1({
        ...withoutExpectedDraftRevision,
        draftId: 'draft-1',
        expectedBaseRevision: 7,
      }),
    );
    expectContractError(() =>
      decodeGenerateKnowledgeDraftImpactRequestV1({
        ...withoutExpectedDraftRevision,
        draftId: 'draft-1',
        expectedBaseRevision: 7,
      }),
    );
    expectContractError(() =>
      decodeResolveKnowledgeDraftCommandOutcomeRequestV1({
        schemaVersion: '1.0.0',
        clientRequestId: 'request-1',
        idempotencyKey: 'key-1',
        semanticDigest: '',
      }),
    );
    for (const status of ['PARTIAL', 'FAILED', 'UNAVAILABLE'] as const) {
      expectDraftCommandError(
        () =>
          decodeSubmitKnowledgeDraftForReviewRequestV1({
            ...envelope,
            draftId: 'draft-1',
            expectedBaseRevision: 7,
            validationArtifact: { ...artifact, status },
            impactArtifact: artifact,
          }),
        'NOT_READY_FOR_REVIEW',
      );
    }
    expectContractError(() =>
      decodeSubmitKnowledgeDraftForReviewRequestV1({
        ...withoutExpectedDraftRevision,
        draftId: 'draft-1',
        expectedBaseRevision: 7,
        validationArtifact: artifact,
        impactArtifact: artifact,
      }),
    );
    expectContractError(() =>
      decodeResolveKnowledgeDraftCommandOutcomeResultV1({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        originalClientRequestId: 'request-1',
        draft: draftFor(),
      }),
    );

    const serverAuthorityFields = [
      'principalId',
      'sessionId',
      'activeProjectId',
      'resourceProjectId',
      'draftProjectId',
      'effectiveProjectId',
      'accessRevision',
      'policyContextRevision',
      'canonicalSnapshotId',
      'canonicalVersion',
      'canonicalResourceId',
      'canonicalRevisionId',
      'capability',
      'capabilities',
      'commandId',
    ] as const;
    for (const field of serverAuthorityFields) {
      expectContractError(() =>
        decodeMaterializeDraftRequestV1({
          ...envelope,
          seedId: 'seed-1',
          [field]: 'browser-value',
        }),
      );
    }
  });

  it('preserves every Frozen API failure alias while exposing its normalized boundary', () => {
    const aliases = [
      'NOT_FOUND',
      'FORBIDDEN',
      'PROJECT_BINDING_CONFLICT',
      'ACCESS_REVOKED',
      'BASE_UNAVAILABLE',
      'DRAFT_NOT_FOUND',
      'DRAFT_REVISION_CONFLICT',
      'VALIDATION_FAILED',
      'STALE',
      'IMPACT_PARTIAL',
      'ANALYZER_UNAVAILABLE',
      'NOT_READY_FOR_REVIEW',
      'OUTCOME_NOT_FOUND',
      'DIGEST_MISMATCH',
      'COMMAND_SCOPE_MISMATCH',
      'OUTCOME_INDETERMINATE',
    ] as const;
    for (const alias of aliases) {
      const normalized = normalizeFrontendKnowledgeDraftFailure(alias);
      expect(normalized?.apiCode).toBe(alias);
      expect(normalized?.normalizedCode).toBeDefined();
    }
    const mappingExpectations = {
      NOT_FOUND: ['SEED_NOT_FOUND', 'NOT_FOUND', 404],
      FORBIDDEN: ['ACCESS_DENIED', 'AUTHORIZATION', 403],
      PROJECT_BINDING_CONFLICT: ['PROJECT_BINDING_FAILURE', 'CONFLICT', 409],
      ACCESS_REVOKED: ['ACCESS_DENIED', 'AUTHORIZATION', 403],
      BASE_UNAVAILABLE: ['CANONICAL_SNAPSHOT_MISMATCH', 'DEPENDENCY', 503],
      DRAFT_NOT_FOUND: ['DRAFT_NOT_FOUND', 'NOT_FOUND', 404],
      DRAFT_REVISION_CONFLICT: ['CONFLICT', 'CONFLICT', 409],
      VALIDATION_FAILED: ['INVALID_REQUEST', 'VALIDATION', 422],
      STALE: ['STALE_BASE', 'CONFLICT', 409],
      IMPACT_PARTIAL: ['ARTIFACT_INCOMPLETE', 'DEPENDENCY', 409],
      ANALYZER_UNAVAILABLE: ['ARTIFACT_INCOMPLETE', 'DEPENDENCY', 503],
      NOT_READY_FOR_REVIEW: ['ARTIFACT_INCOMPLETE', 'DEPENDENCY', 409],
      OUTCOME_NOT_FOUND: ['OUTCOME_UNKNOWN', 'NOT_FOUND', 404],
      DIGEST_MISMATCH: ['CONFLICT', 'CONFLICT', 409],
      COMMAND_SCOPE_MISMATCH: ['PROJECT_BINDING_FAILURE', 'AUTHORIZATION', 403],
      OUTCOME_INDETERMINATE: ['OUTCOME_UNKNOWN', 'OUTCOME_UNKNOWN', 503],
    } as const;
    for (const [apiCode, [normalizedCode, category, httpStatus]] of Object.entries(
      mappingExpectations,
    )) {
      const normalized = normalizeFrontendKnowledgeDraftFailure(apiCode);
      expect(normalized).toMatchObject({
        apiCode,
        normalizedCode,
        mapping: { category, httpStatus, retryable: false },
      });
    }
    for (const [code, normalizedCode, category, httpStatus] of [
      ['DRAFT_NOT_FOUND', 'DRAFT_NOT_FOUND', 'NOT_FOUND', 404],
      ['ACCESS_REVOKED', 'ACCESS_DENIED', 'AUTHORIZATION', 403],
      ['OUTCOME_NOT_FOUND', 'OUTCOME_UNKNOWN', 'NOT_FOUND', 404],
      ['OUTCOME_INDETERMINATE', 'OUTCOME_UNKNOWN', 'OUTCOME_UNKNOWN', 503],
    ] as const) {
      expect(
        decodeFrontendKnowledgeDraftFailureV1({
          schemaVersion: '1.0.0',
          code,
          normalizedCode,
          category,
          httpStatus,
          retryable: false,
          message: `${code} is preserved.`,
        }).code,
      ).toBe(code);
    }
    expectContractError(() =>
      decodeFrontendKnowledgeDraftFailureV1({
        schemaVersion: '1.0.0',
        code: 'ACCESS_REVOKED',
        normalizedCode: 'CONFLICT',
        category: 'AUTHORIZATION',
        httpStatus: 403,
        retryable: false,
        message: 'Access was revoked.',
      }),
    );
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
