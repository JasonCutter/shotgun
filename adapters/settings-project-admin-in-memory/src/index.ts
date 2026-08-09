import { randomUUID } from 'node:crypto';

import type { InMemoryAuthRepository } from '../../../packages/authentication/src/index.js';
import {
  FrontendContractError,
  decodeSettingsSnapshot,
  type ProjectListItemView,
  type ProjectAdministrationView,
  type SettingsSnapshot,
  type SettingsValidationResult,
  type SettingsImpactPreview,
  type SettingsCommandResult,
  type ModelDescriptorView,
  type CostBudgetView,
  type PrivacyRetentionView,
  type ConnectorSettingsView,
  type DirectiveProposalView,
  type SchemaPackView,
  type DiagnosticsView,
  type ProductFeatureView,
} from '../../../packages/contracts/src/index.js';
import type {
  CreateProjectInput,
  ProjectBootstrapInput,
  ProjectBootstrapResult,
  ProjectBootstrapUnitOfWorkPort,
  ProjectAdministrationRepositoryPort,
  UpdateProjectInput,
  ProjectLifecycleCommandInput,
} from '../../../modules/project-administration/src/index.js';
import type {
  ApplySettingsCommandInput,
  ApplyPreferenceCommandInput,
  ListPolicyHistoryInput,
  ListPolicyHistoryResult,
  PolicyHistoryEntry,
  PolicyHistoryReadPort,
  SettingsRepositoryPort,
} from '../../../modules/settings-policy/src/index.js';
import {
  deriveSettingsImpact,
  paginatePolicyHistory,
} from '../../../modules/settings-policy/src/index.js';

export class InMemoryProjectAdministrationRepository implements ProjectAdministrationRepositoryPort {
  private readonly projects = new Map<string, ProjectListItemView>();

  constructor(
    private readonly createOwnerMembership?: (input: {
      readonly principalId: string;
      readonly projectId: string;
    }) => Promise<void>,
    seedDefaultProject = true,
  ) {
    if (!seedDefaultProject) return;
    // Seed the compatibility Project only for existing/test installations.
    const now = new Date().toISOString();
    this.projects.set('shotgun', {
      id: 'shotgun',
      name: 'shotgun',
      description: 'Default Local Owner Project',
      isOwner: true,
      status: 'ACTIVE',
      active: true,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      capability: {
        canRename: true,
        canArchive: true,
        canRestore: false,
        canDelete: false,
        canManagePolicies: true,
      },
    });
  }

  async getProjects(projectIds: readonly string[]): Promise<ProjectAdministrationView> {
    if (!projectIds) throw new FrontendContractError('INVALID_REQUEST', 'projectIds required');
    return Object.freeze({
      schemaVersion: '1.0.0',
      projects: Object.freeze(Array.from(this.projects.values())),
    });
  }

  async getProjectDetails(projectId: string): Promise<ProjectListItemView | null> {
    return this.projects.get(projectId) ?? null;
  }

  removeProjectForRollback(projectId: string): void {
    this.projects.delete(projectId);
  }

