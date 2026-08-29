import { describe, expect, it, vi } from 'vitest';

import {
  computeDiscoveryFingerprintV1,
  createDiscoveryEffectiveStrategySetV1,
  createDiscoveryFindingEnvelopeV1,
  deriveDiscoverySemanticEssenceV1,
  semanticStableJson,
  sha256Text,
  type DiscoveryFindingEnvelopeInputV1,
  type DiscoveryFindingPayloadV1,
  type DiscoveryFindingProvenanceV1,
  type DiscoveryFindingType,
  type DiscoveryResourceKind,
  type DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';
import {
  createDiscoveryEngine,
  createDiscoverySignalFacade,
  createWp1DiscoveryStrategyRegistry,
  type DiscoverySignalPortsV1,
  type DiscoverySignalReadContextV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import {
  DiscoveryAIGenerationError,
  executeDiscoveryStrategiesV1,
} from '../../modules/discovery-ai-generation/src/index.js';
import {
  createDiscoveryQualityGateV1,
  DISCOVERY_RANKING_POLICY_VERSION_V1,
  rankAcceptedDiscoveryCandidatesV1,
  type DiscoveryQualityRevalidationPortV1,
} from '../../modules/discovery-quality-gate/src/index.js';

const FIXTURE_ID = 'akp-3-discovery-evaluation:v1' as const;
const projectId = 'wp5-synthetic-project';
const sourceProjectionDigest = 'sha256:wp5-synthetic-sources';
const canonicalBase = {
  schemaVersion: '1.0.0' as const,
  canonicalVersion: 1,
  snapshotDigest: 'sha256:wp5-synthetic-canonical',
};
const discoveryBase = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'wp5-discovery-v1',
  projectionDigest: 'sha256:wp5-synthetic-discovery',
};
const context = {
  projectId,
  accessScope: ['project:read'],
  sensitivity: 'internal' as const,
  sourceProjectionDigest,
  canonicalBase,
  discoveryBase,
};

const ref = (
  resourceId: string,
  resourceKind: DiscoveryResourceKind = 'CANONICAL_CLAIM',
  resourceState: 'CURRENT' | 'APPROVED' = 'CURRENT',
): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind,
  resourceId,
  projectId,
  resourceState,
  resourceRevision: '1',
});

const signalResource = (resource: DiscoveryResourceRefV1, label = resource.resourceId) => ({
  resource,
  label,
  evidenceIds: resource.resourceKind === 'CANONICAL_ENTITY' ? [] : ['evidence-wp5'],
  security: { projectId, accessScope: ['project:read'], sensitivity: 'internal' as const },
});

const emptySignalPorts = (): DiscoverySignalPortsV1 => ({
  compiledTruth: {
    read: vi.fn(async () => ({
      resources: [],
      sourceProjectionDigest,
      completeness: 'COMPLETE' as const,
    })),
  },
  hybridRetrieval: {
    read: vi.fn(async () => ({ resources: [], ranks: {}, completeness: 'COMPLETE' as const })),
  },
  graph: { read: vi.fn(async () => ({ edges: [], completeness: 'COMPLETE' as const })) },
  temporalConflict: {
    read: vi.fn(async () => ({ observations: [], completeness: 'COMPLETE' as const })),
  },
  evidenceCoverage: {
    read: vi.fn(async () => ({ resources: [], completeness: 'COMPLETE' as const })),
  },
});

const wp1Context: DiscoverySignalReadContextV1 = {
  schemaVersion: '1.0.0',
  projectId,
  accessScope: ['project:read'],
  sensitivity: 'internal',
  canonicalBase,
  discoveryBase,
  sourceProjectionDigest,
  bounds: { maxResourcesRead: 10, maxObservationsReturned: 10, maxFindingsEmitted: 10 },
};

const deterministicWp1Run = async () => {
  const ports = emptySignalPorts();
  const entity = signalResource(ref('entity-isolated', 'CANONICAL_ENTITY'), 'Isolated entity');
  ports.compiledTruth.read = vi.fn(async () => ({
    resources: [entity],
    sourceProjectionDigest,
    completeness: 'COMPLETE' as const,
  }));
  const finding = await createDiscoveryEngine({
    facade: createDiscoverySignalFacade(ports),
    registry: createWp1DiscoveryStrategyRegistry(),
  }).generateBudgeted({
    context: wp1Context,
    dependencies: {
      runId: 'wp5-run-deterministic',
      clock: { now: () => '2026-08-30T00:00:00.000Z' },
      findingIdFactory: ({ fingerprint }) => `wp5-${fingerprint.slice(-12)}`,
    },
  });
  return finding;
};

