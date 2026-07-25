import type {
  ProjectListItemView,
  ProjectAdministrationView,
} from '../../../packages/contracts/src/index.js';

export type CreateProjectInput = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly ownerId: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly privacyProfile?: string;
  readonly modelProfile?: string;
  readonly costProfile?: string;
};

export type UpdateProjectInput = {
  readonly projectId: string;
  readonly name?: string;
  readonly description?: string;
  readonly expectedRevision: number;
};

export type ProjectAdministrationRepositoryPort = {
  getProjects(principalId: string): Promise<ProjectAdministrationView>;
  getProjectDetails(projectId: string): Promise<ProjectListItemView | null>;
  createProject(input: CreateProjectInput): Promise<ProjectListItemView>;
  updateProject(input: UpdateProjectInput): Promise<ProjectListItemView>;
  archiveProject(projectId: string, expectedRevision: number): Promise<ProjectListItemView>;
  restoreProject(projectId: string, expectedRevision: number): Promise<ProjectListItemView>;
  requestDeleteProject(projectId: string, expectedRevision: number): Promise<ProjectListItemView>;
};
