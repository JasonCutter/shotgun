import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DeepSeekConnectivityAdapter,
  DEEPSEEK_IMAGE_TRANSPORT_REVISION,
  type DeepSeekInlineImage,
} from '../../adapters/ai-provider-deepseek/src/index.js';
const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cL1sAAAAASUVORK5CYII=',
  'base64',
);
const image: DeepSeekInlineImage = {
  mediaType: 'image/png',
  contentBase64: bytes.toString('base64'),
  expectedContentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
};
const request = {
  systemInstruction: 'Fixture only.',
  prompt: 'Return the fixture JSON.',
  responseSchema: { type: 'object' },
  maxOutputTokens: 32,
};
const sizedImage = (byteLength: number): DeepSeekInlineImage => {
  // Transport fixtures retain the valid PNG prefix; complete decoding belongs
  // to the authorized image preflight, not this byte-envelope validator.
  const envelope = Buffer.alloc(byteLength);
  bytes.copy(envelope);
  return {
    mediaType: 'image/png',
    contentBase64: envelope.toString('base64'),
    expectedContentHash: `sha256:${createHash('sha256').update(envelope).digest('hex')}`,
  };
};
const fixture = (
  body: unknown = {
    model: 'deepseek-flash',
    id: 'synthetic-response',
    choices: [{ message: { content: '{"description":"fixture only"}' } }],
    usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
  },
) => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  return {
    fetch,
    adapter: new DeepSeekConnectivityAdapter({ fetch }),
    input: {
      apiKey: new TextEncoder().encode('SYNTHETIC-KEY-NOT-LIVE'),
      modelId: 'deepseek-flash',
      request,
      images: [image],
    },
  };
};
describe('prepared DeepSeek native inline image transport, fake HTTP only', () => {
  it.each([
    { name: 'all sparse', images: new Array<DeepSeekInlineImage>(1) },
    {
      name: 'sparse suffix',
      images: Object.assign(new Array<DeepSeekInlineImage>(2), { 0: image }),
    },
  ])('rejects $name image batches before egress', async ({ images }) => {
    const f = fixture();
    await expect(f.adapter.generateImageStructured({ ...f.input, images })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('accepts a canonical 10 MiB pinned image envelope without recursive regex failure', async () => {
    const f = fixture();
    const maximum = sizedImage(10 * 1024 * 1024);
    const result = await f.adapter.generateImageStructured({ ...f.input, images: [maximum] });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      String((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(payload.messages[1].content[1].image_url.url).toBe(
      `data:image/png;base64,${maximum.contentBase64}`,
    );
    expect(result.imageContentHashes).toEqual([maximum.expectedContentHash]);
  });

  it('rejects a canonical image one byte above 10 MiB without egress', async () => {
    const f = fixture();
    await expect(
      f.adapter.generateImageStructured({ ...f.input, images: [sizedImage(10 * 1024 * 1024 + 1)] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['a=aa', 'AAAA===', `${image.contentBase64}\n`])(
    'rejects internal/extra padding or whitespace without egress',
    async (contentBase64) => {
      const f = fixture();
      await expect(
        f.adapter.generateImageStructured({
          ...f.input,
          images: [{ ...image, contentBase64 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );

  it('sends pinned immutable inline bytes only in a user message and records reported usage', async () => {
    const f = fixture();
    const result = await f.adapter.generateImageStructured(f.input);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = f.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toBe(
      `${request.systemInstruction}\nReturn only a JSON object matching this JSON Schema: ${JSON.stringify(request.responseSchema)}`,
    );
    expect(payload.messages[1].content).toEqual([
      { type: 'text', text: request.prompt },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${image.contentBase64}`, detail: 'original' },
      },
    ]);
    expect(payload.model).toBe('deepseek-flash');
    expect(payload.max_tokens).toBe(32);
    expect(result).toMatchObject({
      modelVersion: 'deepseek-flash',
      providerResponseId: 'synthetic-response',
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
    });
    expect(result.imageTransportRevision).toBe(DEEPSEEK_IMAGE_TRANSPORT_REVISION);
    expect(result.imageRequestDigest).toBe(
      `sha256:${createHash('sha256').update(String(init.body)).digest('hex')}`,
    );
    expect(result.imageContentHashes).toEqual([image.expectedContentHash]);
    expect(Object.isFrozen(result.imageContentHashes)).toBe(true);
  });
  it('preserves the existing text-only request exactly and never attaches images implicitly', async () => {
    const f = fixture();
    await f.adapter.generateStructured(f.input);
    const payload = JSON.parse(
      String((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(payload).toEqual({
      model: 'deepseek-flash',
      messages: [
        {
          role: 'system',
          content: `${request.systemInstruction}\nReturn only a JSON object matching this JSON Schema: ${JSON.stringify(request.responseSchema)}`,
        },
        { role: 'user', content: request.prompt },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false,
      temperature: 0.2,
      max_tokens: 32,
    });
  });
  it.each(['deepseek-v4-pro', 'deepseek-v4-flash', 'unconfigured'])(
    'rejects %s before any network request',
    async (modelId) => {
      const f = fixture();
      await expect(
        f.adapter.generateImageStructured({ ...f.input, modelId }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...image, expectedContentHash: `sha256:${'0'.repeat(64)}` },
    { ...image, contentBase64: 'https://example.org/image.png' },
    { ...image, contentBase64: 'file-api-123' },
    { ...image, contentBase64: 'a===' },
    { ...image, contentBase64: '' },
    { ...image, mediaType: 'image/jpeg' },
    { ...image, contentBase64: Buffer.from('not an image').toString('base64') },
  ] as DeepSeekInlineImage[])(
    'rejects wrong pin, MIME or non-inline bytes without egress',
    async (invalid) => {
      const f = fixture();
      await expect(
        f.adapter.generateImageStructured({ ...f.input, images: [invalid] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it.each([{ images: [] }, { images: Array.from({ length: 5 }, () => image) }])(
    'rejects empty or oversized batches without egress',
    async ({ images }) => {
      const f = fixture();
      await expect(f.adapter.generateImageStructured({ ...f.input, images })).rejects.toMatchObject(
        { code: 'VALIDATION_ERROR' },
      );
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects an oversized request envelope without egress', async () => {
    const f = fixture();
    await expect(
      f.adapter.generateImageStructured({
        ...f.input,
        request: { ...request, prompt: 'x'.repeat(32 * 1024 * 1024) },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { model: 'deepseek-v4-pro' },
    { model: 'deepseek-flash', choices: [{ message: { content: 'not JSON' } }] },
  ])(
    'rejects absent/mismatching model or malformed output after one call without retry',
    async (body) => {
      const f = fixture(body);
      await expect(f.adapter.generateImageStructured(f.input)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(f.fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('preserves missing usage as unknown rather than zero', async () => {
    const f = fixture({ model: 'deepseek-flash', choices: [{ message: { content: '{}' } }] });
    const result = await f.adapter.generateImageStructured(f.input);
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
  });
  it('does not replace the captured model identity with a caller mutation during execution', async () => {
    const input = { ...fixture().input };
    const fetch = vi.fn(async () => {
      input.modelId = 'deepseek-v4-pro';
      return new Response(
        JSON.stringify({ model: 'deepseek-v4-pro', choices: [{ message: { content: '{}' } }] }),
        { status: 200 },
      );
    });
    const adapter = new DeepSeekConnectivityAdapter({ fetch });
    await expect(adapter.generateImageStructured(input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model,
    ).toBe('deepseek-flash');
  });
  it('makes no call for an already-cancelled request', async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.adapter.generateImageStructured({ ...f.input, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'TERMINAL_FAILURE' });
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