const aiProvenance = (): DiscoveryFindingProvenanceV1 => ({
  schemaVersion: '1.0.0',
  kind: 'AI_ASSISTED',
  providerId: 'fake-provider',
  modelId: 'fake-discovery-model',
  modelVersion: 'fake-model-v1',
  aiConfigurationRevision: 'ai-config-v1',
  credentialId: 'credential-identity-only',
  credentialRevision: 'credential-revision-1',
  providerPolicyFingerprint: 'sha256:fake-provider-policy',
  privacyPolicyRevision: 'privacy-policy-v1',
  dataPolicyRevision: 'data-policy-v1',
  promptVersion: 'discovery-ai-prompt:v1',
  outputSchemaVersion: 'discovery-ai-output:v1',
});

const aiExecution = () => {
  const provenance = aiProvenance();
  if (provenance.kind !== 'AI_ASSISTED') throw new Error('Unexpected fixture provenance kind');
  return {
    providerId: provenance.providerId,
    modelId: provenance.modelId,
    modelVersion: provenance.modelVersion,
    aiConfigurationRevision: provenance.aiConfigurationRevision,
    credentialId: provenance.credentialId,
    credentialRevision: provenance.credentialRevision,
    providerPolicyFingerprint: provenance.providerPolicyFingerprint,
    privacyPolicyRevision: provenance.privacyPolicyRevision,
    dataPolicyRevision: provenance.dataPolicyRevision,
    promptVersion: provenance.promptVersion,
    outputSchemaVersion: provenance.outputSchemaVersion,
  } as const;
};

const deterministicProvenance: DiscoveryFindingProvenanceV1 = {
  schemaVersion: '1.0.0',
  kind: 'DETERMINISTIC',
  ruleId: 'akp-3-wp5.synthetic-fixture',
  ruleVersion: '1.0.0',
  inputDigest: 'sha256:wp5-fixture-input',
};

const originIdentity = {
  schemaVersion: '1.0.0' as const,
  originFindingType: 'EVIDENCE_GAP' as const,
  fingerprintVersion: 'discovery-fingerprint:v1' as const,
  fingerprint: `sha256:${'1'.repeat(64)}` as `sha256:${string}`,
};

type FixtureEntry = {
  readonly candidate: ReturnType<typeof createDiscoveryFindingEnvelopeV1>;
  readonly fingerprintInput: {
    readonly findingType: DiscoveryFindingType;
    readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
    readonly semanticEssence: string;
  };
  readonly selectionSignals?: readonly {
    readonly kind: 'EXPLICIT_INCOMPATIBILITY';
    readonly incompatibilityKind: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
    readonly source:
      | 'TYPED_PROPOSITION'
      | 'TEMPORAL_QUALIFICATION'
      | 'IDENTITY_ASSIGNMENT'
      | 'EXPLICIT_CONFLICT_SIGNAL';
    readonly signalId: string;
  }[];
  readonly qualifiedFollowUp?: {
    readonly originIdentity: typeof originIdentity;
    readonly projectId: string;
    readonly sourceProjectionDigest: string;
    readonly canonicalBase: typeof canonicalBase;
    readonly discoveryBase: typeof discoveryBase;
    readonly accessScope: readonly string[];
    readonly sensitivity: 'internal';
    readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  };
};

const authority = (overrides: Partial<DiscoveryQualityRevalidationPortV1> = {}) =>
  ({
    revalidateResource: vi.fn(async ({ resource }) => ({
      exists: true,
      eligible: true,
      projectId: resource.projectId,
      accessScope: ['project:read'],
      sensitivity: 'internal' as const,
    })),
    revalidateEvidence: vi.fn(async () => ({
      exists: true,
      eligible: true,
      projectId,
      identityValid: true,
    })),
    findByFingerprint: vi.fn(async () => []),
    findAuthoritativeEquivalent: vi.fn(async () => false),
    ...overrides,
  }) satisfies DiscoveryQualityRevalidationPortV1;

