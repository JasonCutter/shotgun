import type {
  AnyFrontendCommandOutcomeView,
  AnyProductSessionView,
  SessionBoundaryView as LegacySessionBoundaryView,
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
  ProductFeatureView,
  FrontendCommandOutcomeView,
  ErrorCode,
  FailureCategory,
  FailureRetryability,
  FailureRecovery,
  ProductFailureDetails,
  ProductFailureEnvelope,
  TypedFrontendFailure,
  GlobalSearchRequest,
  GlobalSearchResultView,
  GlobalShellView,
  HomeActionCenterView,
  RouteGuardDecisionView,
  TargetRouteView,
  BrowserDraftPresentationView,
  NavigationAvailability,
  SourceLibraryQuery,
  SourceLibraryPageView,
  SourceDetailView,
  SourceVersionHistoryView,
  SourcePreviewView,
  EvidenceListView,
  IntakeSubmissionSnapshot,
  ExactDuplicateDecisionView,
  SubmitSourcesIntakeCommandPayload,
  CitationReturnTarget,
  IntakeDraftSeed,
} from '../../contracts/src/index.js';

export type ProductSessionView = AnyProductSessionView;
export type SessionBoundaryView = Omit<LegacySessionBoundaryView, 'session'> & {
  readonly session: ProductSessionView | null;
};

export type {
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
  ProductFeatureView,
  FrontendCommandOutcomeView,
  AnyFrontendCommandOutcomeView,
  GlobalSearchRequest,
  GlobalSearchResultView,
  GlobalShellView,
  HomeActionCenterView,
  RouteGuardDecisionView,
  TargetRouteView,
  BrowserDraftPresentationView,
  NavigationAvailability,
  SourceLibraryQuery,
  SourceLibraryPageView,
  SourceDetailView,
  SourceVersionHistoryView,
  SourcePreviewView,
  EvidenceListView,
  IntakeSubmissionSnapshot,
  ExactDuplicateDecisionView,
  SubmitSourcesIntakeCommandPayload,
  CitationReturnTarget,
  IntakeDraftSeed,
  ErrorCode,
  FailureCategory,
  FailureRetryability,
  FailureRecovery,
  ProductFailureDetails,
  ProductFailureEnvelope,
  TypedFrontendFailure,
};

export {
  deriveFrontendFailure,
  getFailureDescriptor,
  isErrorCode,
  decodeCitationReturnTarget,
  decodeIntakeDraftSeed,
} from '../../contracts/src/index.js';

export type FrontendCommandMutationResponse<T> = {
  readonly outcome: AnyFrontendCommandOutcomeView;
  readonly resource: T;
};

export type FrontendCommandSubmission = {
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly resourceProjectId?: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly clientIssuedAt?: string;
};

export type ProductApiErrorBody = ProductFailureEnvelope;

export type RequestOptions = {
  readonly signal?: AbortSignal;
};

