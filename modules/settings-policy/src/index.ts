import type {
  SettingsSnapshot,
  SettingsValidationResult,
  SettingsImpactPreview,
  SettingsCommandResult,
  ModelDescriptorView,
  CostBudgetView,
  PrivacyRetentionView,
  ConnectorSettingsView,
  DirectiveProposalView,
  SchemaPackView,
  DiagnosticsView,
  ProductFeatureView,
} from '../../../packages/contracts/src/index.js';

export type ApplySettingsCommandInput = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly expectedSettingsRevision: number;
  readonly observedPolicyContextRevision: number;
  readonly settings: Record<string, unknown>;
  readonly actorId: string;
};

export type ApplyPreferenceCommandInput = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly principalId: string;
  readonly expectedPreferenceRevision: number;
  readonly preferences: Record<string, unknown>;
};

export type SettingsRepositoryPort = {
  getSettingsSnapshot(projectId: string): Promise<SettingsSnapshot>;
  getPrincipalPreferences(principalId: string): Promise<Record<string, unknown>>;
  updatePrincipalPreferences(input: ApplyPreferenceCommandInput): Promise<Record<string, unknown>>;
  validateSettingsDraft(
    projectId: string,
    draft: Record<string, unknown>,
  ): Promise<SettingsValidationResult>;
  previewSettingsImpact(
    projectId: string,
    expectedSettingsRevision: number,
    observedPolicyContextRevision: number,
    draft: Record<string, unknown>,
  ): Promise<SettingsImpactPreview>;
  applySettingsCommand(input: ApplySettingsCommandInput): Promise<SettingsCommandResult>;
  getCommandStatus(commandId: string): Promise<SettingsCommandResult | null>;
  getModelDescriptors(
    projectId: string,
  ): Promise<ProductFeatureView<readonly ModelDescriptorView[]>>;
  getCostBudget(projectId: string): Promise<ProductFeatureView<CostBudgetView>>;
  getPrivacyRetention(projectId: string): Promise<ProductFeatureView<PrivacyRetentionView>>;
  getConnectorSettings(
    projectId: string,
  ): Promise<ProductFeatureView<readonly ConnectorSettingsView[]>>;
  getDirectiveProposals(
    projectId: string,
  ): Promise<ProductFeatureView<readonly DirectiveProposalView[]>>;
  getSchemaPacks(projectId: string): Promise<ProductFeatureView<readonly SchemaPackView[]>>;
  getDiagnostics(projectId: string): Promise<ProductFeatureView<DiagnosticsView>>;
};
