import { type AnyEnvelope, ShotgunError } from '../../contracts/src/index.js';
import type { RequiredSecurityContext } from '../../module-sdk/src/index.js';

export const assertSecurityContext = (
  envelope: AnyEnvelope,
  requiredContext: readonly RequiredSecurityContext[],
  requiredAccessScopes: readonly string[] = [],
): void => {
  const missing = requiredContext.filter((field) => {
    if (field === 'actor') {
      return !envelope.actor;
    }
    if (field === 'project') {
      return !envelope.projectId;
    }
    if (field === 'access_scope') {
      return !envelope.security?.accessScope.length;
    }
    return !envelope.security?.sensitivity;
  });

  if (missing.length > 0) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: `Required security context is missing: ${missing.join(', ')}.`,
      module: 'policy',
      operation: 'authorize-message',
      correlationId: envelope.correlationId,
    });
  }

  const actualScopes = new Set(envelope.security?.accessScope ?? []);
  const deniedScopes = requiredAccessScopes.filter((scope) => !actualScopes.has(scope));
  if (deniedScopes.length > 0) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: `Required access scope is missing: ${deniedScopes.join(', ')}.`,
      module: 'policy',
      operation: 'authorize-message',
      correlationId: envelope.correlationId,
    });
  }
};