  activateProjectForBootstrap(projectId: string): ProjectListItemView {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Bootstrap Project not found.');
    const activeProject = Object.freeze({ ...project, active: true });
    this.projects.set(projectId, activeProject);
    return activeProject;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectListItemView> {
    if (this.projects.has(input.projectId)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Project '${input.projectId}' already exists.`,
      );
    }
    const now = new Date().toISOString();
    const item: ProjectListItemView = Object.freeze({
      id: input.projectId,
      name: input.name,
      description: input.description,
      isOwner: true,
      status: 'ACTIVE',
      active: false,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      capability: Object.freeze({
        canRename: true,
        canArchive: true,
        canRestore: false,
        canDelete: true,
        canManagePolicies: true,
      }),
    });
    await this.createOwnerMembership?.({
      principalId: input.actorPrincipalId,
      projectId: input.projectId,
    });
    this.projects.set(input.projectId, item);
    return item;
  }

  async updateProject(input: UpdateProjectInput): Promise<ProjectListItemView> {
    const existing = this.projects.get(input.projectId);
    if (!existing) {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Project '${input.projectId}' not found.`,
      );
    }
    if (existing.revision !== input.expectedProjectRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${input.expectedProjectRevision} but found ${existing.revision}.`,
      );
    }

    const updated: ProjectListItemView = Object.freeze({
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      updatedAt: new Date().toISOString(),
      revision: existing.revision + 1,
    });
    this.projects.set(input.projectId, updated);
    return updated;
  }

  async archiveProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView> {
    const existing = this.projects.get(input.projectId);
    if (!existing) {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Project '${input.projectId}' not found.`,
      );
    }
    if (existing.revision !== input.expectedProjectRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${input.expectedProjectRevision} but found ${existing.revision}.`,
      );
    }

    const updated: ProjectListItemView = Object.freeze({
      ...existing,
      status: 'ARCHIVED',
      active: false,
      updatedAt: new Date().toISOString(),
      revision: existing.revision + 1,
      capability: Object.freeze({
        ...existing.capability,
        canArchive: false,
        canRestore: true,
      }),
    });
    this.projects.set(input.projectId, updated);
    return updated;
  }

  async restoreProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView> {
    const existing = this.projects.get(input.projectId);
    if (!existing) {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Project '${input.projectId}' not found.`,
      );
    }
    if (existing.revision !== input.expectedProjectRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${input.expectedProjectRevision} but found ${existing.revision}.`,
      );
    }

    const updated: ProjectListItemView = Object.freeze({
      ...existing,
      status: 'ACTIVE',
      updatedAt: new Date().toISOString(),
      revision: existing.revision + 1,
      capability: Object.freeze({
        ...existing.capability,
        canArchive: true,
        canRestore: false,
      }),
    });
    this.projects.set(input.projectId, updated);
    return updated;
  }

  async requestDeleteProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView> {
    const existing = this.projects.get(input.projectId);
    if (!existing) {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Project '${input.projectId}' not found.`,
      );
    }
    if (existing.revision !== input.expectedProjectRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${input.expectedProjectRevision} but found ${existing.revision}.`,
      );
    }

    const updated: ProjectListItemView = Object.freeze({
      ...existing,
      status: 'DELETE_REQUESTED',
      active: false,
      updatedAt: new Date().toISOString(),
      revision: existing.revision + 1,
      capability: Object.freeze({
        canRename: false,
        canArchive: false,
        canRestore: false,
        canDelete: false,
        canManagePolicies: false,
        disabledReason: 'Delete request pending',
      }),
    });
    this.projects.set(input.projectId, updated);
    return updated;
  }
}

export class InMemoryProjectBootstrapUnitOfWork implements ProjectBootstrapUnitOfWorkPort {
  private readonly completed = new Map<string, ProjectListItemView>();
  private readonly sessionLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly projects: InMemoryProjectAdministrationRepository,
    private readonly auth: InMemoryAuthRepository,
  ) {}

  async bootstrap(input: ProjectBootstrapInput): Promise<ProjectBootstrapResult> {
    const previous = this.sessionLocks.get(input.sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.sessionLocks.set(input.sessionId, queued);
    await previous;
    try {
      const completed = this.completed.get(input.commandId);
      if (completed) return { project: completed, replayed: true };
      if (
        input.observedProjectAccessRevision !== undefined &&
        input.observedProjectAccessRevision !== '0'
      ) {
        throw new FrontendContractError(
          'PROJECT_ACCESS_REVISION_CONFLICT',
          'The accessible Project set changed before bootstrap.',
        );
      }
      try {
        this.auth.assertZeroProjectSession(input.sessionId, input.principalId);
      } catch {
        throw new FrontendContractError(
          'ZERO_PROJECT_PRECONDITION_FAILED',
          'The Session is no longer in the zero-project state.',
        );
      }
      const projectId = randomUUID();
      try {
        const project = await this.projects.createProject({
          commandId: input.commandId,
          clientRequestId: input.clientRequestId,
          idempotencyKey: input.idempotencyKey,
          actorPrincipalId: input.principalId,
          projectId,
          expectedProjectRevision: 0,
          ...input.payload,
        });
        this.auth.updateSessionProjectById(input.sessionId, input.principalId, projectId);
        const activeProject = this.projects.activateProjectForBootstrap(project.id);
        this.completed.set(input.commandId, activeProject);
        return { project: activeProject, replayed: false };
      } catch (error) {
        this.projects.removeProjectForRollback(projectId);
        this.auth.removeProjectMembershipForRollback(input.principalId, projectId);
        this.auth.updateSessionProjectById(input.sessionId, input.principalId, null);
        throw error;
      }
    } finally {
      release();
      if (this.sessionLocks.get(input.sessionId) === queued) {
        this.sessionLocks.delete(input.sessionId);
      }
    }
  }

  async findCompleted(commandId: string): Promise<ProjectListItemView | null> {
    return this.completed.get(commandId) ?? null;
  }
}

export class InMemorySettingsRepository implements SettingsRepositoryPort {
  private readonly preferences = new Map<string, Record<string, unknown>>();
  private readonly preferenceRevisions = new Map<string, number>();
  private readonly projectRevisions = new Map<string, number>();
  private readonly projectSettings = new Map<string, Map<string, unknown>>();
  private readonly commands = new Map<string, SettingsCommandResult>();
  private readonly clientRequests = new Map<string, SettingsCommandResult>();
  private readonly idempotencyKeys = new Map<string, SettingsCommandResult>();

  constructor() {
    this.preferences.set('principal-a', {
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      dateDisplay: 'YYYY-MM-DD',
      screenDensity: 'COMFORTABLE',
      reducedMotion: false,
    });
    this.preferenceRevisions.set('principal-a', 1);
    this.projectRevisions.set('shotgun', 1);
  }

  async getPrincipalPreferences(principalId: string): Promise<Record<string, unknown>> {
    return (
      this.preferences.get(principalId) ?? {
        locale: 'en-US',
        timezone: 'UTC',
        dateDisplay: 'YYYY-MM-DD',
        screenDensity: 'COMFORTABLE',
        reducedMotion: false,
      }
    );
  }

  async getPrincipalPreferenceRevision(principalId: string): Promise<number> {
    return this.preferenceRevisions.get(principalId) ?? 0;
  }

  async updatePrincipalPreferences(
    input: ApplyPreferenceCommandInput,
  ): Promise<Record<string, unknown>> {
    const currentRevision = await this.getPrincipalPreferenceRevision(input.principalId);
    if (currentRevision !== input.expectedPreferenceRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected preference revision ${input.expectedPreferenceRevision} but current is ${currentRevision}.`,
      );
    }
    const existing = await this.getPrincipalPreferences(input.principalId);
    const updated = { ...existing, ...input.preferences };
    this.preferences.set(input.principalId, updated);
    this.preferenceRevisions.set(input.principalId, currentRevision + 1);
    return updated;
  }

  async getSettingsSnapshot(projectId: string): Promise<SettingsSnapshot> {
    const rev = this.projectRevisions.get(projectId) ?? 1;
    const settingsMap = this.projectSettings.get(projectId) ?? new Map();

    return decodeSettingsSnapshot({
      schemaVersion: '1.0.0',
      targetProjectId: projectId,
      settingsRevision: rev,
      policyContextRevision: rev,
      categories: Object.freeze([
        {
          categoryId: 'preferences',
          label: 'User Preferences',
          description: 'Personal display and locale settings',
          scope: 'PRINCIPAL',
          totalSettingsCount: 5,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'IMMEDIATE',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
          lastModifiedAt: new Date().toISOString(),
        },
        {
          categoryId: 'projects',
          label: 'Project Administration',
          description: 'Project identity, lifecycle and access',
          scope: 'PROJECT',
          totalSettingsCount: 3,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'IMMEDIATE',
          capability: { canEdit: true, canReset: false, canProposeReview: false },
          lastModifiedAt: new Date().toISOString(),
        },
        {
          categoryId: 'models',
          label: 'Model Profiles',
          description: 'AI model selection and capability routing',
          scope: 'PROJECT',
          totalSettingsCount: 3,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'CONFIRM_REQUIRED',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
          lastModifiedAt: new Date().toISOString(),
        },
        {
          categoryId: 'costs',
          label: 'Costs & Budgets',
          description: 'Usage tracking and spending limits',
          scope: 'PROJECT',
          totalSettingsCount: 4,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'CONFIRM_REQUIRED',
          capability: { canEdit: true, canReset: false, canProposeReview: true },
          lastModifiedAt: new Date().toISOString(),
        },
        {
          categoryId: 'privacy',
          label: 'Privacy & Retention',
          description: 'Sensitivity classifications and retention policies',
          scope: 'PROJECT',
          totalSettingsCount: 4,
          actionRequiredCount: 0,
          warningCount: 0,
          applicationMode: 'REVIEW_REQUIRED',
          capability: { canEdit: true, canReset: false, canProposeReview: true },
          lastModifiedAt: new Date().toISOString(),
        },
      ]),
      settings: Object.freeze([
        {
          key: 'general.locale',
          label: 'Locale',
          description: 'Interface language and regional formatting',
          scope: 'PRINCIPAL',
          category: 'preferences',
          valueType: 'string',
          currentValue: settingsMap.get('general.locale') ?? 'ko-KR',
          defaultValue: 'ko-KR',
          applicationMode: 'IMMEDIATE',
          riskLevel: 'LOW',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
        },
        {
          key: 'models.defaultAnswerProfile',
          label: 'Default Answer Model',
          description: 'Primary AI model used for generating answers',
          scope: 'PROJECT',
          category: 'models',
          valueType: 'string',
          currentValue: settingsMap.get('models.defaultAnswerProfile') ?? 'gemini-2.5-flash',
          defaultValue: 'gemini-2.5-flash',
          applicationMode: 'CONFIRM_REQUIRED',
          riskLevel: 'MEDIUM',
          capability: { canEdit: true, canReset: true, canProposeReview: false },
        },
        {
          key: 'costs.monthlyHardLimitUsd',
          label: 'Monthly Hard Limit (USD)',
          description: 'Strict upper limit for project spending',
          scope: 'PROJECT',
          category: 'costs',
          valueType: 'number',
          currentValue: settingsMap.get('costs.monthlyHardLimitUsd') ?? 100,
          defaultValue: 100,
          applicationMode: 'CONFIRM_REQUIRED',
          riskLevel: 'HIGH',
          capability: { canEdit: true, canReset: false, canProposeReview: true },
        },
        {
          key: 'privacy.sensitivityLevel',
          label: 'Sensitivity Level',
          description: 'Default sensitivity level for project assets',
          scope: 'PROJECT',
          category: 'privacy',
          valueType: 'string',
          currentValue: settingsMap.get('privacy.sensitivityLevel') ?? 'NORMAL',
          defaultValue: 'NORMAL',
          applicationMode: 'REVIEW_REQUIRED',
          riskLevel: 'HIGH',
          capability: { canEdit: true, canReset: false, canProposeReview: true },
        },
      ]),
      fetchedAt: new Date().toISOString(),
    });
  }

  async validateSettingsDraft(
    _projectId: string,
    draft: Record<string, unknown>,
  ): Promise<SettingsValidationResult> {
    const errors: { key: string; message: string }[] = [];
    const warnings: { key: string; message: string }[] = [];

    if (
      draft['costs.monthlyHardLimitUsd'] !== undefined &&
      Number(draft['costs.monthlyHardLimitUsd']) < 0
    ) {
      errors.push({ key: 'costs.monthlyHardLimitUsd', message: 'Hard limit cannot be negative.' });
    }

    if (
      draft['costs.monthlySoftLimitUsd'] !== undefined &&
      draft['costs.monthlyHardLimitUsd'] !== undefined
    ) {
      if (Number(draft['costs.monthlySoftLimitUsd']) > Number(draft['costs.monthlyHardLimitUsd'])) {
        warnings.push({
          key: 'costs.monthlySoftLimitUsd',
          message: 'Soft limit is higher than hard limit.',
        });
      }
    }

    return Object.freeze({
      isValid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    });
  }

  async previewSettingsImpact(
    projectId: string,
    expectedSettingsRevision: number,
    observedPolicyContextRevision: number,
    draft: Record<string, unknown>,
  ): Promise<SettingsImpactPreview> {
    const currentRev = this.projectRevisions.get(projectId) ?? 1;
    if (currentRev !== expectedSettingsRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${expectedSettingsRevision} but current is ${currentRev}.`,
      );
    }

    const derived = deriveSettingsImpact(draft);

    return Object.freeze({
      targetProjectId: projectId,
      expectedRevision: expectedSettingsRevision,
      ...derived,
      affectedComponents: Object.freeze(['settings-policy', 'ai-provider-router']),
      summaryDescription: `Applying ${Object.keys(draft).length} setting changes to project ${projectId}.`,
    });
  }

  async applySettingsCommand(input: ApplySettingsCommandInput): Promise<SettingsCommandResult> {
    // Check Idempotency Key Reuse
    const existingKey = this.idempotencyKeys.get(input.idempotencyKey);
    if (existingKey) {
      if (existingKey.clientRequestId !== input.clientRequestId) {
        throw new FrontendContractError(
          'IDEMPOTENCY_KEY_REUSE_MISMATCH',
          `Idempotency key '${input.idempotencyKey}' reused with different clientRequestId.`,
        );
      }
      return existingKey;
    }

    const currentRev = this.projectRevisions.get(input.projectId) ?? 1;
    if (currentRev !== input.expectedSettingsRevision) {
      throw new FrontendContractError(
        'REVISION_CONFLICT',
        `Expected revision ${input.expectedSettingsRevision} but current is ${currentRev}.`,
      );
    }

    const validation = await this.validateSettingsDraft(input.projectId, input.settings);
    if (!validation.isValid) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
      );
    }

    const impact = await this.previewSettingsImpact(
      input.projectId,
      input.expectedSettingsRevision,
      input.observedPolicyContextRevision,
      input.settings,
    );

    let result: SettingsCommandResult;
    if (impact.requiresReview) {
      const proposalId = `prop-${Date.now()}`;
      result = Object.freeze({
        commandId: input.commandId,
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
        projectId: input.projectId,
        status: 'REVIEW_REQUIRED',
        reviewProposalId: proposalId,
        completedAt: new Date().toISOString(),
      });
    } else {
      const nextRev = currentRev + 1;
      this.projectRevisions.set(input.projectId, nextRev);

      let settingsMap = this.projectSettings.get(input.projectId);
      if (!settingsMap) {
        settingsMap = new Map();
        this.projectSettings.set(input.projectId, settingsMap);
      }
      for (const [k, v] of Object.entries(input.settings)) {
        settingsMap.set(k, v);
      }

      result = Object.freeze({
        commandId: input.commandId,
        clientRequestId: input.clientRequestId,
        idempotencyKey: input.idempotencyKey,
        projectId: input.projectId,
        status: 'APPLIED',
        appliedRevision: nextRev,
        completedAt: new Date().toISOString(),
      });
    }

    this.commands.set(input.commandId, result);
    this.clientRequests.set(input.clientRequestId, result);
    this.idempotencyKeys.set(input.idempotencyKey, result);
    return result;
  }

  async getCommandStatus(commandId: string): Promise<SettingsCommandResult | null> {
    return this.commands.get(commandId) ?? null;
  }

  async getModelDescriptors(
    projectId: string,
  ): Promise<ProductFeatureView<readonly ModelDescriptorView[]>> {
    if (!projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze([
        {
          modelId: 'gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          provider: 'google',
          available: true,
          isDefault: true,
          capabilities: Object.freeze(['fast_answer', 'transformation']),
          inputTypes: Object.freeze(['text', 'image']),
          costClass: 'LOW' as const,
          privacyCharacteristics: 'No logging',
        },
        {
          modelId: 'gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro',
          provider: 'google',
          available: true,
          isDefault: false,
          capabilities: Object.freeze(['deep_analysis', 'reasoning']),
          inputTypes: Object.freeze(['text', 'image', 'document']),
          costClass: 'HIGH' as const,
          privacyCharacteristics: 'No logging',
        },
      ]),
    });
  }

  async getCostBudget(projectId: string): Promise<ProductFeatureView<CostBudgetView>> {
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze({
        targetProjectId: projectId,
        currentUsageTokens: 145000,
        estimatedCostUsd: 12.5,
        confirmedCostUsd: 10.0,
        warningThresholdUsd: 80.0,
        softLimitUsd: 90.0,
        hardLimitUsd: 100.0,
        aggregationTimestamp: new Date().toISOString(),
        status: 'NORMAL',
      }),
    });
  }

  async getPrivacyRetention(projectId: string): Promise<ProductFeatureView<PrivacyRetentionView>> {
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze({
        targetProjectId: projectId,
        profileName: 'LOCAL_ONLY',
        sensitivityLevel: 'NORMAL',
        externalTransferAllowed: false,
        connectorAllowed: false,
        telemetryAllowed: false,
        exportAllowed: true,
        retentionSummary: 'Assets retained indefinitely in local storage',
      }),
    });
  }

  async getConnectorSettings(
    projectId: string,
  ): Promise<ProductFeatureView<readonly ConnectorSettingsView[]>> {
    if (!projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze([
        {
          connectorId: 'github-connector',
          name: 'GitHub Repository Connector',
          status: 'CONNECTED' as const,
          maskedCredentials: 'ghp_****1234',
          canTest: true,
          canRotate: true,
          canRevoke: true,
        },
        {
          connectorId: 'slack-connector',
          name: 'Slack Webhook',
          status: 'NOT_CONFIGURED' as const,
          canTest: false,
          canRotate: false,
          canRevoke: false,
        },
      ]),
    });
  }

  async getDirectiveProposals(
    projectId: string,
  ): Promise<ProductFeatureView<readonly DirectiveProposalView[]>> {
    if (!projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze([
        {
          proposalId: 'prop-101',
          resourceId: 'res-45',
          directiveType: 'FACT_PRIORITY_OVERRIDE',
          description: 'Override default fact ranking for release notes',
          status: 'PROPOSED' as const,
          createdAt: new Date().toISOString(),
        },
      ]),
    });
  }

  async getSchemaPacks(projectId: string): Promise<ProductFeatureView<readonly SchemaPackView[]>> {
    if (!projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze([
        {
          packId: 'standard-v1',
          name: 'Standard Knowledge Schema Pack',
          version: '1.0.0',
          compatibilityStatus: 'COMPATIBLE' as const,
          canUpgrade: true,
          canDisable: false,
        },
      ]),
    });
  }

  async getDiagnostics(projectId: string): Promise<ProductFeatureView<DiagnosticsView>> {
    return Object.freeze({
      availability: 'AVAILABLE',
      data: Object.freeze({
        appVersion: '0.1.0',
        serverVersion: '0.1.0',
        activeProjectId: 'shotgun',
        targetProjectId: projectId,
        databaseReadiness: 'READY',
        projectionReadiness: 'READY',
        recentFailures: Object.freeze([]),
        backupStatus: 'HEALTHY',
      }),
    });
  }
}

/**
 * In-memory Policy History read adapter (WP2-A). Mirrors the authoritative
 * append-only `settings.settings_audit_events` source. Read-only: entries are
 * never edited or deleted once appended (append-only safe).
 */
export class InMemoryPolicyHistoryReadAdapter implements PolicyHistoryReadPort {
  private readonly entries: PolicyHistoryEntry[] = [];

  appendEntry(entry: PolicyHistoryEntry): void {
    if (this.entries.some((existing) => existing.eventId === entry.eventId)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Policy history event ${entry.eventId} already exists (append-only).`,
      );
    }
    this.entries.push(Object.freeze({ ...entry }));
  }

  async listPolicyHistory(input: ListPolicyHistoryInput): Promise<ListPolicyHistoryResult> {
    if (!input.projectId) throw new FrontendContractError('INVALID_REQUEST', 'projectId required');
    const projectEntries = this.entries
      .filter((entry) => entry.projectId === input.projectId)
      .sort(comparePolicyHistoryEntries);
    return paginatePolicyHistory(projectEntries, input);
  }
}

const comparePolicyHistoryEntries = (a: PolicyHistoryEntry, b: PolicyHistoryEntry): number => {
  if (a.timestamp < b.timestamp) return -1;
  if (a.timestamp > b.timestamp) return 1;
  if (a.eventId < b.eventId) return -1;
  if (a.eventId > b.eventId) return 1;
  return 0;
};
