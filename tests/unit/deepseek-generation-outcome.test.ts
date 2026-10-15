import { describe, expect, it, vi } from 'vitest';

import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';

const apiKey = new TextEncoder().encode('SYNTHETIC-KEY-NOT-LIVE');
const generation = {
  apiKey,
  modelId: 'deepseek-flash',
  request: {
    systemInstruction: 'Fixture only.',
    prompt: 'Return a fixture object.',
    responseSchema: { type: 'object' },
  },
};

describe('DeepSeek generation outcome boundary, fake HTTP only', () => {
  it('does not dispatch a pre-aborted generation', async () => {
    const fetch = vi.fn();
    const adapter = new DeepSeekConnectivityAdapter({ fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.generateStructured({ ...generation, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TERMINAL_FAILURE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies a lost generation response as unknown without retry authority', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('synthetic transport reset');
    });
    const adapter = new DeepSeekConnectivityAdapter({ fetch });
    await expect(adapter.generateStructured(generation)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('classifies an aborted generation response as unknown', async () => {
    const fetch = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const adapter = new DeepSeekConnectivityAdapter({ fetch, generationTimeoutMs: 5 });
    await expect(adapter.generateStructured(generation)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('classifies a broken response body stream as unknown', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('synthetic body stream reset'));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(
      new DeepSeekConnectivityAdapter({ fetch }).generateStructured(generation),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a complete malformed JSON response as validation failure', async () => {
    const fetch = vi.fn(async () => new Response('broken JSON', { status: 200 }));
    await expect(
      new DeepSeekConnectivityAdapter({ fetch }).generateStructured(generation),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', retryable: false });
  });

  it('keeps known HTTP failures and connectivity probes on their existing paths', async () => {
    const statusFetch = vi.fn(async () => new Response('', { status: 503 }));
    await expect(
      new DeepSeekConnectivityAdapter({ fetch: statusFetch }).generateStructured(generation),
    ).rejects.toMatchObject({ code: 'RETRYABLE_DEPENDENCY', retryable: true });
    const probeFetch = vi.fn(async () => {
      throw new TypeError('synthetic transport reset');
    });
    await expect(
      new DeepSeekConnectivityAdapter({ fetch: probeFetch }).testConnection({
        apiKey,
        modelId: 'deepseek-flash',
      }),
    ).rejects.toMatchObject({ code: 'RETRYABLE_DEPENDENCY', retryable: true });
  });
});
