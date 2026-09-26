import { describe, expect, it, vi } from 'vitest';

import { GeneralAIVPDecisionAdapter } from '../../adapters/vp-decision-general-ai/src/index.js';
import type {
  AIProviderExecutionResolverPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
import type { VPRelationDecisionRequest } from '../../modules/vp-decision/src/index.js';

const request: VPRelationDecisionRequest = {
  projectId: 'project-a',
  left: {
    assertionId: 'left',
    sourceVersionId: 'version-a',
    evidenceId: 'evidence-a',
    text: 'Output rose by 5% in 2024.',
    accessScope: ['owner'],
    sensitivity: 'internal',
  },
  right: {
    assertionId: 'right',
    sourceVersionId: 'version-b',
    evidenceId: 'evidence-b',
    text: 'Output fell by 5% in 2024.',
    accessScope: ['owner'],
    sensitivity: 'private',
  },
  allowedAccessScope: ['owner'],
  authorizedSensitivities: ['internal', 'private'],
  externalEgressAllowed: true,
  policyRevision: 'vp-relation-v1',
};

const probabilities = {
  EQUIVALENT: 0.01,
  QUALIFIES: 0.02,
  CONTRADICTS: 0.93,
  RELATED: 0.03,
  UNRESOLVED: 0.01,
};

describe('project-resolved general AI VP DecisionProvider contract', () => {
  it('uses the project credential resolver and sends only bounded pair text', async () => {
    const generateStructured = vi.fn(async (_request: StructuredGenerationRequest) => ({
      rawText: JSON.stringify({ choice: 'CONTRADICTS', confidence: 0.93, probabilities }),
      providerResponseId: 'response-1',
      inputTokens: 110,
      outputTokens: 34,
    }));
    const resolve = vi.fn(async () => ({
      adapter: {
        identity: {
          provider: 'deepseek',
          model: 'model-pinned',
          adapterVersion: 'test',
          dataPolicyVersion: 'test',
        },
        generateStructured,
      },
      executionIdentity: {} as never,
    }));
    const adapter = new GeneralAIVPDecisionAdapter({ resolve } as AIProviderExecutionResolverPort);
    expect(await adapter.decideRelation(request)).toMatchObject({
      choice: 'CONTRADICTS',
      model: 'deepseek/model-pinned',
      inputTokens: 110,
      outputTokens: 34,
    });
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-a',
        sourceVersionId: 'version-a',
        sensitivity: 'private',
        accessScope: ['owner'],
      }),
    );
    const sent = generateStructured.mock.calls[0]?.[0];
    expect(sent?.maxOutputTokens).toBe(256);
    expect(JSON.parse(sent?.prompt ?? '')).toEqual({
      left: request.left.text,
      right: request.right.text,
    });
    expect(sent?.prompt).not.toContain('project-a');
  });

  it('does not call a provider for restricted or disjoint scopes', async () => {
    const resolve = vi.fn();
    const adapter = new GeneralAIVPDecisionAdapter({ resolve } as never);
    await expect(
      adapter.decideRelation({
        ...request,
        right: { ...request.right, sensitivity: 'restricted' },
      }),
    ).rejects.toThrow(/authorized evidence scope/);
    await expect(
      adapter.decideRelation({
        ...request,
        right: { ...request.right, accessScope: ['member'] },
        allowedAccessScope: ['owner', 'member'],
      }),
    ).rejects.toThrow(/no shared access scope/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects malformed model output rather than recording a relation', async () => {
    const resolver = {
      resolve: async () => ({
        adapter: {
          identity: { provider: 'test', model: 'pinned' },
          generateStructured: async () => ({
            rawText: JSON.stringify({ choice: 'CONTRADICTS', confidence: 0.93, probabilities: {} }),
          }),
        },
      }),
    } as unknown as AIProviderExecutionResolverPort;
    await expect(new GeneralAIVPDecisionAdapter(resolver).decideRelation(request)).rejects.toThrow(
      /invalid VP relation decision/,
    );
  });
});
