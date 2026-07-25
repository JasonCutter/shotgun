import type {
  ProductSessionView,
  RequestOptions,
  ProductFeatureView,
  ShotgunApiClient,
} from './contracts.js';
import { createCsrfMutationManager } from './csrf-manager.js';
import {
  decodeCsrfEnvelope,
  decodeLogoutEnvelope,
  decodeProductApiErrorBody,
  decodeSessionEnvelope,
} from './decode.js';
import { ShotgunApiError } from './errors.js';
import {
  decodeSettingsSnapshot,
  decodeSettingsValidationResult,
  decodeSettingsImpactPreview,
  decodeSettingsCommandResult,
  decodeProjectListItemView,
  decodeProductFeatureView,
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
} from '../../contracts/src/index.js';

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
  const error = decodeProductApiErrorBody(body);
  throw new ShotgunApiError({
    status: response.status,
    code: error?.code ?? 'REQUEST_FAILED',
    message: error?.message ?? 'Request failed.',
    ...(error?.correlationId === undefined ? {} : { correlationId: error.correlationId }),
  });
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

  const csrf = createCsrfMutationManager();

  const runMutation = async <T>(
    signal: AbortSignal | undefined,
    mutation: (csrfToken: string) => Promise<T>,
  ): Promise<T> =>
    csrf.run(async () => {
      const response = await request('/security/csrf', { signal });
      return decodeCsrfEnvelope(await assertOk(response));
    }, mutation);

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
      const body = (await assertOk(response)) as { categories: readonly SettingsCategorySummary[] };
      return body.categories;
    },

    async getPrincipalPreferences(
      requestOptions?: RequestOptions,
    ): Promise<Record<string, unknown>> {
      const response = await request('/settings/preferences', { signal: requestOptions?.signal });
      const body = (await assertOk(response)) as { preferences: Record<string, unknown> };
      return body.preferences;
    },

    async updatePrincipalPreferences(
      params: {
        commandId: string;
        clientRequestId: string;
        idempotencyKey: string;
        expectedPreferenceRevision: number;
        preferences: Record<string, unknown>;
      },
      requestOptions?: RequestOptions,
    ): Promise<Record<string, unknown>> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/settings/preferences', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(params),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { preferences: Record<string, unknown> };
        return body.preferences;
      });
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
        commandId: string;
        clientRequestId: string;
        idempotencyKey: string;
        expectedSettingsRevision: number;
        observedPolicyContextRevision: number;
        settings: Record<string, unknown>;
        targetProjectId?: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<SettingsCommandResult> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/settings/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(params),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { result: unknown };
        return decodeSettingsCommandResult(body.result);
      });
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
        id: string;
        name: string;
        description?: string;
        clientRequestId: string;
        idempotencyKey: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<ProjectListItemView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(params),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { project: unknown };
        return decodeProjectListItemView(body.project);
      });
    },

    async updateProject(
      projectId: string,
      params: {
        name?: string;
        description?: string;
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<ProjectListItemView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request(`/projects/${encodeURIComponent(projectId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(params),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { project: unknown };
        return decodeProjectListItemView(body.project);
      });
    },

    async archiveProject(
      projectId: string,
      params: {
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<ProjectListItemView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request(`/projects/${encodeURIComponent(projectId)}/archive`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(params),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { project: unknown };
        return decodeProjectListItemView(body.project);
      });
    },

    async restoreProject(
      projectId: string,
      params: {
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<ProjectListItemView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request(`/projects/${encodeURIComponent(projectId)}/restore`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
          body: JSON.stringify(params),
          signal: requestOptions?.signal,
        });
        const body = (await assertOk(response)) as { project: unknown };
        return decodeProjectListItemView(body.project);
      });
    },

    async requestDeleteProject(
      projectId: string,
      params: {
        expectedRevision: number;
        clientRequestId: string;
        idempotencyKey: string;
      },
      requestOptions?: RequestOptions,
    ): Promise<ProjectListItemView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request(
          `/projects/${encodeURIComponent(projectId)}/delete-request`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
            body: JSON.stringify(params),
            signal: requestOptions?.signal,
          },
        );
        const body = (await assertOk(response)) as { project: unknown };
        return decodeProjectListItemView(body.project);
      });
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
      return decodeProductFeatureView(body.models, (x) => x as readonly ModelDescriptorView[]);
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
      return decodeProductFeatureView(body.costs, (x) => x as CostBudgetView);
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
      return decodeProductFeatureView(body.privacy, (x) => x as PrivacyRetentionView);
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
      return decodeProductFeatureView(
        body.connectors,
        (x) => x as readonly ConnectorSettingsView[],
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
      return decodeProductFeatureView(body.proposals, (x) => x as readonly DirectiveProposalView[]);
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
      return decodeProductFeatureView(body.schemaPacks, (x) => x as readonly SchemaPackView[]);
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
      return decodeProductFeatureView(body.diagnostics, (x) => x as DiagnosticsView);
    },
  };
};
