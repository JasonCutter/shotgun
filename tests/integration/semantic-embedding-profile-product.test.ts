import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
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
import {
  SemanticEmbeddingProfileService,
  initialSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';

const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];

afterEach(async () => {
  while (applications.length > 0) {
    await applications.pop()?.server.close();
  }
});

const createFixture = async () => {
  const projectId = `semantic-profile-${crypto.randomUUID()}`;
  const accountId = `semantic-profile-account-${crypto.randomUUID()}`;
  const auth = new InMemoryAuthRepository();
  await auth.bootstrapOwner({
    accountId,
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await auth.findPrincipalByAccountId(accountId);
  if (!principal) throw new Error('Semantic profile fixture principal was not created.');

  const projects = new InMemoryProjectAdministrationRepository(undefined, false);
  await projects.createProject({
    commandId: `semantic-profile-project-${crypto.randomUUID()}`,
    clientRequestId: `semantic-profile-project-${crypto.randomUUID()}`,
    idempotencyKey: `semantic-profile-project-${crypto.randomUUID()}`,
    projectId,
    name: 'Semantic profile Product boundary fixture',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });

  const registry = initialProviderRegistry();
  const vault = new CredentialVaultService(
    new InMemoryCredentialVaultRepository(),
    new StaticCredentialMasterKeyAuthority({
      key: Buffer.alloc(32, 71),
      keyVersion: 'semantic-profile-product-test',
    }),
  );
  const backend = new AISettingsBackendService(
    registry,
    new ProjectAIConfigurationService(
      registry,
      new InMemoryProjectAIConfigurationRepository(),
      vault,
    ),
    vault,
    new StaticAIProviderConnectivityRegistry([]),
    parseProviderDeploymentCeiling({ providerAllowlist: 'deepseek,openai' }),
    { getLegacyExternalTransferAllowed: async () => false },
    { getCurrent: async () => undefined },
  );
  const semanticProfile = new SemanticEmbeddingProfileService(
    registry,
    initialSemanticEmbeddingRegistry(),
    new InMemorySemanticEmbeddingProfileRepository(),
    vault,
  );
  const application = await createApplication({
    authRepository: auth,
    projectAdminRepository: projects,
    aiSettingsBackend: backend,
    semanticEmbeddingProfile: semanticProfile,
  });
  applications.push(application);
  const session = await auth.createSession(
    principal.principalId,
    projectId,
    new Date(Date.now() + 60_000).toISOString(),
  );
  const cookie = `shotgun_session=${session.sessionToken}`;
  const csrfResponse = await application.server.inject({
    method: 'GET',
    url: '/api/v1/security/csrf',
    headers: { cookie },
  });
  if (csrfResponse.statusCode !== 200) throw new Error('Semantic profile CSRF setup failed.');
  const csrfToken = (csrfResponse.json() as { csrfToken: string }).csrfToken;
  return {
    application,
    projectId,
    headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
  };
};

describe('Semantic embedding profile Product boundary', () => {
  it('provisions a PREPARED profile through the Product API and enforces server ownership/CAS', async () => {
    const fixture = await createFixture();
    const empty = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ profile: null });

    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        secret: 'semantic-profile-test-secret',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const credential = (
      credentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;

    const profileResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      },
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json()).toMatchObject({
      profile: {
        projectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        profileRevision: 1,
        status: 'PREPARED',
      },
    });

    const readBack = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toMatchObject({ profile: { profileRevision: 1, status: 'PREPARED' } });

    const unknownAuthority = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 1,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        projectId: 'attacker-controlled-project',
      },
    });
    expect(unknownAuthority.statusCode).toBe(400);
    expect(unknownAuthority.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

    const stale = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects generative DeepSeek as a semantic embedding profile', async () => {
    const fixture = await createFixture();
    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'deepseek',
        secret: 'deepseek-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const credential = (
      credentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;
    const response = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 0,
        providerId: 'deepseek',
        embeddingModelId: 'deepseek-v4-flash',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
  });
});
