import { describe, expect, it, vi } from 'vitest';

import {
  DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  DISCOVERY_AI_PROMPT_VERSION_V1,
  DISCOVERY_AI_SYSTEM_INSTRUCTION_V1,
  DiscoveryAIGenerationService,
  DiscoveryModelProfileService,
  type DiscoveryHypothesisCandidateV1,
} from '../../modules/discovery-ai-generation/src/index.js';
import type {
  DiscoveryAIConfigurationRevisionV1,
  DiscoveryAIExecutionResolutionV1,
  DiscoveryModelProfileRepositoryPort,
  DiscoveryModelProfileV1,
  DiscoveryQualifiedAIGenerationContextV1,
  DiscoveryStructuredGenerationRequestV1,
  DiscoveryStructuredGenerationResponseV1,
} from '../../packages/contracts/src/index.js';

const ref = (resourceId: string) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind: 'CANONICAL_ENTITY' as const,
  resourceId,
  projectId: 'project-1',
  resourceState: 'APPROVED' as const,
  resourceRevision: '1',
});

const base = {
  sourceProjectionDigest: 'source-projection-1',
  canonicalBase: {
    schemaVersion: '1.0.0' as const,
    canonicalVersion: 7,
    snapshotDigest: 'canonical-7',
  },
  discoveryBase: {
    schemaVersion: '1.0.0' as const,
    projectionRevision: 'discovery-7',
    projectionDigest: 'discovery-digest-7',
  },
};

const contextFor = (
  refs: readonly ReturnType<typeof ref>[],
  overrides: Partial<DiscoveryQualifiedAIGenerationContextV1> = {},
): DiscoveryQualifiedAIGenerationContextV1 => ({
  projectId: 'project-1',
  accessScope: ['project:read'],
  sensitivity: 'internal',
  ...base,
  originatingFindingType: 'RELATION_HYPOTHESIS',
  boundedRationale: 'WP2 selected this bounded resource neighborhood.',
  items: refs.map((resourceRef) => ({
    resourceRef,
    deterministicRepresentation: `Server data for ${resourceRef.resourceId}`,
    evidenceIds: [`evidence-${resourceRef.resourceId}`],
  })),
  ...overrides,
});

const candidateFor = (
  targetFindingType: DiscoveryHypothesisCandidateV1['targetFindingType'],
  members: readonly ReturnType<typeof ref>[],
  selectionSignals: readonly unknown[] = [{ kind: 'SEMANTIC_NEIGHBOR', semanticRank: 1 }],
): DiscoveryHypothesisCandidateV1 => ({
  retentionClass: 'EPHEMERAL_PRE_MATERIALIZATION',
  targetFindingType,
  anchor: members[0]!,
  memberResourceRefs: members as DiscoveryHypothesisCandidateV1['memberResourceRefs'],
  security: {
    materializable: true,
    projectId: 'project-1',
    accessScope: ['project:read'],
    sensitivity: 'internal',
  },
  ...base,
  semanticGenerationId: 'semantic-generation-1',
  selectionSignals,
  provenance: {
    selectorId: 'akp-3.wp2.relation',
    selectorVersion: '1.0.0',
    inputDigest: 'candidate-input-digest',
    anchorResourceKey: 'project-1\u0000CANONICAL_ENTITY\u0000a\u0000APPROVED\u00001',
    selectionSignals,
  },
});

const profile = (): DiscoveryModelProfileV1 => ({
  schemaVersion: '1.0.0',
  profileId: 'discovery-profile-1',
  projectId: 'project-1',
  profileRevision: 1,
  aiConfigurationRevision: 4,
  providerId: 'openai',
  modelId: 'gpt-discovery',
  providerRegistryRevision: 'provider-registry:v1',
  modelCapabilityRevision: 'model-capability:v4',
  promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
  outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  status: 'ACTIVE',
  createdBy: 'owner-1',
  createdAt: '2026-08-30T00:00:00.000Z',
  activatedAt: '2026-08-30T00:01:00.000Z',
});

