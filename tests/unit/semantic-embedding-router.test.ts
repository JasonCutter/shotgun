import { describe, expect, it } from 'vitest';

import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import { SemanticEmbeddingAuthorityResolver } from '../../adapters/semantic-embedding-resolution/src/index.js';
import {
  initialSemanticEmbeddingRegistry,
  SemanticEmbeddingProfileService,
  SemanticEmbeddingRouter,
} from '../../modules/semantic-embedding/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  parseProviderDeploymentCeiling,
  type ProviderExternalTransferApprovalPort,
} from '../../modules/provider-privacy-policy/src/index.js';
import type {
  CredentialMetadata,
  CredentialVaultPort,
} from '../../modules/credential-vault/src/index.js';
import type {
  ProviderEmbeddingConnectivityPort,
  ProviderEmbeddingRequest,
  ProviderEmbeddingResponse,
} from '../../packages/contracts/src/index.js';

describe('AKP-1R R1: SemanticEmbeddingRouter & Exact-Pin Credential Binding', () => {
  class RecordingFakeEmbeddingConnectivity implements ProviderEmbeddingConnectivityPort {
    readonly providerId = 'openai';
    callCount = 0;
    lastRequest?: ProviderEmbeddingRequest;
    receivedApiKey?: string;

    customResponseItems?: (request: ProviderEmbeddingRequest) => {
      vector: readonly number[];
      dimension: number;
    }[];

    async embed(request: ProviderEmbeddingRequest): Promise<ProviderEmbeddingResponse> {
      this.callCount++;
      this.lastRequest = request;
      this.receivedApiKey = request.apiKey;

      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      const dimension = request.dimension ?? 1536;

      if (this.customResponseItems) {
        return {
          providerId: this.providerId,
          modelId: request.modelId,
          items: this.customResponseItems(request),
          totalTokens: inputs.length * 4,
        };
      }

      return {
        providerId: this.providerId,
        modelId: request.modelId,
        items: inputs.map((text, idx) => ({
          vector: new Array(dimension).fill(0.1 * (idx + 1)),
          dimension,
          tokenCount: 4,
        })),
        totalTokens: inputs.length * 4,
      };
    }
  }

  const createRig = (
    options: {
      readonly credentialRevoked?: boolean;
      readonly approved?: boolean;
      readonly customConnectivity?: ProviderEmbeddingConnectivityPort;
    } = {},
  ) => {
    const providerRegistry = initialProviderRegistry();
    const embeddingRegistry = initialSemanticEmbeddingRegistry();
    const profileRepo = new InMemorySemanticEmbeddingProfileRepository();

    const connectivity = options.customConnectivity ?? new RecordingFakeEmbeddingConnectivity();

    const credentialsList: CredentialMetadata[] = [
      {
        projectId: 'project-r1',
        providerId: 'openai',
        credentialId: 'cred-openai-1',
        credentialRevision: 1,
        encryptionVersion: 'aes-256-gcm:v1',
        keyVersion: 'v1',
        lifecycleState: options.credentialRevoked ? 'revoked' : 'active',
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
      {
        projectId: 'project-r1',
        providerId: 'openai',
        credentialId: 'cred-openai-1',
        credentialRevision: 2,
        encryptionVersion: 'aes-256-gcm:v1',
        keyVersion: 'v1',
        lifecycleState: 'active',
        createdAt: '2026-08-19T01:00:00.000Z',
        updatedAt: '2026-08-19T01:00:00.000Z',
      },
    ];

    let vaultCallbackProject: string | undefined;
    let vaultCallbackProvider: string | undefined;
    let vaultCallbackCredentialId: string | undefined;
    let vaultCallbackRevision: number | undefined;

    const vault: CredentialVaultPort = {
      getAvailability: () => ({ state: 'AVAILABLE', keyVersion: 'v1' }),
      getMetadata: async (scope) =>
        credentialsList.find(
          (c) =>
            c.projectId === scope.projectId &&
            c.providerId === scope.providerId &&
            c.credentialId === scope.credentialId &&
            c.credentialRevision === scope.credentialRevision,
        ),
      listMetadata: async (projectId) => credentialsList.filter((c) => c.projectId === projectId),
      create: async () => {
        throw new Error('not implemented');
      },
      replace: async () => {
        throw new Error('not implemented');
      },
      revoke: async () => {
        throw new Error('not implemented');
      },
      remove: async () => {
        throw new Error('not implemented');
      },
      getWriteOutcome: async () => undefined,
      withCredential: async (scope, callback) => {
        vaultCallbackProject = scope.projectId;
        vaultCallbackProvider = scope.providerId;
        vaultCallbackCredentialId = scope.credentialId;
        vaultCallbackRevision = scope.credentialRevision;

        const record = credentialsList.find(
          (c) =>
            c.projectId === scope.projectId &&
            c.providerId === scope.providerId &&
            c.credentialId === scope.credentialId &&
            c.credentialRevision === scope.credentialRevision,
        );
        if (!record || record.lifecycleState !== 'active') {
          throw new Error('Pinned credential revision is revoked or unavailable.');
        }

        const secret = new TextEncoder().encode('sk-secret-test-key-12345');
        return callback(secret, record);
      },
    };

    const approvalAuthority: ProviderExternalTransferApprovalPort = {
      getCurrent: async (projectId, providerId) =>
        options.approved === false
          ? undefined
          : {
              projectId,
              providerId: providerId as 'openai',
              approved: true,
              approvalRevision: 1,
              reviewedBy: 'principal-owner',
              reviewedAt: '2026-08-19T00:00:00.000Z',
            },
      listHistory: async () => [],
      propose: async () => {
        throw new Error('not implemented');
      },
      approve: async () => {
        throw new Error('not implemented');
      },
    };

    const deploymentCeiling = parseProviderDeploymentCeiling({
      providerAllowlist: 'openai,google-gemini',
    });

    const profileService = new SemanticEmbeddingProfileService(
      providerRegistry,
      embeddingRegistry,
      profileRepo,
      {
        getMetadata: async (s) =>
          credentialsList.find(
            (c) =>
              c.projectId === s.projectId &&
              c.providerId === s.providerId &&
              c.credentialId === s.credentialId &&
              c.credentialRevision === s.credentialRevision,
          ),
      },
    );

    const resolver = new SemanticEmbeddingAuthorityResolver(
      providerRegistry,
      embeddingRegistry,
      profileService,
      vault,
      {
        approvalAuthority,
        deploymentCeiling,
        clock: () => '2026-08-19T12:00:00.000Z',
      },
    );

    const router = new SemanticEmbeddingRouter(
      providerRegistry,
      embeddingRegistry,
      vault,
      approvalAuthority,
      deploymentCeiling,
      [connectivity],
    );

    return {
      profileService,
      resolver,
      router,
      connectivity: connectivity as RecordingFakeEmbeddingConnectivity,
      vaultSpy: () => ({
        vaultCallbackProject,
        vaultCallbackProvider,
        vaultCallbackCredentialId,
        vaultCallbackRevision,
      }),
    };
  };

  it('7. Real resolver produces exact non-secret pin from durable profile revision', async () => {
    const { profileService, resolver } = createRig();

    const profile = await profileService.createProfile({
      projectId: 'project-r1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });

    const resolved = await resolver.resolveExecution({
      projectId: 'project-r1',
      sensitivity: 'internal',
      profileRevision: profile.profileRevision,
    });

    expect(resolved.pin).toMatchObject({
      projectId: 'project-r1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: profile.profileId,
      embeddingProfileRevision: 1,
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      representationVersion: 'semantic-representation:v1',
    });

    // Check no plaintext secrets exist anywhere on resolved output
    expect(JSON.stringify(resolved)).not.toContain('sk-');
    expect((resolved as Record<string, unknown>).credentialSecret).toBeUndefined();
    expect((resolved.pin as Record<string, unknown>).credentialSecret).toBeUndefined();
  });

  it('8. Router invokes CredentialVault.withCredential() with exactly the pinned Project/provider/credential/revision', async () => {
    const { profileService, resolver, router, vaultSpy } = createRig();

    const profile = await profileService.createProfile({
      projectId: 'project-r1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });

    const resolved = await resolver.resolveExecution({
      projectId: 'project-r1',
      sensitivity: 'internal',
      profileRevision: profile.profileRevision,
    });

    const result = await router.embed(resolved.pin, {
      text: 'Machine learning for knowledge graphs',
    });
    expect(result.vector).toHaveLength(1536);
    expect(result.dimension).toBe(1536);
    expect(result.modelId).toBe('text-embedding-3-small');
    expect(result.providerId).toBe('openai');

    // Verify exact vault invocation scope
    expect(vaultSpy()).toEqual({
      vaultCallbackProject: 'project-r1',
      vaultCallbackProvider: 'openai',
      vaultCallbackCredentialId: 'cred-openai-1',
      vaultCallbackRevision: 1,
    });
  });

  it('9. Fake provider connectivity receives the secret only inside the vault callback and the returned public result contains no secret', async () => {
    const { profileService, resolver, router, connectivity } = createRig();

    const profile = await profileService.createProfile({
      projectId: 'project-r1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });

    const resolved = await resolver.resolveExecution({
      projectId: 'project-r1',
      sensitivity: 'internal',
      profileRevision: profile.profileRevision,
    });

    const result = await router.embed(resolved.pin, { text: 'Shotgun architecture test' });

    // Connectivity received secret inside callback
    expect(connectivity.receivedApiKey).toBe('sk-secret-test-key-12345');

    // Returned result contains NO secret
    expect(JSON.stringify(result)).not.toContain('sk-');
    expect((result as Record<string, unknown>).apiKey).toBeUndefined();
    expect((result as Record<string, unknown>).secret).toBeUndefined();
  });

  it('10. Revoked exact credential revision after pin creation causes execution failure; router does not substitute latest credential', async () => {
    const { router } = createRig({ credentialRevoked: true });

    // Note: createProfile would fail with revoked credential, so create profile with active cred first
    // In our test rig when credentialRevoked=true, revision 1 is revoked while revision 2 is active
    const pin = {
      projectId: 'project-r1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-rev-1',
      embeddingProfileRevision: 1,
      credentialId: 'cred-openai-1',
      credentialRevision: 1, // Pinned to revoked revision 1
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      providerPolicyFingerprint:
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      representationVersion: 'semantic-representation:v1',
      createdAt: '2026-08-19T12:00:00.000Z',
    };

    // Even though revision 2 is active in the vault, the router must fail closed for pinned revision 1
    await expect(
      router.embed(pin, { text: 'Testing revoked credential pin' }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('11. Provider/model/dimension mismatch from connectivity fails validation', async () => {
    const connectivity = new RecordingFakeEmbeddingConnectivity();
    // Return empty vector to simulate malformed provider output
    connectivity.customResponseItems = () => [{ vector: [], dimension: 0 }];

    const { router } = createRig({ customConnectivity: connectivity });

    const pin = {
      projectId: 'project-r1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      providerPolicyFingerprint:
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      representationVersion: 'semantic-representation:v1',
      createdAt: '2026-08-19T12:00:00.000Z',
    };

    await expect(router.embed(pin, { text: 'Test malformed output' })).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'VALIDATION_FAILURE',
    });
  });

  it('12. Current privacy/deployment denial causes zero provider connectivity calls', async () => {
    const connectivity = new RecordingFakeEmbeddingConnectivity();
    const { router } = createRig({ approved: false, customConnectivity: connectivity });

    const pin = {
      projectId: 'project-r1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      providerPolicyFingerprint:
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      representationVersion: 'semantic-representation:v1',
      createdAt: '2026-08-19T12:00:00.000Z',
    };

    // Private egress without project approval must fail closed
    await expect(router.embed(pin, { text: 'Private data' }, 'private')).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });

    // Zero network/connectivity calls made
    expect(connectivity.callCount).toBe(0);
  });

  it('13. Batch result cardinality, order, and dimension are validated', async () => {
    const { router, connectivity } = createRig();

    const pin = {
      projectId: 'project-r1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: 'prof-1',
      embeddingProfileRevision: 1,
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      providerPolicyFingerprint:
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      representationVersion: 'semantic-representation:v1',
      createdAt: '2026-08-19T12:00:00.000Z',
    };

    const payloads = [{ text: 'Item 1' }, { text: 'Item 2' }, { text: 'Item 3' }];

    const results = await router.embedBatch(pin, payloads);

    expect(results).toHaveLength(3);
    expect(results[0]?.vector[0]).toBeCloseTo(0.1);
    expect(results[1]?.vector[0]).toBeCloseTo(0.2);
    expect(results[2]?.vector[0]).toBeCloseTo(0.3);
    expect(connectivity.callCount).toBe(1);
  });
});
