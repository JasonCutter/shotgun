import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { AIProviderRouter } from '../../adapters/ai-provider-router/src/index.js';
import { StructuredAskAnswerProviderAdapter } from '../../adapters/ai-provider-ask/src/index.js';
import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import { InMemoryAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-in-memory/src/index.js';
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
import {
  AskAnswerExecutionService,
  type AIExecutionPin,
  type AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import { parseProviderDeploymentCeiling } from '../../modules/provider-privacy-policy/src/index.js';
import { InMemoryProjectAdministrationRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';

const handles: { close: () => Promise<unknown> }[] = [];

const secretFixture = () => {
  const registry = initialProviderRegistry();
  const repository = new InMemoryCredentialVaultRepository();
  const vault = new CredentialVaultService(
    repository,
    new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 17), keyVersion: 'a9-test' }),
  );
  const configuration = new ProjectAIConfigurationService(
    registry,
    new InMemoryProjectAIConfigurationRepository(),
    vault,
  );
  let transportAuthorizationObserved = false;
  let expectedTransportAuthorization: string | undefined;
  const connectivity = new StaticAIProviderConnectivityRegistry([
    {
      providerId: 'deepseek',
      testConnection: async () => ({ providerRequestId: 'synthetic-a9-test' }),
      generateStructured: async ({ apiKey }) => {
        transportAuthorizationObserved =
          expectedTransportAuthorization !== undefined &&
          Buffer.from(apiKey).toString('utf8') === expectedTransportAuthorization;
        return {
          rawText: '{"answer":"synthetic","citations":[]}',
          providerResponseId: 'synthetic-a9-provider-response',
        };
      },
    },
  ]);
  const backend = new AISettingsBackendService(
    registry,
    configuration,
    vault,
    connectivity,
    parseProviderDeploymentCeiling({ providerAllowlist: 'deepseek' }),
    { getLegacyExternalTransferAllowed: async () => false },
    { getCurrent: async () => undefined },
  );
  return {
    backend,
    configuration,
    registry,
    repository,
    vault,
    connectivity,
    authorizationObserved: () => transportAuthorizationObserved,
    setExpectedAuthorization: (value: string) => {
      expectedTransportAuthorization = value;
    },
  };
};

const secretRunSnapshot = (input: {
  readonly answerRunId: string;
  readonly projectId: string;
}): AskAnswerRunSnapshot => ({
  schemaVersion: '1.0.0',
  answerRunId: input.answerRunId,
  conversationId: 'a9-secret-conversation',
  branchId: 'a9-secret-branch',
  turnId: 'a9-secret-turn',
  projectId: input.projectId,
  mode: 'SOURCE_EXPLORATION',
  state: 'QUEUED',
  question: 'Execute through the bounded synthetic transport.',
  statements: [],
  sourceSelections: [
    {
      sourceId: 'a9-secret-source',
      sourceVersionId: 'a9-secret-version',
      evidenceIds: ['a9-secret-evidence'],
    },
  ],
  capabilities: ['CANCEL'],
  answerRevision: 'a9-secret-answer-revision',
  conversationRevision: 'a9-secret-conversation-revision',
  accessRevision: 'a9-secret-access-revision',
  policyContextRevision: 'a9-secret-policy-revision',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  stale: false,
});

const secretScope = (projectId: string): AskExecutionScope => ({
  principalId: 'a9-secret-owner',
  projectId,
  accessRevision: 'a9-secret-access-revision',
  policyContextRevision: 'a9-secret-policy-revision',
  sensitivityClearance: 'private',
  accessScope: ['owner'],
});

const flattenConsoleCalls = (spies: readonly ReturnType<typeof vi.spyOn>[]): string =>
  JSON.stringify(spies.flatMap((spy) => spy.mock.calls));

const assertAbsent = (surface: unknown, forbidden: readonly string[]): void => {
  const serialized = typeof surface === 'string' ? surface : JSON.stringify(surface);
  for (const value of forbidden) expect(serialized).not.toContain(value);
};

afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close();
});

