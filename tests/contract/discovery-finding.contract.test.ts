import { describe, expect, it } from 'vitest';

import type {
  DiscoveryFindingEnvelopeInputV1,
  DiscoveryFindingPayloadV1,
  DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import {
  DISCOVERY_FINDING_LIFECYCLE_STATES,
  DISCOVERY_FINDING_TYPES,
  DISCOVERY_REENTRY_TARGET_BY_TYPE,
  composeDiscoveryFindingSecurityV1,
  createDiscoveryFindingEnvelopeV1,
  decodeDiscoveryFindingEnvelopeV1,
  discoveryReentryTargetFor,
  normalizeDiscoveryFingerprintInputV1,
} from '../../packages/contracts/src/index.js';
import type { DerivedInferenceCandidate } from '../../packages/contracts/src/index.js';

const ref = (
  resourceId: string,
  overrides: Partial<DiscoveryResourceRefV1> = {},
): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_CLAIM',
  resourceId,
  projectId: 'project-1',
  resourceState: 'CURRENT',
  ...overrides,
});

const deterministicProvenance = {
  schemaVersion: '1.0.0' as const,
  kind: 'DETERMINISTIC' as const,
  ruleId: 'discovery.rule.gap',
  ruleVersion: '3',
  inputDigest: 'sha256:input',
};

const baseEnvelope = (
  findingType: DiscoveryFindingPayloadV1['payloadType'],
  payload: DiscoveryFindingPayloadV1,
  relatedResourceRefs: readonly DiscoveryResourceRefV1[] = [],
  overrides: Partial<
    Pick<DiscoveryFindingEnvelopeInputV1, 'generationMethod' | 'provenance' | 'signalSummary'>
  > = {},
): DiscoveryFindingEnvelopeInputV1 =>
  ({
    schemaVersion: '1.0.0',
    findingId: `finding-${findingType.toLowerCase()}`,
    findingRevision: 1,
    projectId: 'project-1',
    findingType,
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload,
    relatedResourceRefs,
    evidenceIds: ['evidence-1'],
    sourceProjectionDigest: 'sha256:projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 4,
      snapshotDigest: 'sha256:canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-revision-4',
      projectionDigest: 'sha256:discovery-projection',
    },
    runId: 'run-1',
    signalSummary: { semanticSimilarity: 0.8, novelty: 0.4 },
    rationale: 'The bounded discovery signal identifies a reviewable gap.',
    derivationSummary: 'Derived from the pinned projection and source evidence.',
    provenance: deterministicProvenance,
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: 'sha256:finding',
    fingerprintVersion: 'discovery-fingerprint-v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  }) as DiscoveryFindingEnvelopeInputV1;

const validPayloads = (): readonly {
  readonly findingType: DiscoveryFindingPayloadV1['payloadType'];
  readonly payload: DiscoveryFindingPayloadV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
}[] => {
  const claimA = ref('claim-a');
  const claimB = ref('claim-b');
  const conflict = ref('conflict-1', { resourceKind: 'CANONICAL_CONFLICT' });
  return [
    {
      findingType: 'KNOWLEDGE_GAP',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'Milo',
        missingFact: 'current weight',
        question: "What is Milo's current weight?",
      },
      relatedResourceRefs: [],
    },
    {
      findingType: 'EVIDENCE_GAP',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'EVIDENCE_GAP',
        coverageKind: 'INSUFFICIENT',
        affectedResourceRef: claimA,
        coverageGap: 'The approved claim has only one weak supporting source.',
        requiredEvidence: 'A current first-party source is required.',
      },
      relatedResourceRefs: [claimA],
    },
    {
      findingType: 'RELATION_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'RELATION_HYPOTHESIS',
        sourceEndpoint: claimA,
        targetEndpoint: claimB,
        proposedRelationType: 'DEPENDS_ON',
        direction: 'DIRECTED',
      },
      relatedResourceRefs: [claimA, claimB],
    },
    {
      findingType: 'PATTERN_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'PATTERN_HYPOTHESIS',
        patternKind: 'CLUSTER',
        memberResourceRefs: [claimA, claimB],
        patternIdentity: 'cluster:claims-a-b',
        patternStatement: 'These claims repeatedly occur in the same context.',
      },
      relatedResourceRefs: [claimA, claimB],
    },
    {
      findingType: 'CONFLICT_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CONFLICT_HYPOTHESIS',
        participatingResourceRefs: [claimA, claimB],
        contradictionKind: 'FACTUAL',
        possibleContradiction: 'The two current claims assert incompatible values.',
      },
      relatedResourceRefs: [claimA, claimB],
    },
    {
      findingType: 'CLARIFICATION_QUESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CLARIFICATION_QUESTION',
        investigationTargetRefs: [conflict],
        question: 'Which evidence resolves the known conflict?',
        context: 'The conflict is already registered as a current resource.',
        proposedNextStep: 'Ask the owner to identify the authoritative source.',
      },
      relatedResourceRefs: [conflict],
    },
    {
      findingType: 'ACTION_SUGGESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'ACTION_SUGGESTION',
        suggestedAction: 'Review the two claims together.',
        rationale: 'A human review can determine whether the possible contradiction is real.',
        affectedResourceRefs: [claimA, claimB],
        riskContext: 'No action is proposed automatically.',
        executionStatus: 'CANDIDATE_ONLY',
      },
      relatedResourceRefs: [claimA, claimB],
    },
  ];
};

