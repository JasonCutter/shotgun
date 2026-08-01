import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from '../../../modules/ai-provider/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

export type FakeAIProviderStep =
  | { readonly rawText: string }
  | { readonly claimText: string }
  | { readonly errorCode: 'RATE_LIMITED' | 'TIMEOUT' | 'TERMINAL_FAILURE' };

export class FakeAIProviderAdapter implements AIProviderAdapterPort {
  readonly identity = {
    provider: 'fake',
    adapterVersion: '1.0.0',
    model: 'shotgun-direct-copy',
    dataPolicyVersion: 'fake-local-v1' as const,
  };

  private callCount = 0;

  constructor(private readonly steps: readonly FakeAIProviderStep[] = []) {}

  async generateStructured(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResponse> {
    const step = this.steps[this.callCount];
    this.callCount += 1;
    if (step && 'errorCode' in step) {
      throw new ShotgunError({
        code: step.errorCode,
        safeMessage: 'The fake AI provider failed.',
        module: 'fake-ai-provider',
        operation: 'generate-structured',
        retryable: step.errorCode !== 'TERMINAL_FAILURE',
      });
    }
    if (step && 'rawText' in step) {
      return {
        rawText: step.rawText,
        providerResponseId: `fake-${this.callCount}`,
      };
    }

    const parsed = JSON.parse(request.prompt) as {
      readonly task?: string;
      readonly question?: string;
      readonly evidence: readonly {
        readonly evidenceId: string;
        readonly text?: string;
        readonly exactQuote?: string;
      }[];
    };
    if (parsed.task === 'shotgun-ask-answer-v1') {
      const answer = parsed.evidence.length
        ? `${parsed.question ?? 'Answer'}\n\n${parsed.evidence
            .map((item) => item.text ?? item.exactQuote ?? '')
            .join('\n')}`
        : `No selected Evidence was available for: ${parsed.question ?? 'the question'}`;
      return {
        rawText: JSON.stringify({
          answer,
          citations: parsed.evidence.map((item) => ({ evidenceId: item.evidenceId })),
        }),
        providerResponseId: `fake-${this.callCount}`,
        modelVersion: this.identity.model,
        inputTokens: Math.ceil(request.prompt.length / 4),
        outputTokens: Math.ceil(answer.length / 4),
      };
    }
    if (step && 'claimText' in step) {
      return {
        rawText: JSON.stringify({
          candidates: [
            {
              claimText: step.claimText,
              evidenceId: parsed.evidence[0]?.evidenceId,
            },
          ],
        }),
        providerResponseId: `fake-${this.callCount}`,
      };
    }
    const rawText = JSON.stringify({
      candidates: parsed.evidence.map((item) => ({
        claimText: item.text ?? item.exactQuote ?? '',
        evidenceId: item.evidenceId,
      })),
    });
    return {
      rawText,
      providerResponseId: `fake-${this.callCount}`,
      modelVersion: this.identity.model,
      inputTokens: Math.ceil(request.prompt.length / 4),
      outputTokens: Math.ceil(rawText.length / 4),
    };
  }

  calls(): number {
    return this.callCount;
  }
}
