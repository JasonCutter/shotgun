import {
  ASK_SCHEMA_VERSION,
  sha256Text,
  stableJson,
  type AskProviderEligibilityView,
  type AskSourceSelectionView,
} from '../../../packages/contracts/src/index.js';

export type AskContextSensitivity = 'public' | 'internal' | 'private' | 'restricted';

export type AskProjectPrivacyPolicy = {
  readonly externalTransferAllowed: boolean;
  readonly settingsRevision: number;
  readonly policyContextRevision: number;
};

export type AskProviderPolicyAuthorityReaderPort = {
  readProjectPrivacyPolicy(projectId: string): Promise<AskProjectPrivacyPolicy>;
  readSelectedSensitivities(input: {
    readonly projectId: string;
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<readonly AskContextSensitivity[]>;
};

export type AskProviderPolicyResolverPort = {
  evaluateSelections(input: {
    readonly projectId: string;
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<AskProviderEligibilityView>;
  evaluateContext(input: {
    readonly projectId: string;
    readonly sensitivities: readonly AskContextSensitivity[];
  }): Promise<AskProviderEligibilityView>;
};

export type AskProviderPolicyResolverOptions = {
  readonly deploymentPrivateTransferAllowed: boolean;
  readonly providerPolicyIdentity: string;
  readonly providerDisplayName: string;
  readonly providerModel: string;
};

const policyMessage = (reason: AskProviderEligibilityView['reason']): string => {
  switch (reason) {
    case 'DEPLOYMENT_POLICY_BLOCKED':
      return 'This deployment does not permit sending private Project context to the configured AI provider.';
    case 'PROJECT_APPROVAL_REQUIRED':
      return 'A Project Owner must complete the privacy review before private Project context can be sent to the configured AI provider.';
    case 'RESTRICTED_CONTEXT_BLOCKED':
      return 'Restricted Project context cannot be sent to an external AI provider.';
    case 'ELIGIBLE':
      return 'The selected authoritative context is eligible for the configured AI provider.';
  }
};

export class AskProviderPolicyResolver implements AskProviderPolicyResolverPort {
  constructor(
    private readonly reader: AskProviderPolicyAuthorityReaderPort,
    private readonly options: AskProviderPolicyResolverOptions,
  ) {}

  async evaluateSelections(input: {
    readonly projectId: string;
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<AskProviderEligibilityView> {
    return this.evaluateContext({
      projectId: input.projectId,
      sensitivities: await this.reader.readSelectedSensitivities(input),
    });
  }

  async evaluateContext(input: {
    readonly projectId: string;
    readonly sensitivities: readonly AskContextSensitivity[];
  }): Promise<AskProviderEligibilityView> {
    const projectPolicy = await this.reader.readProjectPrivacyPolicy(input.projectId);
    const restricted = input.sensitivities.includes('restricted');
    const privateContext = input.sensitivities.includes('private');
    const reason: AskProviderEligibilityView['reason'] = restricted
      ? 'RESTRICTED_CONTEXT_BLOCKED'
      : privateContext && !this.options.deploymentPrivateTransferAllowed
        ? 'DEPLOYMENT_POLICY_BLOCKED'
        : privateContext && !projectPolicy.externalTransferAllowed
          ? 'PROJECT_APPROVAL_REQUIRED'
          : 'ELIGIBLE';
    const requiredAction: AskProviderEligibilityView['requiredAction'] =
      reason === 'RESTRICTED_CONTEXT_BLOCKED'
        ? 'REMOVE_RESTRICTED_CONTEXT'
        : reason === 'DEPLOYMENT_POLICY_BLOCKED'
          ? 'CONTACT_DEPLOYMENT_ADMINISTRATOR'
          : reason === 'PROJECT_APPROVAL_REQUIRED'
            ? 'REVIEW_PROJECT_PRIVACY_SETTINGS'
            : 'NONE';
    const policyFingerprint = sha256Text(
      stableJson({
        schema: 'ask-provider-effective-policy-v2',
        providerPolicyIdentity: this.options.providerPolicyIdentity,
        deploymentPrivateTransferAllowed: this.options.deploymentPrivateTransferAllowed,
        projectExternalTransferAllowed: projectPolicy.externalTransferAllowed,
        projectSettingsRevision: projectPolicy.settingsRevision,
        projectPolicyContextRevision: projectPolicy.policyContextRevision,
        restrictedExternalTransferAllowed: false,
      }),
    );
    return Object.freeze({
      schemaVersion: ASK_SCHEMA_VERSION,
      eligible: reason === 'ELIGIBLE',
      reason,
      requiredAction,
      policyFingerprint: `ask-provider-effective-policy-v2:${policyFingerprint}`,
      policyContextRevision: String(projectPolicy.policyContextRevision),
      provider: {
        displayName: this.options.providerDisplayName,
        model: this.options.providerModel,
      },
      message: policyMessage(reason),
    });
  }
}