describe('AKP-2 WP1 Discovery finding contracts', () => {
  it('freezes exactly seven types and validates a distinct payload for each', () => {
    expect(DISCOVERY_FINDING_TYPES).toHaveLength(7);
    expect(new Set(validPayloads().map((entry) => entry.findingType)).size).toBe(7);
    for (const entry of validPayloads()) {
      const decoded = createDiscoveryFindingEnvelopeV1(
        baseEnvelope(entry.findingType, entry.payload, entry.relatedResourceRefs),
      );
      expect(decoded.findingType).toBe(entry.findingType);
      expect(decoded.payload.payloadType).toBe(entry.findingType);
    }
  });

  it('keeps the four Knowledge Gap meanings distinct', () => {
    const conflict = ref('conflict-1', { resourceKind: 'CANONICAL_CONFLICT' });
    const variants = [
      {
        gapKind: 'MISSING_FACT' as const,
        subject: 'Milo',
        missingFact: 'current weight',
        question: "What is Milo's current weight?",
      },
      {
        gapKind: 'TEMPORAL_GAP' as const,
        subject: 'Milo',
        missingTimeDescription: 'the interval after the last review',
        question: 'What changed during that interval?',
      },
      {
        gapKind: 'UNDEFINED_TERM' as const,
        term: 'canonicality',
        context: 'The review note uses the term without defining it.',
        question: 'What does canonicality mean here?',
      },
      {
        gapKind: 'KNOWN_CONFLICT_QUESTION' as const,
        knownConflictRef: conflict,
        missingResolutionInput: 'an owner decision and stronger evidence',
        question: 'What evidence would resolve the known conflict?',
      },
    ];
    for (const variant of variants) {
      const relatedResourceRefs = variant.gapKind === 'KNOWN_CONFLICT_QUESTION' ? [conflict] : [];
      const decoded = createDiscoveryFindingEnvelopeV1(
        baseEnvelope(
          'KNOWLEDGE_GAP',
          { schemaVersion: '1.0.0', payloadType: 'KNOWLEDGE_GAP', ...variant },
          relatedResourceRefs,
        ),
      );
      expect(
        (decoded.payload as Extract<DiscoveryFindingPayloadV1, { payloadType: 'KNOWLEDGE_GAP' }>)
          .gapKind,
      ).toBe(variant.gapKind);
    }
    const invalidConflict = {
      ...variants[3]!,
      knownConflictRef: ref('claim-not-conflict'),
    };
    expect(() =>
      createDiscoveryFindingEnvelopeV1(
        baseEnvelope(
          'KNOWLEDGE_GAP',
          {
            schemaVersion: '1.0.0',
            payloadType: 'KNOWLEDGE_GAP',
            ...invalidConflict,
          },
          [invalidConflict.knownConflictRef],
        ),
      ),
    ).toThrow(/CANONICAL_CONFLICT/);
  });

  it('rejects invalid type/payload combinations and unknown authority fields', () => {
    const relation = validPayloads().find((entry) => entry.findingType === 'RELATION_HYPOTHESIS')!;
    const invalid = baseEnvelope('EVIDENCE_GAP', relation.payload, relation.relatedResourceRefs);
    expect(() => decodeDiscoveryFindingEnvelopeV1(invalid)).toThrow();

    const action = validPayloads().find((entry) => entry.findingType === 'ACTION_SUGGESTION')!;
    const forged = {
      ...baseEnvelope('ACTION_SUGGESTION', action.payload, action.relatedResourceRefs),
      payload: { ...action.payload, connectorRequest: { command: 'execute' } },
    };
    expect(() => decodeDiscoveryFindingEnvelopeV1(forged)).toThrow(/unknown field/);
  });

  it('enforces DERIVED_INFERENCE and the closed generation method vocabulary', () => {
    const entry = validPayloads()[0]!;
    const finding = createDiscoveryFindingEnvelopeV1(
      baseEnvelope(entry.findingType, entry.payload, entry.relatedResourceRefs),
    );
    expect(finding.status).toBe('DERIVED_INFERENCE');
    expect(() =>
      decodeDiscoveryFindingEnvelopeV1({
        ...finding,
        status: 'FACT',
      }),
    ).toThrow();
    expect(() =>
      decodeDiscoveryFindingEnvelopeV1({
        ...finding,
        generationMethod: 'MODEL_INFERRED',
      }),
    ).toThrow();
  });

  it('keeps deterministic, AI and hybrid provenance typed and non-secret', () => {
    const entry = validPayloads()[0]!;
    const aiProvenance = {
      schemaVersion: '1.0.0' as const,
      kind: 'AI_ASSISTED' as const,
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      modelVersion: '2026-08-20',
      configurationRevision: 'config-7',
      credentialRevision: 'credential-3',
      privacyPolicyRevision: 'privacy-2',
      dataPolicyRevision: 'provider-policy-4',
      promptVersion: 'discovery-v1',
      outputSchemaVersion: 'finding-payload-v1',
    };
    const ai = createDiscoveryFindingEnvelopeV1(
      baseEnvelope(entry.findingType, entry.payload, entry.relatedResourceRefs, {
        generationMethod: 'AI_ASSISTED',
        provenance: aiProvenance,
      }),
    );
    expect(ai.provenance).toMatchObject({
      providerId: 'openai',
      credentialRevision: 'credential-3',
    });
    expect(ai.provenance).not.toHaveProperty('credentialPlaintext');

    const hybrid = createDiscoveryFindingEnvelopeV1(
      baseEnvelope(entry.findingType, entry.payload, entry.relatedResourceRefs, {
        generationMethod: 'HYBRID',
        provenance: {
          schemaVersion: '1.0.0',
          kind: 'HYBRID',
          deterministic: {
            ruleId: 'discovery.rule.hybrid',
            ruleVersion: '2',
            inputDigest: 'sha256:hybrid-input',
          },
          aiExecution: {
            providerId: aiProvenance.providerId,
            modelId: aiProvenance.modelId,
            modelVersion: aiProvenance.modelVersion,
            configurationRevision: aiProvenance.configurationRevision,
            credentialRevision: aiProvenance.credentialRevision,
            privacyPolicyRevision: aiProvenance.privacyPolicyRevision,
            dataPolicyRevision: aiProvenance.dataPolicyRevision,
            promptVersion: aiProvenance.promptVersion,
            outputSchemaVersion: aiProvenance.outputSchemaVersion,
          },
        },
      }),
    );
    expect(hybrid.provenance.kind).toBe('HYBRID');
    expect(hybrid.provenance).toHaveProperty('deterministic');
    expect(hybrid.provenance).toHaveProperty('aiExecution');

    expect(() =>
      decodeDiscoveryFindingEnvelopeV1({
        ...ai,
        provenance: { ...aiProvenance, apiKey: 'secret' },
      }),
    ).toThrow(/unknown field/);
  });

  it('composes same-project security restrictively and deterministically', () => {
    const result = composeDiscoveryFindingSecurityV1({
      findingProjectId: 'project-1',
      resources: [
        {
          projectId: 'project-1',
          accessScope: ['owner', 'reviewer', 'owner'],
          sensitivity: 'internal',
        },
        { projectId: 'project-1', accessScope: ['reviewer', 'owner'], sensitivity: 'restricted' },
      ],
      executionContext: {
        projectId: 'project-1',
        accessScope: ['owner', 'reviewer', 'reader'],
        sensitivity: 'public',
      },
    });
    expect(result).toEqual({
      materializable: true,
      projectId: 'project-1',
      accessScope: ['owner', 'reviewer'],
      sensitivity: 'restricted',
    });
  });

  it('rejects cross-project composition and an empty safe scope intersection', () => {
    expect(
      composeDiscoveryFindingSecurityV1({
        findingProjectId: 'project-1',
        resources: [
          { projectId: 'project-1', accessScope: ['owner'], sensitivity: 'internal' },
          { projectId: 'project-2', accessScope: ['owner'], sensitivity: 'internal' },
        ],
        executionContext: {
          projectId: 'project-1',
          accessScope: ['owner'],
          sensitivity: 'internal',
        },
      }),
    ).toEqual({ materializable: false, reason: 'CROSS_PROJECT' });

    expect(
      composeDiscoveryFindingSecurityV1({
        findingProjectId: 'project-1',
        resources: [{ projectId: 'project-1', accessScope: ['owner'], sensitivity: 'internal' }],
        executionContext: {
          projectId: 'project-1',
          accessScope: ['reviewer'],
          sensitivity: 'internal',
        },
      }),
    ).toEqual({ materializable: false, reason: 'NO_COMMON_ACCESS_SCOPE' });
  });

  it('keeps signals separate from epistemic authority', () => {
    const entry = validPayloads()[0]!;
    const finding = createDiscoveryFindingEnvelopeV1(
      baseEnvelope(entry.findingType, entry.payload, entry.relatedResourceRefs, {
        signalSummary: {
          semanticSimilarity: 1,
          semanticRank: 1,
          evidenceCoverage: 0.1,
          novelty: 0.9,
        },
      }),
    );
    expect(finding.signalSummary).toMatchObject({ semanticSimilarity: 1, evidenceCoverage: 0.1 });
    expect(() =>
      decodeDiscoveryFindingEnvelopeV1({
        ...finding,
        signalSummary: { truthConfidence: 1 },
      }),
    ).toThrow(/unknown field/);
  });

  it('makes Action Suggestion candidate-only and structurally non-executable', () => {
    const entry = validPayloads().find((item) => item.findingType === 'ACTION_SUGGESTION')!;
    const finding = createDiscoveryFindingEnvelopeV1(
      baseEnvelope(entry.findingType, entry.payload, entry.relatedResourceRefs),
    );
    expect(finding.payload).toMatchObject({ executionStatus: 'CANDIDATE_ONLY' });
    expect(() =>
      decodeDiscoveryFindingEnvelopeV1({
        ...finding,
        payload: { ...finding.payload, executionStatus: 'EXECUTE' },
      }),
    ).toThrow();
    expect(() =>
      decodeDiscoveryFindingEnvelopeV1({
        ...finding,
        payload: { ...finding.payload, approvalToken: 'approved' },
      }),
    ).toThrow(/unknown field/);
  });

  it('freezes lifecycle, versioned fingerprint inputs and seven non-mutating re-entry intents', () => {
    expect(DISCOVERY_FINDING_LIFECYCLE_STATES).toEqual([
      'NEW',
      'VALIDATING',
      'REVIEW_READY',
      'REENTERED',
      'DISMISSED',
      'SUPPRESSED',
      'RESOLVED',
      'STALE',
      'SUPERSEDED',
    ]);
    const a = ref('a', { resourceRevision: '2' });
    const b = ref('b', { resourceRevision: '1' });
    const normalized = normalizeDiscoveryFingerprintInputV1({
      findingType: 'RELATION_HYPOTHESIS',
      relatedResourceRefs: [b, a],
      semanticEssence: '  a depends on b  ',
      fingerprintVersion: 'discovery-fingerprint-v1',
    });
    expect(normalized).toEqual({
      findingType: 'RELATION_HYPOTHESIS',
      relatedResourceRefs: [a, b],
      semanticEssence: 'a depends on b',
      fingerprintVersion: 'discovery-fingerprint-v1',
    });
    expect(Object.keys(DISCOVERY_REENTRY_TARGET_BY_TYPE).sort()).toEqual(
      [...DISCOVERY_FINDING_TYPES].sort(),
    );
    for (const findingType of DISCOVERY_FINDING_TYPES) {
      expect(discoveryReentryTargetFor(findingType)).toBe(
        DISCOVERY_REENTRY_TARGET_BY_TYPE[findingType],
      );
    }
    expect(DISCOVERY_REENTRY_TARGET_BY_TYPE.ACTION_SUGGESTION).toBe('ACTION_CANDIDATE_GOVERNANCE');
  });

  it('leaves the historical Stage-10 candidate contract unchanged', () => {
    const legacyCandidate: DerivedInferenceCandidate = {
      candidateId: 'legacy-1',
      fingerprint: 'sha256:legacy',
      status: 'DERIVED_INFERENCE',
      candidateType: 'KNOWLEDGE_GAP',
      question: 'What is missing?',
      relatedNodeIds: [],
      evidenceIds: [],
      sourceProjectionDigest: 'sha256:projection',
      reentryPhase: 'VALIDATION',
      createdAt: '2026-08-28T00:00:00.000Z',
    };
    expect(legacyCandidate.candidateType).toBe('KNOWLEDGE_GAP');
    expect(legacyCandidate.reentryPhase).toBe('VALIDATION');
  });
});