const makeEntry = (input: {
  readonly findingType: DiscoveryFindingType;
  readonly payload: DiscoveryFindingPayloadV1;
  readonly relatedResourceRefs: readonly DiscoveryResourceRefV1[];
  readonly generationMethod?: 'DETERMINISTIC' | 'AI_ASSISTED' | 'HYBRID';
  readonly semanticEssence?: string;
}): FixtureEntry => {
  const generationMethod = input.generationMethod ?? 'AI_ASSISTED';
  const semanticEssence =
    input.semanticEssence ??
    (input.findingType === 'KNOWLEDGE_GAP' || input.findingType === 'EVIDENCE_GAP'
      ? `wp5:${input.findingType}:${input.relatedResourceRefs.map((entry) => entry.resourceId).join(',')}`
      : deriveDiscoverySemanticEssenceV1({
          findingType: input.findingType,
          payload: input.payload,
          originIdentity:
            input.findingType === 'CLARIFICATION_QUESTION' ||
            input.findingType === 'ACTION_SUGGESTION'
              ? originIdentity
              : undefined,
        }));
  const fingerprint = computeDiscoveryFingerprintV1({
    findingType: input.findingType,
    relatedResourceRefs: input.relatedResourceRefs,
    semanticEssence,
  });
  const provenance: DiscoveryFindingProvenanceV1 =
    generationMethod === 'DETERMINISTIC'
      ? deterministicProvenance
      : generationMethod === 'AI_ASSISTED'
        ? aiProvenance()
        : {
            schemaVersion: '1.0.0',
            kind: 'HYBRID',
            deterministic: {
              ruleId: 'akp-3-wp5.synthetic-selector',
              ruleVersion: '1.0.0',
              inputDigest: 'sha256:wp5-selector-input',
            },
            aiExecution: aiExecution(),
          };
  const candidate = createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: `wp5-${input.findingType.toLowerCase()}`,
    findingRevision: 1,
    projectId,
    findingType: input.findingType,
    generationMethod,
    lifecycleState: 'NEW',
    payload: input.payload,
    relatedResourceRefs: input.relatedResourceRefs,
    evidenceIds:
      input.findingType === 'KNOWLEDGE_GAP' || input.findingType === 'EVIDENCE_GAP'
        ? []
        : ['evidence-wp5'],
    sourceProjectionDigest,
    canonicalBase,
    discoveryBase,
    runId: 'wp5-synthetic-run',
    signalSummary: { novelty: 0.5, evidenceCoverage: 0.5 },
    rationale: 'Synthetic WP5 acceptance fixture.',
    derivationSummary: 'Bounded server-owned synthetic evaluation path.',
    provenance,
    accessScope: ['project:read'],
    sensitivity: 'internal',
    fingerprint: fingerprint.fingerprint,
    fingerprintVersion: fingerprint.fingerprintVersion,
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-30T00:00:00.000Z',
  } as DiscoveryFindingEnvelopeInputV1);
  const qualifiedFollowUp =
    input.findingType === 'CLARIFICATION_QUESTION' || input.findingType === 'ACTION_SUGGESTION'
      ? {
          originIdentity,
          projectId,
          sourceProjectionDigest,
          canonicalBase,
          discoveryBase,
          accessScope: ['project:read'],
          sensitivity: 'internal' as const,
          relatedResourceRefs: input.relatedResourceRefs,
        }
      : undefined;
  return {
    candidate,
    fingerprintInput: {
      findingType: input.findingType,
      relatedResourceRefs: input.relatedResourceRefs,
      semanticEssence,
    },
    ...(qualifiedFollowUp === undefined ? {} : { qualifiedFollowUp }),
  };
};

const evaluate = async (
  entry: FixtureEntry,
  selectionSignals: FixtureEntry['selectionSignals'] = entry.selectionSignals,
  revalidation = authority(),
) =>
  createDiscoveryQualityGateV1(revalidation).evaluate({
    candidate: entry.candidate,
    fingerprintInput: entry.fingerprintInput,
    context,
    ...(selectionSignals === undefined ? {} : { selectionSignals }),
    ...(entry.qualifiedFollowUp === undefined
      ? {}
      : { qualifiedFollowUp: entry.qualifiedFollowUp }),
  });

