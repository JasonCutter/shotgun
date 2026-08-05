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
  KnowledgeWorkspaceRequest,
  KnowledgePageListRequest,
  KnowledgeSearchRequest,
  KnowledgeDetailRequest,
  KnowledgeCompareRequest,
  KnowledgeAuthority,
  KnowledgeKind,
  KnowledgeTemporalState,
  KnowledgeProjectionStatus,
  KnowledgeEvidenceReturnTarget,
  KnowledgeItemView,
  KnowledgePageSummaryView,
  KnowledgeLineageView,
  KnowledgeWorkspaceView,
  KnowledgePageListView,
  KnowledgePageView,
  KnowledgeProjectionStatusView,
  KnowledgeSearchResultViewVNext,
  KnowledgeSearchResultViewAny,
  KnowledgeDetailView,
  KnowledgeCompareView,
  FrontendKnowledgeDraftChangeSetV1,
  FrontendKnowledgeDraftCommandOutcomeV1,
  FrontendKnowledgeOperationV1,
  GenerateKnowledgeDraftImpactRequestV1,
  GenerateKnowledgeDraftImpactResultV1,
  MaterializeDraftResultV1,
  ReadKnowledgeDraftRequestV1,
  ReadKnowledgeDraftResultV1,
  ResolveKnowledgeDraftCommandOutcomeResultV1,
  SaveKnowledgeDraftResultV1,
  SubmitKnowledgeDraftForReviewRequestV1,
  SubmitKnowledgeDraftForReviewResultV1,
  ValidateKnowledgeDraftRequestV1,
  ValidateKnowledgeDraftResultV1,
  GraphAccessMaskingStateV1,
  GraphAppliedLimitsV1,
  GraphAuthorityClassificationV1,
  GraphBaseViewKindV1,
  GraphCapabilitiesViewV1,
  GraphCapabilityV1,
  GraphConflictOverlayRequestV1,
  GraphContinuationTokenV1,
  GraphEdgeReferenceV1,
  GraphEdgeSemanticKindV1,
  GraphEdgeV1,
  GraphEvidenceDetailRequestV1,
  GraphEvidenceDetailResultV1,
  GraphEvidenceEntryV1,
  GraphEvidenceSummaryV1,
  GraphEvidenceTargetV1,
  GraphFilterSetV1,
  GraphKnowledgeGapOverlayRequestV1,
  GraphNeighborhoodRequestV1,
  GraphNeighborhoodResultV1,
  GraphNodePayloadV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphOperationFailureV1,
  GraphOverlayIdentityV1,
  GraphOverlayKindV1,
  GraphOverlayResultV1,
  GraphPathDescriptionSegmentV1,
  GraphPathDescriptionV1,
  GraphPathDescribeRequestV1,
  GraphPathRequestV1,
  GraphPathResultV1,
  GraphPathSegmentV1,
  GraphProjectionHealthV1,
  GraphProvenanceSummaryV1,
  GraphRecursiveImpactOverlayRequestV1,
  GraphResourceKindV1,
  GraphRestoreRequestV1,
  GraphRestoreResultV1,
  GraphResultCompletenessV1,
  GraphRevisionBindingV1,
  GraphSnapshotIdentityV1,
  GraphSnapshotRefreshRequestV1,
  GraphSnapshotRequestV1,
  GraphSnapshotResultV1,
  GraphTemporalValidityV1,
  GraphTraversalDirectionV1,
  GraphTraversalLimitsV1,
  GraphTruncationStateV1,
  GraphUnavailableReasonV1,
  ApprovalPurposeV1,
  ApprovalStatusV1,
  AddReviewCommentRequestV1,
  AddReviewCommentResultV1,
  GetReviewApprovalRequestV1,
  GetReviewApprovalResultV1,
  GetReviewContextRequestV1,
  GetReviewContextResultV1,
  GetReviewItemDetailRequestV1,
  GetReviewItemDetailResultV1,
  ListReviewQueueRequestV1,
  ListReviewQueueResultV1,
  RecordReviewDecisionsRequestV1,
  RecordReviewDecisionsResultV1,
  ResolveReviewCommandOutcomeRequestV1,
  ResolveReviewCommandOutcomeResultV1,
  RevalidateReviewContextRequestV1,
  RevalidateReviewContextResultV1,
  ReviewAggregateStateV1,
  ReviewApprovalV1,
  ReviewAttentionReasonV1,
  ReviewCapabilityV1,
  ReviewCommentRecordV1,
  ReviewContentRepresentationV1,
  ReviewContextRevisionV1,
  ReviewDecisionIntentV1,
  ReviewDecisionRecordV1,
  ReviewDependencyV1,
  ReviewEvidenceEntryV1,
  ReviewFailureReasonV1,
  ReviewImpactEntryV1,
  ReviewItemDecisionStateV1,
  ReviewItemDecisionInputV1,
  ReviewItemV1,
  ReviewQueueItemV1,
  ReviewRevisionReturnTargetV1,
  ReviewTargetKindV1,
  // FE-P4-S2 WP5 External Action workspace types (contracts V1).
  ExternalActionSchemaVersion,
  FrontendExternalActionCommandType,
  ExternalActionTargetKindV1,
  ExternalActionOperationV1,
  ExternalActionAggregateStatusV1,
  ExternalActionConcreteKindV1,
  ExecutionAttemptStatusV1,
  PreflightResultStatusV1,
  VerificationResultStatusV1,
  ExternalActionApprovalPurposeV1,
  ExternalActionApprovalStatusV1,
  ExternalActionAccessMaskingStateV1,
  ExternalActionAggregateReadinessV1,
  ExternalActionCapabilityV1,
  ExternalActionAuditCategoryV1,
  ExternalActionFailureReasonV1,
  ExternalActionTargetRefV1,
  ExternalActionResourceRefV1,
  ExternalActionParameterRefV1,
  ExternalActionEvidenceSetRefV1,
  ExternalActionActorV1,
  ExternalActionV1,
  ActionCandidateV1,
  RiskDecisionV1,
  ActionManifestV1,
  ExternalActionApprovalV1,
  PreflightV1,
  ExecutionV1,
  ExecutionAttemptV1,
  VerificationV1,
  ResultV1,
  ActionAuditEventDataV1,
  ActionAuditEventV1,
  CompensatingActionV1,
  RollbackV1,
  ExternalActionCredentialViewV1,
  ExternalActionBudgetViewV1,
  ListExternalActionsRequestV1,
  ExternalActionQueueItemV1,
  ListExternalActionsResultV1,
  GetExternalActionRequestV1,
  GetExternalActionResultV1,
  GetActionManifestRequestV1,
  GetActionManifestResultV1,
  GetRiskDecisionRequestV1,
  GetRiskDecisionResultV1,
  GetPreflightRequestV1,
  GetPreflightResultV1,
  GetExternalActionApprovalRequestV1,
  GetExternalActionApprovalResultV1,
  GetExecutionRequestV1,
  GetExecutionResultV1,
  GetExecutionAttemptsRequestV1,
  GetExecutionAttemptsResultV1,
  GetVerificationRequestV1,
  GetVerificationResultV1,
  GetActionResultRequestV1,
  GetActionResultResultV1,
  GetExternalActionDetailRequestV1,
  GetExternalActionDetailResultV1,
  ListExternalActionAuditRequestV1,
  ListExternalActionAuditResultV1,
  ValidateActionCandidateRequestV1,
  ValidateActionCandidateResultV1,
  PrepareActionManifestRequestV1,
  PrepareActionManifestResultV1,
  ApproveExternalActionRequestV1,
  ApproveExternalActionResultV1,
  PreflightExternalActionRequestV1,
  PreflightExternalActionResultV1,
  ExecuteExternalActionRequestV1,
  ExecuteExternalActionResultV1,
  RetryExecutionAttemptRequestV1,
  RetryExecutionAttemptResultV1,
  VerifyExternalActionRequestV1,
  VerifyExternalActionResultV1,
  CancelExternalActionRequestV1,
  CancelExternalActionResultV1,
  RollbackExternalActionRequestV1,
  RollbackExternalActionResultV1,
  PrepareCompensatingActionRequestV1,
  PrepareCompensatingActionResultV1,
  ResolveExternalActionOutcomeRequestV1,
  ResolvedCommandResultV1,
  ResolveExternalActionOutcomeResultV1,
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
  KnowledgeWorkspaceRequest,
  KnowledgePageListRequest,
  KnowledgeSearchRequest,
  KnowledgeDetailRequest,
  KnowledgeCompareRequest,
  KnowledgeAuthority,
  KnowledgeKind,
  KnowledgeTemporalState,
  KnowledgeProjectionStatus,
  KnowledgeEvidenceReturnTarget,
  KnowledgeItemView,
  KnowledgePageSummaryView,
  KnowledgeLineageView,
  KnowledgeWorkspaceView,
  KnowledgePageListView,
  KnowledgePageView,
  KnowledgeProjectionStatusView,
  KnowledgeSearchResultViewVNext,
  KnowledgeSearchResultViewAny,
  KnowledgeDetailView,
  KnowledgeCompareView,
  FrontendKnowledgeDraftChangeSetV1,
  FrontendKnowledgeDraftCommandOutcomeV1,
  FrontendKnowledgeOperationV1,
  GenerateKnowledgeDraftImpactRequestV1,
  GenerateKnowledgeDraftImpactResultV1,
  MaterializeDraftResultV1,
  ReadKnowledgeDraftRequestV1,
  ReadKnowledgeDraftResultV1,
  ResolveKnowledgeDraftCommandOutcomeResultV1,
  SaveKnowledgeDraftResultV1,
  SubmitKnowledgeDraftForReviewRequestV1,
  SubmitKnowledgeDraftForReviewResultV1,
  ValidateKnowledgeDraftRequestV1,
  ValidateKnowledgeDraftResultV1,
  GraphAccessMaskingStateV1,
  GraphAppliedLimitsV1,
  GraphAuthorityClassificationV1,
  GraphBaseViewKindV1,
  GraphCapabilitiesViewV1,
  GraphCapabilityV1,
  GraphConflictOverlayRequestV1,
  GraphContinuationTokenV1,
  GraphEdgeReferenceV1,
  GraphEdgeSemanticKindV1,
  GraphEdgeV1,
  GraphEvidenceDetailRequestV1,
  GraphEvidenceDetailResultV1,
  GraphEvidenceEntryV1,
  GraphEvidenceSummaryV1,
  GraphEvidenceTargetV1,
  GraphFilterSetV1,
  GraphKnowledgeGapOverlayRequestV1,
  GraphNeighborhoodRequestV1,
  GraphNeighborhoodResultV1,
  GraphNodePayloadV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphOperationFailureV1,
  GraphOverlayIdentityV1,
  GraphOverlayKindV1,
  GraphOverlayResultV1,
  GraphPathDescriptionSegmentV1,
  GraphPathDescriptionV1,
  GraphPathDescribeRequestV1,
  GraphPathRequestV1,
  GraphPathResultV1,
  GraphPathSegmentV1,
  GraphProjectionHealthV1,
  GraphProvenanceSummaryV1,
  GraphRecursiveImpactOverlayRequestV1,
  GraphResourceKindV1,
  GraphRestoreRequestV1,
  GraphRestoreResultV1,
  GraphResultCompletenessV1,
  GraphRevisionBindingV1,
  GraphSnapshotIdentityV1,
  GraphSnapshotRefreshRequestV1,
  GraphSnapshotRequestV1,
  GraphSnapshotResultV1,
  GraphTemporalValidityV1,
  GraphTraversalDirectionV1,
  GraphTraversalLimitsV1,
  GraphTruncationStateV1,
  GraphUnavailableReasonV1,
  ApprovalPurposeV1,
  ApprovalStatusV1,
  AddReviewCommentRequestV1,
  AddReviewCommentResultV1,
  GetReviewApprovalRequestV1,
  GetReviewApprovalResultV1,
  GetReviewContextRequestV1,
  GetReviewContextResultV1,
  GetReviewItemDetailRequestV1,
  GetReviewItemDetailResultV1,
  ListReviewQueueRequestV1,
  ListReviewQueueResultV1,
  RecordReviewDecisionsRequestV1,
  RecordReviewDecisionsResultV1,
  ResolveReviewCommandOutcomeRequestV1,
  ResolveReviewCommandOutcomeResultV1,
  RevalidateReviewContextRequestV1,
  RevalidateReviewContextResultV1,
  ReviewAggregateStateV1,
  ReviewApprovalV1,
  ReviewAttentionReasonV1,
  ReviewCapabilityV1,
  ReviewCommentRecordV1,
  ReviewContentRepresentationV1,
  ReviewContextRevisionV1,
  ReviewDecisionIntentV1,
  ReviewDecisionRecordV1,
  ReviewDependencyV1,
  ReviewEvidenceEntryV1,
  ReviewFailureReasonV1,
  ReviewImpactEntryV1,
  ReviewItemDecisionStateV1,
  ReviewItemDecisionInputV1,
  ReviewItemV1,
  ReviewQueueItemV1,
  ReviewRevisionReturnTargetV1,
  ReviewTargetKindV1,
  ErrorCode,
  FailureCategory,
  FailureRetryability,
  FailureRecovery,
  ProductFailureDetails,
  ProductFailureEnvelope,
  TypedFrontendFailure,
  // FE-P4-S2 WP5 External Action workspace types (contracts V1).
  ExternalActionSchemaVersion,
  FrontendExternalActionCommandType,
  ExternalActionTargetKindV1,
  ExternalActionOperationV1,
  ExternalActionAggregateStatusV1,
  ExternalActionConcreteKindV1,
  ExecutionAttemptStatusV1,
  PreflightResultStatusV1,
  VerificationResultStatusV1,
  ExternalActionApprovalPurposeV1,
  ExternalActionApprovalStatusV1,
  ExternalActionAccessMaskingStateV1,
  ExternalActionAggregateReadinessV1,
  ExternalActionCapabilityV1,
  ExternalActionAuditCategoryV1,
  ExternalActionFailureReasonV1,
  ExternalActionTargetRefV1,
  ExternalActionResourceRefV1,
  ExternalActionParameterRefV1,
  ExternalActionEvidenceSetRefV1,
  ExternalActionActorV1,
  ExternalActionV1,
  ActionCandidateV1,
  RiskDecisionV1,
  ActionManifestV1,
  ExternalActionApprovalV1,
  PreflightV1,
  ExecutionV1,
  ExecutionAttemptV1,
  VerificationV1,
  ResultV1,
  ActionAuditEventDataV1,
  ActionAuditEventV1,
  CompensatingActionV1,
  RollbackV1,
  ExternalActionCredentialViewV1,
  ExternalActionBudgetViewV1,
  ListExternalActionsRequestV1,
  ExternalActionQueueItemV1,
  ListExternalActionsResultV1,
  GetExternalActionRequestV1,
  GetExternalActionResultV1,
  GetActionManifestRequestV1,
  GetActionManifestResultV1,
  GetRiskDecisionRequestV1,
  GetRiskDecisionResultV1,
  GetPreflightRequestV1,
  GetPreflightResultV1,
  GetExternalActionApprovalRequestV1,
  GetExternalActionApprovalResultV1,
  GetExecutionRequestV1,
  GetExecutionResultV1,
  GetExecutionAttemptsRequestV1,
  GetExecutionAttemptsResultV1,
  GetVerificationRequestV1,
  GetVerificationResultV1,
  GetActionResultRequestV1,
  GetActionResultResultV1,
  GetExternalActionDetailRequestV1,
  GetExternalActionDetailResultV1,
  ListExternalActionAuditRequestV1,
  ListExternalActionAuditResultV1,
  ValidateActionCandidateRequestV1,
  ValidateActionCandidateResultV1,
  PrepareActionManifestRequestV1,
  PrepareActionManifestResultV1,
  ApproveExternalActionRequestV1,
  ApproveExternalActionResultV1,
  PreflightExternalActionRequestV1,
  PreflightExternalActionResultV1,
  ExecuteExternalActionRequestV1,
  ExecuteExternalActionResultV1,
  RetryExecutionAttemptRequestV1,
  RetryExecutionAttemptResultV1,
  VerifyExternalActionRequestV1,
  VerifyExternalActionResultV1,
  CancelExternalActionRequestV1,
  CancelExternalActionResultV1,
  RollbackExternalActionRequestV1,
  RollbackExternalActionResultV1,
  PrepareCompensatingActionRequestV1,
  PrepareCompensatingActionResultV1,
  ResolveExternalActionOutcomeRequestV1,
  ResolvedCommandResultV1,
  ResolveExternalActionOutcomeResultV1,
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
  getKnowledgeWorkspace(
    request: KnowledgeWorkspaceRequest,
    options?: RequestOptions,
  ): Promise<KnowledgeWorkspaceView>;
  listKnowledgePages(
    request: KnowledgePageListRequest,
    options?: RequestOptions,
  ): Promise<KnowledgePageListView>;
  searchKnowledge(
    request: KnowledgeSearchRequest,
    options?: RequestOptions,
  ): Promise<KnowledgeSearchResultViewAny>;
  getKnowledgeDetail(
    request: KnowledgeDetailRequest,
    options?: RequestOptions,
  ): Promise<KnowledgeDetailView>;
  compareKnowledgePages(
    request: KnowledgeCompareRequest,
    options?: RequestOptions,
  ): Promise<KnowledgeCompareView>;
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
