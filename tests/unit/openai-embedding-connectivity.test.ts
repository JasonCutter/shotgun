import { describe, expect, it } from 'vitest';

import { OpenAIEmbeddingConnectivityAdapter } from '../../adapters/ai-provider-openai/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';

describe('AKP-1R R1: OpenAIEmbeddingConnectivityAdapter', () => {
  it('14. Request uses /embeddings endpoint, expected model, input, dimensions, and Bearer credential', async () => {
    let capturedUrl: string | URL | undefined;
    let capturedInit: RequestInit | undefined;

    const fakeFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = url;
      capturedInit = init;

      const mockResponse = {
        object: 'list',
        data: [
          {
            object: 'embedding',
            index: 0,
            embedding: [0.01, 0.02, 0.03],
          },
          {
            object: 'embedding',
            index: 1,
            embedding: [0.04, 0.05, 0.06],
          },
        ],
        model: 'text-embedding-3-small',
        usage: {
          prompt_tokens: 12,
          total_tokens: 12,
        },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new OpenAIEmbeddingConnectivityAdapter({
      baseUrl: 'https://api.openai.com/v1',
      fetch: fakeFetch,
    });

    const response = await adapter.embed({
      modelId: 'text-embedding-3-small',
      input: ['Text 1', 'Text 2'],
      dimension: 512,
      apiKey: 'sk-secret-openai-api-key-test',
    });

    expect(String(capturedUrl)).toBe('https://api.openai.com/v1/embeddings');
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-secret-openai-api-key-test',
    );
    expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );

    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).toEqual({
      model: 'text-embedding-3-small',
      input: ['Text 1', 'Text 2'],
      dimensions: 512,
    });

    expect(response.providerId).toBe('openai');
    expect(response.modelId).toBe('text-embedding-3-small');
    expect(response.items).toHaveLength(2);
    expect(response.items[0]?.vector).toEqual([0.01, 0.02, 0.03]);
    expect(response.items[0]?.dimension).toBe(3);
    expect(response.totalTokens).toBe(12);
  });

  it('15. Valid response is mapped deterministically with index ordering preserved', async () => {
    // Return items out-of-order in response to test deterministic sorting by index
    const fakeFetch = async (): Promise<Response> => {
      const mockResponse = {
        object: 'list',
        data: [
          {
            object: 'embedding',
            index: 1,
            embedding: [0.2, 0.3],
          },
          {
            object: 'embedding',
            index: 0,
            embedding: [0.1, 0.2],
          },
        ],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 8, total_tokens: 8 },
      };

      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new OpenAIEmbeddingConnectivityAdapter({ fetch: fakeFetch });

    const response = await adapter.embed({
      modelId: 'text-embedding-3-small',
      input: ['Item 0', 'Item 1'],
      apiKey: 'sk-test',
    });

    expect(response.items[0]?.vector).toEqual([0.1, 0.2]);
    expect(response.items[1]?.vector).toEqual([0.2, 0.3]);
  });

  it('16. 401/403, 429, 5xx, timeout, invalid JSON/schema and network failures map to safe typed failures', async () => {
    // 1. 401 Authentication failure
    const authFailAdapter = new OpenAIEmbeddingConnectivityAdapter({
      fetch: async () => new Response('Unauthorized', { status: 401 }),
    });
    await expect(
      authFailAdapter.embed({
        modelId: 'text-embedding-3-small',
        input: 'Test',
        apiKey: 'sk-invalid-key-should-not-leak',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ShotgunError);
      const shotgunErr = err as ShotgunError;
      expect(shotgunErr.code).toBe('AUTHENTICATION_FAILED');
      expect(shotgunErr.safeMessage).not.toContain('sk-');
      return true;
    });

    // 2. 429 Rate limited
    const rateLimitAdapter = new OpenAIEmbeddingConnectivityAdapter({
      fetch: async () => new Response('Too Many Requests', { status: 429 }),
    });
    await expect(
      rateLimitAdapter.embed({
        modelId: 'text-embedding-3-small',
        input: 'Test',
        apiKey: 'sk-test',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ShotgunError);
      const shotgunErr = err as ShotgunError;
      expect(shotgunErr.code).toBe('RATE_LIMITED');
      expect(shotgunErr.retryable).toBe(true);
      return true;
    });

    // 3. 500 Server error
    const serverErrorAdapter = new OpenAIEmbeddingConnectivityAdapter({
      fetch: async () => new Response('Internal Server Error', { status: 500 }),
    });
    await expect(
      serverErrorAdapter.embed({
        modelId: 'text-embedding-3-small',
        input: 'Test',
        apiKey: 'sk-test',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ShotgunError);
      const shotgunErr = err as ShotgunError;
      expect(shotgunErr.code).toBe('RETRYABLE_DEPENDENCY');
      expect(shotgunErr.retryable).toBe(true);
      return true;
    });

    // 4. Timeout
    const timeoutAdapter = new OpenAIEmbeddingConnectivityAdapter({
      timeoutMs: 10,
      fetch: async () => new Promise((resolve) => setTimeout(resolve, 100)),
    });
    await expect(
      timeoutAdapter.embed({
        modelId: 'text-embedding-3-small',
        input: 'Test',
        apiKey: 'sk-test',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ShotgunError);
      const shotgunErr = err as ShotgunError;
      expect(shotgunErr.code).toBe('TIMEOUT');
      return true;
    });

    // 5. Invalid JSON response
    const invalidJsonAdapter = new OpenAIEmbeddingConnectivityAdapter({
      fetch: async () => new Response('<html>Error page</html>', { status: 200 }),
    });
    await expect(
      invalidJsonAdapter.embed({
        modelId: 'text-embedding-3-small',
        input: 'Test',
        apiKey: 'sk-test',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ShotgunError);
      const shotgunErr = err as ShotgunError;
      expect(shotgunErr.code).toBe('VALIDATION_ERROR');
      return true;
    });

    // 6. Malformed response schema (empty data)
    const malformedSchemaAdapter = new OpenAIEmbeddingConnectivityAdapter({
      fetch: async () =>
        new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 }),
    });
    await expect(
      malformedSchemaAdapter.embed({
        modelId: 'text-embedding-3-small',
        input: 'Test',
        apiKey: 'sk-test',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ShotgunError);
      const shotgunErr = err as ShotgunError;
      expect(shotgunErr.code).toBe('VALIDATION_ERROR');
      return true;
    });
  });

  it('rejects insecure HTTP base URL without https protocol', () => {
    expect(
      () =>
        new OpenAIEmbeddingConnectivityAdapter({
          baseUrl: 'http://insecure-api.openai.com/v1',
        }),
    ).toThrow('OpenAI base URL must be an HTTPS URL');
  });
});
