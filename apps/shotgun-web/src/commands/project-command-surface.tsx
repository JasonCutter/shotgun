import type { GlobalShellView, ProjectListItemView } from '@shotgun/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';

import { useAppRuntime } from '../app/providers.js';
import { projectAdminQueryKey, purgeSettingsScopedCaches } from '../app/query-keys.js';
import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import { safeErrorMessage } from '../components/error-state.js';
import { projectLifecycleLabel } from '../presentation/product-labels.js';
import type { ProjectCommandId } from './owner-command-registry.js';

type ProjectSurfaceStep = 'MANAGE' | 'CREATE' | 'SELECT' | 'RENAME' | 'RESTORE' | 'CONFIRM';

export type ProjectCommandSurfaceProps = {
  readonly open: boolean;
  readonly commandId: ProjectCommandId | null;
  readonly shell: GlobalShellView;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
};

const flowStep = (commandId: ProjectCommandId): ProjectSurfaceStep => {
  if (commandId === 'project.manage') return 'MANAGE';
  if (commandId === 'project.create') return 'CREATE';
  if (commandId === 'project.rename') return 'RENAME';
  if (commandId === 'project.restore') return 'RESTORE';
  return 'CONFIRM';
};

const isEligible = (project: ProjectListItemView, commandId: ProjectCommandId): boolean => {
  if (commandId === 'project.rename') return project.capability.canRename;
  if (commandId === 'project.archive') return project.capability.canArchive;
  if (commandId === 'project.restore') return project.capability.canRestore;
  if (commandId === 'project.delete_request') return project.capability.canDelete;
  return false;
};

const targetProject = (
  projects: readonly ProjectListItemView[],
  commandId: ProjectCommandId,
  activeProjectId: string | undefined,
): ProjectListItemView | undefined =>
  projects.find((project) => project.id === activeProjectId && isEligible(project, commandId)) ??
  projects.find((project) => isEligible(project, commandId));

const identity = () => ({
  clientRequestId: crypto.randomUUID(),
  idempotencyKey: crypto.randomUUID(),
});