describe('A9 deterministic safety evidence', () => {
  it('E2E-I: actual plaintext, persisted envelope, and transport authorization sentinels stay inside their permitted boundaries', async () => {
    const projectId = 'a9-secret-project';
    const plaintext = `a9-plaintext-${crypto.randomUUID()}`;
    const authorization = `a9-authorization-${crypto.randomUUID()}`;
    const fixture = secretFixture();
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: 'a9-secret-owner',
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId('a9-secret-owner');
    if (!principal) throw new Error('E2E-I owner fixture was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const projects = new InMemoryProjectAdministrationRepository(undefined, false);
    await projects.createProject({
      commandId: 'a9-secret-project-create',
      clientRequestId: 'a9-secret-project-create',
      idempotencyKey: 'a9-secret-project-create',
      projectId,
      name: 'A9 secret evidence project',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const application = await createApplication({
      authRepository: auth,
      projectAdminRepository: projects,
      aiSettingsBackend: fixture.backend,
    });
    handles.push(application.server);
    const cookie = `shotgun_session=${session.sessionToken}`;
    const csrf = await application.server.inject({
      method: 'GET',
      url: '/api/v1/security/csrf',
      headers: { cookie },
    });
    expect(csrf.statusCode).toBe(200);
    const csrfToken = (csrf.json() as { csrfToken: string }).csrfToken;
    const headers = {
      cookie,
      'x-csrf-token': csrfToken,
      'content-type': 'application/json',
    };
    const logSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    try {
      const createPlaintext = await application.server.inject({
        method: 'POST',
        url: '/api/v1/settings/ai/credentials',
        headers,
        payload: {
          targetProjectId: projectId,
          providerId: 'deepseek',
          secret: plaintext,
          clientRequestId: 'a9-secret-plaintext-create',
        },
      });
      expect(createPlaintext.statusCode).toBe(200);
      const plaintextCredential = (
        createPlaintext.json() as {
          credential: { credentialId: string; credentialRevision: number };
        }
      ).credential;

      const createAuthorization = await application.server.inject({
        method: 'POST',
        url: '/api/v1/settings/ai/credentials',
        headers,
        payload: {
          targetProjectId: projectId,
          providerId: 'deepseek',
          secret: authorization,
          clientRequestId: 'a9-secret-authorization-create',
        },
      });
      expect(createAuthorization.statusCode).toBe(200);
      const authorizationCredential = (
        createAuthorization.json() as {
          credential: { credentialId: string; credentialRevision: number };
        }
      ).credential;

      const [settingsRead, settingsReload, plaintextOutcome, authorizationOutcome] =
        await Promise.all([
          application.server.inject({
            method: 'GET',
            url: `/api/v1/settings/ai?targetProjectId=${projectId}`,
            headers: { cookie },
          }),
          application.server.inject({
            method: 'GET',
            url: `/api/v1/settings/ai?targetProjectId=${projectId}`,
            headers: { cookie },
          }),
          application.server.inject({
            method: 'GET',
            url:
              `/api/v1/settings/ai/credential-write-outcomes/by-client-request?targetProjectId=${projectId}` +
              '&clientRequestId=a9-secret-plaintext-create&providerId=deepseek&operation=CREATE',
            headers: { cookie },
          }),
          application.server.inject({
            method: 'GET',
            url:
              `/api/v1/settings/ai/credential-write-outcomes/by-client-request?targetProjectId=${projectId}` +
              '&clientRequestId=a9-secret-authorization-create&providerId=deepseek&operation=CREATE',
            headers: { cookie },
          }),
        ]);
      for (const response of [
        settingsRead,
        settingsReload,
        plaintextOutcome,
        authorizationOutcome,
      ]) {
        expect(response.statusCode).toBe(200);
      }

      const plaintextStored = await fixture.repository.findExact({
        projectId,
        providerId: 'deepseek',
        credentialId: plaintextCredential.credentialId,
        credentialRevision: plaintextCredential.credentialRevision,
      });
      const authorizationStored = await fixture.repository.findExact({
        projectId,
        providerId: 'deepseek',
        credentialId: authorizationCredential.credentialId,
        credentialRevision: authorizationCredential.credentialRevision,
      });
      if (!plaintextStored || !authorizationStored)
        throw new Error('E2E-I credential persistence missing.');
      const envelopeMaterial = [
        plaintextStored.encryptedSecret.nonce,
        plaintextStored.encryptedSecret.ciphertext,
        plaintextStored.encryptedSecret.authTag,
        authorizationStored.encryptedSecret.nonce,
        authorizationStored.encryptedSecret.ciphertext,
        authorizationStored.encryptedSecret.authTag,
      ];
      expect(envelopeMaterial.every((value) => value.length > 0)).toBe(true);
      expect(envelopeMaterial).not.toContain(plaintext);
      expect(envelopeMaterial).not.toContain(authorization);

      const configuration = await fixture.backend.saveConfiguration({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: authorizationCredential.credentialId,
        credentialRevision: authorizationCredential.credentialRevision,
        updatedBy: principal.principalId,
      });
      const runId = `a9-secret-run-${crypto.randomUUID()}`;
      const executionRepository = new InMemoryAskAnswerExecutionRepository();
      executionRepository.register(secretRunSnapshot({ answerRunId: runId, projectId }), [
        {
          evidenceId: 'a9-secret-evidence',
          sourceId: 'a9-secret-source',
          sourceVersionId: 'a9-secret-version',
          exactQuote: 'Synthetic private evidence for E2E-I.',
          sensitivity: 'private',
        },
      ]);
      const pin: AIExecutionPin = {
        answerRunId: runId,
        projectId,
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        aiConfigurationRevision: configuration.aiConfigurationRevision,
        credentialId: authorizationCredential.credentialId,
        credentialRevision: authorizationCredential.credentialRevision,
        initialProviderPolicyFingerprint: 'a9-secret-policy',
        createdAt: '2026-08-13T00:00:00.000Z',
      };
      fixture.setExpectedAuthorization(authorization);
      const execution = new AskAnswerExecutionService(
        executionRepository,
        new StructuredAskAnswerProviderAdapter(new FakeAIProviderAdapter()),
        {
          executionIdentityResolver: {
            resolveInitialAIExecutionIdentity: async () => pin,
            revalidatePinnedCredential: async () => true,
          },
          providerRouter: new AIProviderRouter(
            fixture.registry,
            fixture.connectivity,
            fixture.vault,
          ),
        },
      );
      const run = await execution.execute(secretScope(projectId), runId);
      expect(run.state).toBe('SUCCEEDED');
      expect(fixture.authorizationObserved()).toBe(true);
      const runContext = await executionRepository.getRunContext(secretScope(projectId), runId);
      const runEvents = await execution.events(secretScope(projectId), runId);
      expect(runContext?.executionPin).toEqual(pin);
      expect(runEvents).not.toHaveLength(0);

      const [globalShell, activity, history] = await Promise.all([
        application.server.inject({
          method: 'GET',
          url: '/product-api/frontend/global-shell',
          headers: { cookie },
        }),
        application.server.inject({
          method: 'POST',
          url: '/product-api/frontend/activity/queue',
          headers,
          payload: { schemaVersion: '1.0.0', limit: 50 },
        }),
        application.server.inject({
          method: 'POST',
          url: '/product-api/frontend/history/workspace',
          headers,
          payload: { schemaVersion: '1.0.0', resourceProjectId: projectId, limit: 50 },
        }),
      ]);
      expect(globalShell.statusCode).toBe(200);
      expect(activity.statusCode).toBe(200);
      expect(history.statusCode).toBe(200);

      const permittedPersistence = {
        plaintextMetadata: await fixture.vault.getMetadata({
          projectId,
          providerId: 'deepseek',
          credentialId: plaintextCredential.credentialId,
          credentialRevision: plaintextCredential.credentialRevision,
        }),
        authorizationMetadata: await fixture.vault.getMetadata({
          projectId,
          providerId: 'deepseek',
          credentialId: authorizationCredential.credentialId,
          credentialRevision: authorizationCredential.credentialRevision,
        }),
        configuration: await fixture.configuration.getCurrent(projectId),
      };
      const forbidden = [plaintext, authorization, ...envelopeMaterial];
      const forbiddenSurfaces = [
        createPlaintext.body,
        createAuthorization.body,
        settingsRead.body,
        settingsReload.body,
        plaintextOutcome.body,
        authorizationOutcome.body,
        globalShell.body,
        activity.body,
        history.body,
        runContext,
        runEvents,
        permittedPersistence,
        flattenConsoleCalls(logSpies),
      ];
      for (const surface of forbiddenSurfaces) assertAbsent(surface, forbidden);
    } finally {
      for (const spy of logSpies) spy.mockRestore();
    }
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
