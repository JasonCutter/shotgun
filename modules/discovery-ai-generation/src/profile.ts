import { randomUUID } from 'node:crypto';

import {
  DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION,
  DISCOVERY_MODEL_PROFILE_STATUSES,
  type DiscoveryAIConfigurationReaderPort,
  type DiscoveryAICredentialMetadataReaderPort,
  type DiscoveryAIProviderCapabilityRegistryPort,
  type DiscoveryModelProfileRepositoryPort,
  type DiscoveryModelProfileServicePort,
  type DiscoveryModelProfileV1,
} from '../../../packages/contracts/src/index.js';

export type DiscoveryModelProfileErrorCode =
  'INVALID_INPUT' | 'CONFIGURATION_REQUIRED' | 'CAPABILITY_UNAVAILABLE' | 'CONFLICT' | 'NOT_FOUND';

export class DiscoveryModelProfileError extends Error {
  constructor(
    readonly code: DiscoveryModelProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiscoveryModelProfileError';
  }
}

const identifier = (name: string, value: string, maxLength = 256): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new DiscoveryModelProfileError('INVALID_INPUT', `${name} is invalid.`);
  }
  return normalized;
};

const positiveRevision = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DiscoveryModelProfileError('INVALID_INPUT', `${name} is invalid.`);
  }
  return value;
};

const expectedRevision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DiscoveryModelProfileError('INVALID_INPUT', 'Expected profile revision is invalid.');
  }
  return value;
};

const timestamp = (value: string): string => {
  const normalized = identifier('Timestamp', value, 100);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new DiscoveryModelProfileError('INVALID_INPUT', 'Timestamp is invalid.');
  }
  return normalized;
};

const structuredOutputAvailable = (model: {
  readonly structuredOutput?: boolean;
  readonly shotgunUsableCapabilities?: readonly string[];
}): boolean =>
  model.structuredOutput === true ||
  model.shotgunUsableCapabilities?.includes('structuredOutput') === true;

/**
 * Creates and activates immutable Discovery profile revisions. The service
 * reads the exact ADR-133 configuration and credential metadata revision; it
 * never accepts or persists secret material.
 */
export class DiscoveryModelProfileService implements DiscoveryModelProfileServicePort {
  constructor(
    private readonly registry: DiscoveryAIProviderCapabilityRegistryPort,
    private readonly configuration: DiscoveryAIConfigurationReaderPort,
    private readonly credentials: DiscoveryAICredentialMetadataReaderPort,
    private readonly repository: DiscoveryModelProfileRepositoryPort,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly options: { readonly enforceDeepSeekOnly?: boolean } = {},
  ) {}

  getActive(projectId: string): Promise<DiscoveryModelProfileV1 | undefined> {
    return this.repository.findActive(identifier('Project ID', projectId));
  }

  getCurrent(projectId: string): Promise<DiscoveryModelProfileV1 | undefined> {
    return this.repository.findCurrent(identifier('Project ID', projectId));
  }

  getRevision(
    projectId: string,
    profileRevision: number,
  ): Promise<DiscoveryModelProfileV1 | undefined> {
    return this.repository.findRevision(
      identifier('Project ID', projectId),
      positiveRevision('Profile revision', profileRevision),
    );
  }

