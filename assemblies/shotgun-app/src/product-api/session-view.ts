import type {
  ProjectMembership,
  TrustedSecurityContext,
} from '../../../../packages/authentication/src/index.js';

export type ProductSessionView = {
  readonly apiVersion: '1.0.0';
  readonly principal: {
    readonly id: string;
    readonly actor: {
      readonly type: 'user' | 'service';
      readonly id: string;
    };
    readonly authenticationMethod: 'session' | 'development';
  };
  readonly activeProject: {
    readonly id: string;
  };
  readonly accessibleProjects: readonly {
    readonly id: string;
    readonly isOwner: boolean;
  }[];
  readonly session: {
    readonly expiresAt: string | null;
  };
};

export const createProductSessionView = (input: {
  readonly context: TrustedSecurityContext;
  readonly sessionExpiresAt: string | null;
  readonly memberships: readonly ProjectMembership[];
}): ProductSessionView => {
  if (input.context.authenticationMethod === 'api_token') {
    throw new Error('API tokens cannot create a browser product session view.');
  }
  if (input.context.actor.type === 'system') {
    throw new Error('System actors cannot create a browser product session view.');
  }

  const accessibleProjects = input.memberships
    .filter(
      (membership) =>
        membership.principalId === input.context.principalId &&
        (!membership.expiresAt || Date.parse(membership.expiresAt) > Date.now()),
    )
    .map((membership) => ({ id: membership.projectId, isOwner: membership.isOwner }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!accessibleProjects.some((project) => project.id === input.context.projectId)) {
    throw new Error('The active project is not accessible to the principal.');
  }

  return {
    apiVersion: '1.0.0',
    principal: {
      id: input.context.principalId,
      actor: {
        type: input.context.actor.type,
        id: input.context.actor.id,
      },
      authenticationMethod: input.context.authenticationMethod,
    },
    activeProject: { id: input.context.projectId },
    accessibleProjects,
    session: { expiresAt: input.sessionExpiresAt },
  };
};
