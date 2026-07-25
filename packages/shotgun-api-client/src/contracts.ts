import type {
  ProductSessionView,
  SessionBoundaryView,
  SettingsDraftState,
  SettingsSnapshot,
  SettingsCategorySummary,
  SettingsValidationResult,
  SettingsImpactPreview,
  SettingsCommandResult,
  ProjectListItemView,
  ModelDescriptorView,
  CostBudgetView,
  PrivacyRetentionView,
  ConnectorSettingsView,
  DirectiveProposalView,
  SchemaPackView,
  DiagnosticsView,
} from '../../contracts/src/index.js';

export type {
  ProductSessionView,
  SessionBoundaryView,
  SettingsDraftState,
  SettingsSnapshot,
  SettingsCategorySummary,
  SettingsValidationResult,
  SettingsImpactPreview,
  SettingsCommandResult,
  ProjectListItemView,
  ModelDescriptorView,
  CostBudgetView,
  PrivacyRetentionView,
  ConnectorSettingsView,
  DirectiveProposalView,
  SchemaPackView,
  DiagnosticsView,
};

export type ProductApiErrorBody = {
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
};

export type RequestOptions = {
  readonly signal?: AbortSignal;
};

export type ShotgunApiClient = {
  bootstrapLocalOwner(options?: RequestOptions): Promise<ProductSessionView>;
  getSession(options?: RequestOptions): Promise<ProductSessionView>;
  switchActiveProject(projectId: string, options?: RequestOptions): Promise<ProductSessionView>;
  logout(options?: RequestOptions): Promise<void>;

  // Settings & Project Administration
  getSettingsSnapshot(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<SettingsSnapshot>;
  getSettingsCategories(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<readonly SettingsCategorySummary[]>;
  getPrincipalPreferences(options?: RequestOptions): Promise<Record<string, unknown>>;
  updatePrincipalPreferences(
    preferences: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<Record<string, unknown>>;
  validateSettingsDraft(
    draft: Record<string, unknown>,
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<SettingsValidationResult>;
  previewSettingsImpact(
    expectedRevision: number,
    draft: Record<string, unknown>,
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<SettingsImpactPreview>;
  applySettingsCommand(
    params: {
      commandId: string;
      clientRequestId: string;
      idempotencyKey: string;
      expectedRevision: number;
      settings: Record<string, unknown>;
      targetProjectId?: string;
    },
    options?: RequestOptions,
  ): Promise<SettingsCommandResult>;
  getSettingsCommandStatus(
    commandId: string,
    options?: RequestOptions,
  ): Promise<SettingsCommandResult>;

  getProjects(options?: RequestOptions): Promise<readonly ProjectListItemView[]>;
  getProjectDetails(projectId: string, options?: RequestOptions): Promise<ProjectListItemView>;
  createProject(
    params: {
      id: string;
      name: string;
      description?: string;
      clientRequestId: string;
      idempotencyKey: string;
    },
    options?: RequestOptions,
  ): Promise<ProjectListItemView>;
  updateProject(
    projectId: string,
    params: { name?: string; description?: string; expectedRevision: number },
    options?: RequestOptions,
  ): Promise<ProjectListItemView>;
  archiveProject(
    projectId: string,
    expectedRevision: number,
    options?: RequestOptions,
  ): Promise<ProjectListItemView>;
  restoreProject(
    projectId: string,
    expectedRevision: number,
    options?: RequestOptions,
  ): Promise<ProjectListItemView>;
  requestDeleteProject(
    projectId: string,
    expectedRevision: number,
    options?: RequestOptions,
  ): Promise<ProjectListItemView>;

  getModelDescriptors(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<readonly ModelDescriptorView[]>;
  getCostBudget(targetProjectId?: string, options?: RequestOptions): Promise<CostBudgetView>;
  getPrivacyRetention(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<PrivacyRetentionView>;
  getConnectorSettings(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<readonly ConnectorSettingsView[]>;
  getDirectiveProposals(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<readonly DirectiveProposalView[]>;
  getSchemaPacks(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<readonly SchemaPackView[]>;
  getDiagnostics(targetProjectId?: string, options?: RequestOptions): Promise<DiagnosticsView>;
};
