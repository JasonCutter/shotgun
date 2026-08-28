import {
  FrontendContractError,
  decodeGetHistoryEntryRequestV1,
  decodeHistoryCursorV1,
  decodeHistoryEntryV1,
  decodeListHistoryWorkspaceRequestV1,
  type GetHistoryEntryRequestV1,
  type GetHistoryEntryResultV1,
  type HistoryCursorV1,
  type ListHistoryWorkspaceRequestV1,
  type ListHistoryWorkspaceResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';

/**
 * FE-P5-S2 WP5 — History Workspace Product API read client.
 *
 * Typed, Project-bound, cursor-bounded reads for the federated History
 * Workspace (ADR-131 §2 / IR r1 §5 WP4). The browser never authors Principal,
 * Project, access, policy, capability or sensitivity authority — the server
 * derives every binding from the session. This client is read-only
 * (`ListHistoryWorkspace` / `GetHistoryEntry`); Reversal creation is NOT a
 * History route (it stays on the change-set-review owning route, WP3).
 *
 * READ POSTs are idempotent and safe: a CSRF refresh + single retry is allowed
 * only for the typed REQUEST_ORIGIN_DENIED failure. Every
 * response is strictly decoded.
 */

export type FrontendHistoryClient = {
  listHistoryWorkspace(
    request: ListHistoryWorkspaceRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ListHistoryWorkspaceResultV1>;
  getHistoryEntry(
    request: GetHistoryEntryRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetHistoryEntryResultV1>;
};

// --- shared response helpers ------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidHistoryResponse = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const objectField = (object: Record<string, unknown>, key: string, path: string): unknown => {
  if (!(key in object)) return invalidHistoryResponse(`History ${path}.${key} is required.`);
  return object[key];
};

const stringField = (object: Record<string, unknown>, key: string, path: string): string => {
  const value = objectField(object, key, path);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidHistoryResponse(`History ${path}.${key} must be a non-empty string.`);
  }
  return value;
};

const arrayField = (object: Record<string, unknown>, key: string, path: string): unknown[] => {
  const value = objectField(object, key, path);
  if (!Array.isArray(value)) {
    return invalidHistoryResponse(`History ${path}.${key} must be an array.`);
  }
  return value;
};

/** Strict-decode one History cursor (or undefined when absent). */
const decodeOptionalCursor = (value: unknown, path: string): HistoryCursorV1 | undefined => {
  if (value === undefined) return undefined;
  return decodeHistoryCursorV1(value, path);
};

/** Strict-decode the federated History Workspace list result. */
const decodeListResult = (value: unknown): ListHistoryWorkspaceResultV1 => {
  if (!isRecord(value)) invalidHistoryResponse('History list response must be an object.');
  const record = value as Record<string, unknown>;
  const entries = arrayField(record, 'entries', 'list').map((entry, index) =>
    decodeHistoryEntryV1(entry, `list.entries[${index}]`),
  );
  const nextCursor = decodeOptionalCursor(record['nextCursor'], 'list.nextCursor');
  return Object.freeze({
    schemaVersion: stringField(record, 'schemaVersion', 'list') as '1.0.0',
    entries: Object.freeze(entries),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
};

/** Strict-decode the History entry detail result. */
const decodeEntryResult = (value: unknown): GetHistoryEntryResultV1 => {
  if (!isRecord(value)) invalidHistoryResponse('History entry response must be an object.');
  const record = value as Record<string, unknown>;
  const entry = decodeHistoryEntryV1(objectField(record, 'entry', 'entry'), 'entry.entry');
  return Object.freeze({
    schemaVersion: stringField(record, 'schemaVersion', 'entry') as '1.0.0',
    entry,
  });
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

/**
 * FE-P5-S2 WP5 — History read client factory.
 */
export const createFrontendHistoryClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendHistoryClient => {
  const request = options.fetch ?? globalThis.fetch;
  const csrf = getSharedCsrfMutationManager(request);

  const post = (
    path: string,
    params: unknown,
    token: string,
    signal?: AbortSignal,
  ): Promise<Response> =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      credentials: 'same-origin',
      body: JSON.stringify(params),
      signal,
    });

  const read = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> => {
    return csrf.run((token) => post(path, params, token, signal), {
      signal,
      recoverOnResponse: isCsrfFailureResponse,
    });
  };

  return {
    async listHistoryWorkspace(params, requestOptions) {
      // The browser never authors the request beyond the frozen Contract: the
      // strict decoder runs before any network I/O (deny-by-default).
      decodeListHistoryWorkspaceRequestV1(params, 'listHistoryWorkspace');
      const response = await read(
        '/product-api/frontend/history/workspace',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeListResult(body);
    },

    async getHistoryEntry(params, requestOptions) {
      decodeGetHistoryEntryRequestV1(params, 'getHistoryEntry');
      const response = await read(
        '/product-api/frontend/history/entry',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeEntryResult(body);
    },
  };
};

// Re-export the decoded view/request types the browser History Workspace uses,
// so the web app never imports the module layer directly for these shapes.
export type {
  GetHistoryEntryRequestV1,
  GetHistoryEntryResultV1,
  HistoryCursorV1,
  HistoryEntryV1,
  HistorySourceDomainKindV1,
  ListHistoryWorkspaceRequestV1,
  ListHistoryWorkspaceResultV1,
  PayloadAvailabilityV1,
} from '../../contracts/src/index.js';