const resolution = (): DiscoveryAIExecutionResolutionV1 => ({
  pin: {
    projectId: 'project-1',
    profileId: 'discovery-profile-1',
    profileRevision: 1,
    providerId: 'openai',
    modelId: 'gpt-discovery',
    modelCapabilityRevision: 'model-capability:v4',
    aiConfigurationRevision: 4,
    credentialId: 'credential-7',
    credentialRevision: 2,
    providerPolicyFingerprint: 'policy-fingerprint-7',
    privacyPolicyRevision: 'privacy-policy-5',
    dataPolicyRevision: 'provider-policy-3',
    promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
    outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
  },
  modelVersion: 'catalog:gpt-discovery@model-capability:v4',
});

const configuration: DiscoveryAIConfigurationRevisionV1 = {
  projectId: 'project-1',
  activeProviderId: 'openai',
  activeModelId: 'gpt-discovery',
  credentialId: 'credential-7',
  credentialRevision: 2,
  aiConfigurationRevision: 4,
};

class MemoryProfileRepository implements DiscoveryModelProfileRepositoryPort {
  private readonly values: DiscoveryModelProfileV1[] = [];

  async findActive(projectId: string): Promise<DiscoveryModelProfileV1 | undefined> {
    return this.values.find((value) => value.projectId === projectId && value.status === 'ACTIVE');
  }

  async findCurrent(projectId: string): Promise<DiscoveryModelProfileV1 | undefined> {
    return [...this.values]
      .filter((value) => value.projectId === projectId)
      .sort((left, right) => right.profileRevision - left.profileRevision)[0];
  }

  async findRevision(
    projectId: string,
    revision: number,
  ): Promise<DiscoveryModelProfileV1 | undefined> {
    return this.values.find(
      (value) => value.projectId === projectId && value.profileRevision === revision,
    );
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: DiscoveryModelProfileV1;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    if (
      (await this.findCurrent(input.next.projectId))?.profileRevision !== input.expectedRevision &&
      input.expectedRevision !== 0
    ) {
      return 'CONFLICT';
    }
    this.values.push(input.next);
    return input.expectedRevision === 0 ? 'CREATED' : 'UPDATED';
  }

  async updateStatus(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly expectedStatus: DiscoveryModelProfileV1['status'];
    readonly status: DiscoveryModelProfileV1['status'];
    readonly updatedAt: string;
  }): Promise<DiscoveryModelProfileV1 | 'NOT_FOUND' | 'CONFLICT'> {
    const value = await this.findRevision(input.projectId, input.profileRevision);
    if (!value || value.profileId !== input.profileId) return 'NOT_FOUND';
    if (value.status !== input.expectedStatus) return 'CONFLICT';
    const next = {
      ...value,
      status: input.status,
      ...(input.status === 'ACTIVE'
        ? { activatedAt: input.updatedAt }
        : { retiredAt: input.updatedAt }),
    };
    const index = this.values.indexOf(value);
    this.values[index] = next;
    return next;
  }
}

const createProfileService = () => {
  const repository = new MemoryProfileRepository();
  const registry = {
    getProvider: () => ({
      providerId: 'openai',
      status: 'active' as const,
      registryRevision: 'provider-registry:v1',
      providerPolicyRevision: 'provider-policy:3',
    }),
    getModel: () => ({
      providerId: 'openai',
      modelId: 'gpt-discovery',
      capabilityRevision: 'model-capability:v4',
      structuredOutput: true,
    }),
  };
  const configurations = { getRevision: vi.fn(async () => configuration) };
  const credentials = {
    getMetadata: vi.fn(async () => ({
      projectId: configuration.projectId,
      providerId: configuration.activeProviderId,
      credentialId: configuration.credentialId,
      credentialRevision: configuration.credentialRevision,
      lifecycleState: 'active' as const,
    })),
  };
  const service = new DiscoveryModelProfileService(
    registry,
    configurations,
    credentials,
    repository,
    () => '2026-08-30T00:00:00.000Z',
  );
  return { repository, configurations, credentials, service };
};

