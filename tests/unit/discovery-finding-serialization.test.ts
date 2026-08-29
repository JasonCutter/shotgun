import discoveryFindingSchema from '../../packages/contracts/schemas/discovery-finding.v1.schema.json';
import {
  assertJsonSchema,
  createDiscoveryFindingEnvelopeV1,
  deserializeDiscoveryFindingEnvelopeV1,
  DISCOVERY_FINDING_TYPES,
  serializeDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeInputV1,
  type DiscoveryFindingPayloadV1,
  type DiscoveryFindingProvenanceV1,
  type DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';

const ref = (
  resourceId: string,
  overrides: Partial<DiscoveryResourceRefV1> = {},
): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_CLAIM',
  resourceId,
  projectId: 'project-serialization',
  resourceState: 'CURRENT',
  ...overrides,
});

const deterministic: DiscoveryFindingProvenanceV1 = {
  schemaVersion: '1.0.0',
  kind: 'DETERMINISTIC',
  ruleId: 'discovery.serialization.test',
  ruleVersion: '1',
  inputDigest: 'sha256:serialization-input',
};

const aiDetails = {
  providerId: 'provider-serialization',
  modelId: 'model-serialization',
  modelVersion: '2026-08',
  aiConfigurationRevision: 'config-1',
  credentialId: 'credential-1',
  credentialRevision: 'credential-revision-1',
  providerPolicyFingerprint: 'sha256:provider-policy',
  privacyPolicyRevision: 'privacy-1',
  dataPolicyRevision: 'data-1',
  promptVersion: 'prompt-1',
  outputSchemaVersion: 'output-1',
} as const;

const base = (
  findingType: DiscoveryFindingPayloadV1['payloadType'],
  payload: DiscoveryFindingPayloadV1,
  relatedResourceRefs: readonly DiscoveryResourceRefV1[],
  overrides: Partial<DiscoveryFindingEnvelopeInputV1> = {},
): DiscoveryFindingEnvelopeInputV1 =>
  ({
    schemaVersion: '1.0.0',
    findingId: `finding-${findingType.toLowerCase()}`,
    findingRevision: 1,
    projectId: 'project-serialization',
    findingType,
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload,
    relatedResourceRefs,
    evidenceIds: ['evidence-serialization'],
    sourceProjectionDigest: 'sha256:projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: 'sha256:canonical',
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-1',
      projectionDigest: 'sha256:discovery',
    },
    runId: 'run-serialization',
    signalSummary: { semanticSimilarity: 0.75, novelty: 0.2 },
    rationale: 'A bounded signal is preserved at the wire boundary.',
    derivationSummary: 'Derived from the current project projection.',
    provenance: deterministic,
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: 'sha256:finding',
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  }) as DiscoveryFindingEnvelopeInputV1;

const payloads = (): readonly {
  readonly findingType: DiscoveryFindingPayloadV1['payloadType'];
  readonly payload: DiscoveryFindingPayloadV1;
  readonly refs: readonly DiscoveryResourceRefV1[];
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
      refs: [],
    },
    {
      findingType: 'EVIDENCE_GAP',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'EVIDENCE_GAP',
        coverageKind: 'INSUFFICIENT',
        affectedResourceRef: claimA,
        coverageGap: 'The claim has incomplete supporting evidence.',
        requiredEvidence: 'A current source version is required.',
      },
      refs: [claimA],
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
      refs: [claimA, claimB],
    },
    {
      findingType: 'PATTERN_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'PATTERN_HYPOTHESIS',
        patternKind: 'CLUSTER',
        memberResourceRefs: [claimA, claimB],
        patternIdentity: 'cluster:claim-a-claim-b',
        patternStatement: 'These claims repeatedly occur in one context.',
      },
      refs: [claimA, claimB],
    },
    {
      findingType: 'CONFLICT_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CONFLICT_HYPOTHESIS',
        participatingResourceRefs: [claimA, claimB],
        contradictionKind: 'FACTUAL',
        possibleContradiction: 'The claims assert incompatible values.',
      },
      refs: [claimA, claimB],
    },
    {
      findingType: 'CLARIFICATION_QUESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CLARIFICATION_QUESTION',
        investigationTargetRefs: [conflict],
        question: 'Which evidence resolves the conflict?',
        context: 'The conflict is a current resource.',
        proposedNextStep: 'Ask the owner to identify the authoritative source.',
      },
      refs: [conflict],
    },
    {
      findingType: 'ACTION_SUGGESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'ACTION_SUGGESTION',
        suggestedAction: 'Review the claims together.',
        rationale: 'A human must decide whether the possible contradiction is real.',
        affectedResourceRefs: [claimA, claimB],
        riskContext: 'No action is executed automatically.',
        executionStatus: 'CANDIDATE_ONLY',
      },
      refs: [claimA, claimB],
    },
  ];
};