export type ShotgunApiClient = {
  bootstrapLocalOwner(options?: RequestOptions): Promise<ProductSessionView>;
  getSession(options?: RequestOptions): Promise<ProductSessionView>;
  switchActiveProject(projectId: string, options?: RequestOptions): Promise<ProductSessionView>;
  logout(options?: RequestOptions): Promise<void>;
  getGlobalShell(options?: RequestOptions): Promise<GlobalShellView>;
  getHomeActionCenter(options?: RequestOptions): Promise<HomeActionCenterView>;
  searchGlobal(
    request: GlobalSearchRequest,
    options?: RequestOptions,
  ): Promise<GlobalSearchResultView>;
  getRouteGuardDecision(
    targetRoute: TargetRouteView,
    resourceProjectId?: string,
    options?: RequestOptions,
  ): Promise<RouteGuardDecisionView>;
  listSources(query: SourceLibraryQuery, options?: RequestOptions): Promise<SourceLibraryPageView>;
  getSourceDetail(sourceId: string, options?: RequestOptions): Promise<SourceDetailView>;
  getSourceVersionHistory(
    sourceId: string,
    selectedSourceVersionId: string,
    cursor?: string,
    options?: RequestOptions,
  ): Promise<SourceVersionHistoryView>;
  getSourcePreview(
    sourceId: string,
    sourceVersionId: string,
    mode: 'ORIGINAL' | 'TRANSFORMED',
    options?: RequestOptions,
  ): Promise<SourcePreviewView>;
  getSourceEvidence(
    sourceId: string,
    sourceVersionId: string,
    cursor?: string,
    options?: RequestOptions,
  ): Promise<EvidenceListView>;
  getIntakeSubmission(
    submissionId: string,
    options?: RequestOptions,
  ): Promise<IntakeSubmissionSnapshot>;
  getExactDuplicateDecision(
    decisionId: string,
    options?: RequestOptions,
  ): Promise<ExactDuplicateDecisionView>;
  submitSourcesIntake(
    params: FrontendCommandSubmission & SubmitSourcesIntakeCommandPayload,
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<IntakeSubmissionSnapshot>>;
  createFirstProject(
    params: {
      readonly name: string;
      readonly description?: string;
      readonly locale?: string;
      readonly timezone?: string;
      readonly privacyProfile?: string;
      readonly modelProfile?: string;
      readonly costProfile?: string;
      readonly projectAccessRevision: string;
      readonly clientRequestId: string;
      readonly idempotencyKey: string;
      readonly clientIssuedAt?: string;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<ProjectListItemView>>;

  // Settings & Project Administration
  getSettingsSnapshot(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<SettingsSnapshot>;
  getSettingsCategories(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<readonly SettingsCategorySummary[]>;
  getPrincipalPreferences(
    options?: RequestOptions,
  ): Promise<{ readonly preferences: Record<string, unknown>; readonly revision: number }>;
  updatePrincipalPreferences(
    params: FrontendCommandSubmission & {
      readonly expectedPreferenceRevision: number;
      readonly preferences: Record<string, unknown>;
    },
    options?: RequestOptions,
  ): Promise<
    FrontendCommandMutationResponse<{
      readonly preferences: Record<string, unknown>;
      readonly revision: number;
    }>
  >;
  validateSettingsDraft(
    draft: Record<string, unknown>,
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<SettingsValidationResult>;
  previewSettingsImpact(
    expectedSettingsRevision: number,
    observedPolicyContextRevision: number,
    draft: Record<string, unknown>,
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<SettingsImpactPreview>;
  applySettingsCommand(
    params: FrontendCommandSubmission & {
      expectedSettingsRevision: number;
      observedPolicyContextRevision: number;
      settings: Record<string, unknown>;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<SettingsCommandResult>>;
  getFrontendCommandOutcomeByClientRequestId(
    clientRequestId: string,
    options?: RequestOptions,
  ): Promise<FrontendCommandOutcomeView>;
  getSettingsCommandStatus(
    commandId: string,
    options?: RequestOptions,
  ): Promise<SettingsCommandResult>;

  getProjects(options?: RequestOptions): Promise<readonly ProjectListItemView[]>;
  getProjectDetails(projectId: string, options?: RequestOptions): Promise<ProjectListItemView>;
  createProject(
    params: FrontendCommandSubmission & {
      id: string;
      name: string;
      description?: string;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<ProjectListItemView>>;
  updateProject(
    projectId: string,
    params: FrontendCommandSubmission & {
      name?: string;
      description?: string;
      expectedRevision: number;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<ProjectListItemView>>;
  archiveProject(
    projectId: string,
    params: FrontendCommandSubmission & {
      expectedRevision: number;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<ProjectListItemView>>;
  restoreProject(
    projectId: string,
    params: FrontendCommandSubmission & {
      expectedRevision: number;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<ProjectListItemView>>;
  requestDeleteProject(
    projectId: string,
    params: FrontendCommandSubmission & {
      expectedRevision: number;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<ProjectListItemView>>;

  getModelDescriptors(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<readonly ModelDescriptorView[]>>;
  getCostBudget(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<CostBudgetView>>;
  getPrivacyRetention(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<PrivacyRetentionView>>;
  getConnectorSettings(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<readonly ConnectorSettingsView[]>>;
  getDirectiveProposals(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<readonly DirectiveProposalView[]>>;
  getSchemaPacks(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<readonly SchemaPackView[]>>;
  getDiagnostics(
    targetProjectId?: string,
    options?: RequestOptions,
  ): Promise<ProductFeatureView<DiagnosticsView>>;
};
