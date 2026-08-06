import {
  FrontendContractError,
  decodeActivityDimensionsV1,
  decodeActivityEventViewV1,
  decodeActivityProjectionMetadataV1,
  decodeActivityRootReferenceV1,
  decodeActivitySnapshotV1,
  decodeActivityStageViewV1,
  type ActivityDomainKindV1,
  type ActivityLifecycleStateV1,
  type ActivityProjectionMetadataV1,
} from '../../contracts/src/index.js';
import type {
  ActivityAdapterKindV1,
  ActivityDetailV1,
  ActivityEventContinuationV1,
  ActivityProjectionAdapterFailureV1,
  ActivityProjectionBuildResultV1,
  ActivityQueueItemV1,
  ActivityQueuePageV1,
  ActivityStageContinuationV1,
  ActivityWatermarkRecordV1,
  GetActivityDetailRequestV1,
  ListActivityContinuationRequestV1,
  ListActivityQueueRequestV1,
  RefreshActivityProjectionRequestV1,
} from '../../../modules/frontend-activity/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';

/**
 * FE-P5-S1 WP4 — Activity Product API read client.
 *
 * Typed, Project-bound, cursor-bounded reads for the Activity Workspace. The
 * browser never authors Principal, Project, access, policy, capability or
 * sensitivity authority — the server derives every binding from the session.
 * Retry and Cancel are NOT Activity commands (WP5 keeps them on the owning
 * Domain routes); this client is read + explicit-refresh only.
 *
 * READ POSTs are idempotent and safe: a CSRF refresh + single retry on a
 * general 403 is allowed (session rotation must not break a plain read). Every
 * response is strictly decoded; a decoded Detail must echo the requested
 * Activity identity before it is trusted.
 */

