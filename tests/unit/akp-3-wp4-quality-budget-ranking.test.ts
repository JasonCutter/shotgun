import { describe, expect, it, vi } from 'vitest';

import { computeDiscoveryFingerprintV1 } from '../../modules/discovery-finding-fingerprint/src/index.js';
import {
  DISCOVERY_RANKING_POLICY_VERSION_V1,
  DISCOVERY_TOKEN_ESTIMATOR_VERSION_V1,
  DISCOVERY_WORK_BUDGET_VERSION_V1,
  DiscoveryBudgetControllerV1,
  DiscoveryQualityGateV1,
  DiscoveryWorkBudgetLedgerV1,
  createDiscoveryQualityGateV1,
  createUtf16TokenUpperBoundEstimatorV1,
  rankAcceptedDiscoveryCandidatesV1,
  type DiscoveryAuthoritativeResourceV1,
  type DiscoveryExistingFindingV1,
  type DiscoveryQualityGateContextV1,
  type DiscoveryQualityGateInputV1,
  type DiscoveryQualityRevalidationPortV1,
  type DiscoveryRankingDimensionsV1,
  type DiscoveryWorkBudgetV1,
} from '../../modules/discovery-quality-gate/src/index.js';
import { OpenAIConnectivityAdapter } from '../../adapters/ai-provider-openai/src/index.js';
import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { GeminiConnectivityAdapter } from '../../adapters/ai-provider-gemini/src/connectivity.js';
import {
  decodeDiscoveryFindingEnvelopeV1,
  type DiscoveryFingerprintLogicalInputV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingPayloadV1,
  type DiscoveryResourceRefV1,
} from '../../packages/contracts/src/index.js';

const context = (projectId = 'project-1'): DiscoveryQualityGateContextV1 => ({
  projectId,
  accessScope: ['project:read'],
  sensitivity: 'internal',
  sourceProjectionDigest: 'sources-1',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 7,
    snapshotDigest: 'canonical-7',
  },
  discoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'discovery-7',
    projectionDigest: 'discovery-digest-7',
  },
});

const ref = (
  resourceId: string,
  resourceKind: DiscoveryResourceRefV1['resourceKind'] = 'CANONICAL_ENTITY',
  projectId = 'project-1',
): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind,
  resourceId,
  projectId,
  resourceState: 'APPROVED',
  resourceRevision: '1',
});

const basePayload = (payload: DiscoveryFindingPayloadV1): DiscoveryFindingPayloadV1 => payload;

const envelope = (
  findingType: DiscoveryFindingEnvelopeV1['findingType'],
  payload: DiscoveryFindingPayloadV1,
  relatedResourceRefs: readonly DiscoveryResourceRefV1[],
  options: {
    readonly evidenceIds?: readonly string[];
    readonly generationMethod?: DiscoveryFindingEnvelopeV1['generationMethod'];
    readonly provenance?: DiscoveryFindingEnvelopeV1['provenance'];
    readonly projectId?: string;
  } = {},
): {
  readonly candidate: DiscoveryFindingEnvelopeV1;
  readonly fingerprintInput: DiscoveryFingerprintLogicalInputV1;
} => {
  const projectId = options.projectId ?? 'project-1';
  const semanticEssence = `${findingType}:semantic-identity:${relatedResourceRefs
    .map((entry) => entry.resourceId)
    .join('|')}`;
  const fingerprintInput: DiscoveryFingerprintLogicalInputV1 = {
    fingerprintVersion: 'discovery-fingerprint:v1',
    findingType,
    relatedResourceRefs,
    semanticEssence,
  };
  const fingerprint = computeDiscoveryFingerprintV1({
    findingType,
    relatedResourceRefs,
    semanticEssence,
  });
  const candidate = decodeDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: `finding-${findingType}`,
    findingRevision: 1,
    projectId,
    findingType,
    status: 'DERIVED_INFERENCE',
    generationMethod: options.generationMethod ?? 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: basePayload(payload),
    relatedResourceRefs,
    evidenceIds: options.evidenceIds ?? [],
    sourceProjectionDigest: 'sources-1',
    canonicalBase: context(projectId).canonicalBase,
    discoveryBase: context(projectId).discoveryBase,
    runId: 'run-1',
    signalSummary: {},
    rationale: 'A bounded server-generated candidate.',
    derivationSummary: 'A deterministic test candidate.',
    provenance: options.provenance ?? {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'test-rule',
      ruleVersion: '1.0.0',
      inputDigest: 'input-digest-1',
    },
    accessScope: ['project:read'],
    sensitivity: 'internal',
    fingerprint: fingerprint.fingerprint,
    fingerprintVersion: fingerprint.fingerprintVersion,
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-30T00:00:00.000Z',
  });
  return { candidate, fingerprintInput };
};

