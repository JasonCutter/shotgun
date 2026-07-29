import type {
  ProjectMembership,
  TrustedPrincipalContext,
  TrustedSecurityContext,
} from '../../../../packages/authentication/src/index.js';
import {
  FrontendContractError,
  type AnyProductSessionView,
} from '../../../../packages/contracts/src/index.js';

export type ProductSessionView = AnyProductSessionView;

export const createProductSessionView = (input: {
  readonly principalContext: TrustedPrincipalContext;
  readonly projectContext?: TrustedSecurityContext;
  readonly sessionExpiresAt: string | null;
  readonly memberships: readonly ProjectMembership[];
}): ProductSessionView => {
  if (input.principalContext.authenticationMethod === 'api_token') {
    throw new Error('API tokens cannot create a browser product session view.');
  }
  if (input.principalContext.actor.type === 'system') {
    throw new Error('System actors cannot create a browser product session view.');
  }

  const accessibleProjects = input.memberships
    .filter(
      (membership) =>
        membership.principalId === input.principalContext.principalId &&
        (!membership.expiresAt || Date.parse(membership.expiresAt) > Date.now()),
    )
    .map((membership) => ({ id: membership.projectId, isOwner: membership.isOwner }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const principal = {
    id: input.principalContext.principalId,
    actor: {
      type: input.principalContext.actor.type,
      id: input.principalContext.actor.id,
    },
    authenticationMethod: input.principalContext.authenticationMethod,
  } as const;

  if (!input.projectContext) {
    if (accessibleProjects.length > 0) {
      throw new FrontendContractError(
        'LOCAL_PROJECT_SELECTION_REQUIRED',
        'Accessible Projects exist without an authoritative active Project.',
      );
    }
    return {
      apiVersion: '2.0.0',
      principal,
      activeProject: null,
      accessibleProjects: [],
      session: { expiresAt: input.sessionExpiresAt },
      sessionReady: true,
      projectReady: false,
      projectAccessRevision: '0',
    };
  }

  if (!accessibleProjects.some((project) => project.id === input.projectContext?.projectId)) {
    throw new FrontendContractError(
      'LOCAL_PROJECT_SELECTION_REQUIRED',
      'The active Project is not accessible to the Principal.',
    );
  }

  return {
    apiVersion: '1.0.0',
    principal,
    activeProject: { id: input.projectContext.projectId },
    accessibleProjects,
    session: { expiresAt: input.sessionExpiresAt },
  };
};