describe('AKP-2 WP4 Discovery finding serialization boundary', () => {
  it('round-trips every frozen V1 finding type without reinterpretation', () => {
    expect(payloads()).toHaveLength(DISCOVERY_FINDING_TYPES.length);
    for (const entry of payloads()) {
      const finding = createDiscoveryFindingEnvelopeV1(
        base(entry.findingType, entry.payload, entry.refs),
      );
      const restored = deserializeDiscoveryFindingEnvelopeV1(
        serializeDiscoveryFindingEnvelopeV1(finding),
      );
      expect(restored).toEqual(finding);
      expect(restored.payload.payloadType).toBe(entry.findingType);
    }
  });

  it('preserves deterministic, AI-assisted, and HYBRID provenance identity', () => {
    const entry = payloads()[0]!;
    const ai: DiscoveryFindingProvenanceV1 = {
      schemaVersion: '1.0.0',
      kind: 'AI_ASSISTED',
      ...aiDetails,
    };
    const hybrid: DiscoveryFindingProvenanceV1 = {
      schemaVersion: '1.0.0',
      kind: 'HYBRID',
      deterministic: {
        ruleId: deterministic.ruleId,
        ruleVersion: deterministic.ruleVersion,
        inputDigest: deterministic.inputDigest,
      },
      aiExecution: aiDetails,
    };
    for (const [generationMethod, provenance] of [
      ['DETERMINISTIC', deterministic],
      ['AI_ASSISTED', ai],
      ['HYBRID', hybrid],
    ] as const) {
      const finding = createDiscoveryFindingEnvelopeV1(
        base(entry.findingType, entry.payload, entry.refs, { generationMethod, provenance }),
      );
      const restored = deserializeDiscoveryFindingEnvelopeV1(
        serializeDiscoveryFindingEnvelopeV1(finding),
      );
      expect(restored.provenance).toEqual(provenance);
      if (restored.provenance.kind !== 'DETERMINISTIC') {
        expect(restored.provenance).toMatchObject({
          kind: restored.provenance.kind,
          ...(restored.provenance.kind === 'HYBRID' ? { aiExecution: aiDetails } : aiDetails),
        });
      }
    }
  });

  it('matches the golden V1 wire fixture and preserves all meaningful envelope fields', async () => {
    const fixture = (await import('../fixtures/discovery-finding.v1.json')).default;
    const restored = deserializeDiscoveryFindingEnvelopeV1(JSON.stringify(fixture));
    expect(restored).toEqual(fixture);
    expect(restored.status).toBe('DERIVED_INFERENCE');
    expect(restored.retentionClass).toBe('DURABLE_DERIVED_RECORD');
    expect(restored.lifecycleState).toBe('RESOLVED');
    expect(restored.relatedResourceRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceKind: 'CANONICAL_DECISION' })]),
    );
    expect(serializeDiscoveryFindingEnvelopeV1(restored)).toBe(JSON.stringify(fixture));
    assertJsonSchema(discoveryFindingSchema, fixture, 'Discovery Finding V1');
  });

  it('fails closed for malformed JSON, future versions, unknown fields, unsafe status, and executable actions', () => {
    expect(() => deserializeDiscoveryFindingEnvelopeV1('{')).toThrow(/valid JSON/);
    const entry = payloads()[0]!;
    const finding = createDiscoveryFindingEnvelopeV1(
      base(entry.findingType, entry.payload, entry.refs),
    );
    expect(() => deserializeDiscoveryFindingEnvelopeV1(JSON.stringify({}))).toThrow();
    expect(() =>
      deserializeDiscoveryFindingEnvelopeV1(JSON.stringify({ ...finding, schemaVersion: '2.0.0' })),
    ).toThrow();
    expect(() =>
      deserializeDiscoveryFindingEnvelopeV1(
        JSON.stringify({ ...finding, unrecognizedField: true }),
      ),
    ).toThrow(/unknown field/);
    expect(() =>
      deserializeDiscoveryFindingEnvelopeV1(JSON.stringify({ ...finding, status: 'FACT' })),
    ).toThrow();
    expect(() =>
      deserializeDiscoveryFindingEnvelopeV1(
        JSON.stringify({ ...finding, retentionClass: 'EPHEMERAL_PRE_MATERIALIZATION' }),
      ),
    ).toThrow();

    const action = payloads().find((candidate) => candidate.findingType === 'ACTION_SUGGESTION')!;
    expect(() =>
      deserializeDiscoveryFindingEnvelopeV1(
        JSON.stringify({
          ...createDiscoveryFindingEnvelopeV1(
            base(action.findingType, action.payload, action.refs),
          ),
          payload: { ...action.payload, executionStatus: 'EXECUTABLE' },
        }),
      ),
    ).toThrow();
  });
});
