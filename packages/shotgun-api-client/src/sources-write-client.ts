import {
  SOURCES_FRONTEND_COMMAND_TYPES,
  decodeAnyFrontendCommandOutcomeView,
  decodeIntakeSubmissionSnapshot,
  decodeSourcesStagingReceipt,
  type ExactDuplicateDisposition,
  type IntakeSubmissionSnapshot,
  type SourcesStagingReceipt,
  type StagedSourcesIntakeInput,
} from '../../contracts/src/index.js';
import type {
  FrontendCommandMutationResponse,
  FrontendCommandSubmission,
  RequestOptions,
} from './contracts.js';

export type SourcesWriteFetch = typeof fetch;

export type SourcesWriteClient = {
  stageBytes(
    input: {
      readonly draftId: string;
      readonly itemId: string;
      readonly kind: 'DIRECT_TEXT' | 'FILE';
      readonly label: string;
      readonly mediaType: 'text/plain' | 'text/markdown';
      readonly fileName?: string;
      readonly bytes: Uint8Array;
    },
    options?: RequestOptions,
  ): Promise<SourcesStagingReceipt>;
  stageUrl(
    input: {
      readonly draftId: string;
      readonly itemId: string;
      readonly label: string;
      readonly requestedUrl: string;
    },
    options?: RequestOptions,
  ): Promise<SourcesStagingReceipt>;
  submit(
    input: FrontendCommandSubmission & {
      readonly draftId: string;
      readonly inputs: readonly StagedSourcesIntakeInput[];
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<IntakeSubmissionSnapshot>>;
  resolveDuplicate(
    input: FrontendCommandSubmission & {
      readonly decisionId: string;
      readonly disposition: ExactDuplicateDisposition;
      readonly targetSourceId?: string;
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<IntakeSubmissionSnapshot>>;
  cancel(
    input: FrontendCommandSubmission & { readonly submissionId: string },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<IntakeSubmissionSnapshot>>;
  retry(
    input: FrontendCommandSubmission & {
      readonly submissionId: string;
      readonly itemIds: readonly string[];
      readonly mode: 'SAME_CONTEXT' | 'CURRENT_POLICY';
    },
    options?: RequestOptions,
  ): Promise<FrontendCommandMutationResponse<IntakeSubmissionSnapshot>>;
};

const commandRequest = (input: {
  readonly commandType: string;
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly clientIssuedAt?: string;
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
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions: [],
  clientIssuedAt: input.clientIssuedAt ?? new Date().toISOString(),
  payload: input.payload,
});

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const failure = body['failure'];
    const message =
      typeof failure === 'object' && failure !== null && 'message' in failure
        ? String((failure as { message: unknown }).message)
        : `Sources request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
};

export const createSourcesWriteClient = (
  fetchImpl: SourcesWriteFetch = fetch,
  productBase = '/product-api/frontend',
): SourcesWriteClient => {
  let csrfToken: string | undefined;
  const csrf = async (signal?: AbortSignal): Promise<string> => {
    if (csrfToken) return csrfToken;
    const response = await fetchImpl('/api/v1/security/csrf', {
      credentials: 'same-origin',
      signal,
    });
    const body = await readJson(response);
    const token = body['csrfToken'];
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('The CSRF token response is invalid.');
    }
    csrfToken = token;
    return token;
  };

  const mutateJson = async (
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    const token = await csrf(signal);
    let response = await fetchImpl(`${productBase}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 403) {
      csrfToken = undefined;
      response = await fetchImpl(`${productBase}${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf(signal) },
        body: JSON.stringify(body),
        signal,
      });
    }
    return readJson(response);
  };

  const mutation = async (
    path: string,
    request: unknown,
    signal?: AbortSignal,
  ): Promise<FrontendCommandMutationResponse<IntakeSubmissionSnapshot>> => {
    const body = await mutateJson(path, request, signal);
    return {
      outcome: decodeAnyFrontendCommandOutcomeView(body['outcome']),
      resource: decodeIntakeSubmissionSnapshot(body['submission']),
    };
  };

  return {
    async stageBytes(input, options) {
      const parameters = new URLSearchParams({
        draftId: input.draftId,
        itemId: input.itemId,
        kind: input.kind,
        label: input.label,
        mediaType: input.mediaType,
      });
      if (input.fileName !== undefined) parameters.set('fileName', input.fileName);
      const token = await csrf(options?.signal);
      const bodyBytes = new Uint8Array(input.bytes.byteLength);
      bodyBytes.set(input.bytes);
      const response = await fetchImpl(
        `${productBase}/sources/staging/bytes?${parameters.toString()}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'content-type': 'application/octet-stream',
            'x-csrf-token': token,
          },
          body: bodyBytes.buffer,
          signal: options?.signal,
        },
      );
      const body = await readJson(response);
      return decodeSourcesStagingReceipt(body['receipt']);
    },

    async stageUrl(input, options) {
      const body = await mutateJson('/sources/staging/url', input, options?.signal);
      return decodeSourcesStagingReceipt(body['receipt']);
    },

    submit(input, options) {
      return mutation(
        '/sources/submissions',
        commandRequest({
          ...input,
          commandType: SOURCES_FRONTEND_COMMAND_TYPES.submit,
          payload: { draftId: input.draftId, inputs: input.inputs },
        }),
        options?.signal,
      );
    },

    resolveDuplicate(input, options) {
      return mutation(
        '/sources/duplicate-decisions/resolve',
        commandRequest({
          ...input,
          commandType: SOURCES_FRONTEND_COMMAND_TYPES.resolveDuplicate,
          payload: {
            decisionId: input.decisionId,
            disposition: input.disposition,
            ...(input.targetSourceId === undefined
              ? {}
              : { targetSourceId: input.targetSourceId }),
          },
        }),
        options?.signal,
      );
    },

    cancel(input, options) {
      return mutation(
        '/sources/submissions/cancel',
        commandRequest({
          ...input,
          commandType: SOURCES_FRONTEND_COMMAND_TYPES.cancel,
          payload: { submissionId: input.submissionId },
        }),
        options?.signal,
      );
    },

    retry(input, options) {
      return mutation(
        '/sources/submissions/retry',
        commandRequest({
          ...input,
          commandType: SOURCES_FRONTEND_COMMAND_TYPES.retry,
          payload: {
            submissionId: input.submissionId,
            itemIds: input.itemIds,
            mode: input.mode,
          },
        }),
        options?.signal,
      );
    },
  };
};
