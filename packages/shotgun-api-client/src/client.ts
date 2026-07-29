import type {
  ProductSessionView,
  RequestOptions,
  ProductFeatureView,
  ShotgunApiClient,
  FrontendCommandMutationResponse,
} from './contracts.js';
import { createCsrfMutationManager } from './csrf-manager.js';
import {
  decodeCsrfEnvelope,
  decodeLogoutEnvelope,
  decodeProductApiErrorBody,
  decodeSessionEnvelope,
} from './decode.js';
import {
  ShotgunApiError,
  outcomeIndeterminateApiError,
  productFailureApiError,
  remoteUnclassifiedProductApiFailure,
} from './errors.js';
import {
  decodeSettingsSnapshot,
  decodeSettingsCategorySummary,
  decodePrincipalPreferences,
  decodeSettingsValidationResult,
  decodeSettingsImpactPreview,
  decodeSettingsCommandResult,
  decodeProjectListItemView,
  decodeProductFeatureView,
  decodeFrontendCommandOutcomeView,
  decodeModelDescriptorView,
  decodeCostBudgetView,
  decodePrivacyRetentionView,
  decodeConnectorSettingsView,
  decodeDirectiveProposalView,
  decodeSchemaPackView,
  decodeDiagnosticsView,
  decodeAnyFrontendCommandOutcomeView,
  decodeGlobalSearchResultView,
  decodeGlobalShellView,
  decodeHomeActionCenterView,
  decodeRouteGuardDecisionView,
  SECTION2_FRONTEND_COMMAND_TYPES,
  type SettingsSnapshot,
  type SettingsCategorySummary,
  type SettingsValidationResult,
  type SettingsImpactPreview,
  type SettingsCommandResult,
  type ProjectListItemView,
  type ModelDescriptorView,
  type CostBudgetView,
  type PrivacyRetentionView,
  type ConnectorSettingsView,
  type DirectiveProposalView,
  type SchemaPackView,
  type DiagnosticsView,
  type GlobalSearchRequest,
  type GlobalSearchResultView,
  type GlobalShellView,
  type HomeActionCenterView,
  type RouteGuardDecisionView,
  type TargetRouteView,
} from '../../contracts/src/index.js';

const createCommandRequest = (input: {
  readonly commandType: string;
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly resourceProjectId?: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly clientIssuedAt?: string;
  readonly observedPolicyContextRevision?: number;
  readonly preconditions: readonly {
    readonly purpose: 'TARGET' | 'POLICY';
    readonly subject: { readonly resourceKind: string; readonly resourceId: string };
    readonly expectedRevision: string;
  }[];
  readonly payload: Record<string, unknown>;
}) => ({
  envelopeVersion: '1.0.0',
  commandType: input.commandType,
  commandSchemaVersion: '1.0.0',
  clientRequestId: input.clientRequestId,
  idempotencyKey: input.idempotencyKey,
  projectContext: {
    activeProjectId: input.activeProjectId,
    targetProjectId: input.targetProjectId,
    ...(input.resourceProjectId ? { resourceProjectId: input.resourceProjectId } : {}),
  },
  policyBinding: {
    mode: 'CURRENT',
    ...(input.observedPolicyContextRevision === undefined
      ? {}
      : { observedPolicyContextRevision: String(input.observedPolicyContextRevision) }),
  },
  preconditions: input.preconditions,
  clientIssuedAt: input.clientIssuedAt ?? new Date().toISOString(),
  payload: input.payload,
});

const apiPath = (path: string): string => `/api/v1${path}`;

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const assertOk = async (response: Response): Promise<unknown> => {
  const body = await readJson(response);
  if (response.ok) return body;
  const failure = decodeProductApiErrorBody(body);
  if (!failure) throw remoteUnclassifiedProductApiFailure(response.status);
  throw productFailureApiError(response.status, failure);
};