const fixtureEntries = (): readonly FixtureEntry[] => {
  const entity = ref('entity-knowledge-gap', 'CANONICAL_ENTITY');
  const claimA = ref('claim-a');
  const claimB = ref('claim-b');
  const conflict = ref('conflict-1', 'CANONICAL_CONFLICT');
  return [
    makeEntry({
      findingType: 'KNOWLEDGE_GAP',
      generationMethod: 'DETERMINISTIC',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: entity.resourceId,
        missingFact: 'the missing approved context',
        question: 'What approved context is missing?',
      },
      relatedResourceRefs: [entity],
    }),
    makeEntry({
      findingType: 'EVIDENCE_GAP',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'EVIDENCE_GAP',
        coverageKind: 'ABSENT',
        affectedResourceRef: claimA,
        coverageGap: 'No evidence lineage is attached.',
        requiredEvidence: 'Attach approved evidence.',
      },
      relatedResourceRefs: [claimA],
    }),
    makeEntry({
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
    }),
    makeEntry({
      findingType: 'PATTERN_HYPOTHESIS',
      generationMethod: 'HYBRID',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'PATTERN_HYPOTHESIS',
        patternKind: 'RECURRING_ASSOCIATION',
        memberResourceRefs: [claimA, claimB],
        patternIdentity: 'pattern:claim-a-claim-b',
        patternStatement: 'The typed members recur together in the bounded context.',
      },
      relatedResourceRefs: [claimA, claimB],
    }),
    makeEntry({
      findingType: 'CONFLICT_HYPOTHESIS',
      generationMethod: 'HYBRID',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CONFLICT_HYPOTHESIS',
        participatingResourceRefs: [claimA, claimB],
        contradictionKind: 'FACTUAL',
        possibleContradiction: 'The two bounded claims assert incompatible values.',
      },
      relatedResourceRefs: [claimA, claimB],
    }),
    makeEntry({
      findingType: 'CLARIFICATION_QUESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CLARIFICATION_QUESTION',
        investigationTargetRefs: [conflict],
        question: 'Which evidence resolves this candidate conflict?',
        context: 'The conflict resource is an accepted upstream context.',
        proposedNextStep: 'Ask the owner to identify the stronger evidence.',
      },
      relatedResourceRefs: [conflict],
    }),
    makeEntry({
      findingType: 'ACTION_SUGGESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'ACTION_SUGGESTION',
        suggestedAction: 'Review the two bounded claims together.',
        rationale: 'Human review is required; no external execution is requested.',
        affectedResourceRefs: [claimA, claimB],
        executionStatus: 'CANDIDATE_ONLY',
      },
      relatedResourceRefs: [claimA, claimB],
    }),
  ];
};

const conflictSignal = (
  incompatibilityKind: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT',
) => ({
  kind: 'EXPLICIT_INCOMPATIBILITY' as const,
  incompatibilityKind,
  source: {
    FACTUAL: 'TYPED_PROPOSITION',
    TEMPORAL: 'TEMPORAL_QUALIFICATION',
    IDENTITY: 'IDENTITY_ASSIGNMENT',
    MODEL_DISAGREEMENT: 'EXPLICIT_CONFLICT_SIGNAL',
  }[incompatibilityKind] as
    | 'TYPED_PROPOSITION'
    | 'TEMPORAL_QUALIFICATION'
    | 'IDENTITY_ASSIGNMENT'
    | 'EXPLICIT_CONFLICT_SIGNAL',
  signalId: `wp5-${incompatibilityKind.toLowerCase()}-signal`,
});

