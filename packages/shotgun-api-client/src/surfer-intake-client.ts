import type {
  SurferIntakeCursor,
  SurferIntakeResume,
  SurferIntakeStatusPage,
  SurferIntakeStatusItem,
  SurferIntakeResumeResult,
} from '../../contracts/src/surfer-intake.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';
export type {
  SurferIntakeCursor,
  SurferIntakeResume,
  SurferIntakeStatusPage,
  SurferIntakeStatusItem,
  SurferIntakeResumeResult,
};
export interface SurferIntakeClient {
  status(cursor?: SurferIntakeCursor | null, signal?: AbortSignal): Promise<SurferIntakeStatusPage>;
  resume(target: SurferIntakeResume, signal?: AbortSignal): Promise<SurferIntakeResumeResult>;
}
function invalid(): never {
  throw new Error('Invalid intake response.');
}
const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : invalid();
const keys = (x: Record<string, unknown>, names: string) => {
  if (Object.keys(x).sort().join(',') !== names.split(',').sort().join(',')) invalid();
};
const code = (v: unknown) =>
  typeof v === 'string' && ['WORK_UNAVAILABLE', 'OUTCOME_UNKNOWN', 'INCOMPLETE'].includes(v);
const uuid = (v: unknown) =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
// Keep browser validation independent of the server schema/hash implementations.
const targetInput = (value: unknown): SurferIntakeResume => {
  const r = object(value);
  keys(r, 'jobId,expectedRevision');
  if (
    typeof r.jobId !== 'string' ||
    !/^intake:[a-f0-9]{64}$/.test(r.jobId) ||
    typeof r.expectedRevision !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(r.expectedRevision) ||
    BigInt(r.expectedRevision) > 9223372036854775807n
  )
    invalid();
  return { jobId: r.jobId, expectedRevision: r.expectedRevision };
};
const cursorInput = (value: unknown): SurferIntakeCursor | null => {
  if (value === null) return null;
  const r = object(value);
  keys(r, 'jobId,createdAt');
  if (
    typeof r.jobId !== 'string' ||
    !/^intake:[a-f0-9]{64}$/.test(r.jobId) ||
    typeof r.createdAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(r.createdAt) ||
    r.createdAt.startsWith('0000-') ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    new Date(r.createdAt).toISOString() !== r.createdAt.slice(0, -4) + 'Z'
  )
    invalid();
  return { jobId: r.jobId, createdAt: r.createdAt };
};
function page(value: unknown): SurferIntakeStatusPage {
  const r = object(value);
  keys(r, 'executionConfigured,items,nextCursor');
  if (typeof r.executionConfigured !== 'boolean' || !Array.isArray(r.items) || r.items.length > 20)
    invalid();
  cursorInput(r.nextCursor);
  if (r.nextCursor !== null && r.items.length !== 20) invalid();
  const ids = new Set<string>();
  for (const item of r.items) {
    const q = object(item);
    keys(q, 'jobId,sourceId,sourceVersionId,revisionId,revision,state,code,updatedAt,recovery');
    targetInput({ jobId: q.jobId, expectedRevision: q.revision });
    if (ids.has(String(q.jobId))) invalid();
    ids.add(String(q.jobId));
    if (
      ![q.sourceId, q.sourceVersionId, q.revisionId].every(uuid) ||
      typeof q.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(q.updatedAt)) ||
      new Date(q.updatedAt).toISOString() !== q.updatedAt
    )
      invalid();
    if (
      typeof q.state !== 'string' ||
      !['READY', 'RUNNING', 'COMPLETED', 'BLOCKED'].includes(q.state) ||
      typeof q.recovery !== 'string' ||
      ![
        'UNAVAILABLE',
        'NOT_CONFIGURED',
        'CONFIGURATION_MISMATCH',
        'SOURCE_CHANGED',
        'WAIT_LEASE',
        'AVAILABLE',
      ].includes(String(q.recovery)) ||
      (q.state === 'BLOCKED' ? !code(q.code) : q.code !== null) ||
      (q.state !== 'RUNNING' && q.recovery !== 'UNAVAILABLE') ||
      (q.state === 'RUNNING' &&
        (r.executionConfigured
          ? ['NOT_CONFIGURED', 'UNAVAILABLE'].includes(String(q.recovery))
          : q.recovery !== 'NOT_CONFIGURED'))
    )
      invalid();
  }
  if (r.nextCursor !== null && object(r.nextCursor).jobId !== r.items.at(-1)?.jobId) invalid();
  return value as SurferIntakeStatusPage;
}
function result(value: unknown, target: SurferIntakeResume): SurferIntakeResumeResult {
  const r = object(value);
  if (r.status === 'NOT_CONFIGURED') keys(r, 'status');
  else if (r.status === 'COMPLETED' || r.status === 'BLOCKED') {
    keys(r, r.status === 'COMPLETED' ? 'status,jobId' : 'status,jobId,code');
    if (r.jobId !== target.jobId || (r.status === 'BLOCKED' && !code(r.code))) invalid();
  } else invalid();
  return value as SurferIntakeResumeResult;
}
/** Resume is one POST only. Uncertain outcomes require inspection, never automatic resubmission. */
export function createSurferIntakeClient(
  fetcher: typeof fetch = globalThis.fetch,
): SurferIntakeClient {
  const csrf = getSharedCsrfMutationManager(fetcher);
  const post = async (operation: 'status' | 'resume', body: unknown, signal?: AbortSignal) => {
    const response = await csrf.run(
      (token) =>
        fetcher('/api/v1/surfer/intake/' + operation, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify(body),
          signal,
        }).catch(() => {
          throw new Error('Intake request outcome is uncertain.');
        }),
      { signal, ...(operation === 'status' ? { recoverOnResponse: isCsrfFailureResponse } : {}) },
    );
    const raw = await response.text();
    if (raw.length > 65536) invalid();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      invalid();
    }
    if (!response.ok) {
      const failure = decodeProductApiErrorBody(value);
      throw failure
        ? productFailureApiError(response.status, failure)
        : remoteUnclassifiedProductApiFailure(response.status);
    }
    return value;
  };
  return {
    status: async (cursor = null, signal) =>
      page(await post('status', { cursor: cursorInput(cursor) }, signal)),
    resume: async (target, signal) => {
      const fixed = targetInput(target);
      return result(await post('resume', fixed, signal), fixed);
    },
  };
}
