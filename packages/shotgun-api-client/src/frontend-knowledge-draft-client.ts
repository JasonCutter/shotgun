import { FrontendContractError } from '../../contracts/src/index.js';
import {
  decodeGenerateKnowledgeDraftImpactResultV1,
  decodeMaterializeDraftResultV1,
  decodeReadKnowledgeDraftResultV1,
  decodeResolveKnowledgeDraftCommandOutcomeResultV1,
  decodeSaveKnowledgeDraftResultV1,
  decodeSubmitKnowledgeDraftForReviewResultV1,
  decodeValidateKnowledgeDraftResultV1,
  frontendKnowledgeDraftAbandonDigest,
  frontendKnowledgeDraftMaterializeDigest,
  frontendKnowledgeDraftRevisionDigest,
  frontendKnowledgeDraftSaveDigest,
  frontendKnowledgeDraftStartSeedlessDigest,
  type AbandonKnowledgeDraftRequestV1,
  type GenerateKnowledgeDraftImpactRequestV1,
  type GenerateKnowledgeDraftImpactResultV1,
  type MaterializeDraftRequestV1,
  type MaterializeDraftResultV1,
  type ReadKnowledgeDraftRequestV1,
  type ReadKnowledgeDraftResultV1,
  type ResolveKnowledgeDraftCommandOutcomeRequestV1,
  type ResolveKnowledgeDraftCommandOutcomeResultV1,
  type SaveKnowledgeDraftRequestV1,
  type SaveKnowledgeDraftResultV1,
  type StartSeedlessDraftRequestV1,
  type StartSeedlessDraftResultV1,
  type SubmitKnowledgeDraftForReviewRequestV1,
  type SubmitKnowledgeDraftForReviewResultV1,
  type ValidateKnowledgeDraftRequestV1,
  type ValidateKnowledgeDraftResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';

// The shared per-command semantic digests and the revision content digest are
// re-exported here so the browser Draft State Machine computes exactly the
// same digests the server validates.
export {
  frontendKnowledgeDraftAbandonDigest,
  frontendKnowledgeDraftMaterializeDigest,
  frontendKnowledgeDraftRevisionDigest,
  frontendKnowledgeDraftSaveDigest,
  frontendKnowledgeDraftStartSeedlessDigest,
};

export type FrontendKnowledgeDraftClient = {
  readDraft(
    params: ReadKnowledgeDraftRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadKnowledgeDraftResultV1>;
  materializeDraft(
    params: MaterializeDraftRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<MaterializeDraftResultV1>;
  startSeedlessDraft(
    params: StartSeedlessDraftRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StartSeedlessDraftResultV1>;
  saveDraft(
    params: SaveKnowledgeDraftRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SaveKnowledgeDraftResultV1>;
  abandonDraft(
    params: AbandonKnowledgeDraftRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<MaterializeDraftResultV1>;
  validateDraft(
    params: ValidateKnowledgeDraftRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ValidateKnowledgeDraftResultV1>;
  generateImpactPreview(
    params: GenerateKnowledgeDraftImpactRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateKnowledgeDraftImpactResultV1>;
  submitDraftForReview(
    params: SubmitKnowledgeDraftForReviewRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SubmitKnowledgeDraftForReviewResultV1>;
  resolveCommandOutcome(
    params: ResolveKnowledgeDraftCommandOutcomeRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ResolveKnowledgeDraftCommandOutcomeResultV1>;
};

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

const identityMismatch = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

/**
 * Typed FE-P3-S2 Knowledge Draft client. Mirrors the Ask workspace client:
 * same-origin credentials, shared CSRF coordination with a single retry only
 * for REQUEST_ORIGIN_DENIED, and
 * strict decoding of every response. The server Draft is always authoritative;
 * this client never merges or refreshes a Draft automatically.
 */
export const createFrontendKnowledgeDraftClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendKnowledgeDraftClient => {
  const request = options.fetch ?? globalThis.fetch;
  const csrf = getSharedCsrfMutationManager(request);

  const mutate = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> => {
    return csrf.run(
      (token) =>
        request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          credentials: 'same-origin',
          body: JSON.stringify(params),
          signal,
        }),
      { signal, recoverOnResponse: isCsrfFailureResponse },
    );
  };

  return {
    async readDraft(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeReadKnowledgeDraftResultV1(body);
      if (result.draft.draftId !== params.draftId) {
        identityMismatch('Read result does not match the requested Draft.');
      }
      return result;
    },
    async materializeDraft(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/materialize',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeMaterializeDraftResultV1(body);
      if (result.draft.seedId !== params.seedId) {
        identityMismatch('Materialize result does not match the requested Seed.');
      }
      return result;
    },
    async startSeedlessDraft(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/start-seedless',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeMaterializeDraftResultV1(body);
      if (params.resourceId !== undefined && result.draft.resourceId !== params.resourceId) {
        identityMismatch('Seedless start result does not match the requested Resource.');
      }
      return result;
    },
    async saveDraft(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/save',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeSaveKnowledgeDraftResultV1(body);
      if (result.draft.draftId !== params.draftId) {
        identityMismatch('Save result does not match the requested Draft.');
      }
      return result;
    },
    async abandonDraft(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/abandon',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeMaterializeDraftResultV1(body);
      if (result.draft.draftId !== params.draftId) {
        identityMismatch('Abandon result does not match the requested Draft.');
      }
      return result;
    },
    async validateDraft(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/validate',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeValidateKnowledgeDraftResultV1(body);
    },
    async generateImpactPreview(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/impact-preview',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeGenerateKnowledgeDraftImpactResultV1(body);
    },
    async submitDraftForReview(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/submit-review',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeSubmitKnowledgeDraftForReviewResultV1(body);
    },
    async resolveCommandOutcome(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/knowledge/drafts/resolve-outcome',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeResolveKnowledgeDraftCommandOutcomeResultV1(body);
    },
  };
};