describe('AKP-3 WP5 Discovery evaluation, degradation and security closure', () => {
  it('freezes a deterministic synthetic fixture identity and the seven-type positive matrix', async () => {
    const entries = fixtureEntries();
    const fixtureDigest = sha256Text(
      semanticStableJson({
        fixtureId: FIXTURE_ID,
        cases: entries.map((entry) => ({
          findingType: entry.candidate.findingType,
          fingerprint: entry.candidate.fingerprint,
          payload: entry.candidate.payload,
        })),
      }),
    );
    expect(FIXTURE_ID).toBe('akp-3-discovery-evaluation:v1');
    expect(fixtureDigest).toBe(
      'sha256:04ed2fa202844c4f9f6babe7c491ca81c3e40e9f44ebc7401354d72d40f333bc',
    );
    expect(entries).toHaveLength(7);
    expect(new Set(entries.map((entry) => entry.candidate.findingType)).size).toBe(7);
    for (const entry of entries) {
      const result = await evaluate(
        entry,
        entry.candidate.findingType === 'CONFLICT_HYPOTHESIS'
          ? [conflictSignal('FACTUAL')]
          : undefined,
      );
      expect(result.disposition).toBe('ACCEPTED');
    }
  });

  it('repeats pure evaluation with identical identities, dispositions and ranking order', async () => {
    const evaluateFixture = async () => {
      const entries = fixtureEntries();
      const evaluations = await Promise.all(
        entries.map((entry) =>
          evaluate(
            entry,
            entry.candidate.findingType === 'CONFLICT_HYPOTHESIS'
              ? [conflictSignal('FACTUAL')]
              : undefined,
          ),
        ),
      );
      const ranked = rankAcceptedDiscoveryCandidatesV1(
        entries.map((entry) => ({
          candidate: entry.candidate,
          dimensions: {
            novelty: 0.5,
            projectRelevance: 0.5,
            evidenceCoverage: 0.5,
            impactReach: 0.5,
            temporalUrgency: 0.5,
            redundancyPenalty: 0.1,
            costRiskPenalty: 0.1,
          },
        })),
        {
          version: DISCOVERY_RANKING_POLICY_VERSION_V1,
          weights: {
            novelty: 0.5,
            projectRelevance: 0.5,
            evidenceCoverage: 0.5,
            impactReach: 0.5,
            temporalUrgency: 0.5,
            redundancyPenalty: 0.1,
            costRiskPenalty: 0.1,
          },
        },
      );
      return semanticStableJson({
        candidates: entries.map((entry) => ({
          findingId: entry.candidate.findingId,
          fingerprint: entry.candidate.fingerprint,
          semanticEssence: entry.fingerprintInput.semanticEssence,
        })),
        dispositions: evaluations.map((result) => ({
          disposition: result.disposition,
          reasonCode:
            result.disposition === 'ACCEPTED'
              ? null
              : 'reasonCode' in result
                ? result.reasonCode
                : result.reason,
        })),
        ranking: ranked.map((entry) => ({
          findingId: entry.candidate.findingId,
          fingerprint: entry.candidate.fingerprint,
          scoreMicros: entry.scoreMicros,
        })),
      });
    };

    await expect(evaluateFixture()).resolves.toBe(await evaluateFixture());
  });

  it('continues the real deterministic WP1 path while explicitly skipping AI-dependent work', async () => {
    const deterministic = await deterministicWp1Run();
    expect(deterministic.findings).toHaveLength(1);
    const providerCall = vi.fn();
    const result = await executeDiscoveryStrategiesV1({
      strategies: [
        {
          strategyId: 'akp-3.wp1.knowledge-gap',
          aiRequirement: 'NONE',
          execute: async () => deterministic.findings,
        },
        {
          strategyId: 'akp-3.wp3.relation-ai',
          aiRequirement: 'REQUIRED',
          execute: async () => {
            throw new DiscoveryAIGenerationError(
              'PROFILE_UNAVAILABLE',
              'No active Discovery profile is available.',
            );
          },
        },
      ],
    });
    expect(result.strategySet).toEqual({
      schemaVersion: '1.0.0',
      mode: 'DEGRADED',
      completion: 'PARTIAL',
      requestedStrategies: ['akp-3.wp1.knowledge-gap', 'akp-3.wp3.relation-ai'],
      effectiveStrategies: ['akp-3.wp1.knowledge-gap'],
      skippedStrategies: [{ strategyId: 'akp-3.wp3.relation-ai', reason: 'PROFILE_UNAVAILABLE' }],
    });
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]?.value).toEqual(deterministic.findings);
    expect(providerCall).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/apiKey|authorization|credentialPlaintext|secret/i);
  });

  it.each(['PROFILE_UNAVAILABLE', 'POLICY_DENIED', 'AI_CAPABILITY_UNAVAILABLE'] as const)(
    'retains the exact typed AI-unavailable reason for %s',
    async (code) => {
      const result = await executeDiscoveryStrategiesV1({
        strategies: [
          {
            strategyId: 'ai-dependent',
            aiRequirement: 'REQUIRED',
            execute: async () => {
              throw new DiscoveryAIGenerationError(code, `typed ${code}`);
            },
          },
        ],
      });
      expect(result.strategySet.mode).toBe('DEGRADED');
      expect(result.strategySet.completion).toBe('PARTIAL');
      expect(result.strategySet.skippedStrategies).toEqual([
        { strategyId: 'ai-dependent', reason: code },
      ]);
      expect(result.outputs).toEqual([]);
    },
  );

  it('keeps budget exhaustion typed as FULL/PARTIAL and never relabels it as AI unavailable', async () => {
    const result = await executeDiscoveryStrategiesV1({
      strategies: [
        {
          strategyId: 'ai-budgeted',
          aiRequirement: 'REQUIRED',
          execute: async () => {
            throw new DiscoveryAIGenerationError('BUDGET_EXHAUSTED', 'provider call budget');
          },
        },
      ],
    });
    expect(result.strategySet).toEqual({
      schemaVersion: '1.0.0',
      mode: 'FULL',
      completion: 'PARTIAL',
      requestedStrategies: ['ai-budgeted'],
      effectiveStrategies: [],
      skippedStrategies: [{ strategyId: 'ai-budgeted', reason: 'BUDGET_EXHAUSTED' }],
    });
  });

  it('does not downgrade malformed output, invalid input, programming errors, or deterministic failures', async () => {
    for (const error of [
      new DiscoveryAIGenerationError('AI_OUTPUT_INVALID', 'malformed output'),
      new DiscoveryAIGenerationError('INVALID_INPUT', 'invalid input'),
      new Error('unexpected programming error'),
    ]) {
      await expect(
        executeDiscoveryStrategiesV1({
          strategies: [
            {
              strategyId: 'unsafe-path',
              aiRequirement: 'REQUIRED',
              execute: async () => {
                throw error;
              },
            },
          ],
        }),
      ).rejects.toBe(error);
    }
    await expect(
      executeDiscoveryStrategiesV1({
        strategies: [
          {
            strategyId: 'deterministic-path',
            aiRequirement: 'NONE',
            execute: async () => {
              throw new DiscoveryAIGenerationError('PROFILE_UNAVAILABLE', 'must fail closed');
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PROFILE_UNAVAILABLE' });
  });

  it('validates the versioned strategy-set contract and deterministic UTF-16 identity', () => {
    const set = createDiscoveryEffectiveStrategySetV1({
      mode: 'DEGRADED',
      completion: 'PARTIAL',
      requestedStrategies: ['z-strategy', 'ä-strategy'],
      effectiveStrategies: ['z-strategy'],
      skippedStrategies: [{ strategyId: 'ä-strategy', reason: 'POLICY_DENIED' }],
    });
    expect(set.requestedStrategies).toEqual(['z-strategy', 'ä-strategy']);
    expect(() =>
      createDiscoveryEffectiveStrategySetV1({
        mode: 'FULL',
        completion: 'COMPLETE',
        requestedStrategies: ['a'],
        effectiveStrategies: [],
        skippedStrategies: [{ strategyId: 'a', reason: 'PROFILE_UNAVAILABLE' }],
      }),
    ).toThrow(/COMPLETE execution cannot skip/);
    expect(() =>
      createDiscoveryEffectiveStrategySetV1({
        mode: 'DEGRADED',
        completion: 'PARTIAL',
        requestedStrategies: ['a'],
        effectiveStrategies: [],
        skippedStrategies: [{ strategyId: 'a', reason: 'BUDGET_EXHAUSTED' }],
      }),
    ).toThrow(/requires an AI-unavailable reason/);
  });

  it('accepts all four deterministic Conflict mappings and rejects unsafe Conflict bases', async () => {
    const claimA = ref('conflict-a');
    const claimB = ref('conflict-b');
    for (const kind of ['FACTUAL', 'TEMPORAL', 'IDENTITY', 'MODEL_DISAGREEMENT'] as const) {
      const entry = makeEntry({
        findingType: 'CONFLICT_HYPOTHESIS',
        generationMethod: 'HYBRID',
        payload: {
          schemaVersion: '1.0.0',
          payloadType: 'CONFLICT_HYPOTHESIS',
          participatingResourceRefs: [claimA, claimB],
          contradictionKind: kind,
          possibleContradiction: 'Bounded deterministic incompatibility requires review.',
        },
        relatedResourceRefs: [claimA, claimB],
      });
      await expect(evaluate(entry, [conflictSignal(kind)])).resolves.toMatchObject({
        disposition: 'ACCEPTED',
      });
    }
    const factual = makeEntry({
      findingType: 'CONFLICT_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'CONFLICT_HYPOTHESIS',
        participatingResourceRefs: [claimA, claimB],
        contradictionKind: 'FACTUAL',
        possibleContradiction: 'Bounded deterministic incompatibility requires review.',
      },
      relatedResourceRefs: [claimA, claimB],
    });
    await expect(evaluate(factual, [])).resolves.toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'CONFLICT_BASIS_MISSING',
    });
    await expect(evaluate(factual, [conflictSignal('TEMPORAL')])).resolves.toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'CONFLICT_BASIS_INVALID',
    });
    const noConflict = await evaluate(factual, undefined, {
      ...authority(),
      findAuthoritativeEquivalent: vi.fn(async () => true),
    });
    const authoritativeConflict = await evaluate(factual, [conflictSignal('FACTUAL')], {
      ...authority(),
      findAuthoritativeEquivalent: vi.fn(async () => true),
    });
    expect(noConflict).toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'CONFLICT_BASIS_MISSING',
    });
    expect(authoritativeConflict).toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'AUTHORITATIVE_EQUIVALENT',
    });
  });

  it('rejects candidate-only and security/identity violations before publication eligibility', async () => {
    const claimA = ref('negative-a');
    const claimB = ref('negative-b');
    const action = makeEntry({
      findingType: 'ACTION_SUGGESTION',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'ACTION_SUGGESTION',
        suggestedAction: 'execute this command now',
        rationale: 'unsafe',
        affectedResourceRefs: [claimA, claimB],
        executionStatus: 'CANDIDATE_ONLY',
      },
      relatedResourceRefs: [claimA, claimB],
    });
    await expect(evaluate(action)).resolves.toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'ACTION_NOT_CANDIDATE_ONLY',
    });

    const relation = makeEntry({
      findingType: 'RELATION_HYPOTHESIS',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'RELATION_HYPOTHESIS',
        sourceEndpoint: claimA,
        targetEndpoint: claimA,
        proposedRelationType: 'SELF_REFERENCE',
        direction: 'DIRECTED',
      },
      relatedResourceRefs: [claimA],
    });
    await expect(evaluate(relation)).resolves.toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'RELATION_SELF_REFERENCE',
    });

    const crossProject = { ...action.candidate, projectId: 'other-project' };
    await expect(
      createDiscoveryQualityGateV1(authority()).evaluate({
        candidate: crossProject,
        fingerprintInput: action.fingerprintInput,
        context,
        qualifiedFollowUp: action.qualifiedFollowUp,
      }),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'SCHEMA_INVALID' });
  });

  it('keeps ranking explainable, deterministic and separate from fingerprint or Truth authority', () => {
    const candidate = fixtureEntries()[0]!.candidate;
    const dimensions = {
      novelty: 0.5,
      projectRelevance: 0.5,
      evidenceCoverage: 0.5,
      impactReach: 0.5,
      temporalUrgency: 0.5,
      redundancyPenalty: 0.1,
      costRiskPenalty: 0.1,
    } as const;
    const ranked = rankAcceptedDiscoveryCandidatesV1([{ candidate, dimensions }], {
      version: DISCOVERY_RANKING_POLICY_VERSION_V1,
      weights: dimensions,
    });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      rankingPolicyVersion: DISCOVERY_RANKING_POLICY_VERSION_V1,
      dimensions,
    });
    expect(ranked[0]).not.toHaveProperty('truthProbability');
    expect(ranked[0]).not.toHaveProperty('confidence');
    expect(ranked[0]?.candidate.fingerprint).toBe(candidate.fingerprint);
    expect(ranked).toEqual(
      rankAcceptedDiscoveryCandidatesV1([{ candidate, dimensions }], {
        version: DISCOVERY_RANKING_POLICY_VERSION_V1,
        weights: dimensions,
      }),
    );
  });
});