  async createProfile(
    input: Parameters<DiscoveryModelProfileServicePort['createProfile']>[0],
  ): Promise<DiscoveryModelProfileV1> {
    const projectId = identifier('Project ID', input.projectId);
    const expected = expectedRevision(input.expectedRevision);
    const aiConfigurationRevision = positiveRevision(
      'AI configuration revision',
      input.aiConfigurationRevision,
    );
    const providerId = identifier('Provider ID', input.providerId, 128);
    const modelId = identifier('Model ID', input.modelId, 256);
    const promptVersion = identifier('Prompt version', input.promptVersion, 128);
    const outputSchemaVersion = identifier('Output schema version', input.outputSchemaVersion, 128);
    const createdBy = identifier('Created by', input.createdBy, 256);

    const provider = this.registry.getProvider(providerId);
    const model = this.registry.getModel(providerId, modelId);
    if (!provider || provider.status !== 'active' || !model || !structuredOutputAvailable(model)) {
      throw new DiscoveryModelProfileError(
        'CAPABILITY_UNAVAILABLE',
        'The requested Discovery provider capability is unavailable.',
      );
    }
    if (model.providerId !== providerId || model.modelId !== modelId) {
      throw new DiscoveryModelProfileError(
        'CAPABILITY_UNAVAILABLE',
        'The requested Discovery provider capability is mismatched.',
      );
    }
    if (
      this.options.enforceDeepSeekOnly === true &&
      (providerId !== 'deepseek' || modelId !== 'deepseek-v4-flash')
    ) {
      throw new DiscoveryModelProfileError(
        'CONFIGURATION_REQUIRED',
        'New Discovery profiles must use DeepSeek deepseek-v4-flash.',
      );
    }

    const configuration = await this.configuration.getRevision(projectId, aiConfigurationRevision);
    if (
      !configuration ||
      configuration.projectId !== projectId ||
      configuration.aiConfigurationRevision !== aiConfigurationRevision ||
      configuration.activeProviderId !== providerId ||
      configuration.activeModelId !== modelId
    ) {
      throw new DiscoveryModelProfileError(
        'CONFIGURATION_REQUIRED',
        'The exact Project AI configuration revision does not match the Discovery profile.',
      );
    }

    const credential = await this.credentials.getMetadata({
      projectId,
      providerId,
      credentialId: configuration.credentialId,
      credentialRevision: configuration.credentialRevision,
    });
    if (
      !credential ||
      credential.projectId !== projectId ||
      credential.providerId !== providerId ||
      credential.credentialId !== configuration.credentialId ||
      credential.credentialRevision !== configuration.credentialRevision ||
      credential.lifecycleState !== 'active'
    ) {
      throw new DiscoveryModelProfileError(
        'CONFIGURATION_REQUIRED',
        'The exact credential revision is unavailable for the Discovery profile.',
      );
    }

    const current = await this.repository.findCurrent(projectId);
    if ((current?.profileRevision ?? 0) !== expected) {
      throw new DiscoveryModelProfileError('CONFLICT', 'The Discovery profile revision is stale.');
    }

    const createdAt = input.now ? timestamp(input.now) : this.clock();
    const profile: DiscoveryModelProfileV1 = {
      schemaVersion: DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION,
      profileId: randomUUID(),
      projectId,
      profileRevision: expected + 1,
      aiConfigurationRevision,
      providerId,
      modelId,
      providerRegistryRevision: provider.registryRevision,
      modelCapabilityRevision: model.capabilityRevision,
      promptVersion,
      outputSchemaVersion,
      status: 'PREPARED',
      createdBy,
      createdAt,
    };
    const result = await this.repository.saveRevision({
      expectedRevision: expected,
      next: profile,
    });
    if (result === 'CONFLICT') {
      throw new DiscoveryModelProfileError(
        'CONFLICT',
        'The Discovery profile revision changed concurrently.',
      );
    }
    return profile;
  }

  async activateProfile(
    input: Parameters<DiscoveryModelProfileServicePort['activateProfile']>[0],
  ): Promise<DiscoveryModelProfileV1> {
    const profile = await this.requireProfile(
      input.projectId,
      input.profileId,
      input.profileRevision,
    );
    if (profile.status === 'ACTIVE') return profile;
    if (profile.status !== 'PREPARED') {
      throw new DiscoveryModelProfileError(
        'CONFLICT',
        'The Discovery profile cannot be activated.',
      );
    }
    const result = await this.repository.updateStatus({
      projectId: profile.projectId,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      expectedStatus: profile.status,
      status: 'ACTIVE',
      updatedAt: input.now ? timestamp(input.now) : this.clock(),
    });
    if (result === 'NOT_FOUND' || result === 'CONFLICT') {
      throw new DiscoveryModelProfileError(
        'CONFLICT',
        'The Discovery profile activation conflicted.',
      );
    }
    return result;
  }

  async retireProfile(
    input: Parameters<DiscoveryModelProfileServicePort['retireProfile']>[0],
  ): Promise<DiscoveryModelProfileV1> {
    const profile = await this.requireProfile(
      input.projectId,
      input.profileId,
      input.profileRevision,
    );
    if (profile.status === 'RETIRED') return profile;
    if (profile.status !== 'ACTIVE') {
      throw new DiscoveryModelProfileError(
        'CONFLICT',
        'Only an active Discovery profile can retire.',
      );
    }
    const result = await this.repository.updateStatus({
      projectId: profile.projectId,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      expectedStatus: 'ACTIVE',
      status: 'RETIRED',
      updatedAt: input.now ? timestamp(input.now) : this.clock(),
    });
    if (result === 'NOT_FOUND' || result === 'CONFLICT') {
      throw new DiscoveryModelProfileError(
        'CONFLICT',
        'The Discovery profile retirement conflicted.',
      );
    }
    return result;
  }

  private async requireProfile(
    projectId: string,
    profileId: string,
    profileRevision: number,
  ): Promise<DiscoveryModelProfileV1> {
    const normalizedProjectId = identifier('Project ID', projectId);
    const normalizedProfileId = identifier('Profile ID', profileId);
    const normalizedRevision = positiveRevision('Profile revision', profileRevision);
    const profile = await this.repository.findRevision(normalizedProjectId, normalizedRevision);
    if (!profile || profile.profileId !== normalizedProfileId) {
      throw new DiscoveryModelProfileError(
        'NOT_FOUND',
        'The Discovery profile revision was not found.',
      );
    }
    if (!DISCOVERY_MODEL_PROFILE_STATUSES.includes(profile.status)) {
      throw new DiscoveryModelProfileError('CONFLICT', 'The Discovery profile status is invalid.');
    }
    return profile;
  }
}
