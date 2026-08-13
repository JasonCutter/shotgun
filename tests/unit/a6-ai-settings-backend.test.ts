import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { OpenAIConnectivityAdapter } from '../../adapters/ai-provider-openai/src/index.js';
import { GeminiConnectivityAdapter } from '../../adapters/ai-provider-gemini/src/connectivity.js';
import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';
import {
  AISettingsBackendService,
  StaticAIProviderConnectivityRegistry,
  type AIProviderConnectivityAdapter,
} from '../../modules/ai-settings-backend/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  ProjectAIConfigurationService,
  initialProviderRegistry,
} from '../../modules/ai-configuration/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';

const response = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const deployment = {
  configured: true,
  allowedProviders: new Set(['deepseek', 'openai', 'google-gemini']),
  allows: (providerId: string) => ['deepseek', 'openai', 'google-gemini'].includes(providerId),
};

const createBackend = (adapter: AIProviderConnectivityAdapter) => {
  const vault = new CredentialVaultService(
    new InMemoryCredentialVaultRepository(),
    new StaticCredentialMasterKeyAuthority({ key: randomBytes(32), keyVersion: 'test' }),
  );
  const registry = initialProviderRegistry();
  const configuration = new ProjectAIConfigurationService(
    registry,
    new InMemoryProjectAIConfigurationRepository(),
    vault,
  );
  const backend = new AISettingsBackendService(
    registry,
    configuration,
    vault,
    new StaticAIProviderConnectivityRegistry([adapter]),
    deployment,
    {
      getLegacyExternalTransferAllowed: async () => true,
    },
    {
      getCurrent: async () => undefined,
    },
  );
  return { backend, vault, configuration };
};

