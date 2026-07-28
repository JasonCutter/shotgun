import { decodeProductFailureEnvelope } from '../../contracts/src/index.js';
import type { ProductApiErrorBody, ProductSessionView } from './contracts.js';
import { invalidProductApiResponse } from './errors.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const decodeProductSessionView = (value: unknown): ProductSessionView => {
  if (!isRecord(value) || value.apiVersion !== '1.0.0') throw invalidProductApiResponse();
  const principal = value.principal;
  const activeProject = value.activeProject;
  const accessibleProjects = value.accessibleProjects;
  const session = value.session;
  if (
    !isRecord(principal) ||
    !nonEmptyString(principal.id) ||
    !isRecord(principal.actor) ||
    !['user', 'service'].includes(String(principal.actor.type)) ||
    !nonEmptyString(principal.actor.id) ||
    !['session', 'development'].includes(String(principal.authenticationMethod)) ||
    !isRecord(activeProject) ||
    !nonEmptyString(activeProject.id) ||
    !Array.isArray(accessibleProjects) ||
    !isRecord(session) ||
    !(session.expiresAt === null || typeof session.expiresAt === 'string')
  ) {
    throw invalidProductApiResponse();
  }

  const projects = accessibleProjects.map((project) => {
    if (!isRecord(project) || !nonEmptyString(project.id) || typeof project.isOwner !== 'boolean') {
      throw invalidProductApiResponse();
    }
    return { id: project.id, isOwner: project.isOwner };
  });
  if (!projects.some((project) => project.id === activeProject.id)) {
    throw invalidProductApiResponse();
  }

  return {
    apiVersion: '1.0.0',
    principal: {
      id: principal.id,
      actor: {
        type: principal.actor.type as 'user' | 'service',
        id: principal.actor.id,
      },
      authenticationMethod: principal.authenticationMethod as 'session' | 'development',
    },
    activeProject: { id: activeProject.id },
    accessibleProjects: projects,
    session: { expiresAt: session.expiresAt },
  };
};

export const decodeSessionEnvelope = (value: unknown): ProductSessionView => {
  if (!isRecord(value)) throw invalidProductApiResponse();
  return decodeProductSessionView(value.session);
};

export const decodeCsrfEnvelope = (value: unknown): string => {
  if (!isRecord(value) || !nonEmptyString(value.csrfToken)) throw invalidProductApiResponse();
  return value.csrfToken;
};

export const decodeProductApiErrorBody = (value: unknown): ProductApiErrorBody | undefined =>
  decodeProductFailureEnvelope(value);

export const decodeLogoutEnvelope = (value: unknown): void => {
  if (!isRecord(value) || value.message !== 'Logged out') throw invalidProductApiResponse();
};
