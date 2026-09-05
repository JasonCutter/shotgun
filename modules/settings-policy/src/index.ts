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

export const COMPARISON_ROLLOUT_SETTING_KEY = 'comparison.stage5.rollout' as const;
export const COMPARISON_ROLLOUT_STATES = ['V1_ONLY', 'V2_SHADOW', 'V2_ACTIVE'] as const;
export type ComparisonRolloutStateSetting = (typeof COMPARISON_ROLLOUT_STATES)[number];

export const isComparisonRolloutState = (value: unknown): value is ComparisonRolloutStateSetting =>
  typeof value === 'string' && (COMPARISON_ROLLOUT_STATES as readonly string[]).includes(value);

export const validateComparisonRolloutSetting = (
  value: unknown,
): { readonly valid: true } | { readonly valid: false; readonly message: string } =>
  isComparisonRolloutState(value)
    ? { valid: true }
    : {
        valid: false,
        message: `comparison.stage5.rollout must be one of ${COMPARISON_ROLLOUT_STATES.join(', ')}.`,
      };

export const deriveSettingsImpact = (
  draft: Record<string, unknown>,
): Pick<
  SettingsImpactPreview,
  | 'applicationMode'
  | 'riskLevel'
  | 'requiresConfirmation'
  | 'requiresReview'
  | 'requiresMigration'
  | 'requiresRestart'
  | 'affectedResources'
  | 'retrospectiveEffect'
> => {
  const keys = Object.keys(draft);
  const hasSchemaChange = keys.some((key) => key.startsWith('schema.'));
  const hasPrivacyReduction = keys.some(
    (key) =>
      key === 'privacy.sensitivityLevel' ||
      key === 'privacy.retentionDays' ||
      key === 'privacy.externalTransferAllowed',
  );
  const hasHardBudget = keys.includes('costs.monthlyHardLimitUsd');
  const hasModelRouting = keys.some((key) => key.startsWith('models.'));
  const hasComparisonRollout = keys.includes(COMPARISON_ROLLOUT_SETTING_KEY);
  const requiresMigration = hasSchemaChange;
  // Rollout transitions are high-impact and confirmation-gated, but use the
  // existing Settings command/confirmation path rather than the privacy-only
  // review proposal store.
  const requiresReview = hasPrivacyReduction;
  const requiresConfirmation = hasHardBudget || hasModelRouting || hasComparisonRollout;
  return {
    applicationMode: requiresMigration
      ? 'MIGRATION_REQUIRED'
      : requiresReview
        ? 'REVIEW_REQUIRED'
        : requiresConfirmation
          ? 'CONFIRM_REQUIRED'
          : 'IMMEDIATE',
    riskLevel:
      hasPrivacyReduction || hasSchemaChange || hasComparisonRollout
        ? 'HIGH'
        : requiresConfirmation
          ? 'MEDIUM'
          : 'LOW',
    requiresConfirmation,
    requiresReview,
    requiresMigration,
    requiresRestart: false,
    affectedResources: keys.map((key) => `setting/${key}`),
    retrospectiveEffect:
      hasPrivacyReduction && keys.includes('privacy.retentionDays')
        ? 'Existing retained material may require policy-governed cleanup review.'
        : 'NONE',
  };
};

export type ApplySettingsCommandInput = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly expectedSettingsRevision: number;
  readonly observedPolicyContextRevision: number;
  readonly settings: Record<string, unknown>;
  readonly reviewProposalId?: string;
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
  /** Narrow read boundary for append-only project settings used by runtime policy resolvers. */
  getProjectSettingValue?(projectId: string, key: string): Promise<unknown | undefined>;
  getPrincipalPreferences(principalId: string): Promise<Record<string, unknown>>;
  getPrincipalPreferenceRevision(principalId: string): Promise<number>;
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

export type {
  ListPolicyHistoryInput,
  ListPolicyHistoryResult,
  PolicyHistoryCursor,
  PolicyHistoryEntry,
  PolicyHistoryReadPort,
  PolicyHistorySourceKind,
} from './policy-history.js';
export {
  comparePolicyHistoryEntries,
  isPolicyHistoryAfter,
  paginatePolicyHistory,
} from './policy-history.js';
