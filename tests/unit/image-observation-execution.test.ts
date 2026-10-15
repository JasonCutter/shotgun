import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sha256Text } from '../../packages/contracts/src/index.js';
import {
  createIsolatedFakeImageExecutionResolver,
  createIsolatedLiveImageExecutionResolver,
} from '../../assemblies/shotgun-app/src/image-fake-execution-resolver.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import type { CredentialVaultPort } from '../../modules/credential-vault/src/index.js';
import {
  executeImageObservation,
  imageObservationTransformationIdentity,
  ImageObservationOutputRejectedError,
  type CapturedImageExecutor,
  type ImageObservationExecutionInput,
  type ImageObservationExecutionRecord,
  type ImageObservationExecutionRepositoryPort,
} from '../../modules/image-observation-execution/src/index.js';

const fixture = () => {
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cL1sAAAAASUVORK5CYII=',
    'base64',
  );
  const input: ImageObservationExecutionInput = {
    projectId: 'isolated-project',
    requestId: randomUUID(),
    sourceId: randomUUID(),
    sourceVersionId: randomUUID(),
    originalAssetId: randomUUID(),
    sourceContentHash: `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`,
    transformerId: 'python-document-format',
    transformerVersion: '1.15.0',
    image: {
      mediaType: 'image/png',
      width: 1,
      height: 1,
      region: { x: 0, y: 0, width: 1, height: 1, unit: 'px' },
    },
    accessScope: ['project:isolated-project'],
    sensitivity: 'internal',
    imageBytes,
  };
  const generateImage = vi.fn(async () => ({
    rawText: '{"observationText":"Authored Fake observation; unverified."}',
    modelVersion: 'deepseek-flash',
    providerResponseId: 'fake-response',
    imageRequestDigest: sha256Text('fake-exact-http'),
    imageContentHashes: [input.sourceContentHash],
  }));
  const captured: CapturedImageExecutor = {
    transportKind: 'ISOLATED_FAKE',
    liveCapable: false,
    identity: {
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
      aiConfigurationRevision: 1,
      credentialId: 'synthetic-only',
      credentialRevision: 1,
      policyContextRevision: 'synthetic-fake',
      providerPolicyFingerprint: sha256Text('synthetic-policy'),
    },
    credentialFingerprint: sha256Text('synthetic-key-not-live'),
    adapterVersion: 'fake-native-v1',
    generateImage,
  };
  let record: ImageObservationExecutionRecord | undefined;
  const repository: ImageObservationExecutionRepositoryPort = {
    read: vi.fn(async () => record),
    ensure: vi.fn(async (candidate) => (record ??= candidate)),
    activate: vi.fn(async (_project, _call, attemptId) => {
      if (record?.state !== 'REQUESTED') return false;
      record = { ...record, state: 'PROVIDER_RUNNING', attemptId };
      return true;
    }),
    storeOutput: vi.fn(async (_project, _call, _attempt, output) => {
      record = { ...record!, state: 'OUTPUT_STORED', output };
    }),
    markUnknown: vi.fn(async () => {
      if (record?.state === 'PROVIDER_RUNNING') record = { ...record, state: 'OUTCOME_UNKNOWN' };
    }),
    rejectOutput: vi.fn(async (_project, _call, _attempt, rejectedResponse) => {
      record = {
        ...record!,
        state: 'OUTPUT_REJECTED',
        ...(rejectedResponse === undefined ? {} : { rejectedResponse }),
      };
    }),
    finalize: vi.fn(
      async ({ transformationRevisionId }) =>
        (record = { ...record!, state: 'COMPLETED', transformationRevisionId }),
    ),
  };
  const resolver = { resolve: vi.fn(async () => captured) };
  const options = { runtimeProfile: 'runtime-test', repository, resolver };
  return { input, captured, generateImage, repository, resolver, options, read: () => record };
};

