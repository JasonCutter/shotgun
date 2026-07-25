import type {
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