describe('A6 AI settings backend and multi-provider connectivity', () => {
  it('exposes a non-secret read model and isolates project credential metadata', async () => {
    const { backend } = createBackend({
      providerId: 'deepseek',
      testConnection: async () => ({}),
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    const credential = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'deepseek',
      secret: 'deepseek-secret',
    });
    const settings = await backend.getSettings('project-a');
    expect(settings.mode).toBe('LEGACY_GEMINI_COMPATIBILITY');
    expect(settings.providers.map((provider) => provider.providerId)).toEqual([
      'openai',
      'google-gemini',
      'deepseek',
    ]);
    expect(settings.credentialStatuses).toHaveLength(1);
    expect(JSON.stringify(settings)).not.toContain('deepseek-secret');
    expect(settings.credentialStatuses[0]).toMatchObject({
      credentialId: credential.credentialId,
      providerId: 'deepseek',
      credentialRevision: 1,
      lifecycleState: 'active',
    });
    expect(
      settings.privacy.find((item) => item.providerId === 'openai')?.legacyGeminiCompatibility,
    ).toBe(false);
  });

  it('recovers idempotent credential create and replace outcomes without persisting a secret', async () => {
    const { backend } = createBackend({
      providerId: 'openai',
      testConnection: async () => ({}),
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    const created = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'first-secret',
      clientRequestId: 'credential-write-create-1',
    });
    const recoveredCreate = await backend.getCredentialWriteOutcome({
      projectId: 'project-a',
      clientRequestId: 'credential-write-create-1',
      binding: { operation: 'CREATE', providerId: 'openai' },
    });
    const replayedCreate = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'must-not-replace-or-persist',
      clientRequestId: 'credential-write-create-1',
    });
    expect(recoveredCreate).toEqual(created);
    expect(replayedCreate).toEqual(created);

    const replaced = await backend.replaceCredential({
      projectId: 'project-a',
      providerId: 'openai',
      credentialId: created.credentialId,
      expectedRevision: created.credentialRevision,
      secret: 'second-secret',
      clientRequestId: 'credential-write-replace-1',
    });
    const replayedReplace = await backend.replaceCredential({
      projectId: 'project-a',
      providerId: 'openai',
      credentialId: created.credentialId,
      expectedRevision: created.credentialRevision,
      secret: 'must-not-replace-or-persist',
      clientRequestId: 'credential-write-replace-1',
    });
    expect(replayedReplace).toEqual(replaced);
    expect((await backend.getSettings('project-a')).credentialStatuses).toEqual([
      expect.objectContaining({
        credentialId: created.credentialId,
        credentialRevision: 2,
        lifecycleState: 'active',
      }),
    ]);
    expect(JSON.stringify(await backend.getSettings('project-a'))).not.toContain('first-secret');
    expect(JSON.stringify(await backend.getSettings('project-a'))).not.toContain('second-secret');
  });

  it('fails closed when a credential write request identity is reused with different semantics', async () => {
    const { backend } = createBackend({
      providerId: 'openai',
      testConnection: async () => ({}),
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    const created = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'deepseek',
      secret: 'deepseek-secret',
      clientRequestId: 'semantic-request-id',
    });
    await expect(
      backend.createCredential({
        projectId: 'project-a',
        providerId: 'openai',
        secret: 'openai-secret',
        clientRequestId: 'semantic-request-id',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      backend.replaceCredential({
        projectId: 'project-a',
        providerId: 'deepseek',
        credentialId: created.credentialId,
        expectedRevision: created.credentialRevision,
        secret: 'replace-secret',
        clientRequestId: 'semantic-request-id',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const replaceRequestId = 'semantic-replace-id';
    const replaced = await backend.replaceCredential({
      projectId: 'project-a',
      providerId: 'deepseek',
      credentialId: created.credentialId,
      expectedRevision: created.credentialRevision,
      secret: 'replace-secret',
      clientRequestId: replaceRequestId,
    });
    await expect(
      backend.replaceCredential({
        projectId: 'project-a',
        providerId: 'deepseek',
        credentialId: created.credentialId,
        expectedRevision: created.credentialRevision,
        secret: 'must-not-write-a-second-secret',
        clientRequestId: replaceRequestId,
      }),
    ).resolves.toEqual(replaced);
    await expect(
      backend.createCredential({
        projectId: 'project-a',
        providerId: 'deepseek',
        secret: 'must-not-cross-recover',
        clientRequestId: replaceRequestId,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('uses an exact stored credential revision through the vault callback and zeroes it afterwards', async () => {
    let callbackSecret: Uint8Array | undefined;
    const { backend } = createBackend({
      providerId: 'deepseek',
      testConnection: async ({ apiKey }) => {
        callbackSecret = apiKey;
        expect(new TextDecoder().decode(apiKey)).toBe('stored-secret');
        return { providerRequestId: 'request-safe-id' };
      },
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    const credential = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'deepseek',
      secret: 'stored-secret',
    });
    await expect(
      backend.testConnection({
        projectId: 'project-a',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      }),
    ).resolves.toMatchObject({
      status: 'CONNECTED',
      providerRequestId: 'request-safe-id',
    });
    expect(Buffer.from(callbackSecret!).toString('utf8')).toBe('\0'.repeat('stored-secret'.length));
  });

  it('keeps draft credentials transient and does not substitute a current credential', async () => {
    let observed = '';
    const { backend } = createBackend({
      providerId: 'deepseek',
      testConnection: async ({ apiKey }) => {
        observed = new TextDecoder().decode(apiKey);
        return {};
      },
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    await expect(
      backend.testConnection({
        projectId: 'project-a',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        draftSecret: 'draft-only-secret',
      }),
    ).resolves.toMatchObject({ status: 'CONNECTED' });
    expect(observed).toBe('draft-only-secret');
    expect((await backend.getSettings('project-a')).credentialStatuses).toEqual([]);
  });

  it('keeps credential revisions and configuration revisions separate and fail closed on stale save', async () => {
    const { backend } = createBackend({
      providerId: 'openai',
      testConnection: async () => ({}),
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    const credential = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'openai',
      secret: 'first-secret',
    });
    const replaced = await backend.replaceCredential({
      projectId: 'project-a',
      providerId: 'openai',
      credentialId: credential.credentialId,
      expectedRevision: 1,
      secret: 'second-secret',
    });
    const configuration = await backend.saveConfiguration({
      projectId: 'project-a',
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: replaced.credentialId,
      credentialRevision: replaced.credentialRevision,
      updatedBy: 'owner-a',
    });
    expect(configuration.aiConfigurationRevision).toBe(1);
    expect(configuration.credentialRevision).toBe(2);
    await expect(
      backend.saveConfiguration({
        projectId: 'project-a',
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: replaced.credentialId,
        credentialRevision: replaced.credentialRevision,
        updatedBy: 'owner-a',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = await backend.getSettings('project-a');
    expect(after.currentConfiguration).toEqual(configuration);
    expect(after.credentialStatuses).toHaveLength(1);
    expect(after.credentialStatuses[0]?.credentialRevision).toBe(2);
  });

  it('supports explicit revoke and remove lifecycle transitions without deleting history', async () => {
    const { backend } = createBackend({
      providerId: 'google-gemini',
      testConnection: async () => ({}),
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    const credential = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'google-gemini',
      secret: 'gemini-secret',
    });
    const revoked = await backend.revokeCredential({ ...credential });
    expect(revoked.lifecycleState).toBe('revoked');
    const removable = await backend.createCredential({
      projectId: 'project-a',
      providerId: 'google-gemini',
      secret: 'gemini-secret-2',
    });
    const removed = await backend.removeCredential({ ...removable });
    expect(removed.lifecycleState).toBe('removed');
    const statuses = (await backend.getSettings('project-a')).credentialStatuses;
    expect(statuses.find((item) => item.credentialId === credential.credentialId)).toMatchObject({
      credentialId: credential.credentialId,
      credentialRevision: 1,
      lifecycleState: 'revoked',
    });
    expect(statuses.find((item) => item.credentialId === removable.credentialId)).toMatchObject({
      credentialId: removable.credentialId,
      credentialRevision: 1,
      lifecycleState: 'removed',
    });
  });

  it('normalizes authentication and rate-limit responses for OpenAI and DeepSeek', async () => {
    const authFetch = async () => response({ error: { message: 'do-not-leak' } }, 401);
    const rateFetch = async () => response({}, 429);
    const openai = new OpenAIConnectivityAdapter({ fetch: authFetch });
    const deepseek = new DeepSeekConnectivityAdapter({ fetch: rateFetch });
    await expect(
      openai.testConnection({ modelId: 'gpt-5.6-luna', apiKey: Buffer.from('secret') }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await expect(
      deepseek.testConnection({ modelId: 'deepseek-v4-flash', apiKey: Buffer.from('secret') }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      openai.testConnection({ modelId: 'gpt-5.6-luna', apiKey: Buffer.from('secret') }),
    ).rejects.not.toThrow('do-not-leak');
  });

  it('projects a definite provider terminal failure as FAILED rather than Model unavailable', async () => {
    const { backend } = createBackend({
      providerId: 'openai',
      testConnection: async () => {
        throw new ShotgunError({
          code: 'TERMINAL_FAILURE',
          safeMessage: 'OpenAI rejected this probe for a non-model reason.',
          module: 'test',
          operation: 'test-connection',
        });
      },
      generateStructured: async () => ({ rawText: '{"ok":true}' }),
    });
    await expect(
      backend.testConnection({
        projectId: 'project-a',
        providerId: 'openai',
        modelId: 'gpt-5.6-luna',
        draftSecret: 'draft-secret',
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'TERMINAL_FAILURE',
    });
  });

  it('uses the official catalog identifiers in provider request payloads', async () => {
    let openaiBody: Record<string, unknown> | undefined;
    let deepseekBody: Record<string, unknown> | undefined;
    const openai = new OpenAIConnectivityAdapter({
      fetch: async (_input, init) => {
        openaiBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response({
          id: 'openai-request',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: '{"ready":true}' }],
            },
          ],
        });
      },
    });
    const deepseek = new DeepSeekConnectivityAdapter({
      fetch: async (_input, init) => {
        deepseekBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response({
          id: 'deepseek-request',
          choices: [{ message: { content: '{"ready":true}' } }],
        });
      },
    });
    await openai.testConnection({ modelId: 'gpt-5.6-luna', apiKey: Buffer.from('secret') });
    await deepseek.testConnection({ modelId: 'deepseek-v4-flash', apiKey: Buffer.from('secret') });
    expect(openaiBody?.model).toBe('gpt-5.6-luna');
    expect(deepseekBody?.model).toBe('deepseek-v4-flash');
    expect(JSON.stringify(openaiBody)).not.toContain('secret');
    expect(JSON.stringify(deepseekBody)).not.toContain('secret');
  });

  it('extracts structured generation text from an OpenAI Responses output content array', async () => {
    const openai = new OpenAIConnectivityAdapter({
      fetch: async () =>
        response({
          id: 'openai-generation',
          model: 'gpt-5.6-luna-2026-08-01',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'refusal', refusal: null },
                { type: 'output_text', text: '{"answer":"ok"}' },
              ],
            },
          ],
        }),
    });
    await expect(
      openai.generateStructured({
        modelId: 'gpt-5.6-luna',
        apiKey: Buffer.from('secret'),
        request: {
          systemInstruction: 'Return JSON only.',
          prompt: 'Generate a response.',
          responseSchema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      }),
    ).resolves.toMatchObject({
      rawText: '{"answer":"ok"}',
      providerResponseId: 'openai-generation',
      modelVersion: 'gpt-5.6-luna-2026-08-01',
    });
  });

  it('keeps Gemini on the common connectivity contract with a replaceable SDK boundary', async () => {
    let observedModel = '';
    const gemini = new GeminiConnectivityAdapter(
      () =>
        ({
          interactions: {
            create: async (request: { readonly model?: string }) => {
              observedModel = request.model ?? '';
              return { id: 'gemini-request', output_text: '{"ready":true}' };
            },
          },
        }) as never,
    );
    await expect(
      gemini.testConnection({ modelId: 'gemini-3.6-flash', apiKey: Buffer.from('secret') }),
    ).resolves.toMatchObject({ providerRequestId: 'gemini-request' });
    expect(observedModel).toBe('gemini-3.6-flash');
  });
});
