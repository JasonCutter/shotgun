import type { FastifyInstance } from 'fastify';
import type { SurferApplicationReadPort } from '../../../../packages/contracts/src/surfer-application.js';
import type { SecurityHeaders } from '../server.js';
import { ShotgunError } from '../../../../packages/contracts/src/errors.js';
/** Browser actor is derived on the server; request bodies contain only bounded typed questions. */
export function registerSurferRoutes(
  server: FastifyInstance,
  runtime: SurferApplicationReadPort,
  requireSession: (
    headers: SecurityHeaders,
  ) => Promise<{ context: { projectId: string }; sessionToken: string }>,
) {
  if (runtime.executionReadiness)
    server.post<{ Headers: SecurityHeaders }>(
      '/api/v1/surfer/execution/readiness',
      { bodyLimit: 1024 },
      async (request) => {
        const current = await requireSession(request.headers);
        return runtime.executionReadiness!(
          { projectId: current.context.projectId, sessionToken: current.sessionToken },
          request.body,
        );
      },
    );
  if (runtime.intakeStatus && runtime.resumeIntake) {
    for (const operation of ['status', 'resume'] as const) {
      server.post<{ Headers: SecurityHeaders }>(
        `/api/v1/surfer/intake/${operation}`,
        { bodyLimit: 2048 },
        async (request) => {
          const current = await requireSession(request.headers);
          const actor = {
            projectId: current.context.projectId,
            sessionToken: current.sessionToken,
          };
          return operation === 'status'
            ? runtime.intakeStatus!(actor, request.body)
            : runtime.resumeIntake!(actor, request.body);
        },
      );
    }
  }
  if (runtime.ruleCatalog && runtime.guidedRuleAsk) {
    server.post<{ Headers: SecurityHeaders }>(
      '/api/v1/surfer/memory/rule-catalog',
      { bodyLimit: 1024 },
      async (request) => {
        const current = await requireSession(request.headers);
        if (
          !request.body ||
          typeof request.body !== 'object' ||
          Array.isArray(request.body) ||
          Object.keys(request.body).length
        )
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'Catalog accepts an empty request only.',
            module: 'surfer.application',
            operation: 'rule-catalog',
          });
        return runtime.ruleCatalog!({
          projectId: current.context.projectId,
          sessionToken: current.sessionToken,
        });
      },
    );
    server.post<{ Headers: SecurityHeaders }>(
      '/api/v1/surfer/memory/guided-rule-ask',
      { bodyLimit: 262144 },
      async (request) => {
        const current = await requireSession(request.headers);
        return runtime.guidedRuleAsk!(
          { projectId: current.context.projectId, sessionToken: current.sessionToken },
          request.body,
        );
      },
    );
  }
  if (runtime.catalog && runtime.guidedAsk) {
    server.post<{ Headers: SecurityHeaders }>(
      '/api/v1/surfer/memory/catalog',
      { bodyLimit: 1024 },
      async (request) => {
        const current = await requireSession(request.headers);
        if (
          !request.body ||
          typeof request.body !== 'object' ||
          Array.isArray(request.body) ||
          Object.keys(request.body).length
        ) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'Catalog accepts an empty request only.',
            module: 'surfer.application',
            operation: 'catalog',
          });
        }
        return runtime.catalog!({
          projectId: current.context.projectId,
          sessionToken: current.sessionToken,
        });
      },
    );
    server.post<{ Headers: SecurityHeaders }>(
      '/api/v1/surfer/memory/guided-ask',
      { bodyLimit: 262144 },
      async (request) => {
        const current = await requireSession(request.headers);
        return runtime.guidedAsk!(
          { projectId: current.context.projectId, sessionToken: current.sessionToken },
          request.body,
        );
      },
    );
  }
  server.post<{ Headers: SecurityHeaders }>(
    '/api/v1/surfer/memory/ask',
    { bodyLimit: 262144 },
    async (request) => {
      const current = await requireSession(request.headers);
      return runtime.ask(
        { projectId: current.context.projectId, sessionToken: current.sessionToken },
        request.body,
      );
    },
  );
}
