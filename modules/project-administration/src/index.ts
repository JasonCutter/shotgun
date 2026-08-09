import type {
  CreateProjectCommandPayloadV2,
  ProjectListItemView,
  ProjectAdministrationView,
} from '../../../packages/contracts/src/index.js';

export type ProjectLifecycleCommandInput = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly actorPrincipalId: string;
  readonly projectId: string;
  readonly expectedProjectRevision: number;
};

export type CreateProjectInput = ProjectLifecycleCommandInput & {
  readonly name: string;
  readonly description?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly privacyProfile?: string;
  readonly modelProfile?: string;
  readonly costProfile?: string;
};

export type UpdateProjectInput = ProjectLifecycleCommandInput & {
  readonly name?: string;
  readonly description?: string;
};

export type ProjectAdministrationRepositoryPort = {
  getProjects(projectIds: readonly string[]): Promise<ProjectAdministrationView>;
  getProjectDetails(projectId: string): Promise<ProjectListItemView | null>;
  createProject(input: CreateProjectInput): Promise<ProjectListItemView>;
  updateProject(input: UpdateProjectInput): Promise<ProjectListItemView>;
  archiveProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView>;
  restoreProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView>;
  requestDeleteProject(input: ProjectLifecycleCommandInput): Promise<ProjectListItemView>;
};

export type ProjectBootstrapInput = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly observedProjectAccessRevision?: string;
  readonly payload: CreateProjectCommandPayloadV2;
};

export type ProjectBootstrapResult = {
  readonly project: ProjectListItemView;
  readonly replayed: boolean;
};

export type ProjectBootstrapUnitOfWorkPort = {
  bootstrap(input: ProjectBootstrapInput): Promise<ProjectBootstrapResult>;
  findCompleted(commandId: string): Promise<ProjectListItemView | null>;
};

export type {
  CreateProjectTombstoneInput,
  DeletedProjectAuditReadContext,
  DeletedProjectAuditScopeRecord,
  GrantDeletedProjectAuditScopeInput,
  ProjectTombstoneRecord,
  ProjectTombstoneStorePort,
  RevokeDeletedProjectAuditScopeInput,
} from './project-tombstone.js';
export {
  DELETED_PROJECT_AUDIT_READ_CAPABILITY,
  isDeletedProjectAuditReadPermitted,
} from './project-tombstone.js';
