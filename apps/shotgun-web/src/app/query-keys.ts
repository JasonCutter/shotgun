import type { QueryClient } from '@tanstack/react-query';

export const productSessionQueryKey = ['product', 'session'] as const;
export const sessionBoundaryQueryKey = ['session', 'boundary'] as const;
export const protectedQueryKey = ['protected'] as const;
export const globalQueryKey = ['global'] as const;
export const unprotectedQueryKey = ['unprotected'] as const;

export const projectQueryKey = (
  principalId: string,
  projectId: string,
  resource: string,
  ...parts: readonly unknown[]
) => ['project', principalId, projectId, resource, ...parts] as const;

export const settings5DQueryKey = (
  principalId: string,
  targetProjectId: string,
  resourceProjectId: string,
  category: string,
  revisionOrResourceId?: string | number,
) =>
  [
    'settings',
    principalId,
    targetProjectId,
    resourceProjectId,
    category,
    revisionOrResourceId ?? 'latest',
  ] as const;

export const projectAdminQueryKey = (principalId: string) =>
  ['project-admin', principalId] as const;

export const clearProjectQueries = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
};

export const purgeProjectScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await clearProjectQueries(queryClient);
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.removeQueries({ queryKey: ['settings'] });
};

export const purgeProtectedSessionCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['protected'] });
  queryClient.removeQueries({ queryKey: ['protected'] });
  await queryClient.cancelQueries({ queryKey: ['project'] });
  queryClient.removeQueries({ queryKey: ['project'] });
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.removeQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['project-admin'] });
  queryClient.removeQueries({ queryKey: ['project-admin'] });
  await queryClient.cancelQueries({ queryKey: productSessionQueryKey });
  queryClient.removeQueries({ queryKey: productSessionQueryKey });
};

export const purgeSettingsScopedCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.cancelQueries({ queryKey: ['settings'] });
  queryClient.invalidateQueries({ queryKey: ['settings'] });
  await queryClient.cancelQueries({ queryKey: ['project-admin'] });
  queryClient.invalidateQueries({ queryKey: ['project-admin'] });
};