export const ProjectCommandSurface = ({
  open,
  commandId,
  shell,
  invoker,
  onClose,
}: ProjectCommandSurfaceProps) => {
  const { apiClient } = useAppRuntime();
  const queryClient = useQueryClient();
  const titleId = useId();
  const dialog = useAccessibleDialog({ open, onClose });
  const [step, setStep] = useState<ProjectSurfaceStep>('MANAGE');
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [createId, setCreateId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [message, setMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const projectsQuery = useQuery({
    queryKey: projectAdminQueryKey(shell.principalId),
    queryFn: () => apiClient.getProjects(),
    enabled: open,
  });
  const projects = projectsQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  useEffect(() => {
    if (!open || !commandId) return;
    dialog.captureInvoker(invoker);
    setStep(flowStep(commandId));
    setSelectedProjectId(undefined);
    setMessage(undefined);
    setErrorMessage(undefined);
    setCreateId('');
    setCreateName('');
    setCreateDescription('');
    setRenameValue('');
  }, [commandId, invoker, open]);

  useEffect(() => {
    if (!open || !commandId || commandId === 'project.manage' || commandId === 'project.create') {
      return;
    }
    if (selectedProjectId) return;
    const target = targetProject(projects, commandId, shell.activeProject?.id);
    if (target) {
      setSelectedProjectId(target.id);
      setStep(flowStep(commandId));
    } else if (!projectsQuery.isLoading) {
      setStep('SELECT');
    }
  }, [
    commandId,
    open,
    projects,
    projectsQuery.isLoading,
    selectedProjectId,
    shell.activeProject?.id,
  ]);

  const refreshProjects = async () => {
    await purgeSettingsScopedCaches(queryClient);
    await queryClient.invalidateQueries({ queryKey: ['protected', 'global-shell'] });
    await queryClient.refetchQueries({ queryKey: projectAdminQueryKey(shell.principalId) });
  };

  const createMutation = useMutation({
    mutationFn: (input: {
      readonly id: string;
      readonly name: string;
      readonly description?: string;
    }) => {
      const activeProjectId = shell.activeProject?.id;
      if (!activeProjectId)
        throw new Error('Create Project is unavailable until a Project is active.');
      return apiClient.createProject({
        id: input.id,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        activeProjectId,
        targetProjectId: activeProjectId,
        ...identity(),
      });
    },
    onSuccess: async () => {
      await refreshProjects();
      setStep('MANAGE');
      setMessage('Project created.');
      setCreateId('');
      setCreateName('');
      setCreateDescription('');
    },
    onError: (error) => setErrorMessage(safeErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      readonly projectId: string;
      readonly name: string;
      readonly revision: number;
    }) =>
      apiClient.updateProject(input.projectId, {
        name: input.name,
        activeProjectId: shell.activeProject?.id ?? input.projectId,
        targetProjectId: input.projectId,
        resourceProjectId: input.projectId,
        expectedRevision: input.revision,
        ...identity(),
      }),
    onSuccess: async () => {
      await refreshProjects();
      setStep('MANAGE');
      setMessage('Project name updated.');
      setRenameValue('');
    },
    onError: (error) => setErrorMessage(safeErrorMessage(error)),
  });

  const lifecycleMutation = useMutation({
    mutationFn: (input: {
      readonly commandId: Extract<
        ProjectCommandId,
        'project.archive' | 'project.restore' | 'project.delete_request'
      >;
      readonly projectId: string;
      readonly revision: number;
    }) => {
      const params = {
        activeProjectId: shell.activeProject?.id ?? input.projectId,
        targetProjectId: input.projectId,
        resourceProjectId: input.projectId,
        expectedRevision: input.revision,
        ...identity(),
      };
      if (input.commandId === 'project.archive')
        return apiClient.archiveProject(input.projectId, params);
      if (input.commandId === 'project.restore')
        return apiClient.restoreProject(input.projectId, params);
      return apiClient.requestDeleteProject(input.projectId, params);
    },
    onSuccess: async (_result, input) => {
      await refreshProjects();
      setStep('MANAGE');
      setMessage(
        input.commandId === 'project.archive'
          ? 'Project archived.'
          : input.commandId === 'project.restore'
            ? 'Project restored.'
            : 'Deletion request submitted.',
      );
    },
    onError: (error) => setErrorMessage(safeErrorMessage(error)),
  });

  const pending =
    createMutation.isPending || updateMutation.isPending || lifecycleMutation.isPending;

  const selectProject = (project: ProjectListItemView, nextCommandId: ProjectCommandId) => {
    setSelectedProjectId(project.id);
    setErrorMessage(undefined);
    setMessage(undefined);
    setRenameValue('');
    setStep(flowStep(nextCommandId));
  };

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(undefined);
    createMutation.mutate({
      id: createId.trim(),
      name: createName.trim(),
      ...(createDescription.trim() ? { description: createDescription.trim() } : {}),
    });
  };

  const handleRenameSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject || !renameValue.trim()) return;
    setErrorMessage(undefined);
    updateMutation.mutate({
      projectId: selectedProject.id,
      name: renameValue.trim(),
      revision: selectedProject.revision,
    });
  };

  const handleLifecycleSubmit = () => {
    if (
      !selectedProject ||
      !commandId ||
      commandId === 'project.manage' ||
      commandId === 'project.create'
    ) {
      return;
    }
    if (commandId === 'project.rename') return;
    setErrorMessage(undefined);
    lifecycleMutation.mutate({
      commandId,
      projectId: selectedProject.id,
      revision: selectedProject.revision,
    });
  };

  const title =
    commandId === 'project.manage'
      ? 'Manage Projects'
      : commandId === 'project.create'
        ? 'Create Project'
        : commandId === 'project.rename'
          ? 'Rename Project'
          : commandId === 'project.restore'
            ? 'Restore Project'
            : commandId === 'project.archive'
              ? 'Archive Project'
              : 'Request Project Deletion';

  const eligibleProjects = useMemo(
    () => (commandId ? projects.filter((project) => isEligible(project, commandId)) : []),
    [commandId, projects],
  );

  if (!open || !commandId) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={dialog.onDialogKeyDown}
    >
      <div className="modal-card project-command-surface">
        <h2 id={titleId}>{title}</h2>
        {message ? (
          <p className="project-command-message" role="status">
            {message}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="project-command-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {projectsQuery.isLoading ? <p role="status">Loading Projects…</p> : null}
        {projectsQuery.error ? (
          <p className="project-command-error" role="alert">
            {safeErrorMessage(projectsQuery.error)}
          </p>
        ) : null}

        {!projectsQuery.isLoading && !projectsQuery.error && step === 'MANAGE' ? (
          <>
            <p>Choose a Project action without opening the permanent Settings path.</p>
            <ul className="project-command-list">
              {projects.map((project) => (
                <li key={project.id} className="project-command-row">
                  <div>
                    <strong>{project.name}</strong>
                    <span>
                      {project.active ? 'Active Project' : projectLifecycleLabel(project.status)}
                    </span>
                  </div>
                  <div className="project-command-actions">
                    {project.capability.canRename ? (
                      <button
                        type="button"
                        onClick={() => selectProject(project, 'project.rename')}
                      >
                        Rename
                      </button>
                    ) : null}
                    {project.capability.canArchive ? (
                      <button
                        type="button"
                        onClick={() => selectProject(project, 'project.archive')}
                      >
                        Archive
                      </button>
                    ) : null}
                    {project.capability.canRestore ? (
                      <button
                        type="button"
                        onClick={() => selectProject(project, 'project.restore')}
                      >
                        Restore
                      </button>
                    ) : null}
                    {project.capability.canDelete ? (
                      <button
                        type="button"
                        onClick={() => selectProject(project, 'project.delete_request')}
                      >
                        Request deletion
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {shell.activeProject ? (
              <button
                type="button"
                onClick={() => {
                  setStep('CREATE');
                  setErrorMessage(undefined);
                }}
              >
                Create Project
              </button>
            ) : null}
          </>
        ) : null}

        {!projectsQuery.isLoading && !projectsQuery.error && step === 'CREATE' ? (
          <form className="project-command-form" onSubmit={handleCreateSubmit}>
            <p>Only the fields required by the existing Project create contract are shown.</p>
            <label>
              Project key
              <input
                required
                value={createId}
                onChange={(event) => setCreateId(event.currentTarget.value)}
              />
            </label>
            <label>
              Project name
              <input
                required
                value={createName}
                onChange={(event) => setCreateName(event.currentTarget.value)}
              />
            </label>
            <label>
              Description (optional)
              <textarea
                value={createDescription}
                onChange={(event) => setCreateDescription(event.currentTarget.value)}
              />
            </label>
            <div className="dialog-actions">
              <button type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create Project'}
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {!projectsQuery.isLoading && !projectsQuery.error && step === 'SELECT' ? (
          <>
            <p>Select the Project for this command.</p>
            {eligibleProjects.length === 0 ? (
              <p role="status">No eligible Projects are available for this action.</p>
            ) : null}
            <ul className="project-command-list">
              {eligibleProjects.map((project) => (
                <li key={project.id}>
                  <button type="button" onClick={() => selectProject(project, commandId)}>
                    {project.name} ·{' '}
                    {project.active ? 'Active Project' : projectLifecycleLabel(project.status)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {!projectsQuery.isLoading &&
        !projectsQuery.error &&
        step === 'RENAME' &&
        selectedProject ? (
          <form className="project-command-form" onSubmit={handleRenameSubmit}>
            <p>
              Current Project: <strong>{selectedProject.name}</strong>
            </p>
            <label>
              New Project name
              <input
                required
                value={renameValue}
                onChange={(event) => setRenameValue(event.currentTarget.value)}
                autoComplete="off"
              />
            </label>
            <div className="dialog-actions">
              <button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Rename Project'}
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {!projectsQuery.isLoading &&
        !projectsQuery.error &&
        step === 'RESTORE' &&
        selectedProject ? (
          <>
            <p>
              Restore <strong>{selectedProject.name}</strong> to make it available again.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={handleLifecycleSubmit} disabled={pending}>
                {pending ? 'Restoring…' : 'Restore Project'}
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {!projectsQuery.isLoading &&
        !projectsQuery.error &&
        step === 'CONFIRM' &&
        selectedProject ? (
          <>
            <p>
              {commandId === 'project.archive' ? (
                <>
                  Archive <strong>{selectedProject.name}</strong>? It will no longer be available as
                  an active Project.
                </>
              ) : (
                <>
                  Submit a deletion request for <strong>{selectedProject.name}</strong>? This starts
                  the existing deletion workflow.
                </>
              )}
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={handleLifecycleSubmit} disabled={pending}>
                {pending
                  ? 'Submitting…'
                  : commandId === 'project.archive'
                    ? 'Confirm Archive'
                    : 'Confirm Deletion Request'}
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : null}

        {step === 'MANAGE' || step === 'SELECT' ? (
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
