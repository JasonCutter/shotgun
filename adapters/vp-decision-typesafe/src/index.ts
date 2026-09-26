import {
  assertVPDecisionEgress,
  VP_RELATION_CHOICES,
  type VPDecisionProviderPort,
  type VPRelationChoice,
  type VPRelationDecision,
  type VPRelationDecisionRequest,
} from '../../../modules/vp-decision/src/index.js';

type JevAdapterOptions = {
  readonly apiKey: string;
  /** A deployed, explicitly selected model revision; never `jev-latest`. */
  readonly model: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const finiteProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const parseResponse = (value: unknown): VPRelationDecision => {
  const response = record(value);
  const answers = record(response?.['answers']);
  const relation = record(answers?.['relation']);
  const deepAnalysis = record(answers?.['needs_deep_analysis']);
  const usage = record(response?.['usage']);
  const choice = relation?.['choice'];
  const probabilities = record(relation?.['probabilities']);
  const confidence = relation?.['confidence'];
  const needsDeepAnalysis = deepAnalysis?.['noul'];
  if (
    typeof response?.['model'] !== 'string' ||
    relation?.['type'] !== 'choice' ||
    deepAnalysis?.['type'] !== 'noul' ||
    !VP_RELATION_CHOICES.includes(choice as VPRelationChoice) ||
    !finiteProbability(confidence) ||
    !finiteProbability(needsDeepAnalysis) ||
    !probabilities ||
    !nonnegativeInteger(usage?.['input_tokens']) ||
    !nonnegativeInteger(usage?.['output_tokens'])
  ) {
    throw new Error('TypeSafe Jev returned an invalid VP decision response.');
  }
  const parsedProbabilities: Partial<Record<VPRelationChoice, number>> = {};
  let total = 0;
  for (const option of VP_RELATION_CHOICES) {
    const probability = probabilities[option];
    if (!finiteProbability(probability)) {
      throw new Error('TypeSafe Jev returned an incomplete relation distribution.');
    }
    parsedProbabilities[option] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > 0.02) {
    throw new Error('TypeSafe Jev returned an invalid relation distribution.');
  }
  return {
    choice: choice as VPRelationChoice,
    confidence,
    probabilities: parsedProbabilities,
    deepAnalysisScore: needsDeepAnalysis,
    model: response['model'],
    inputTokens: usage['input_tokens'],
    outputTokens: usage['output_tokens'],
    ...(typeof response['request_id'] === 'string'
      ? { providerRequestId: response['request_id'] }
      : {}),
  };
};

export class TypeSafeJevVPDecisionAdapter implements VPDecisionProviderPort {
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: JevAdapterOptions) {
    if (!options.apiKey || !options.model || options.model.includes('latest')) {
      throw new Error('VP Jev requires a credential and a pinned model revision.');
    }
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = options.endpoint ?? 'https://api.typesafe.ai/v1/systemone';
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async decideRelation(input: VPRelationDecisionRequest): Promise<VPRelationDecision> {
    assertVPDecisionEgress(input);
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.options.model,
        state: {
          left: { text: input.left.text },
          right: { text: input.right.text },
        },
        questions: {
          relation: {
            type: 'choice',
            instructions:
              'Classify only the relationship of the two supplied source assertions. Compare their meaning, conditions, quantity, and time. Do not use outside knowledge. Choose UNRESOLVED if the supplied text is insufficient.',
            criteria: {
              EQUIVALENT: 'Same claim with the same conditions and time.',
              QUALIFIES: 'One claim adds a condition, exception, or narrower scope.',
              CONTRADICTS: 'Claims cannot both hold for the same scope and time.',
              RELATED:
                'Related subject, but no supported equivalent, qualification, or contradiction.',
              UNRESOLVED: 'Insufficient information to determine the relationship.',
            },
          },
          needs_deep_analysis: {
            type: 'noul',
            instructions:
              'Do these two assertions require deeper analysis of conditions, time, quantities, causality, or context before a relationship can be recorded?',
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`TypeSafe Jev decision request failed (${response.status}).`);
    const result = parseResponse(await response.json());
    if (result.model !== this.options.model) {
      throw new Error('TypeSafe Jev used a model revision different from the pinned revision.');
    }
    return result;
  }
}
