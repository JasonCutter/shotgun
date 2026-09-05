import { describe, expect, it } from 'vitest';

import type {
  AIProviderAdapterPort,
  AIProviderExecutionResolverPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
import {
  COMPARISON_V2_CONTRACT_VERSION,
  canonicalSnapshotDigest,
  shortlistAuditDigestV2,
  ShotgunError,
  type CanonicalSnapshot,
  type ComparisonCandidateV2,
  type SecurityContext,
  type ShortlistAuditV2,
} from '../../packages/contracts/src/index.js';
import {
  COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2,
  createComparisonSemanticAnalysisV2,
  type ComparisonSemanticAnalysisV2Dependencies,
  type ComparisonSemanticAnalysisV2Request,
} from '../../modules/comparison/src/semantic-analysis-v2.js';

const projectId = 'project-semantic-v2';
const fixedNow = '2026-09-05T12:00:00.000Z';

const snapshotBase = {
  snapshotId: 'snapshot-7',
  projectId,
  version: 7,
  claims: [
    {
      claimId: 'claim-1',
      text: 'Shotgun stores Evidence.',
      revisionNumber: 3,
      evidenceIds: ['e-1'],
    },
    { claimId: 'claim-2', text: 'Evidence is immutable.', revisionNumber: 4, evidenceIds: ['e-2'] },
    {
      claimId: 'claim-secret',
      text: 'Secret claim text.',
      revisionNumber: 1,
      evidenceIds: ['e-3'],
    },
  ],
  createdAt: fixedNow,
} as const;

const snapshot: CanonicalSnapshot = {
  ...snapshotBase,
  digest: canonicalSnapshotDigest(
    snapshotBase.projectId,
    snapshotBase.version,
    snapshotBase.claims,
    undefined,
  ),
};

const candidate: ComparisonCandidateV2 = {
  id: 'candidate-1',
  revision: 1,
  digest: 'sha256:candidate',
  sourceVersionId: 'source-version-1',
  evidenceIds: ['candidate-evidence-1'],
};

const security: SecurityContext = {
  accessScope: ['owner'],
  sensitivity: 'private',
  dataClassification: 'comparison.semantic',
};

const makeAudit = (targetIds: readonly string[] = ['claim-1', 'claim-2']): ShortlistAuditV2 => {
  const audit: ShortlistAuditV2 = {
    contractVersion: COMPARISON_V2_CONTRACT_VERSION,
    canonicalSnapshot: {
      id: snapshot.snapshotId,
      version: snapshot.version,
      digest: snapshot.digest,
    },
    lexicalProjectionWatermark: 'sha256:lexical-watermark',
    lexicalProjectionBase: 'sha256:lexical-base',
    semanticGenerationId: 'generation-1',
    semanticSourceProjectionDigest: 'sha256:semantic-source',
    semanticCanonicalBaseVersion: snapshot.version,
    querySemanticReadiness: 'READY',
    policyRevision: 'comparison-shortlist-policy:v1',
    k: Math.max(targetIds.length, 1),
    selectedTargetIdentities: targetIds.map((resourceId) => ({
      resourceType: 'CLAIM',
      resourceId,
      resourceRevision:
        snapshot.claims.find((claim) => claim.claimId === resourceId)?.revisionNumber ?? 1,
    })),
    exclusionCounts: { ENTITY: 1 },
    truncated: false,
    coverageStatus: 'COMPLETE',
  };
  return audit;
};

const executionIdentity = {
  providerId: 'provider-test',
  modelId: 'model-test',
  aiConfigurationRevision: 2,
  credentialId: 'credential-test',
  credentialRevision: 4,
  policyContextRevision: 'policy-context-1',
  providerPolicyFingerprint: 'policy-fingerprint-1',
} as const;

const responseFor = (relationships: readonly Record<string, unknown>[]): string =>
  JSON.stringify({ relationships });

const makeRequest = (
  audit: ShortlistAuditV2 = makeAudit(),
): ComparisonSemanticAnalysisV2Request => ({
  projectId,
  comparisonId: 'comparison-1',
  candidate,
  candidateText: 'Shotgun stores Evidence and Evidence is immutable.',
  shortlist: audit,
  shortlistDigest: shortlistAuditDigestV2(audit),
  actor: { type: 'user', id: 'user-1' },
  security,
  attempt: 1,
});

const makeDependencies = (
  output: string,
  overrides: Partial<ComparisonSemanticAnalysisV2Dependencies> = {},
) => {
  const prompts: StructuredGenerationRequest[] = [];
  let providerCalls = 0;
  const adapter: AIProviderAdapterPort = {
    identity: {
      provider: executionIdentity.providerId,
      model: executionIdentity.modelId,
      adapterVersion: 'test-adapter-v1',
      dataPolicyVersion: 'test-policy-v1',
    },
    async generateStructured(request) {
      providerCalls += 1;
      prompts.push(request);
      return { rawText: output, providerResponseId: `response-${providerCalls}` };
    },
  };
  const executionResolver: AIProviderExecutionResolverPort = {
    async resolve() {
      return { adapter, executionIdentity };
    },
  };
  const resourceResolver = {
    async resolveResource(requestedProjectId: string, _resourceType: 'CLAIM', resourceId: string) {
      const claim = snapshot.claims.find((item) => item.claimId === resourceId);
      if (requestedProjectId !== projectId || !claim) return undefined;
      return {
        text: claim.text,
        authority: 'CANONICAL' as const,
        authorityRevision: claim.revisionNumber,
        resourceRevision: claim.revisionNumber,
        canonicalVersion: snapshot.version,
        sourceSnapshotDigest: snapshot.digest,
        accessScope: ['owner'],
        sensitivity: 'private' as const,
      };
    },
  };
  const dependencies: ComparisonSemanticAnalysisV2Dependencies = {
    canonicalSnapshot: { getSnapshot: async () => snapshot },
    resourceResolver,
    executionResolver,
    now: () => fixedNow,
    randomId: (() => {
      let next = 0;
      return () => `server-id-${++next}`;
    })(),
    ...overrides,
  };
  return { dependencies, prompts, getProviderCalls: () => providerCalls };
};

const validRelationships = responseFor([
  {
    resourceId: 'claim-1',
    resourceRevision: 3,
    type: 'SUPPORTS',
    rationale: 'The candidate preserves the same claim.',
  },
  {
    resourceId: 'claim-2',
    resourceRevision: 4,
    type: 'REFINES',
    rationale: 'The candidate adds the same immutability detail.',
  },
]);

describe('WP4 governed semantic analysis v2', () => {
  it('analyzes all authorized Claims in one provider call and excludes the rest of the snapshot', async () => {
    const setup = makeDependencies(validRelationships);
    const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
      makeRequest(),
    );

    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(setup.getProviderCalls()).toBe(1);
    const prompt = JSON.parse(setup.prompts[0]!.prompt) as {
      claims: { resourceId: string; text: string }[];
    };
    expect(prompt.claims.map((claim) => claim.resourceId)).toEqual(['claim-1', 'claim-2']);
    expect(prompt.claims.map((claim) => claim.text)).not.toContain('Secret claim text.');
    expect(result.relationships).toHaveLength(2);
    expect(
      result.relationships.every(
        (relationship) => relationship.comparedResource.resourceType === 'CLAIM',
      ),
    ).toBe(true);
    expect(result.analysis.providerIdentity.capabilityId).toBe(
      COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2,
    );
  });

  it('rejects unknown, missing and duplicate model targets without successful material', async () => {
    for (const relationships of [
      [
        {
          resourceId: 'claim-unknown',
          resourceRevision: 1,
          type: 'SUPPORTS',
          rationale: 'unknown',
        },
      ],
      [{ resourceId: 'claim-1', resourceRevision: 3, type: 'SUPPORTS', rationale: 'only one' }],
      [
        { resourceId: 'claim-1', resourceRevision: 3, type: 'SUPPORTS', rationale: 'duplicate' },
        {
          resourceId: 'claim-1',
          resourceRevision: 3,
          type: 'SUPPORTS',
          rationale: 'duplicate again',
        },
      ],
    ]) {
      const setup = makeDependencies(responseFor(relationships));
      const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
        makeRequest(),
      );
      expect(result.status).toBe('FAILED');
      if (result.status === 'FAILED') {
        expect(result.analysis.state).toBe('FAILED_TERMINAL');
        expect(result.relationships).toEqual([]);
      }
    }
  });

  it('enforces CONTRADICTS conflictKind and rejects conflictKind on other types', async () => {
    const valid = makeDependencies(
      responseFor([
        {
          resourceId: 'claim-1',
          resourceRevision: 3,
          type: 'CONTRADICTS',
          conflictKind: 'SCOPE',
          rationale: 'Scope differs.',
        },
        {
          resourceId: 'claim-2',
          resourceRevision: 4,
          type: 'REFINES',
          rationale: 'It refines the claim.',
        },
      ]),
    );
    const validResult = await createComparisonSemanticAnalysisV2(valid.dependencies).analyze(
      makeRequest(),
    );
    expect(validResult.status).toBe('COMPLETED');

    for (const invalid of [
      [
        {
          resourceId: 'claim-1',
          resourceRevision: 3,
          type: 'CONTRADICTS',
          rationale: 'missing conflict',
        },
        { resourceId: 'claim-2', resourceRevision: 4, type: 'REFINES', rationale: 'valid' },
      ],
      [
        {
          resourceId: 'claim-1',
          resourceRevision: 3,
          type: 'SUPPORTS',
          conflictKind: 'SCOPE',
          rationale: 'invalid conflict',
        },
        { resourceId: 'claim-2', resourceRevision: 4, type: 'REFINES', rationale: 'valid' },
      ],
    ]) {
      const setup = makeDependencies(responseFor(invalid));
      const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
        makeRequest(),
      );
      expect(result.status).toBe('FAILED');
    }
  });

  it('blocks before provider egress when a re-resolved target is unauthorized', async () => {
    const setup = makeDependencies(validRelationships, {
      resourceResolver: {
        async resolveResource() {
          return {
            text: 'Secret claim text.',
            authority: 'CANONICAL' as const,
            authorityRevision: 3,
            resourceRevision: 3,
            accessScope: ['secret-scope'],
            sensitivity: 'restricted' as const,
          };
        },
      },
    });
    const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
      makeRequest(),
    );
    expect(result).toMatchObject({ status: 'BLOCKED' });
    expect(setup.getProviderCalls()).toBe(0);
    expect(JSON.stringify(result)).not.toContain('Secret claim text.');
    expect(JSON.stringify(result)).not.toContain('claim-1');
  });

  it('returns typed blocked outcomes and zero calls when governed execution is unavailable or denied', async () => {
    for (const code of ['AI_CAPABILITY_UNAVAILABLE', 'POLICY_DENIED'] as const) {
      const setup = makeDependencies(validRelationships, {
        executionResolver: {
          async resolve() {
            throw new ShotgunError({
              code,
              safeMessage: 'blocked',
              module: 'test',
              operation: 'resolve',
            });
          },
        },
      });
      const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
        makeRequest(),
      );
      expect(result.status).toBe('BLOCKED');
      expect(setup.getProviderCalls()).toBe(0);
    }
  });

  it('maps retryable provider failures to terminal retryable AnalysisRevision with no relationships', async () => {
    const setup = makeDependencies(validRelationships, {
      executionResolver: {
        async resolve() {
          return {
            adapter: {
              identity: {
                provider: executionIdentity.providerId,
                model: executionIdentity.modelId,
                adapterVersion: 'test-adapter-v1',
                dataPolicyVersion: 'test-policy-v1',
              },
              async generateStructured() {
                throw new Error('TIMEOUT');
              },
            },
            executionIdentity,
          };
        },
      },
    });
    const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
      makeRequest(),
    );
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.analysis.state).toBe('FAILED_TERMINAL');
      expect(result.analysis.safeFailureCode).toBe('TERMINAL_FAILURE');
      expect(result.relationships).toEqual([]);
    }
  });

  it('maps a provider ShotgunError timeout to FAILED_RETRYABLE', async () => {
    const setup = makeDependencies(validRelationships, {
      executionResolver: {
        async resolve() {
          return {
            adapter: {
              identity: {
                provider: executionIdentity.providerId,
                model: executionIdentity.modelId,
                adapterVersion: 'test-adapter-v1',
                dataPolicyVersion: 'test-policy-v1',
              },
              async generateStructured() {
                throw new ShotgunError({
                  code: 'TIMEOUT',
                  safeMessage: 'timeout',
                  module: 'test',
                  operation: 'provider',
                  retryable: true,
                });
              },
            },
            executionIdentity,
          };
        },
      },
    });
    const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
      makeRequest(),
    );
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.analysis.state).toBe('FAILED_RETRYABLE');
      expect(result.analysis.safeFailureCode).toBe('ANALYSIS_TIMEOUT');
    }
  });

  it('fails closed for schema-invalid output and returns no completed analysis', async () => {
    const setup = makeDependencies(JSON.stringify({ relationships: [{ resourceId: 'claim-1' }] }));
    const result = await createComparisonSemanticAnalysisV2(setup.dependencies).analyze(
      makeRequest(),
    );
    expect(result.status).toBe('FAILED');
    if (result.status === 'FAILED') {
      expect(result.analysis.state).toBe('FAILED_TERMINAL');
      expect(result.analysis.safeFailureCode).toBe('CONTRACT_FAILURE');
      expect(result.relationships).toEqual([]);
    }
  });

  it('keeps successful normalized material digest deterministic across equivalent decision order', async () => {
    const first = makeDependencies(validRelationships);
    const second = makeDependencies(
      responseFor([
        {
          resourceId: 'claim-2',
          resourceRevision: 4,
          type: 'REFINES',
          rationale: 'The candidate adds the same immutability detail.',
        },
        {
          resourceId: 'claim-1',
          resourceRevision: 3,
          type: 'SUPPORTS',
          rationale: 'The candidate preserves the same claim.',
        },
      ]),
    );
    const firstResult = await createComparisonSemanticAnalysisV2(first.dependencies).analyze(
      makeRequest(),
    );
    const secondResult = await createComparisonSemanticAnalysisV2(second.dependencies).analyze(
      makeRequest(),
    );
    expect(firstResult.status).toBe('COMPLETED');
    expect(secondResult.status).toBe('COMPLETED');
    if (firstResult.status === 'COMPLETED' && secondResult.status === 'COMPLETED') {
      expect(firstResult.analysis.materialDigest).toBe(secondResult.analysis.materialDigest);
      expect(firstResult.analysis.inputDigest).toBe(secondResult.analysis.inputDigest);
      expect(firstResult.relationships.map((item) => item.comparedResource.resourceId)).toEqual([
        'claim-1',
        'claim-2',
      ]);
    }
  });
});