const authority = (
  resources: readonly DiscoveryResourceRefV1[],
  overrides: Partial<DiscoveryAuthoritativeResourceV1> = {},
): DiscoveryQualityRevalidationPortV1 => ({
  revalidateResource: vi.fn(async ({ resource }) =>
    resources.some((entry) => JSON.stringify(entry) === JSON.stringify(resource))
      ? {
          exists: true,
          eligible: true,
          projectId: resource.projectId,
          accessScope: ['project:read'],
          sensitivity: 'internal' as const,
          ...overrides,
        }
      : undefined,
  ),
  findByFingerprint: vi.fn(async () => [] as readonly DiscoveryExistingFindingV1[]),
  findAuthoritativeEquivalent: vi.fn(async () => false),
});

const gateInput = (
  candidate: unknown,
  fingerprintInput: DiscoveryFingerprintLogicalInputV1,
  overrides: Partial<DiscoveryQualityGateInputV1> = {},
): DiscoveryQualityGateInputV1 => ({
  candidate,
  fingerprintInput,
  context: context(),
  ...overrides,
});

const budget = (overrides: Partial<DiscoveryWorkBudgetV1> = {}): DiscoveryWorkBudgetV1 => ({
  schemaVersion: '1.0.0',
  budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
  maxResources: 10,
  maxSemanticNeighbors: 10,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 2,
  maxInputTokens: 1000,
  maxOutputTokens: 20,
  maxOutputTokensPerCall: 10,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

const dimensions = (
  overrides: Partial<DiscoveryRankingDimensionsV1> = {},
): DiscoveryRankingDimensionsV1 => ({
  novelty: 0.5,
  projectRelevance: 0.5,
  evidenceCoverage: 0.5,
  impactReach: 0.5,
  temporalUrgency: 0.5,
  redundancyPenalty: 0,
  costRiskPenalty: 0,
  ...overrides,
});

describe('AKP-3 WP4 deterministic quality gate', () => {
  it('accepts every frozen finding type through one common gate', async () => {
    const entityA = ref('entity-a');
    const entityB = ref('entity-b');
    const cases = [
      envelope(
        'KNOWLEDGE_GAP',
        {
          schemaVersion: '1.0.0',
          payloadType: 'KNOWLEDGE_GAP',
          gapKind: 'MISSING_FACT',
          subject: 'Entity A',
          missingFact: 'A bounded context is absent.',
          question: 'What context is missing?',
        },
        [entityA],
      ),
      envelope(
        'EVIDENCE_GAP',
        {
          schemaVersion: '1.0.0',
          payloadType: 'EVIDENCE_GAP',
          coverageKind: 'ABSENT',
          affectedResourceRef: entityA,
          coverageGap: 'No evidence is linked.',
          requiredEvidence: 'Attach an EvidenceSpan.',
        },
        [entityA],
      ),
      envelope(
        'RELATION_HYPOTHESIS',
        {
          schemaVersion: '1.0.0',
          payloadType: 'RELATION_HYPOTHESIS',
          sourceEndpoint: entityA,
          targetEndpoint: entityB,
          proposedRelationType: 'RELATED_TO',
          direction: 'DIRECTED',
        },
        [entityA, entityB],
        { evidenceIds: ['evidence-a'] },
      ),
      envelope(
        'PATTERN_HYPOTHESIS',
        {
          schemaVersion: '1.0.0',
          payloadType: 'PATTERN_HYPOTHESIS',
          patternKind: 'CLUSTER',
          memberResourceRefs: [entityA, entityB],
          patternIdentity: 'cluster-a-b',
          patternStatement: 'The bounded members form a cluster.',
        },
        [entityA, entityB],
        { evidenceIds: ['evidence-a'] },
      ),
      envelope(
        'CONFLICT_HYPOTHESIS',
        {
          schemaVersion: '1.0.0',
          payloadType: 'CONFLICT_HYPOTHESIS',
          participatingResourceRefs: [entityA, entityB],
          contradictionKind: 'FACTUAL',
          possibleContradiction: 'The bounded propositions disagree.',
        },
        [entityA, entityB],
        { evidenceIds: ['evidence-a'] },
      ),
      envelope(
        'CLARIFICATION_QUESTION',
        {
          schemaVersion: '1.0.0',
          payloadType: 'CLARIFICATION_QUESTION',
          investigationTargetRefs: [entityA],
          question: 'Which context should be investigated?',
          context: 'A qualified finding requires clarification.',
          proposedNextStep: 'Review the bounded target.',
        },
        [entityA],
        { evidenceIds: ['evidence-a'] },
      ),
      envelope(
        'ACTION_SUGGESTION',
        {
          schemaVersion: '1.0.0',
          payloadType: 'ACTION_SUGGESTION',
          suggestedAction: 'Review the affected resource.',
          rationale: 'A human should decide whether to proceed.',
          affectedResourceRefs: [entityA],
          executionStatus: 'CANDIDATE_ONLY',
        },
        [entityA],
        { evidenceIds: ['evidence-a'] },
      ),
    ] as const;

    for (const item of cases) {
      const result = await createDiscoveryQualityGateV1(
        authority(item.candidate.relatedResourceRefs),
      ).evaluate(
        gateInput(
          item.candidate,
          item.fingerprintInput,
          item.candidate.findingType === 'CONFLICT_HYPOTHESIS'
            ? {
                selectionSignals: [
                  {
                    kind: 'EXPLICIT_INCOMPATIBILITY',
                    incompatibilityKind: 'FACTUAL',
                    source: 'TYPED_PROPOSITION',
                    signalId: 'signal-1',
                  },
                ],
              }
            : {},
        ),
      );
      expect(result.disposition).toBe('ACCEPTED');
    }
  });

  it('rejects unsafe structure, stale resources, security widening and missing lineage', async () => {
    const entityA = ref('entity-a');
    const entityB = ref('entity-b');
    const relation = envelope(
      'RELATION_HYPOTHESIS',
      {
        schemaVersion: '1.0.0',
        payloadType: 'RELATION_HYPOTHESIS',
        sourceEndpoint: entityA,
        targetEndpoint: entityB,
        proposedRelationType: 'RELATED_TO',
        direction: 'DIRECTED',
      },
      [entityA, entityB],
      { evidenceIds: ['evidence-a'] },
    );
    const relationSelf = envelope(
      'RELATION_HYPOTHESIS',
      {
        schemaVersion: '1.0.0',
        payloadType: 'RELATION_HYPOTHESIS',
        sourceEndpoint: entityA,
        targetEndpoint: entityA,
        proposedRelationType: 'RELATED_TO',
        direction: 'DIRECTED',
      },
      [entityA],
      { evidenceIds: ['evidence-a'] },
    );
    const conflict = envelope(
      'CONFLICT_HYPOTHESIS',
      {
        schemaVersion: '1.0.0',
        payloadType: 'CONFLICT_HYPOTHESIS',
        participatingResourceRefs: [entityA, entityB],
        contradictionKind: 'FACTUAL',
        possibleContradiction: 'Two propositions disagree.',
      },
      [entityA, entityB],
      { evidenceIds: ['evidence-a'] },
    );

    await expect(
      createDiscoveryQualityGateV1(authority([entityA])).evaluate(
        gateInput(relation.candidate, relation.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'RESOURCE_MISSING' });
    await expect(
      createDiscoveryQualityGateV1(
        authority([entityA, entityB], { sensitivity: 'private' }),
      ).evaluate(gateInput(relation.candidate, relation.fingerprintInput)),
    ).resolves.toMatchObject({
      disposition: 'REJECTED',
      reasonCode: 'SECURITY_CLASSIFICATION_MISMATCH',
    });
    await expect(
      createDiscoveryQualityGateV1(authority([entityA])).evaluate(
        gateInput(relationSelf.candidate, relationSelf.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'RELATION_SELF_REFERENCE' });
    await expect(
      createDiscoveryQualityGateV1(authority([entityA, entityB])).evaluate(
        gateInput(conflict.candidate, conflict.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'CONFLICT_BASIS_MISSING' });

    const missingLineage = envelope('RELATION_HYPOTHESIS', relation.candidate.payload, [
      entityA,
      entityB,
    ]);
    await expect(
      createDiscoveryQualityGateV1(authority([entityA, entityB])).evaluate(
        gateInput(missingLineage.candidate, missingLineage.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'EVIDENCE_LINEAGE_MISSING' });
  });

  it('rejects exact duplicates, respects suppression, and checks authoritative equivalents through Ports', async () => {
    const entity = ref('entity-a');
    const item = envelope(
      'KNOWLEDGE_GAP',
      {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'Entity A',
        missingFact: 'A context is absent.',
        question: 'What context is missing?',
      },
      [entity],
    );
    const duplicate = {
      findingId: 'existing-finding',
      findingRevision: 1,
      lifecycleState: 'NEW',
    };
    const duplicatePort = authority([entity]);
    duplicatePort.findByFingerprint = vi.fn(async () => [duplicate]);
    await expect(
      new DiscoveryQualityGateV1(duplicatePort).evaluate(
        gateInput(item.candidate, item.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'FINGERPRINT_DUPLICATE' });

    const suppressedPort = authority([entity]);
    suppressedPort.findByFingerprint = vi.fn(async () => [
      { ...duplicate, lifecycleState: 'SUPPRESSED' },
    ]);
    await expect(
      new DiscoveryQualityGateV1(suppressedPort).evaluate(
        gateInput(item.candidate, item.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'SUPPRESSED', reasonCode: 'SUPPRESSED_FINGERPRINT' });

    const equivalentPort = authority([entity]);
    equivalentPort.findAuthoritativeEquivalent = vi.fn(async () => true);
    await expect(
      new DiscoveryQualityGateV1(equivalentPort).evaluate(
        gateInput(item.candidate, item.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'AUTHORITATIVE_EQUIVALENT' });
    expect(equivalentPort.findAuthoritativeEquivalent).toHaveBeenCalledTimes(1);
  });

  it('preserves the complete AI provenance boundary and rejects unknown secret fields', async () => {
    const entity = ref('entity-a');
    const item = envelope(
      'RELATION_HYPOTHESIS',
      {
        schemaVersion: '1.0.0',
        payloadType: 'RELATION_HYPOTHESIS',
        sourceEndpoint: entity,
        targetEndpoint: ref('entity-b'),
        proposedRelationType: 'RELATED_TO',
        direction: 'DIRECTED',
      },
      [entity, ref('entity-b')],
      {
        evidenceIds: ['evidence-a'],
        generationMethod: 'AI_ASSISTED',
        provenance: {
          schemaVersion: '1.0.0',
          kind: 'AI_ASSISTED',
          providerId: 'openai',
          modelId: 'gpt-discovery',
          modelVersion: 'gpt-discovery-1',
          aiConfigurationRevision: '4',
          credentialId: 'credential-7',
          credentialRevision: '2',
          providerPolicyFingerprint: 'policy-7',
          privacyPolicyRevision: 'privacy-5',
          dataPolicyRevision: 'provider-3',
          promptVersion: 'discovery-ai-prompt:v1',
          outputSchemaVersion: 'discovery-ai-output:v1',
        },
      },
    );
    const result = await createDiscoveryQualityGateV1(
      authority(item.candidate.relatedResourceRefs),
    ).evaluate(gateInput(item.candidate, item.fingerprintInput));
    expect(result.disposition).toBe('ACCEPTED');
    if (result.disposition === 'ACCEPTED') {
      expect(result.candidate.provenance).toMatchObject({
        providerId: 'openai',
        credentialId: 'credential-7',
        credentialRevision: '2',
        providerPolicyFingerprint: 'policy-7',
      });
    }

    const hybrid = envelope(
      'RELATION_HYPOTHESIS',
      item.candidate.payload,
      item.candidate.relatedResourceRefs,
      {
        evidenceIds: ['evidence-a'],
        generationMethod: 'HYBRID',
        provenance: {
          schemaVersion: '1.0.0',
          kind: 'HYBRID',
          deterministic: {
            ruleId: 'test-rule',
            ruleVersion: '1.0.0',
            inputDigest: 'input-digest-1',
          },
          aiExecution: {
            providerId: 'openai',
            modelId: 'gpt-discovery',
            modelVersion: 'gpt-discovery-1',
            aiConfigurationRevision: '4',
            credentialId: 'credential-7',
            credentialRevision: '2',
            providerPolicyFingerprint: 'policy-7',
            privacyPolicyRevision: 'privacy-5',
            dataPolicyRevision: 'provider-3',
            promptVersion: 'discovery-ai-prompt:v1',
            outputSchemaVersion: 'discovery-ai-output:v1',
          },
        },
      },
    );
    const hybridResult = await createDiscoveryQualityGateV1(
      authority(hybrid.candidate.relatedResourceRefs),
    ).evaluate(gateInput(hybrid.candidate, hybrid.fingerprintInput));
    expect(hybridResult.disposition).toBe('ACCEPTED');
    if (
      hybridResult.disposition === 'ACCEPTED' &&
      hybridResult.candidate.provenance.kind === 'HYBRID'
    ) {
      expect(hybridResult.candidate.provenance.aiExecution).toMatchObject({
        credentialId: 'credential-7',
        credentialRevision: '2',
        providerPolicyFingerprint: 'policy-7',
      });
    }

    const withSecret = JSON.parse(JSON.stringify(item.candidate)) as Record<string, unknown>;
    (withSecret.provenance as Record<string, unknown>).apiKey = 'must-not-pass';
    await expect(
      createDiscoveryQualityGateV1(authority(item.candidate.relatedResourceRefs)).evaluate(
        gateInput(withSecret, item.fingerprintInput),
      ),
    ).resolves.toMatchObject({ disposition: 'REJECTED', reasonCode: 'SCHEMA_INVALID' });
  });
});

describe('AKP-3 WP4 cumulative work budget and provider admission', () => {
  it('accounts for all bounded work dimensions and prevents overflow', () => {
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget());
    expect(ledger.consume('resources', 3)).toBe(true);
    expect(ledger.consume('semanticNeighbors', 2)).toBe(true);
    expect(ledger.consume('candidatePairs', 2)).toBe(true);
    expect(ledger.consume('candidateGroups', 1)).toBe(true);
    expect(ledger.consume('findings', 1)).toBe(true);
    expect(ledger.consume('findings', 10)).toBe(false);
    expect(ledger.snapshot()).toMatchObject({
      resources: 3,
      semanticNeighbors: 2,
      candidatePairs: 2,
      candidateGroups: 1,
      findings: 1,
      activeProviderCalls: 0,
    });
  });

  it('admits a provider call only when output cap, cost and cancellation are enforceable', async () => {
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget());
    const provider = {
      identity: {
        provider: 'openai',
        model: 'gpt-discovery',
        supportsOutputTokenLimit: true,
        supportsCancellation: true,
      },
      generateStructuredWithSignal: vi.fn(
        async (request: { readonly maxOutputTokens?: number }) => ({
          rawText: '{}',
          inputTokens: 4,
          outputTokens: 3,
          modelVersion: request.maxOutputTokens ? 'capped' : 'uncapped',
        }),
      ),
      generateStructured: vi.fn(async () => ({ rawText: '{}' })),
    };
    const controller = new DiscoveryBudgetControllerV1(
      ledger,
      createUtf16TokenUpperBoundEstimatorV1(),
      { revision: 'fixed-cost:test-v1', estimate: () => 5 },
    );
    const result = await controller.executeProviderCall({
      provider,
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
      },
      maxOutputTokens: 6,
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result).toMatchObject({
      completion: 'COMPLETE',
      truncation: { truncated: false },
      budgetVersion: DISCOVERY_WORK_BUDGET_VERSION_V1,
      tokenEstimatorRevision: 'utf16-code-unit-upper-bound:v1',
      costEstimatorRevision: 'fixed-cost:test-v1',
    });
    expect(provider.generateStructuredWithSignal).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 6 }),
      expect.any(AbortSignal),
    );
    expect(ledger.snapshot()).toMatchObject({
      providerCalls: 1,
      inputTokens: 4,
      outputTokens: 3,
      activeProviderCalls: 0,
    });

    const unsupportedProvider = {
      identity: {
        provider: 'unknown',
        model: 'unknown',
        supportsCancellation: true,
      },
      generateStructuredWithSignal: vi.fn(async () => ({ rawText: '{}' })),
      generateStructured: vi.fn(async () => ({ rawText: '{}' })),
    };
    const unsupported = await new DiscoveryBudgetControllerV1(
      new DiscoveryWorkBudgetLedgerV1(budget()),
      createUtf16TokenUpperBoundEstimatorV1(),
      { revision: 'fixed-cost:test-v1', estimate: () => 5 },
    ).executeProviderCall({
      provider: unsupportedProvider,
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
      },
    });
    expect(unsupported).toMatchObject({
      status: 'BUDGET_EXHAUSTED',
      reason: 'OUTPUT_LIMIT_UNSUPPORTED',
      completion: 'PARTIAL',
      truncation: { truncated: true, reason: 'OUTPUT_LIMIT_UNSUPPORTED' },
    });
    expect(unsupportedProvider.generateStructuredWithSignal).not.toHaveBeenCalled();
    expect(unsupportedProvider.generateStructured).not.toHaveBeenCalled();
  });

  it('blocks a second concurrent call, fails closed without cost authority, and releases permits on cancellation', async () => {
    const ledger = new DiscoveryWorkBudgetLedgerV1(budget({ maxConcurrentProviderCalls: 1 }));
    let release!: () => void;
    const provider = {
      identity: {
        provider: 'openai',
        model: 'gpt-discovery',
        supportsOutputTokenLimit: true,
        supportsCancellation: true,
      },
      generateStructuredWithSignal: vi.fn(
        (_request: unknown, signal?: AbortSignal) =>
          new Promise<{ readonly rawText: string }>((resolve, reject) => {
            release = () => resolve({ rawText: '{}' });
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      ),
      generateStructured: vi.fn(async () => ({ rawText: '{}' })),
    };
    const controller = new DiscoveryBudgetControllerV1(
      ledger,
      createUtf16TokenUpperBoundEstimatorV1(),
      { revision: 'fixed-cost:test-v1', estimate: () => 5 },
    );
    const first = controller.executeProviderCall({
      provider,
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
      },
    });
    await Promise.resolve();
    const second = await controller.executeProviderCall({
      provider,
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
      },
    });
    expect(second).toMatchObject({
      status: 'BUDGET_EXHAUSTED',
      reason: 'CONCURRENCY_LIMIT',
      completion: 'PARTIAL',
      truncation: { truncated: true, reason: 'CONCURRENCY_LIMIT' },
    });
    release();
    await first;
    expect(ledger.snapshot().activeProviderCalls).toBe(0);

    const noCostProvider = { ...provider, generateStructuredWithSignal: vi.fn() };
    const noCost = await new DiscoveryBudgetControllerV1(
      new DiscoveryWorkBudgetLedgerV1(budget()),
      createUtf16TokenUpperBoundEstimatorV1(),
      { revision: 'missing', estimate: () => undefined },
    ).executeProviderCall({
      provider: noCostProvider,
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
      },
    });
    expect(noCost).toMatchObject({
      status: 'BUDGET_EXHAUSTED',
      reason: 'COST_ESTIMATE_UNAVAILABLE',
      completion: 'PARTIAL',
      truncation: { truncated: true, reason: 'COST_ESTIMATE_UNAVAILABLE' },
    });
    expect(noCostProvider.generateStructuredWithSignal).not.toHaveBeenCalled();
  });

  it('returns a typed degraded result after a deadline without dispatching a provider call', async () => {
    const provider = {
      identity: {
        provider: 'openai',
        model: 'gpt-discovery',
        supportsOutputTokenLimit: true,
        supportsCancellation: true,
      },
      generateStructured: vi.fn(async () => ({ rawText: '{}' })),
    };
    const result = await new DiscoveryBudgetControllerV1(
      new DiscoveryWorkBudgetLedgerV1(budget({ deadlineAt: '2000-01-01T00:00:00.000Z' })),
      createUtf16TokenUpperBoundEstimatorV1(),
      { revision: 'fixed-cost:test-v1', estimate: () => 5 },
    ).executeProviderCall({
      provider,
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
      },
    });
    expect(result).toMatchObject({
      status: 'BUDGET_EXHAUSTED',
      reason: 'DEADLINE_EXPIRED',
      completion: 'PARTIAL',
      truncation: { truncated: true, reason: 'DEADLINE_EXPIRED' },
    });
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });
});

describe('AKP-3 WP4 explainable deterministic ranking and provider cap adapters', () => {
  it('retains dimensions and policy version, uses UTF-16 tie-break, and leaves fingerprint identity unchanged', () => {
    const left = envelope(
      'KNOWLEDGE_GAP',
      {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'A',
        missingFact: 'A fact is missing.',
        question: 'What is missing?',
      },
      [ref('\uE000')],
    ).candidate;
    const right = envelope(
      'KNOWLEDGE_GAP',
      {
        schemaVersion: '1.0.0',
        payloadType: 'KNOWLEDGE_GAP',
        gapKind: 'MISSING_FACT',
        subject: 'B',
        missingFact: 'B fact is missing.',
        question: 'What is missing?',
      },
      [ref('\uFFFD')],
    ).candidate;
    const leftWithOrdinalId = { ...left, findingId: '\uE000' };
    const rightWithOrdinalId = { ...right, findingId: '\uFFFD' };
    const policy = {
      version: DISCOVERY_RANKING_POLICY_VERSION_V1,
      weights: dimensions({
        novelty: 1,
        projectRelevance: 0,
        evidenceCoverage: 0,
        impactReach: 0,
        temporalUrgency: 0,
        redundancyPenalty: 0,
        costRiskPenalty: 0,
      }),
    } as const;
    const inputs = [
      { candidate: rightWithOrdinalId, dimensions: dimensions({ novelty: 0.5 }) },
      { candidate: leftWithOrdinalId, dimensions: dimensions({ novelty: 0.5 }) },
    ];
    const ranked = rankAcceptedDiscoveryCandidatesV1(inputs, policy);
    expect(ranked.map((entry) => entry.candidate.findingId)).toEqual(['\uE000', '\uFFFD']);
    expect(ranked[0]?.tieBreakKey).toBe('\uE000');
    expect(ranked[0]).toMatchObject({
      rankingPolicyVersion: DISCOVERY_RANKING_POLICY_VERSION_V1,
      dimensions: inputs[0]?.dimensions,
    });
    expect(ranked.find((entry) => entry.tieBreakKey === '\uE000')?.candidate.fingerprint).toBe(
      left.fingerprint,
    );
    expect(ranked.find((entry) => entry.tieBreakKey === '\uFFFD')?.candidate.fingerprint).toBe(
      right.fingerprint,
    );
    expect(ranked).toEqual(rankAcceptedDiscoveryCandidatesV1(inputs, policy));
  });

  it('forwards a real output cap to OpenAI and DeepSeek provider requests', async () => {
    const openaiBodies: Record<string, unknown>[] = [];
    const openai = new OpenAIConnectivityAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      fetch: vi.fn(async (_input, init) => {
        openaiBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{}' }] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    });
    await openai.generateStructured({
      modelId: 'gpt-discovery',
      apiKey: new TextEncoder().encode('secret'),
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
        maxOutputTokens: 6,
      },
    });
    expect(openaiBodies[0]).toMatchObject({ max_output_tokens: 6 });

    const deepseekBodies: Record<string, unknown>[] = [];
    const deepseek = new DeepSeekConnectivityAdapter({
      baseUrl: 'https://example.test',
      fetch: vi.fn(async (_input, init) => {
        deepseekBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    });
    await deepseek.generateStructured({
      modelId: 'deepseek-chat',
      apiKey: new TextEncoder().encode('secret'),
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
        maxOutputTokens: 6,
      },
    });
    expect(deepseekBodies[0]).toMatchObject({ max_tokens: 6 });

    let geminiRequest: Record<string, unknown> | undefined;
    const gemini = new GeminiConnectivityAdapter(
      () =>
        ({
          interactions: {
            create: vi.fn(async (request) => {
              geminiRequest = request as Record<string, unknown>;
              return { id: 'gemini-request', output_text: '{}' };
            }),
          },
        }) as never,
    );
    await gemini.generateStructured({
      modelId: 'gemini-discovery',
      apiKey: new TextEncoder().encode('secret'),
      request: {
        systemInstruction: 'system',
        prompt: 'prompt',
        responseSchema: { type: 'object' },
        maxOutputTokens: 6,
      },
    });
    expect(geminiRequest).toMatchObject({ generation_config: { max_output_tokens: 6 } });
    expect(DISCOVERY_TOKEN_ESTIMATOR_VERSION_V1).toBe('utf16-code-unit-upper-bound:v1');
  });
});
