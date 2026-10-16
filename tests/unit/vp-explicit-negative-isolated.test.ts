import { describe, expect, it, vi } from 'vitest';
import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
import {
  VP_RELATION_CHOICES,
  VPDecisionOutcomeUnknownError,
  validVPRelationDecision,
  type VPRelationDecision,
  type VPRelationDecisionRequest,
} from '../../modules/vp-decision/src/index.js';
import {
  EXPLICIT_NEGATIVE_CHOICES,
  EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  classifyExplicitNegativeDeclaration,
  parseExplicitNegativeDeclaration,
  type ExplicitNegativeChoice,
} from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import {
  IsolatedExplicitNegativeAdapter,
  EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION,
} from '../../adapters/vp-decision-general-ai/src/explicit-negative-isolated.js';
import { VP_RELATION_COMPARISON_SYSTEM_INSTRUCTION } from '../../adapters/vp-decision-general-ai/src/index.js';
import { RELATION_TARGET_REVISIONS } from '../../packages/vp-relation-evaluation/src/index.js';

const input = (): VPRelationDecisionRequest => ({
  projectId: 'synthetic-isolated-project',
  policyRevision: EXPLICIT_NEGATIVE_ISOLATED_REVISION,
  left: {
    assertionId: 'synthetic-a',
    sourceVersionId: 'synthetic-av',
    evidenceId: 'synthetic-ae',
    text: 'The printer supports duplex printing.',
    accessScope: ['owner'],
    sensitivity: 'public',
  },
  right: {
    assertionId: 'synthetic-b',
    sourceVersionId: 'synthetic-bv',
    evidenceId: 'synthetic-be',
    text: 'The fictional lake has a surface area of 42 square units.',
    accessScope: ['owner'],
    sensitivity: 'public',
  },
  allowedAccessScope: ['owner'],
  authorizedSensitivities: ['public'],
  externalEgressAllowed: true,
});
const declaration = (choice: ExplicitNegativeChoice = 'NO_RELATION') => ({
  choice,
  direction: choice === 'SUPPORTS' || choice === 'QUALIFIES' ? 'LEFT_TO_RIGHT' : 'NONE',
  confidence: 0.6,
  probabilities: Object.fromEntries(
    EXPLICIT_NEGATIVE_CHOICES.map((key) => [key, key === choice ? 1 : 0]),
  ),
});
const fake = (value: unknown = declaration()) => ({
  identity: {
    provider: 'isolated-fake',
    adapterVersion: 'synthetic-only',
    model: 'synthetic-no-network',
    dataPolicyVersion: 'synthetic-only',
  },
  generateStructured: vi.fn(async (_request: StructuredGenerationRequest) => ({
    rawText: JSON.stringify(value),
    inputTokens: 100,
    outputTokens: 40,
  })),
});

