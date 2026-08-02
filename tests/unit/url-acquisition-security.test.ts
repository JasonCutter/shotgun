import { describe, expect, it } from 'vitest';

import {
  SecureUrlAcquisitionCoordinator,
  type UrlHopResponse,
  type UrlHopTransportPort,
  type UrlResolverPort,
} from '../../modules/url-acquisition/src/index.js';

const limits = {
  maxRedirects: 3,
  connectTimeoutMs: 1000,
  headerTimeoutMs: 1000,
  bodyTimeoutMs: 1000,
  totalTimeoutMs: 4000,
  maxCompressedBytes: 1024,
  maxDecompressedBytes: 2048,
};

class Resolver implements UrlResolverPort {
  private readonly indexes = new Map<string, number>();
  constructor(private readonly answers: Record<string, readonly (readonly string[])[]>) {}
  async resolve(hostname: string): Promise<readonly string[]> {
    const queue = this.answers[hostname] ?? [];
    const index = this.indexes.get(hostname) ?? 0;
    this.indexes.set(hostname, index + 1);
    return queue[Math.min(index, Math.max(0, queue.length - 1))] ?? [];
  }
}

class Transport implements UrlHopTransportPort {
  readonly requests: { url: string; headers: Readonly<Record<string, never>> }[] = [];
  constructor(private readonly responses: UrlHopResponse[]) {}
  async request(input: Parameters<UrlHopTransportPort['request']>[0]): Promise<UrlHopResponse> {
    this.requests.push({ url: input.url, headers: input.headers });
    const response = this.responses.shift();
    if (!response) throw new Error('Unexpected URL transport request.');
    return response;
  }
}

const response = (overrides: Partial<UrlHopResponse> = {}): UrlHopResponse => ({
  status: 200,
  connectedAddress: '93.184.216.34',
  headers: { 'content-type': 'text/plain', 'set-cookie': 'secret=never-store' },
  body: new TextEncoder().encode('safe body'),
  compressedBytes: 9,
  ...overrides,
});

const coordinator = (
  answers: Record<string, readonly (readonly string[])[]>,
  responses: UrlHopResponse[],
): { service: SecureUrlAcquisitionCoordinator; transport: Transport } => {
  const transport = new Transport(responses);
  return {
    service: new SecureUrlAcquisitionCoordinator(new Resolver(answers), transport),
    transport,
  };
};

describe('secure URL acquisition policy', () => {
  it('returns redacted safe provenance and omits credentials and arbitrary headers', async () => {
    const { service, transport } = coordinator(
      { 'example.com': [['93.184.216.34'], ['93.184.216.34']] },
      [
        response({
          headers: { 'content-type': 'text/plain', etag: 'safe', 'set-cookie': 'secret' },
        }),
      ],
    );
    const receipt = await service.acquire({
      requestedUrl: 'https://example.com/doc?lang=ko',
      limits,
    });
    expect(receipt).toMatchObject({
      redactedRequestedUrl: 'https://example.com/doc?lang=%5BREDACTED%5D',
      redactedFinalUrl: 'https://example.com/doc?lang=%5BREDACTED%5D',
      responseStatus: 200,
      responseContentType: 'text/plain',
      responseMetadata: { etag: 'safe' },
    });
    expect(receipt.responseMetadata).not.toHaveProperty('set-cookie');
    expect(transport.requests[0]?.headers).toEqual({});
  });

  it.each([
    ['file:///etc/passwd', /only HTTP and HTTPS/],
    ['https://user:pass@example.com/', /userinfo credentials/],
    ['https://example.com/#fragment', /fragments are prohibited/],
    ['https://example.com/?token=abc', /Credential-shaped URL query/],
    ['https://example.com/?q=bearer%3Asecret', /Credential-shaped URL query/],
  ])('rejects unsafe requested URL %s', async (requestedUrl, message) => {
    const { service } = coordinator({}, []);
    await expect(service.acquire({ requestedUrl, limits })).rejects.toThrow(message);
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.2',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])('rejects prohibited address %s before transport', async (address) => {
    const { service, transport } = coordinator({ 'example.com': [[address]] }, []);
    await expect(service.acquire({ requestedUrl: 'https://example.com/', limits })).rejects.toThrow(
      /prohibited or empty address set/,
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('revalidates every redirect and rejects a redirect to a private destination', async () => {
    const { service } = coordinator(
      {
        'example.com': [['93.184.216.34'], ['93.184.216.34']],
        'internal.example': [['10.0.0.2']],
      },
      [
        response({
          status: 302,
          redirectLocation: 'http://internal.example/admin',
          body: new Uint8Array(),
        }),
      ],
    );
    await expect(
      service.acquire({ requestedUrl: 'https://example.com/start', limits }),
    ).rejects.toThrow(/prohibited or empty address set/);
  });

  it('rejects DNS rebinding and transport address escape', async () => {
    const rebinding = coordinator({ 'example.com': [['93.184.216.34'], ['93.184.216.35']] }, [
      response(),
    ]);
    await expect(
      rebinding.service.acquire({ requestedUrl: 'https://example.com/', limits }),
    ).rejects.toThrow(/address set changed/);

    const escaped = coordinator({ 'example.com': [['93.184.216.34'], ['93.184.216.34']] }, [
      response({ connectedAddress: '8.8.8.8' }),
    ]);
    await expect(
      escaped.service.acquire({ requestedUrl: 'https://example.com/', limits }),
    ).rejects.toThrow(/outside the approved DNS set/);
  });

  it('rejects redirect loops, unsupported types and oversized bodies', async () => {
    const loop = coordinator(
      { 'example.com': Array.from({ length: 6 }, () => ['93.184.216.34']) },
      [
        response({ status: 302, redirectLocation: '/again', body: new Uint8Array() }),
        response({ status: 302, redirectLocation: '/again', body: new Uint8Array() }),
      ],
    );
    await expect(
      loop.service.acquire({ requestedUrl: 'https://example.com/start', limits }),
    ).rejects.toThrow(/redirect loop/);

    const unsupported = coordinator({ 'example.com': [['93.184.216.34'], ['93.184.216.34']] }, [
      response({ headers: { 'content-type': 'text/html' } }),
    ]);
    await expect(
      unsupported.service.acquire({ requestedUrl: 'https://example.com/', limits }),
    ).rejects.toThrow(/content type is not supported/);

    const oversized = coordinator({ 'example.com': [['93.184.216.34'], ['93.184.216.34']] }, [
      response({ body: new Uint8Array(2049), compressedBytes: 100 }),
    ]);
    await expect(
      oversized.service.acquire({ requestedUrl: 'https://example.com/', limits }),
    ).rejects.toThrow(/exceeds the approved byte limits/);
  });
});