const decodeMeasured = <T>(metric: string, decode: () => T): T => {
  const performanceMetricsEnabled =
    (
      globalThis as typeof globalThis & {
        __SHOTGUN_PERFORMANCE_METRICS__?: boolean;
      }
    ).__SHOTGUN_PERFORMANCE_METRICS__ === true;
  if (!performanceMetricsEnabled || typeof globalThis.performance === 'undefined') {
    return decode();
  }
  const startedAt = globalThis.performance.now();
  try {
    return decode();
  } finally {
    globalThis.performance.measure(`shotgun:decode:${metric}`, {
      start: startedAt,
      end: globalThis.performance.now(),
    });
  }
};

export const createShotgunApiClient = (
  options: {
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): ShotgunApiClient => {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  const request = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImplementation(apiPath(path), {
      ...init,
      credentials: 'same-origin',
    });
  const productRequest = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImplementation(`/product-api/frontend${path}`, {
      ...init,
      credentials: 'same-origin',
    });

  const csrf = createCsrfMutationManager();

  const runMutation = async <T>(
    signal: AbortSignal | undefined,
    mutation: (csrfToken: string) => Promise<T>,
  ): Promise<T> =>
    csrf.run(async () => {
      const response = await request('/security/csrf', { signal });
      return decodeCsrfEnvelope(await assertOk(response));
    }, mutation);

  const runCommandMutation = async <T>(
    signal: AbortSignal | undefined,
    clientRequestId: string,
    mutation: (csrfToken: string) => Promise<T>,
  ): Promise<T> =>
    runMutation(signal, async (csrfToken) => {
      try {
        return await mutation(csrfToken);
      } catch (error) {
        if (error instanceof ShotgunApiError) throw error;
        throw outcomeIndeterminateApiError(clientRequestId);
      }
    });

  return {
    async bootstrapLocalOwner(requestOptions?: RequestOptions): Promise<ProductSessionView> {
      const response = await request('/session/local-bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
        signal: requestOptions?.signal,
      });
      return decodeSessionEnvelope(await assertOk(response));
    },

    async getSession(requestOptions?: RequestOptions): Promise<ProductSessionView> {
      const response = await request('/session', { signal: requestOptions?.signal });
      return decodeSessionEnvelope(await assertOk(response));
    },

    async switchActiveProject(
      projectId: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductSessionView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/session/active-project', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ projectId }),
          signal: requestOptions?.signal,
        });
        return decodeSessionEnvelope(await assertOk(response));
      });
    },

    async logout(requestOptions?: RequestOptions): Promise<void> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/session/logout', {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken },
          signal: requestOptions?.signal,
        });
        decodeLogoutEnvelope(await assertOk(response));
      });
    },

    async getGlobalShell(requestOptions?: RequestOptions): Promise<GlobalShellView> {
      const response = await productRequest('/global-shell', {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { shell: unknown };
      return decodeMeasured('global-shell', () => decodeGlobalShellView(body.shell));
    },

    async getHomeActionCenter(requestOptions?: RequestOptions): Promise<HomeActionCenterView> {
      const response = await productRequest('/home', {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { home: unknown };
      return decodeMeasured('home', () => decodeHomeActionCenterView(body.home));
    },

    async searchGlobal(
      searchRequest: GlobalSearchRequest,
      requestOptions?: RequestOptions,
    ): Promise<GlobalSearchResultView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await productRequest('/search/query', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(searchRequest),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { result: unknown };
        return decodeMeasured('search', () => decodeGlobalSearchResultView(body.result));
      });
    },

    async getRouteGuardDecision(
      targetRoute: TargetRouteView,
      resourceProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<RouteGuardDecisionView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await productRequest('/route-guard', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            targetRoute,
            ...(resourceProjectId === undefined ? {} : { resourceProjectId }),
          }),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { decision: unknown };
        return decodeMeasured('route-guard', () => decodeRouteGuardDecisionView(body.decision));
      });
    },

    async createFirstProject(
      params: {
        name: string;
        description?: string;
        locale?: string;
        timezone?: string;
        privacyProfile?: string;
        modelProfile?: string;
        costProfile?: string;
        projectAccessRevision: string;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<ProjectListItemView>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request('/projects', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify({
              envelopeVersion: '2.0.0',
              commandType: 'project.create.v1',
              commandSchemaVersion: '1.0.0',
              clientRequestId: params.clientRequestId,
              idempotencyKey: params.idempotencyKey,
              projectContext: {
                scope: 'PRINCIPAL',
                observedProjectAccessRevision: params.projectAccessRevision,
              },
              policyBinding: { mode: 'CURRENT' },
              preconditions: [],
              clientIssuedAt: params.clientIssuedAt ?? new Date().toISOString(),
              payload: {
                name: params.name,
                ...(params.description === undefined ? {} : { description: params.description }),
                ...(params.locale === undefined ? {} : { locale: params.locale }),
                ...(params.timezone === undefined ? {} : { timezone: params.timezone }),
                ...(params.privacyProfile === undefined
                  ? {}
                  : { privacyProfile: params.privacyProfile }),
                ...(params.modelProfile === undefined ? {} : { modelProfile: params.modelProfile }),
                ...(params.costProfile === undefined ? {} : { costProfile: params.costProfile }),
              },
            }),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as {
            outcome: unknown;
            project: unknown;
          };
          return {
            outcome: decodeAnyFrontendCommandOutcomeView(body.outcome),
            resource: decodeProjectListItemView(body.project),
          };
        },
      );
    },

    // ------------------------------------------------------------------------
    // Settings & Project Administration Client Methods
    // ------------------------------------------------------------------------

    async getSettingsSnapshot(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<SettingsSnapshot> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/snapshot${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { snapshot: unknown };
      return decodeSettingsSnapshot(body.snapshot);
    },

    async getSettingsCategories(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<readonly SettingsCategorySummary[]> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/categories${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { categories: unknown };
      return Array.isArray(body.categories)
        ? body.categories.map(decodeSettingsCategorySummary)
        : [];
    },

    async getPrincipalPreferences(
      requestOptions?: RequestOptions,
    ): Promise<{ readonly preferences: Record<string, unknown>; readonly revision: number }> {
      const response = await request('/settings/preferences', { signal: requestOptions?.signal });
      const body = (await assertOk(response)) as {
        preferences: Record<string, unknown>;
        preferenceRevision: number;
      };
      return {
        preferences: decodePrincipalPreferences(body.preferences),
        revision: body.preferenceRevision,
      };
    },

    async updatePrincipalPreferences(
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
        expectedPreferenceRevision: number;
        preferences: Record<string, unknown>;
      },
      requestOptions?: RequestOptions,
    ): Promise<
      FrontendCommandMutationResponse<{
        readonly preferences: Record<string, unknown>;
        readonly revision: number;
      }>
    > {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request('/settings/preferences', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(
              createCommandRequest({
                ...params,
                commandType: SECTION2_FRONTEND_COMMAND_TYPES.updatePreference,
                preconditions: [
                  {
                    purpose: 'TARGET',
                    subject: { resourceKind: 'principal-preferences', resourceId: 'self' },
                    expectedRevision: String(params.expectedPreferenceRevision),
                  },
                ],
                payload: { preferences: params.preferences },
              }),
            ),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as {
            outcome: unknown;
            preferences: Record<string, unknown>;
            preferenceRevision: number;
          };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: {
              preferences: decodePrincipalPreferences(body.preferences),
              revision: body.preferenceRevision,
            },
          };
        },
      );
    },

    async validateSettingsDraft(
      draft: Record<string, unknown>,
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<SettingsValidationResult> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/settings/validate', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({ targetProjectId, draft }),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { validation: unknown };
        return decodeSettingsValidationResult(body.validation);
      });
    },

    async previewSettingsImpact(
      expectedSettingsRevision: number,
      observedPolicyContextRevision: number,
      draft: Record<string, unknown>,
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<SettingsImpactPreview> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/settings/impact', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify({
            targetProjectId,
            expectedSettingsRevision,
            observedPolicyContextRevision,
            draft,
          }),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { impact: unknown };
        return decodeSettingsImpactPreview(body.impact);
      });
    },

    async applySettingsCommand(
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
        expectedSettingsRevision: number;
        observedPolicyContextRevision: number;
        settings: Record<string, unknown>;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<SettingsCommandResult>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request('/settings/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(
              createCommandRequest({
                ...params,
                commandType: SECTION2_FRONTEND_COMMAND_TYPES.applyProjectPolicy,
                observedPolicyContextRevision: params.observedPolicyContextRevision,
                preconditions: [
                  {
                    purpose: 'TARGET',
                    subject: {
                      resourceKind: 'project-settings',
                      resourceId: params.targetProjectId,
                    },
                    expectedRevision: String(params.expectedSettingsRevision),
                  },
                  {
                    purpose: 'POLICY',
                    subject: {
                      resourceKind: 'project-policy-context',
                      resourceId: params.targetProjectId,
                    },
                    expectedRevision: String(params.observedPolicyContextRevision),
                  },
                ],
                payload: { settings: params.settings },
              }),
            ),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as { outcome: unknown; result: unknown };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: decodeSettingsCommandResult(body.result),
          };
        },
      );
    },

    async getFrontendCommandOutcomeByClientRequestId(
      clientRequestId: string,
      requestOptions?: RequestOptions,
    ) {
      const response = await request(
        `/frontend-commands/by-client-request/${encodeURIComponent(clientRequestId)}`,
        { signal: requestOptions?.signal },
      );
      const body = (await assertOk(response)) as { outcome: unknown };
      return decodeFrontendCommandOutcomeView(body.outcome);
    },

    async getSettingsCommandStatus(
      commandId: string,
      requestOptions?: RequestOptions,
    ): Promise<SettingsCommandResult> {
      const response = await request(`/settings/commands/${encodeURIComponent(commandId)}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { result: unknown };
      return decodeSettingsCommandResult(body.result);
    },

    async getProjects(requestOptions?: RequestOptions): Promise<readonly ProjectListItemView[]> {
      const response = await request('/projects', { signal: requestOptions?.signal });
      const body = (await assertOk(response)) as { projects: unknown[] };
      return Array.isArray(body.projects) ? body.projects.map(decodeProjectListItemView) : [];
    },

    async getProjectDetails(
      projectId: string,
      requestOptions?: RequestOptions,
    ): Promise<ProjectListItemView> {
      const response = await request(`/projects/${encodeURIComponent(projectId)}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { project: unknown };
      return decodeProjectListItemView(body.project);
    },

    async createProject(
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        id: string;
        name: string;
        description?: string;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<ProjectListItemView>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request('/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(
              createCommandRequest({
                ...params,
                commandType: SECTION2_FRONTEND_COMMAND_TYPES.createProject,
                preconditions: [],
                payload: {
                  newProjectId: params.id,
                  name: params.name,
                  ...(params.description === undefined ? {} : { description: params.description }),
                },
              }),
            ),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as { outcome: unknown; project: unknown };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: decodeProjectListItemView(body.project),
          };
        },
      );
    },

    async updateProject(
      projectId: string,
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        name?: string;
        description?: string;
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<ProjectListItemView>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request(`/projects/${encodeURIComponent(projectId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(
              createCommandRequest({
                ...params,
                commandType: SECTION2_FRONTEND_COMMAND_TYPES.updateProjectMetadata,
                preconditions: [
                  {
                    purpose: 'TARGET',
                    subject: { resourceKind: 'project', resourceId: projectId },
                    expectedRevision: String(params.expectedRevision),
                  },
                ],
                payload: {
                  ...(params.name === undefined ? {} : { name: params.name }),
                  ...(params.description === undefined ? {} : { description: params.description }),
                },
              }),
            ),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as { outcome: unknown; project: unknown };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: decodeProjectListItemView(body.project),
          };
        },
      );
    },

    async archiveProject(
      projectId: string,
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<ProjectListItemView>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request(`/projects/${encodeURIComponent(projectId)}/archive`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(
              createCommandRequest({
                ...params,
                commandType: SECTION2_FRONTEND_COMMAND_TYPES.archiveProject,
                preconditions: [
                  {
                    purpose: 'TARGET',
                    subject: { resourceKind: 'project', resourceId: projectId },
                    expectedRevision: String(params.expectedRevision),
                  },
                ],
                payload: {},
              }),
            ),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as { outcome: unknown; project: unknown };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: decodeProjectListItemView(body.project),
          };
        },
      );
    },

    async restoreProject(
      projectId: string,
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<ProjectListItemView>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request(`/projects/${encodeURIComponent(projectId)}/restore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(
              createCommandRequest({
                ...params,
                commandType: SECTION2_FRONTEND_COMMAND_TYPES.restoreProject,
                preconditions: [
                  {
                    purpose: 'TARGET',
                    subject: { resourceKind: 'project', resourceId: projectId },
                    expectedRevision: String(params.expectedRevision),
                  },
                ],
                payload: {},
              }),
            ),
            signal: requestOptions?.signal,
          });
          const body = (await assertOk(response)) as { outcome: unknown; project: unknown };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: decodeProjectListItemView(body.project),
          };
        },
      );
    },

    async requestDeleteProject(
      projectId: string,
      params: {
        activeProjectId: string;
        targetProjectId: string;
        resourceProjectId?: string;
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
        clientIssuedAt?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<FrontendCommandMutationResponse<ProjectListItemView>> {
      return runCommandMutation(
        requestOptions?.signal,
        params.clientRequestId,
        async (csrfToken) => {
          const response = await request(
            `/projects/${encodeURIComponent(projectId)}/delete-request`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
              body: JSON.stringify(
                createCommandRequest({
                  ...params,
                  commandType: SECTION2_FRONTEND_COMMAND_TYPES.requestProjectDeletion,
                  preconditions: [
                    {
                      purpose: 'TARGET',
                      subject: { resourceKind: 'project', resourceId: projectId },
                      expectedRevision: String(params.expectedRevision),
                    },
                  ],
                  payload: {},
                }),
              ),
              signal: requestOptions?.signal,
            },
          );
          const body = (await assertOk(response)) as { outcome: unknown; project: unknown };
          return {
            outcome: decodeFrontendCommandOutcomeView(body.outcome),
            resource: decodeProjectListItemView(body.project),
          };
        },
      );
    },

    async getModelDescriptors(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<readonly ModelDescriptorView[]>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/models${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { models: unknown };
      return decodeProductFeatureView(body.models, (x) =>
        Array.isArray(x) ? x.map(decodeModelDescriptorView) : [],
      );
    },

    async getCostBudget(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<CostBudgetView>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/costs${query}`, { signal: requestOptions?.signal });
      const body = (await assertOk(response)) as { costs: unknown };
      return decodeProductFeatureView(body.costs, decodeCostBudgetView);
    },

    async getPrivacyRetention(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<PrivacyRetentionView>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/privacy${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { privacy: unknown };
      return decodeProductFeatureView(body.privacy, decodePrivacyRetentionView);
    },

    async getConnectorSettings(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<readonly ConnectorSettingsView[]>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/connectors${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { connectors: unknown };
      return decodeProductFeatureView(body.connectors, (x) =>
        Array.isArray(x) ? x.map(decodeConnectorSettingsView) : [],
      );
    },

    async getDirectiveProposals(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<readonly DirectiveProposalView[]>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/directives${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { proposals: unknown };
      return decodeProductFeatureView(body.proposals, (x) =>
        Array.isArray(x) ? x.map(decodeDirectiveProposalView) : [],
      );
    },

    async getSchemaPacks(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<readonly SchemaPackView[]>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/schema${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { schemaPacks: unknown };
      return decodeProductFeatureView(body.schemaPacks, (x) =>
        Array.isArray(x) ? x.map(decodeSchemaPackView) : [],
      );
    },

    async getDiagnostics(
      targetProjectId?: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductFeatureView<DiagnosticsView>> {
      const query = targetProjectId
        ? `?targetProjectId=${encodeURIComponent(targetProjectId)}`
        : '';
      const response = await request(`/settings/diagnostics${query}`, {
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { diagnostics: unknown };
      return decodeProductFeatureView(body.diagnostics, decodeDiagnosticsView);
    },
  };
};
