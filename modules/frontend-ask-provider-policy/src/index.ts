import {
  ASK_SCHEMA_VERSION,
  sha256Text,
  stableJson,
  type AskProviderEligibilityView,
  type AskContextSensitivity,
  type AskProviderPolicyResolverPort,
  type AskSourceSelectionView,
} from '../../../packages/contracts/src/index.js';

export type { AskContextSensitivity, AskProviderPolicyResolverPort };

export type AskProjectPrivacyPolicy = {
  readonly externalTransferAllowed: boolean;
  readonly settingsRevision: number;
  readonly policyContextRevision: number;
};

export type AskProviderExternalTransferApproval = {
  readonly providerId: string;
  readonly approved: boolean;
  readonly approvalRevision: number;
};

export type AskProviderPolicyAuthorityReaderPort = {
  readProjectPrivacyPolicy(projectId: string): Promise<AskProjectPrivacyPolicy>;
  /** Optional A4 authority. Missing means no provider-specific record exists. */
  readProviderExternalTransferApproval?(input: {
    readonly projectId: string;
    readonly providerId: string;
  }): Promise<AskProviderExternalTransferApproval | undefined>;
  readSelectedSensitivities(input: {
    readonly projectId: string;
    readonly sourceSelections: readonly AskSourceSelectionView[];
  }): Promise<readonly AskContextSensitivity[]>;
};

export type AskProviderPolicyResolverOptions = {
  readonly deploymentPrivateTransferAllowed: boolean;
  readonly deploymentPrivateTransferAllowedForProvider?: (providerId: string) => boolean;
  readonly providerId?: string;
  readonly providerIdResolver?: (projectId: string) => Promise<string | undefined>;
  readonly providerPolicyIdentity: string;
  readonly providerDisplayName: string;
  readonly providerModel: string;
  readonly providerDescriptor?: (
    providerId: string,
    modelId?: string,
  ) =>
    | {
        readonly policyIdentity: string;
        readonly displayName: string;
        readonly model: string;
      }
    | undefined;
  readonly providerModelResolver?: (
    projectId: string,
    providerId: string,
  ) => Promise<string | undefined>;
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
    readonly providerId?: string;
    readonly modelId?: string;
  }): Promise<AskProviderEligibilityView> {
    const projectPolicy = await this.reader.readProjectPrivacyPolicy(input.projectId);
    const selectedProviderId =
      input.providerId ??
      (await this.options.providerIdResolver?.(input.projectId)) ??
      this.options.providerId ??
      'google-gemini';
    const selectedModelId =
      input.modelId ??
      (await this.options.providerModelResolver?.(input.projectId, selectedProviderId)) ??
      this.options.providerDescriptor?.(selectedProviderId)?.model ??
      this.options.providerModel;
    const descriptor = this.options.providerDescriptor?.(selectedProviderId, selectedModelId);
    const providerApprovalRecord = this.reader.readProviderExternalTransferApproval
      ? await this.reader.readProviderExternalTransferApproval({
          projectId: input.projectId,
          providerId: selectedProviderId,
        })
      : undefined;
    const providerApproval =
      providerApprovalRecord?.providerId === selectedProviderId
        ? providerApprovalRecord
        : undefined;
    const deploymentPrivateTransferAllowed =
      this.options.deploymentPrivateTransferAllowedForProvider?.(selectedProviderId) ??
      this.options.deploymentPrivateTransferAllowed;
    const restricted = input.sensitivities.includes('restricted');
    const privateContext = input.sensitivities.includes('private');
    const projectApproval =
      providerApproval?.approved === true ||
      (providerApproval === undefined &&
        selectedProviderId === 'google-gemini' &&
        projectPolicy.externalTransferAllowed);
    const reason: AskProviderEligibilityView['reason'] = restricted
      ? 'RESTRICTED_CONTEXT_BLOCKED'
      : privateContext && !deploymentPrivateTransferAllowed
        ? 'DEPLOYMENT_POLICY_BLOCKED'
        : privateContext && !projectApproval
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
        providerId: selectedProviderId,
        providerPolicyIdentity: descriptor?.policyIdentity ?? this.options.providerPolicyIdentity,
        deploymentPrivateTransferAllowed,
        projectExternalTransferAllowed: projectApproval,
        providerApprovalRevision: providerApproval?.approvalRevision ?? null,
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
        displayName: descriptor?.displayName ?? this.options.providerDisplayName,
        model: selectedModelId,
      },
      message: policyMessage(reason),
    });
  }
}
