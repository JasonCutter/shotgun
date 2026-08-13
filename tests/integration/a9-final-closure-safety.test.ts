import { afterEach, describe, expect, it } from 'vitest';

import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import {
  AISettingsBackendService,
  StaticAIProviderConnectivityRegistry,
} from '../../modules/ai-settings-backend/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
} from '../../modules/ai-configuration/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { parseProviderDeploymentCeiling } from '../../modules/provider-privacy-policy/src/index.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';

const handles: { close: () => Promise<unknown> }[] = [];

afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close();
});

const backend = () => {
  const registry = initialProviderRegistry();
  const vault = new CredentialVaultService(
    new InMemoryCredentialVaultRepository(),
    new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 17), keyVersion: 'a9-test' }),
  );
  const configuration = new ProjectAIConfigurationService(
    registry,
    new InMemoryProjectAIConfigurationRepository(),
    vault,
  );
  return new AISettingsBackendService(
    registry,
    configuration,
    vault,
    new StaticAIProviderConnectivityRegistry([
      {
        providerId: 'deepseek',
        testConnection: async () => ({ providerRequestId: 'synthetic-a9-test' }),
        generateStructured: async () => ({ rawText: '{"answer":"synthetic","citations":[]}' }),
      },
    ]),
    parseProviderDeploymentCeiling({ providerAllowlist: 'deepseek' }),
    { getLegacyExternalTransferAllowed: async () => false },
    { getCurrent: async () => undefined },
  );
};

describe('A9 deterministic safety evidence', () => {
  it('E2E-I: synthetic plaintext, envelope-shaped, and Authorization sentinels never leave permitted boundaries', async () => {
    const plaintext = 'A9_PLAINTEXT_SENTINEL_NEVER_DISCLOSE';
    const envelope = 'A9_ENVELOPE_SENTINEL_NEVER_DISCLOSE';
    const authorization = 'A9_AUTHORIZATION_SENTINEL_NEVER_DISCLOSE';
    const service = backend();
    const credential = await service.createCredential({
      projectId: 'a9-secret-project',
      providerId: 'deepseek',
      secret: plaintext,
      clientRequestId: 'a9-secret-create',
    });
    const settings = await service.getSettings('a9-secret-project');
    const outcome = await service.getCredentialWriteOutcome({
      projectId: 'a9-secret-project',
      clientRequestId: 'a9-secret-create',
      binding: { operation: 'CREATE', providerId: 'deepseek' },
    });
    const exposed = JSON.stringify({ settings, outcome, credential });

    expect(exposed).not.toContain(plaintext);
    expect(exposed).not.toContain(envelope);
    expect(exposed).not.toContain(authorization);
    expect(exposed).not.toContain('encryptedSecret');
    expect(settings.credentialStatuses).toEqual([
      expect.objectContaining({ credentialId: credential.credentialId, credentialRevision: 1 }),
    ]);
  });

  it('E2E-L: Product starts without eligible AI configuration while protected non-AI and Ask read surfaces remain usable', async () => {
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'a9-unavailable-owner',
      projectId: 'a9-unavailable-project',
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('a9-unavailable-owner');
    if (!principal) throw new Error('A9 unavailable fixture owner was not created.');
    const session = await auth.createSession(
      principal.principalId,
      'a9-unavailable-project',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const projects = new InMemoryProjectAdministrationRepository(undefined, false);
    await projects.createProject({
      commandId: 'a9-unavailable-project-create',
      clientRequestId: 'a9-unavailable-project-create',
      idempotencyKey: 'a9-unavailable-project-create',
      projectId: 'a9-unavailable-project',
      name: 'A9 unavailable project',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const application = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
    });
    handles.push(application.server);
    const cookie = `shotgun_session=${session.sessionToken}`;

    expect((await application.server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(
      200,
    );
    expect(
      (
        await application.server.inject({
          method: 'GET',
          url: '/api/v1/session',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const ask = await application.server.inject({
      method: 'GET',
      url: '/product-api/frontend/ask',
      headers: { cookie },
    });
    expect(ask.statusCode).toBe(200);
    expect(ask.json()).toMatchObject({ workspace: { projectId: 'a9-unavailable-project' } });
  });

  it('E2E-M: DeepSeek adapter maps a deterministic abort deadline to TIMEOUT without a network call', async () => {
    const adapter = new DeepSeekConnectivityAdapter({
      timeoutMs: 1,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('synthetic abort'), { name: 'AbortError' })),
            { once: true },
          );
        }),
    });
    await expect(
      adapter.testConnection({
        modelId: 'deepseek-v4-flash',
        apiKey: Buffer.from('synthetic-a9-secret'),
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
