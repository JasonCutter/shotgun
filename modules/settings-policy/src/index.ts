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
} from '../../../packages/contracts/src/index.js';

export type ApplySettingsCommandInput = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly settings: Record<string, unknown>;
  readonly actorId: string;
};

export type SettingsRepositoryPort = {
  getSettingsSnapshot(projectId: string): Promise<SettingsSnapshot>;
  getPrincipalPreferences(principalId: string): Promise<Record<string, unknown>>;
  updatePrincipalPreferences(
    principalId: string,
    preferences: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  validateSettingsDraft(
    projectId: string,
    draft: Record<string, unknown>,
  ): Promise<SettingsValidationResult>;
  previewSettingsImpact(
    projectId: string,
    expectedRevision: number,
    draft: Record<string, unknown>,
  ): Promise<SettingsImpactPreview>;
  applySettingsCommand(input: ApplySettingsCommandInput): Promise<SettingsCommandResult>;
  getCommandStatus(commandId: string): Promise<SettingsCommandResult | null>;
  getModelDescriptors(projectId: string): Promise<readonly ModelDescriptorView[]>;
  getCostBudget(projectId: string): Promise<CostBudgetView>;
  getPrivacyRetention(projectId: string): Promise<PrivacyRetentionView>;
  getConnectorSettings(projectId: string): Promise<readonly ConnectorSettingsView[]>;
  getDirectiveProposals(projectId: string): Promise<readonly DirectiveProposalView[]>;
  getSchemaPacks(projectId: string): Promise<readonly SchemaPackView[]>;
  getDiagnostics(projectId: string): Promise<DiagnosticsView>;
};