describe('opt-in isolated explicit-negative protocol, not model semantic quality', () => {
  it('keeps production v6 six choices and does not implement the production provider interface', () => {
    expect(VP_RELATION_CHOICES).toEqual([
      'EQUIVALENT',
      'SUPPORTS',
      'QUALIFIES',
      'CONTRADICTS',
      'RELATED',
      'UNRESOLVED',
    ]);
    expect(EXPLICIT_NEGATIVE_CHOICES).toHaveLength(7);
    expect(RELATION_TARGET_REVISIONS.V6_EXPLICIT_NEGATIVE_ISOLATED).toBe(
      EXPLICIT_NEGATIVE_ISOLATED_REVISION,
    );
    expect('decideRelation' in new IsolatedExplicitNegativeAdapter(fake())).toBe(false);
    expect(
      validVPRelationDecision({
        ...declaration(),
        model: 'synthetic',
        deepAnalysisScore: 0,
        inputTokens: 100,
        outputTokens: 40,
      } as unknown as VPRelationDecision),
    ).toBe(false);
  });
  it('retains the exact v6 policy as a prefix and makes the new schema/revision explicit', async () => {
    expect(
      EXPLICIT_NEGATIVE_SYSTEM_INSTRUCTION.startsWith(VP_RELATION_COMPARISON_SYSTEM_INSTRUCTION),
    ).toBe(true);
    const provider = fake();
    const result = await new IsolatedExplicitNegativeAdapter(provider).compareIsolated(
      input(),
      'ISOLATED_FAKE',
    );
    const request = provider.generateStructured.mock.calls[0]![0];
    expect(request.responseSchema.properties).toMatchObject({
      choice: { enum: [...EXPLICIT_NEGATIVE_CHOICES] },
    });
    expect(request.maxOutputTokens).toBe(256);
    expect(JSON.parse(request.prompt).left.claim).toBe(input().left.text);
    expect(result.transportKind).toBe('ISOLATED_FAKE');
    expect(result.policyRevision).toBe(EXPLICIT_NEGATIVE_ISOLATED_REVISION);
    expect(result.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.disposition.status).toBe('NO_RELATION');
    expect(result.providerObservation).toEqual({
      responseId: null,
      modelVersion: null,
      inputTokens: 100,
      outputTokens: 40,
    });
    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
  });
  it.each(EXPLICIT_NEGATIVE_CHOICES)(
    'validates the closed seven-choice schema for %s',
    (choice) => {
      expect(parseExplicitNegativeDeclaration(declaration(choice)).choice).toBe(choice);
    },
  );
  it.each([
    { ...declaration(), direction: 'LEFT_TO_RIGHT' },
    { ...declaration('SUPPORTS'), direction: 'NONE' },
    { ...declaration(), unexpected: true },
    { ...declaration(), choice: 'INDEPENDENT' },
    { ...declaration(), probabilities: { NO_RELATION: 1 } },
    { ...declaration(), probabilities: { ...declaration().probabilities, EXTRA: 0 } },
    {
      ...declaration(),
      probabilities: Object.fromEntries(EXPLICIT_NEGATIVE_CHOICES.map((key) => [key, 1])),
    },
  ])('rejects incompatible fields, directions or probability vectors', (value) => {
    expect(() => parseExplicitNegativeDeclaration(value)).toThrow();
  });
  it('distinguishes a model negative, voluntary abstention, low-probability withholding and usage failure', () => {
    const negative = parseExplicitNegativeDeclaration(declaration());
    expect(
      classifyExplicitNegativeDeclaration(negative, { inputTokens: 100, outputTokens: 40 }).status,
    ).toBe('NO_RELATION');
    expect(
      classifyExplicitNegativeDeclaration(
        parseExplicitNegativeDeclaration(declaration('UNRESOLVED')),
        { inputTokens: 100, outputTokens: 40 },
      ),
    ).toMatchObject({ status: 'UNRESOLVED', reason: 'MODEL_ABSTAINED' });
    const low = {
      ...negative,
      probabilities: { ...negative.probabilities, NO_RELATION: 0.7, UNRESOLVED: 0.3 },
    };
    expect(
      classifyExplicitNegativeDeclaration(low, { inputTokens: 100, outputTokens: 40 }),
    ).toMatchObject({ status: 'WITHHELD', reason: 'CHOICE_PROBABILITY_BELOW_THRESHOLD' });
    expect(
      classifyExplicitNegativeDeclaration(negative, { inputTokens: 4_001, outputTokens: 40 }),
    ).toMatchObject({ status: 'WITHHELD', reason: 'USAGE_LIMIT_EXCEEDED' });
    expect(
      classifyExplicitNegativeDeclaration(
        {
          ...negative,
          probabilities: { ...negative.probabilities, NO_RELATION: 0.9, UNRESOLVED: 0.1 },
        },
        { inputTokens: 100, outputTokens: 40 },
      ).status,
    ).toBe('NO_RELATION');
  });
  it('keeps low self-reported confidence distinct from selected-label probability', () => {
    const decision = parseExplicitNegativeDeclaration({ ...declaration(), confidence: 0.01 });
    expect(
      classifyExplicitNegativeDeclaration(decision, { inputTokens: 100, outputTokens: 40 }).status,
    ).toBe('NO_RELATION');
    expect(decision.confidence).toBe(0.01);
  });
  it('rejects production providers before any invocation', () => {
    const provider = { ...fake(), identity: { ...fake().identity, provider: 'deepseek' } };
    expect(() => new IsolatedExplicitNegativeAdapter(provider)).toThrow('isolated Fake');
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });
  it.each(['wrong-mode', 'wrong-policy', 'durable-job', 'restricted', 'scope', 'egress'] as const)(
    'rejects %s before the Fake call',
    async (scenario) => {
      const provider = fake();
      const request = input();
      const changed =
        scenario === 'wrong-policy'
          ? { ...request, policyRevision: RELATION_TARGET_REVISIONS.V6 }
          : scenario === 'durable-job'
            ? {
                ...request,
                execution: { jobId: 'not-a-test-execution', leaseToken: 'not-a-test-lease' },
              }
            : scenario === 'restricted'
              ? { ...request, left: { ...request.left, sensitivity: 'restricted' as const } }
              : scenario === 'scope'
                ? { ...request, allowedAccessScope: [] }
                : scenario === 'egress'
                  ? { ...request, externalEgressAllowed: false }
                  : request;
      await expect(
        new IsolatedExplicitNegativeAdapter(provider).compareIsolated(
          changed,
          (scenario === 'wrong-mode'
            ? 'ISOLATED_LIVE_ACCEPTANCE'
            : 'ISOLATED_FAKE') as 'ISOLATED_FAKE',
        ),
      ).rejects.toThrow();
      expect(provider.generateStructured).not.toHaveBeenCalled();
    },
  );
  it('preserves invalid output and does not turn schema failure into NO_RELATION', async () => {
    const provider = fake({ choice: 'NO_RELATION' });
    const result = await new IsolatedExplicitNegativeAdapter(provider).compareIsolated(
      input(),
      'ISOLATED_FAKE',
    );
    expect(result.disposition).toEqual({ status: 'INVALID', reason: 'OUTPUT_SCHEMA_INVALID' });
    expect(result.rawResponse).toBe(JSON.stringify({ choice: 'NO_RELATION' }));
  });
  it('distinguishes invalid usage and unknown outcomes without retrying', async () => {
    const invalidUsage: AIProviderAdapterPort = {
      ...fake(),
      generateStructured: async () => ({
        rawText: JSON.stringify(declaration()),
        inputTokens: -1,
        outputTokens: 40,
      }),
    };
    expect(
      (
        await new IsolatedExplicitNegativeAdapter(invalidUsage).compareIsolated(
          input(),
          'ISOLATED_FAKE',
        )
      ).disposition,
    ).toEqual({ status: 'INVALID', reason: 'PROVIDER_USAGE_INVALID' });
    const failing = {
      ...fake(),
      generateStructured: vi.fn(async () => {
        throw new VPDecisionOutcomeUnknownError();
      }),
    };
    expect(
      (await new IsolatedExplicitNegativeAdapter(failing).compareIsolated(input(), 'ISOLATED_FAKE'))
        .disposition.status,
    ).toBe('OUTCOME_UNKNOWN');
    expect(failing.generateStructured).toHaveBeenCalledTimes(1);
  });
  it('binds the captured input to the request identity and retains changes in null/truncation', async () => {
    const one = await new IsolatedExplicitNegativeAdapter(fake()).compareIsolated(
      input(),
      'ISOLATED_FAKE',
    );
    const source = input();
    const changed = {
      ...source,
      right: {
        ...source.right,
        evidenceContext: 'An explicitly different excerpt',
        evidenceContextTruncated: true,
      },
    };
    const two = await new IsolatedExplicitNegativeAdapter(fake()).compareIsolated(
      changed,
      'ISOLATED_FAKE',
    );
    expect(two.requestDigest).not.toBe(one.requestDigest);
    expect(two.schemaDigest).toBe(one.schemaDigest);
  });
  it('does not guess absent provider usage as zero', async () => {
    const provider: AIProviderAdapterPort = {
      ...fake(),
      generateStructured: async () => ({ rawText: JSON.stringify(declaration()) }),
    };
    const record = await new IsolatedExplicitNegativeAdapter(provider).compareIsolated(
      input(),
      'ISOLATED_FAKE',
    );
    expect(record.providerObservation).toEqual({
      responseId: null,
      modelVersion: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(record.disposition).toEqual({ status: 'INVALID', reason: 'PROVIDER_USAGE_INVALID' });
  });
});