describe('isolated image execution durable ordering', () => {
  it('requires a bound live acceptance and records a distinct transport kind', async () => {
    const f = fixture();
    Object.assign(f.captured, {
      transportKind: 'ISOLATED_LIVE_ACCEPTANCE',
      liveCapable: true,
    });
    const grant = {
      acceptanceId: 'isolated-image-acceptance-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceContentHash: f.input.sourceContentHash,
      credentialFingerprint: f.captured.credentialFingerprint,
      authorize: vi.fn(async () => {}),
    };
    await expect(executeImageObservation(f.input, f.options)).rejects.toThrow();
    expect(f.generateImage).not.toHaveBeenCalled();
    const result = await executeImageObservation(f.input, {
      ...f.options,
      runtimeProfile: 'runtime-test',
      liveAcceptance: grant,
    });
    expect(result).toMatchObject({
      state: 'OUTPUT_STORED',
      transportKind: 'ISOLATED_LIVE_ACCEPTANCE',
      acceptanceId: grant.acceptanceId,
    });
    expect(grant.authorize).toHaveBeenCalledTimes(2);
    expect(f.generateImage).toHaveBeenCalledTimes(1);
    expect(
      await executeImageObservation(f.input, { ...f.options, liveAcceptance: grant }),
    ).toMatchObject({ callId: result.callId, state: 'OUTPUT_STORED' });
    expect(f.generateImage).toHaveBeenCalledTimes(1);
    expect(f.resolver.resolve).toHaveBeenCalledTimes(2); // denied Fake capture + accepted live capture
    await expect(executeImageObservation(f.input, f.options)).rejects.toThrow();
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });

  it.each(['runtime-development', 'runtime-production'])(
    'rejects live acceptance in %s before capture',
    async (runtimeProfile) => {
      const f = fixture();
      await expect(
        executeImageObservation(f.input, {
          ...f.options,
          runtimeProfile,
          liveAcceptance: {
            acceptanceId: 'isolated-image-acceptance-1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            sourceContentHash: f.input.sourceContentHash,
            credentialFingerprint: f.captured.credentialFingerprint,
            authorize: async () => {},
          },
        }),
      ).rejects.toThrow('isolated runtime');
      expect(f.resolver.resolve).not.toHaveBeenCalled();
      expect(f.repository.activate).not.toHaveBeenCalled();
      expect(f.generateImage).not.toHaveBeenCalled();
    },
  );

  it('fails before credential capture for expired or source-mismatched live grants', async () => {
    for (const mismatch of ['expired', 'hash'] as const) {
      const f = fixture();
      const grant = {
        acceptanceId: 'isolated-image-acceptance-1',
        expiresAt: new Date(Date.now() + (mismatch === 'expired' ? -1_000 : 60_000)).toISOString(),
        sourceContentHash:
          mismatch === 'hash' ? sha256Text('wrong-image') : f.input.sourceContentHash,
        credentialFingerprint: f.captured.credentialFingerprint,
        authorize: vi.fn(async () => {}),
      };
      await expect(
        executeImageObservation(f.input, {
          ...f.options,
          runtimeProfile: 'runtime-test',
          liveAcceptance: grant,
        }),
      ).rejects.toThrow();
      expect(f.resolver.resolve).not.toHaveBeenCalled();
      expect(f.generateImage).not.toHaveBeenCalled();
    }
  });

  it('marks an activated live attempt unknown if the grant changes before egress', async () => {
    const f = fixture();
    Object.assign(f.captured, {
      transportKind: 'ISOLATED_LIVE_ACCEPTANCE',
      liveCapable: true,
    });
    let checks = 0;
    const grant = {
      acceptanceId: 'isolated-image-acceptance-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceContentHash: f.input.sourceContentHash,
      credentialFingerprint: f.captured.credentialFingerprint,
      authorize: vi.fn(async () => {
        checks += 1;
        if (checks === 2) grant.expiresAt = new Date(Date.now() - 1_000).toISOString();
      }),
    };
    await expect(
      executeImageObservation(f.input, {
        ...f.options,
        runtimeProfile: 'runtime-test',
        liveAcceptance: grant,
      }),
    ).rejects.toThrow();
    expect(f.read()?.state).toBe('OUTCOME_UNKNOWN');
    expect(f.generateImage).not.toHaveBeenCalled();
  });

  it('labels the separate live resolver while retaining the existing Vault capture', async () => {
    const f = fixture();
    const secret = new TextEncoder().encode('SYNTHETIC-CAPTURED-IMAGE-KEY');
    const grant = {
      acceptanceId: 'isolated-image-acceptance-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceContentHash: f.input.sourceContentHash,
      credentialFingerprint: sha256Text('SYNTHETIC-CAPTURED-IMAGE-KEY'),
      authorize: vi.fn(async () => {}),
    };
    const resolver = createIsolatedLiveImageExecutionResolver({
      runtimeProfile: 'runtime-test',
      executionResolver: {
        resolve: async () => ({ executionIdentity: f.captured.identity }),
      } as unknown as AIProviderExecutionResolverPort,
      vault: {
        withCredential: async (
          _scope: unknown,
          callback: (bytes: Uint8Array, metadata: unknown) => Promise<unknown>,
        ) =>
          callback(secret, {
            projectId: f.input.projectId,
            providerId: 'deepseek',
            credentialId: f.captured.identity.credentialId,
            credentialRevision: f.captured.identity.credentialRevision,
            lifecycleState: 'active',
          }),
      } as unknown as CredentialVaultPort,
      liveHttp: vi.fn(async () => {
        throw Error('fake-only unit transport');
      }),
      liveAcceptance: grant,
    });
    const captured = await resolver.resolve(f.input);
    expect(captured.transportKind).toBe('ISOLATED_LIVE_ACCEPTANCE');
    expect(captured.liveCapable).toBe(true);
    expect(captured.credentialFingerprint).toBe(grant.credentialFingerprint);
    captured.discardCapturedCredential?.();
  });
  it.each([
    'success',
    'invalid-authority',
    'ensure-failure',
    'activation-ack-loss',
    'provider-unknown',
    'rejected-output',
  ] as const)('discards captured credential after %s even without dispatch', async (window) => {
    const f = fixture();
    const secret = new TextEncoder().encode('SYNTHETIC-CAPTURED-SECRET');
    const discard = vi.fn(() => secret.fill(0));
    f.captured.discardCapturedCredential = discard;
    if (window === 'invalid-authority') Object.assign(f.captured, { liveCapable: true });
    if (window === 'ensure-failure')
      f.repository.ensure = async () => {
        throw Error('synthetic ensure failure');
      };
    if (window === 'activation-ack-loss') {
      const activate = f.repository.activate;
      f.repository.activate = async (...args) => {
        await activate(...args);
        throw Error('synthetic activation ACK loss');
      };
    }
    if (window === 'provider-unknown')
      f.generateImage.mockRejectedValue(Error('synthetic network uncertainty'));
    if (window === 'rejected-output')
      f.generateImage.mockRejectedValue(
        new ImageObservationOutputRejectedError({
          rawText: 'PRIVATE-SYNTHETIC-INVALID-JSON',
          modelVersion: 'deepseek-flash',
        }),
      );
    if (['invalid-authority', 'ensure-failure'].includes(window))
      await expect(executeImageObservation(f.input, f.options)).rejects.toThrow();
    else await executeImageObservation(f.input, f.options);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(secret.every((byte) => byte === 0)).toBe(true);
    if (['invalid-authority', 'ensure-failure', 'activation-ack-loss'].includes(window))
      expect(f.generateImage).not.toHaveBeenCalled();
  });

  it('a generic validation error without an observed-response receipt remains UNKNOWN', async () => {
    const f = fixture();
    f.generateImage.mockRejectedValue(
      Object.assign(new Error('synthetic unspecified validation failure'), {
        code: 'VALIDATION_ERROR',
      }),
    );
    const result = await executeImageObservation(f.input, f.options);
    expect(result.state).toBe('OUTCOME_UNKNOWN');
    expect(result.rejectedResponse).toBeUndefined();
    await executeImageObservation(f.input, f.options);
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });
  it.each(['invalid-json', 'wrong-model', 'missing-text'] as const)(
    'the native Fake resolver preserves known %s output as rejected and never reopens its credential on replay',
    async (kind) => {
      const f = fixture();
      const rawText =
        kind === 'invalid-json'
          ? 'PRIVATE-SYNTHETIC-NON-JSON'
          : kind === 'missing-text'
            ? ''
            : '{"observationText":"synthetic known response"}';
      const fakeHttp = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              model: kind === 'wrong-model' ? 'wrong-model' : 'deepseek-flash',
              id: 'synthetic-observed-response',
              choices: [{ message: { content: rawText } }],
            }),
            { status: 200 },
          ),
      );
      const withCredential = vi.fn(
        async (
          _scope: Parameters<CredentialVaultPort['withCredential']>[0],
          callback: Parameters<CredentialVaultPort['withCredential']>[1],
        ) => {
          const secret = new TextEncoder().encode('SYNTHETIC-CAPTURED-IMAGE-KEY');
          try {
            return await callback(secret, {
              credentialId: f.captured.identity.credentialId,
              credentialRevision: f.captured.identity.credentialRevision,
              projectId: f.input.projectId,
              providerId: 'deepseek',
              lifecycleState: 'active',
              encryptionVersion: 'aes-256-gcm:v1',
              keyVersion: 'synthetic-only',
              createdAt: '2026-10-14T00:00:00Z',
              updatedAt: '2026-10-14T00:00:00Z',
            });
          } finally {
            secret.fill(0);
          }
        },
      );
      const resolver = createIsolatedFakeImageExecutionResolver({
        runtimeProfile: 'runtime-test',
        executionResolver: {
          resolve: async () => ({ executionIdentity: f.captured.identity }),
        } as unknown as AIProviderExecutionResolverPort,
        vault: { withCredential } as unknown as CredentialVaultPort,
        fakeHttp,
      });
      const result = await executeImageObservation(f.input, { ...f.options, resolver });
      expect(result.state).toBe('OUTPUT_REJECTED');
      expect(result.rejectedResponse).toMatchObject({
        rawText,
        rawTextAvailable: true,
        responseDigest: sha256Text(rawText),
        providerResponseId: 'synthetic-observed-response',
        modelVersion: kind === 'wrong-model' ? 'wrong-model' : 'deepseek-flash',
        imageContentHashes: [f.input.sourceContentHash],
      });
      expect(await executeImageObservation(f.input, { ...f.options, resolver })).toEqual(result);
      expect(withCredential).toHaveBeenCalledTimes(1);
      expect(fakeHttp).toHaveBeenCalledTimes(1);
      expect(f.repository.markUnknown).not.toHaveBeenCalled();
    },
  );
  it.each(['wrong-fields', 'wrong-model', 'oversized'] as const)(
    'retains bounded observed rejected %s response audit without replay or publication',
    async (kind) => {
      const f = fixture();
      const response = await f.generateImage();
      const rawText =
        kind === 'oversized'
          ? JSON.stringify({ observationText: 'x'.repeat(300_000) })
          : kind === 'wrong-model'
            ? '{"observationText":"private unverified model output"}'
            : '{"observationText":"private unverified output","fact":true}';
      f.generateImage.mockResolvedValue({
        ...response,
        rawText,
        ...(kind === 'wrong-model' ? { modelVersion: 'other-model' } : {}),
      });
      f.generateImage.mockClear();
      const result = await executeImageObservation(f.input, f.options);
      expect(result.state).toBe('OUTPUT_REJECTED');
      expect(result.output).toBeUndefined();
      expect(result.rejectedResponse).toMatchObject({
        classification: 'OBSERVED_OUTPUT_REJECTED',
        rawTextAvailable: true,
        responseDigest: sha256Text(rawText),
        rawLength: rawText.length,
        rawLengthUnit: 'utf16-code-units',
        truncated: kind === 'oversized',
      });
      expect(result.rejectedResponse!.rawText).toBe(rawText.slice(0, 262_144));
      expect((await executeImageObservation(f.input, f.options)).rejectedResponse).toEqual(
        result.rejectedResponse,
      );
      expect(f.generateImage).toHaveBeenCalledTimes(1);
    },
  );

  it('only an explicit observed-output error supplies a non-enumerable bounded audit', async () => {
    const f = fixture();
    const error = new ImageObservationOutputRejectedError({
      rawText: 'private-observed-response',
      modelVersion: 'deepseek-flash',
      providerResponseId: 'fake-known-response',
      imageRequestDigest: sha256Text('known HTTP request'),
      imageContentHashes: [f.input.sourceContentHash],
    });
    expect(JSON.stringify(error)).not.toContain('private-observed-response');
    expect(
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(error), 'responseAudit')?.enumerable,
    ).toBe(false);
    f.generateImage.mockRejectedValue(error);
    const result = await executeImageObservation(f.input, f.options);
    expect(result.state).toBe('OUTPUT_REJECTED');
    expect(result.rejectedResponse?.rawText).toBe('private-observed-response');
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTPUT_REJECTED');
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });
  it('binds transformation cache identity to full call/output provenance, preserving deterministic replay', async () => {
    const f = fixture();
    const stored = await executeImageObservation(f.input, f.options);
    const identity = imageObservationTransformationIdentity(stored);
    expect(identity.id).toBe(`${stored.snapshot.transformerId}.image-observation`);
    expect(identity.version).toMatch(/^1\.15\.0\+[a-f0-9]{64}$/u);
    expect(
      imageObservationTransformationIdentity({
        ...stored,
        state: 'COMPLETED',
        transformationRevisionId: randomUUID(),
      }),
    ).toEqual(identity);
    for (const changed of [
      { ...stored, callId: randomUUID() },
      { ...stored, attemptId: randomUUID() },
      { ...stored, executionIdentity: { ...stored.executionIdentity, credentialRevision: 2 } },
      { ...stored, output: { ...stored.output!, responseDigest: sha256Text('other response') } },
      {
        ...stored,
        output: { ...stored.output!, transportRequestDigest: sha256Text('other HTTP request') },
      },
    ])
      expect(imageObservationTransformationIdentity(changed).version).not.toBe(identity.version);
    expect(() =>
      imageObservationTransformationIdentity({ ...stored, state: 'OUTCOME_UNKNOWN' }),
    ).toThrow();
  });

  it.each(['1.14.0+bad..metadata', '1.14.0-01', 'not-semver'])(
    'rejects unrepresentable transformation version %s before dispatch',
    async (transformerVersion) => {
      const f = fixture();
      await expect(
        executeImageObservation({ ...f.input, transformerVersion }, f.options),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.resolver.resolve).not.toHaveBeenCalled();
      expect(f.repository.activate).not.toHaveBeenCalled();
      expect(f.generateImage).not.toHaveBeenCalled();
    },
  );
  it('stores exact pinned request/response identity and reuses output without a second call', async () => {
    const f = fixture();
    const output = await executeImageObservation(f.input, f.options);
    expect(output.state).toBe('OUTPUT_STORED');
    expect(output.attemptId).toBeDefined();
    expect(output.output?.responseDigest).toBe(sha256Text(output.output!.rawText));
    expect(output.output?.text).toContain('unverified');
    expect((await executeImageObservation(f.input, f.options)).callId).toBe(output.callId);
    expect(f.generateImage).toHaveBeenCalledTimes(1);
    expect(f.resolver.resolve).toHaveBeenCalledTimes(1);
    expect(f.repository.activate).toHaveBeenCalledTimes(1);
  });

  it('rejects normal runtime and missing Fake authority before attempt consumption', async () => {
    const f = fixture();
    await expect(
      executeImageObservation(f.input, { ...f.options, runtimeProfile: 'normal' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f.resolver.resolve).not.toHaveBeenCalled();
    Object.assign(f.captured, { liveCapable: true });
    await expect(executeImageObservation(f.input, f.options)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(f.repository.activate).not.toHaveBeenCalled();
    expect(f.generateImage).not.toHaveBeenCalled();
  });

  it('rejects changed bytes/geometry before resolving authority or persisting an attempt', async () => {
    for (const patch of [
      { sourceContentHash: sha256Text('other') },
      { image: { ...fixture().input.image, width: 2 } },
    ]) {
      const f = fixture();
      await expect(
        executeImageObservation({ ...f.input, ...patch }, f.options),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(f.resolver.resolve).not.toHaveBeenCalled();
      expect(f.repository.activate).not.toHaveBeenCalled();
    }
  });

  it('snapshots bytes and mutable source context before resolver await', async () => {
    const f = fixture();
    f.resolver.resolve.mockImplementation(async () => {
      f.input.imageBytes.fill(0);
      Object.assign(f.input.image, { width: 2 });
      return f.captured;
    });
    const result = await executeImageObservation(f.input, f.options);
    expect(result.snapshot.image.width).toBe(1);
    const request = f.generateImage.mock.calls[0] as unknown as [{ imageBytes: Uint8Array }];
    expect(`sha256:${createHash('sha256').update(request[0].imageBytes).digest('hex')}`).toBe(
      result.snapshot.sourceContentHash,
    );
  });

  it('rejects a substituted callable before activation and before egress after activation', async () => {
    for (const window of ['ensure', 'activate'] as const) {
      const f = fixture();
      const original = f.repository[window];
      f.repository[window] = (async (...args: never[]) => {
        const result = await (original as (...values: never[]) => Promise<unknown>)(...args);
        f.captured.generateImage = vi.fn(async () => {
          throw Error('replacement must not execute');
        });
        return result;
      }) as never;
      await expect(executeImageObservation(f.input, f.options)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(f.generateImage).not.toHaveBeenCalled();
      if (window === 'ensure') expect(f.repository.activate).not.toHaveBeenCalled();
      else expect(f.read()?.state).toBe('OUTCOME_UNKNOWN');
    }
  });

  it('activation ACK loss never dispatches, and replay holds the same unknown attempt', async () => {
    const f = fixture(),
      activate = f.repository.activate;
    f.repository.activate = async (...args) => {
      await activate(...args);
      throw Error('synthetic lost ACK');
    };
    const first = await executeImageObservation(f.input, f.options);
    expect(first.state).toBe('OUTCOME_UNKNOWN');
    expect((await executeImageObservation(f.input, f.options)).attemptId).toBe(first.attemptId);
    expect(f.generateImage).not.toHaveBeenCalled();
  });

  it('provider uncertainty prohibits another call after reconstructed execution', async () => {
    const f = fixture();
    f.generateImage.mockRejectedValue(Error('synthetic uncertainty'));
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTCOME_UNKNOWN');
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTCOME_UNKNOWN');
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });

  it('response persistence ACK loss is resolved by exact readback without redispatch', async () => {
    const f = fixture(),
      store = f.repository.storeOutput;
    f.repository.storeOutput = async (...args) => {
      await store(...args);
      throw Error('synthetic output ACK loss');
    };
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTPUT_STORED');
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTPUT_STORED');
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });

  it('unpersisted response becomes UNKNOWN and is not silently replayed', async () => {
    const f = fixture();
    f.repository.storeOutput = async () => {
      throw Error('synthetic storage outage');
    };
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTCOME_UNKNOWN');
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTCOME_UNKNOWN');
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });
  it.each(['returned-invalid', 'observed-error'] as const)(
    'reads back a committed rejected %s response after ACK loss without replay',
    async (window) => {
      const f = fixture();
      const rawText = 'PRIVATE-SYNTHETIC-INVALID-JSON';
      if (window === 'observed-error') {
        f.generateImage.mockRejectedValue(
          new ImageObservationOutputRejectedError({
            rawText,
            modelVersion: 'deepseek-flash',
          }),
        );
      } else {
        const normal = await f.generateImage();
        f.generateImage.mockResolvedValue({ ...normal, rawText });
        f.generateImage.mockClear();
      }
      const reject = f.repository.rejectOutput;
      f.repository.rejectOutput = async (...args) => {
        await reject(...args);
        throw new Error('Synthetic committed rejection ACK loss');
      };
      const result = await executeImageObservation(f.input, f.options);
      expect(result.state).toBe('OUTPUT_REJECTED');
      expect(result.rejectedResponse?.rawText).toBe(rawText);
      expect(await executeImageObservation(f.input, f.options)).toEqual(result);
      expect(f.repository.markUnknown).not.toHaveBeenCalled();
      expect(f.generateImage).toHaveBeenCalledTimes(1);
    },
  );
  it('holds an unpersisted rejection as UNKNOWN and does not invent a saved response audit', async () => {
    const f = fixture();
    f.generateImage.mockRejectedValue(
      new ImageObservationOutputRejectedError({ rawText: 'synthetic' }),
    );
    f.repository.rejectOutput = async () => {
      throw new Error('Synthetic rejection persistence outage');
    };
    const result = await executeImageObservation(f.input, f.options);
    expect(result.state).toBe('OUTCOME_UNKNOWN');
    expect(result.rejectedResponse).toBeUndefined();
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTCOME_UNKNOWN');
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });

  it('rejects extra authority fields once, preserving terminal output rejection', async () => {
    const f = fixture();
    f.generateImage.mockResolvedValue({
      ...(await f.generateImage()),
      rawText: '{"observationText":"synthetic","fact":true}',
    });
    f.generateImage.mockClear();
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTPUT_REJECTED');
    expect((await executeImageObservation(f.input, f.options)).state).toBe('OUTPUT_REJECTED');
    expect(f.generateImage).toHaveBeenCalledTimes(1);
  });
});