const createGenerationService = (response: string) => {
  const calls: DiscoveryStructuredGenerationRequestV1[] = [];
  const provider = {
    identity: {
      provider: 'openai',
      model: 'gpt-discovery',
      adapterVersion: 'test-discovery-provider-v1',
      dataPolicyVersion: 'test-policy-v1',
    },
    generateStructured: vi.fn(
      async (
        request: DiscoveryStructuredGenerationRequestV1,
      ): Promise<DiscoveryStructuredGenerationResponseV1> => {
        calls.push(request);
        return { rawText: response, providerResponseId: 'provider-response-1' };
      },
    ),
  };
  const service = new DiscoveryAIGenerationService(
    {
      getActive: vi.fn(async () => profile()),
      getCurrent: vi.fn(),
      getRevision: vi.fn(),
      createProfile: vi.fn(),
      activateProfile: vi.fn(),
      retireProfile: vi.fn(),
    },
    { resolve: vi.fn(async () => resolution()) },
    { resolve: vi.fn(async () => provider) },
  );
  return { service, provider, calls };
};

describe('AKP-3 WP3 Discovery AI profile and structured generation', () => {
  it('creates a Project-scoped profile bound to the exact AI configuration and capability revisions', async () => {
    const { service, configurations, credentials } = createProfileService();
    const created = await service.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      aiConfigurationRevision: 4,
      providerId: 'openai',
      modelId: 'gpt-discovery',
      promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
      outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
      createdBy: 'owner-1',
    });

    expect(created).toMatchObject({
      projectId: 'project-1',
      profileRevision: 1,
      aiConfigurationRevision: 4,
      providerRegistryRevision: 'provider-registry:v1',
      modelCapabilityRevision: 'model-capability:v4',
      status: 'PREPARED',
    });
    expect(created).not.toHaveProperty('credentialId');
    expect(created).not.toHaveProperty('secret');
    expect(configurations.getRevision).toHaveBeenCalledWith('project-1', 4);
    expect(credentials.getMetadata).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai',
      credentialId: 'credential-7',
      credentialRevision: 2,
    });
  });

  it('interprets exactly one bounded relation candidate with complete HYBRID provenance', async () => {
    const { service, provider, calls } = createGenerationService(
      JSON.stringify({ proposedRelationType: 'supports', direction: 'DIRECTED' }),
    );
    const a = ref('a');
    const b = ref('b');
    const result = await service.interpretHypothesis({
      projectId: 'project-1',
      runId: 'run-1',
      candidate: candidateFor('RELATION_HYPOTHESIS', [a, b]),
      context: contextFor([a, b]),
    });

    expect(result.generationMethod).toBe('HYBRID');
    expect(result.payload).toMatchObject({
      payloadType: 'RELATION_HYPOTHESIS',
      sourceEndpoint: a,
      targetEndpoint: b,
      proposedRelationType: 'supports',
      direction: 'DIRECTED',
    });
    expect(result.relatedResourceRefs).toEqual([a, b]);
    expect(result.provenance).toMatchObject({
      kind: 'HYBRID',
      aiExecution: {
        providerId: 'openai',
        credentialId: 'credential-7',
        credentialRevision: '2',
        providerPolicyFingerprint: 'policy-fingerprint-7',
        promptVersion: DISCOVERY_AI_PROMPT_VERSION_V1,
        outputSchemaVersion: DISCOVERY_AI_OUTPUT_SCHEMA_VERSION_V1,
      },
    });
    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
    expect(calls[0]?.systemInstruction).toBe(DISCOVERY_AI_SYSTEM_INSTRUCTION_V1);
    expect(calls[0]?.prompt).toContain('knowledgeData');
    expect(calls[0]?.responseSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(calls[0]?.responseSchema).not.toHaveProperty('properties.projectId');
  });

  it('copies pattern membership and deterministic conflict kind instead of accepting model authority', async () => {
    const pattern = createGenerationService(
      JSON.stringify({
        patternKind: 'CLUSTER',
        patternIdentity: 'cluster-a-b',
        patternStatement: 'The bounded resources form a cluster.',
      }),
    );
    const a = ref('a');
    const b = ref('b');
    const patternResult = await pattern.service.interpretHypothesis({
      projectId: 'project-1',
      runId: 'run-pattern',
      candidate: candidateFor('PATTERN_HYPOTHESIS', [a, b]),
      context: contextFor([a, b], { originatingFindingType: 'PATTERN_HYPOTHESIS' }),
    });
    expect(patternResult.payload).toMatchObject({
      patternKind: 'CLUSTER',
      memberResourceRefs: [a, b],
    });

    const conflict = createGenerationService(
      JSON.stringify({ possibleContradiction: 'Values disagree.' }),
    );
    const conflictResult = await conflict.service.interpretHypothesis({
      projectId: 'project-1',
      runId: 'run-conflict',
      candidate: candidateFor(
        'CONFLICT_HYPOTHESIS',
        [a, b],
        [{ kind: 'EXPLICIT_INCOMPATIBILITY', incompatibilityKind: 'FACTUAL' }],
      ),
      context: contextFor([a, b], { originatingFindingType: 'CONFLICT_HYPOTHESIS' }),
    });
    expect(conflictResult.payload).toMatchObject({
      contradictionKind: 'FACTUAL',
      possibleContradiction: 'Values disagree.',
    });
    expect(conflictResult.payload).not.toHaveProperty('providerContradictionKind');
  });

  it('fails closed before the provider call when context expands the WP2 candidate', async () => {
    const { service, provider } = createGenerationService(
      JSON.stringify({ proposedRelationType: 'supports', direction: 'DIRECTED' }),
    );
    const a = ref('a');
    const b = ref('b');
    const extra = ref('extra');
    await expect(
      service.interpretHypothesis({
        projectId: 'project-1',
        runId: 'run-unsafe',
        candidate: candidateFor('RELATION_HYPOTHESIS', [a, b]),
        context: contextFor([a, b, extra]),
      }),
    ).rejects.toMatchObject({ name: 'DiscoveryAIGenerationError', code: 'INVALID_INPUT' });
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it('rejects prompt-injection output fields and keeps Action suggestions candidate-only', async () => {
    const malicious = createGenerationService(
      JSON.stringify({
        suggestedAction: 'Run it',
        rationale: 'Because',
        executionStatus: 'EXECUTE',
      }),
    );
    const a = ref('a');
    await expect(
      malicious.service.generateAction({
        projectId: 'project-1',
        runId: 'run-action-invalid',
        context: contextFor([a], { originatingFindingType: 'ACTION_SUGGESTION' }),
      }),
    ).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });

    const valid = createGenerationService(
      JSON.stringify({
        suggestedAction: 'Review the approved record',
        rationale: 'The bounded evidence indicates review is useful.',
        riskContext: 'No execution authority is granted.',
      }),
    );
    const result = await valid.service.generateAction({
      projectId: 'project-1',
      runId: 'run-action',
      context: contextFor([a], { originatingFindingType: 'ACTION_SUGGESTION' }),
    });
    expect(result.generationMethod).toBe('AI_ASSISTED');
    expect(result.payload).toMatchObject({
      payloadType: 'ACTION_SUGGESTION',
      affectedResourceRefs: [a],
      executionStatus: 'CANDIDATE_ONLY',
    });
    expect(result.payload).not.toHaveProperty('execute');
    expect(result.payload).not.toHaveProperty('connector');
  });

  it('generates one bounded Clarification Question with server-owned target lineage', async () => {
    const { service, provider, calls } = createGenerationService(
      JSON.stringify({
        question: 'Which approved revision should be reviewed next?',
        context: 'The bounded context contains two approved resources.',
        proposedNextStep: 'Confirm the target revision with the reviewer.',
      }),
    );
    const a = ref('a');
    const b = ref('b');
    const result = await service.generateClarification({
      projectId: 'project-1',
      runId: 'run-clarification',
      context: contextFor([a, b], { originatingFindingType: 'CLARIFICATION_QUESTION' }),
    });

    expect(result.generationMethod).toBe('AI_ASSISTED');
    expect(result.payload).toMatchObject({
      payloadType: 'CLARIFICATION_QUESTION',
      investigationTargetRefs: [a, b],
      question: 'Which approved revision should be reviewed next?',
      proposedNextStep: 'Confirm the target revision with the reviewer.',
    });
    expect(result.payload).not.toHaveProperty('providerTargetRefs');
    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
    expect(calls[0]?.responseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['question', 'context', 'proposedNextStep'],
    });
  });
});
