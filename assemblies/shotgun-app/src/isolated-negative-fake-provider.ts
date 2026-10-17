import { createHash } from 'node:crypto';

import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from '../../../modules/ai-provider/src/index.js';

/** A local, queue-backed provider for the product Fake profile. It has no transport. */
export class IsolatedFakeExplicitNegativeProvider implements AIProviderAdapterPort {
  readonly identity = Object.freeze({
    provider: 'isolated-fake',
    model: 'shotgun-explicit-negative-fake',
    adapterVersion: '1.0.0',
    dataPolicyVersion: 'isolated-fake-local-v1',
  });

  readonly accountFingerprint: string;
  private readonly responses: StructuredGenerationResponse[] = [];
  private callCount = 0;

  constructor(readonly accountId: string) {
    if (!/^isolated-fake-[a-z0-9_-]{1,64}$/u.test(accountId))
      throw new Error('A synthetic isolated Fake account is required.');
    this.accountFingerprint = createHash('sha256').update(accountId).digest('hex');
  }

  enqueue(response: StructuredGenerationResponse): void {
    if (typeof response.rawText !== 'string') throw new Error('Fake raw response is required.');
    this.responses.push(structuredClone(response));
  }

  async generateStructured(
    _request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResponse> {
    const response = this.responses.shift();
    if (!response) throw new Error('No isolated Fake response was queued.');
    this.callCount++;
    return {
      ...response,
      providerResponseId: response.providerResponseId ?? `isolated-fake-${this.callCount}`,
      modelVersion: response.modelVersion ?? this.identity.model,
    };
  }

  calls(): number {
    return this.callCount;
  }
}