export type FrontendActivityClient = {
  listActivityQueue(
    request: ListActivityQueueRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ActivityQueuePageV1>;
  getActivityDetail(
    request: GetActivityDetailRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ActivityDetailV1>;
  listActivityStages(
    request: ListActivityContinuationRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ActivityStageContinuationV1>;
  listActivityEvents(
    request: ListActivityContinuationRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ActivityEventContinuationV1>;
  refreshActivityProjection(
    request: RefreshActivityProjectionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ActivityProjectionBuildResultV1>;
};

// --- shared response helpers ------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidActivityResponse = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const objectField = (object: Record<string, unknown>, key: string, path: string): unknown => {
  if (!(key in object)) return invalidActivityResponse(`Activity ${path}.${key} is required.`);
  return object[key];
};

const stringField = (object: Record<string, unknown>, key: string, path: string): string => {
  const value = objectField(object, key, path);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidActivityResponse(`Activity ${path}.${key} must be a non-empty string.`);
  }
  return value;
};

const optionalStringField = (
  object: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined => {
  if (object[key] === undefined) return undefined;
  return stringField(object, key, path);
};

const arrayField = (object: Record<string, unknown>, key: string, path: string): unknown[] => {
  const value = objectField(object, key, path);
  if (!Array.isArray(value)) {
    return invalidActivityResponse(`Activity ${path}.${key} must be an array.`);
  }
  return value;
};

const ACTIVITY_LIFECYCLE_STATES: readonly string[] = [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_USER',
  'PARTIAL',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'OUTCOME_UNKNOWN',
];

const decodeQueueItem = (value: unknown): ActivityQueueItemV1 => {
  if (!isRecord(value)) return invalidActivityResponse('Activity queue item must be an object.');
  const state = stringField(value, 'state', 'item');
  if (!ACTIVITY_LIFECYCLE_STATES.includes(state)) {
    return invalidActivityResponse(`Activity queue item state ${state} is unsupported.`);
  }
  return {
    root: decodeActivityRootReferenceV1(objectField(value, 'root', 'item'), 'item.root'),
    summary: stringField(value, 'summary', 'item'),
    state: state as ActivityLifecycleStateV1,
    dimensions: decodeActivityDimensionsV1(
      objectField(value, 'dimensions', 'item'),
      'item.dimensions',
    ),
    updatedAt: stringField(value, 'updatedAt', 'item'),
  };
};

const decodeQueuePage = (value: unknown): ActivityQueuePageV1 => {
  if (!isRecord(value)) return invalidActivityResponse('Activity queue page must be an object.');
  const items = arrayField(value, 'items', 'queue').map((entry) => decodeQueueItem(entry));
  const metadata: ActivityProjectionMetadataV1 = decodeActivityProjectionMetadataV1(
    objectField(value, 'metadata', 'queue'),
    'queue.metadata',
  );
  const nextCursor = optionalStringField(value, 'nextCursor', 'queue');
  return {
    items,
    metadata,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
};

const decodeStageContinuation = (value: unknown): ActivityStageContinuationV1 => {
  if (!isRecord(value)) {
    return invalidActivityResponse('Activity stage continuation must be an object.');
  }
  const stages = arrayField(value, 'stages', 'stages').map((entry, index) =>
    decodeActivityStageViewV1(entry, `stages[${index}]`),
  );
  const metadata = decodeActivityProjectionMetadataV1(
    objectField(value, 'metadata', 'stages'),
    'stages.metadata',
  );
  const nextCursor = optionalStringField(value, 'nextCursor', 'stages');
  return {
    stages,
    metadata,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
};

const decodeEventContinuation = (value: unknown): ActivityEventContinuationV1 => {
  if (!isRecord(value)) {
    return invalidActivityResponse('Activity event continuation must be an object.');
  }
  const events = arrayField(value, 'events', 'events').map((entry, index) =>
    decodeActivityEventViewV1(entry, `events[${index}]`),
  );
  const metadata = decodeActivityProjectionMetadataV1(
    objectField(value, 'metadata', 'events'),
    'events.metadata',
  );
  const nextCursor = optionalStringField(value, 'nextCursor', 'events');
  return {
    events,
    metadata,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
};

const ACTIVITY_ADAPTER_STATUS: readonly string[] = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'];

const decodeBuildResult = (value: unknown): ActivityProjectionBuildResultV1 => {
  if (!isRecord(value)) {
    return invalidActivityResponse('Activity refresh result must be an object.');
  }
  const resourceProjectId = stringField(value, 'resourceProjectId', 'refresh');
  const snapshotRevisionValue = objectField(value, 'snapshotRevision', 'refresh');
  if (
    typeof snapshotRevisionValue !== 'number' ||
    !Number.isSafeInteger(snapshotRevisionValue) ||
    snapshotRevisionValue <= 0
  ) {
    return invalidActivityResponse('Activity refresh snapshotRevision must be a positive integer.');
  }
  const indexCountValue = objectField(value, 'indexCount', 'refresh');
  if (typeof indexCountValue !== 'number' || !Number.isSafeInteger(indexCountValue)) {
    return invalidActivityResponse('Activity refresh indexCount must be an integer.');
  }
  const watermarks = arrayField(value, 'watermarks', 'refresh').map((entry, index) => {
    if (!isRecord(entry)) return invalidActivityResponse(`Activity watermark ${index} invalid.`);
    const revision = objectField(entry, 'snapshotRevision', `watermarks[${index}]`);
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
      return invalidActivityResponse(`Activity watermark ${index} snapshotRevision invalid.`);
    }
    const status = stringField(entry, 'adapterStatus', `watermarks[${index}]`);
    if (!ACTIVITY_ADAPTER_STATUS.includes(status)) {
      return invalidActivityResponse(`Activity watermark ${index} adapterStatus unsupported.`);
    }
    const sourceUpdatedAt = optionalStringField(entry, 'sourceUpdatedAt', `watermarks[${index}]`);
    const cursor = optionalStringField(entry, 'cursor', `watermarks[${index}]`);
    const lagValue = entry.lagMilliseconds;
    return {
      resourceProjectId: stringField(entry, 'resourceProjectId', `watermarks[${index}]`),
      adapterId: stringField(entry, 'adapterId', `watermarks[${index}]`),
      domainKind: stringField(entry, 'domainKind', `watermarks[${index}]`) as ActivityDomainKindV1,
      ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
      projectedAt: stringField(entry, 'projectedAt', `watermarks[${index}]`),
      ...(lagValue === undefined
        ? {}
        : typeof lagValue === 'number' && Number.isFinite(lagValue)
          ? { lagMilliseconds: lagValue }
          : invalidActivityResponse(`Activity watermark ${index} lagMilliseconds invalid.`)),
      adapterStatus: status as 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE',
      snapshotRevision: revision,
      ...(cursor === undefined ? {} : { cursor }),
      updatedAt: stringField(entry, 'updatedAt', `watermarks[${index}]`),
    } satisfies ActivityWatermarkRecordV1;
  });
  const adapterStatus = stringField(value, 'adapterStatus', 'refresh');
  if (!ACTIVITY_ADAPTER_STATUS.includes(adapterStatus)) {
    return invalidActivityResponse(
      `Activity refresh adapterStatus ${adapterStatus} is unsupported.`,
    );
  }
  if (typeof value.partial !== 'boolean') {
    return invalidActivityResponse('Activity refresh partial must be a boolean.');
  }
  const failures = arrayField(value, 'failures', 'refresh').map((entry, index) => {
    if (!isRecord(entry)) return invalidActivityResponse(`Activity failure ${index} invalid.`);
    if (typeof entry.safe !== 'boolean') {
      return invalidActivityResponse(`Activity failure ${index} safe must be a boolean.`);
    }
    const domainKind = stringField(
      entry,
      'domainKind',
      `failures[${index}]`,
    ) as ActivityAdapterKindV1;
    if (!['SOURCES', 'ASK', 'EXTERNAL_ACTION'].includes(domainKind)) {
      return invalidActivityResponse(`Activity failure ${index} domainKind unsupported.`);
    }
    return {
      adapterId: stringField(entry, 'adapterId', `failures[${index}]`),
      domainKind,
      safe: entry.safe,
      message: stringField(entry, 'message', `failures[${index}]`),
    } satisfies ActivityProjectionAdapterFailureV1;
  });
  return {
    resourceProjectId,
    snapshotRevision: snapshotRevisionValue,
    indexCount: indexCountValue,
    watermarks,
    adapterStatus: adapterStatus as 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE',
    partial: value.partial,
    failures,
  };
};

const identityMismatch = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
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
 * FE-P5-S1 WP4 — Activity read client factory.
 */
export const createFrontendActivityClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendActivityClient => {
  const request = options.fetch ?? globalThis.fetch;
  let csrfToken: string | undefined;

  const csrf = async (signal?: AbortSignal): Promise<string> => {
    if (csrfToken) return csrfToken;
    const response = await request('/api/v1/security/csrf', {
      credentials: 'same-origin',
      signal,
    });
    const body = (await assertOk(response)) as { readonly csrfToken?: unknown };
    if (typeof body.csrfToken !== 'string' || body.csrfToken.length === 0) {
      throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'The CSRF token response is invalid.');
    }
    csrfToken = body.csrfToken;
    return csrfToken;
  };

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

  // READ POST: idempotent and safe, so a CSRF refresh + single retry on a
  // general 403 is allowed (session rotation must not break a plain read).
  const read = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> => {
    let response = await post(path, params, await csrf(signal), signal);
    if (response.status === 403) {
      csrfToken = undefined;
      response = await post(path, params, await csrf(signal), signal);
    }
    return response;
  };

  return {
    async listActivityQueue(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/activity/queue',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeQueuePage(body);
    },

    async getActivityDetail(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/activity/detail',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const detail = decodeActivitySnapshotV1(body, 'activityDetail');
      // Fail-closed identity binding: the Detail must echo the requested
      // Activity identity (projection + concrete Domain reference).
      if (
        detail.root.activityId !== params.activityId ||
        detail.root.domainKind !== params.domainKind ||
        detail.root.domainResourceKind !== params.domainResourceKind ||
        detail.root.domainResourceId !== params.domainResourceId
      ) {
        identityMismatch('Activity Detail result does not match the requested Activity.');
      }
      return detail;
    },

    async listActivityStages(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/activity/stages',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeStageContinuation(body);
    },

    async listActivityEvents(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/activity/events',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeEventContinuation(body);
    },

    async refreshActivityProjection(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/activity/refresh',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeBuildResult(body);
    },
  };
};

// Re-export the decoded view types and request types the browser workspace
// uses, so the web app never imports the module layer directly for these shapes.
export type {
  ActivityAttentionStateV1,
  ActivityDomainKindV1,
  ActivityLifecycleStateV1,
  ActivityProjectionMetadataV1,
  ActivityRootReferenceV1,
} from '../../contracts/src/index.js';
export type {
  ActivityDetailV1,
  ActivityEventContinuationV1,
  ActivityProjectionBuildResultV1,
  ActivityQueueItemV1,
  ActivityQueuePageV1,
  ActivityStageContinuationV1,
  GetActivityDetailRequestV1,
  ListActivityContinuationRequestV1,
  ListActivityQueueRequestV1,
  RefreshActivityProjectionRequestV1,
} from '../../../modules/frontend-activity/src/index.js';
