import type {
  SurferGuidedAnswer,
  SurferGuidedCatalog,
  SurferGuidedQuestion,
} from '../../contracts/src/surfer-guided-memory.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';

export type { SurferGuidedAnswer, SurferGuidedCatalog, SurferGuidedQuestion };
export interface SurferMemoryClient {
  catalog(signal?: AbortSignal): Promise<SurferGuidedCatalog>;
  ask(question: SurferGuidedQuestion, signal?: AbortSignal): Promise<SurferGuidedAnswer>;
}
const invalid = (): never => {
  throw new Error('Invalid memory response.');
};
const object = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : invalid();
const text = (x: unknown, max = 4096): string =>
  typeof x === 'string' && x.length > 0 && x.length <= max ? x : invalid();
const array = (x: unknown, max: number): unknown[] =>
  Array.isArray(x) && x.length <= max ? x : invalid();
const keys = (x: Record<string, unknown>, names: string) => {
  if (Object.keys(x).sort().join(',') !== names.split(',').sort().join(',')) invalid();
};
const ref = (x: unknown) => {
  const r = object(x);
  text(r.artifactId, 256);
  text(r.digest, 80);
  if (!Number.isSafeInteger(r.revision) || Number(r.revision) < 1) invalid();
};
const snapshot = (x: unknown) => {
  const s = object(x);
  text(s.snapshotId, 256);
  text(s.digest, 80);
};
function catalog(x: unknown): SurferGuidedCatalog {
  const r = object(x);
  keys(r, 'schemaVersion,status,snapshot,items');
  if (r.schemaVersion !== '1.0.0' || !['READY', 'UNAVAILABLE'].includes(String(r.status)))
    invalid();
  if (r.snapshot !== null) snapshot(r.snapshot);
  const items = array(r.items, 16);
  if (r.status === 'UNAVAILABLE' && (r.snapshot !== null || items.length)) invalid();
  if (r.status === 'READY' && r.snapshot === null) invalid();
  for (const i of items) {
    const v = object(i);
    keys(v, 'memory,subject,operation,applySupported,dateRequired,fields');
    ref(v.memory);
    text(v.subject);
    text(v.operation);
    if (typeof v.applySupported !== 'boolean' || typeof v.dateRequired !== 'boolean') invalid();
    const fields = array(v.fields, 8);
    if (new Set(fields.map((f) => object(f).predicateId)).size !== fields.length) invalid();
    for (const f of fields) {
      const q = object(f);
      keys(q, 'predicateId,quote,type,unit');
      text(q.predicateId, 64);
      text(q.quote);
      if (
        !['BOOLEAN', 'NUMBER'].includes(String(q.type)) ||
        (q.unit !== null && typeof q.unit !== 'string') ||
        (q.type === 'BOOLEAN' && q.unit !== null)
      )
        invalid();
      if (q.unit !== null) text(q.unit, 64);
    }
  }
  return r as unknown as SurferGuidedCatalog;
}
function answer(x: unknown): SurferGuidedAnswer {
  const r = object(x);
  keys(r, 'schemaVersion,status,answers,semanticAssessment,execution,premisesOrigin,modelCalls');
  if (
    r.schemaVersion !== '1.0.0' ||
    !['ANSWER', 'UNKNOWN', 'PARTIAL', 'CONFLICT', 'SOURCE_UNAVAILABLE', 'BLOCKED'].includes(
      String(r.status),
    ) ||
    r.semanticAssessment !== 'NOT_EVALUATED' ||
    r.execution !== 'ADVISORY_NOT_ACTION' ||
    r.premisesOrigin !== 'CALLER_SUPPLIED_SCENARIO' ||
    r.modelCalls !== 0
  )
    invalid();
  for (const a of array(r.answers, 16)) {
    const v = object(a);
    keys(v, 'outcome,declaredMode,citations,needed');
    text(v.outcome, 80);
    text(v.declaredMode, 80);
    for (const c of array(v.citations, 32)) {
      const q = object(c);
      keys(q, 'role,predicateId,sourceId,sourceVersionId,evidenceId,revisionId,start,end,quote');
      text(q.quote);
      for (const k of [
        'sourceId',
        'sourceVersionId',
        'evidenceId',
        'revisionId',
        'predicateId',
        'role',
      ])
        text(q[k], 256);
      if (
        !Number.isSafeInteger(q.start) ||
        !Number.isSafeInteger(q.end) ||
        Number(q.start) < 0 ||
        Number(q.end) < Number(q.start)
      )
        invalid();
    }
    for (const n of array(v.needed, 8)) {
      const q = object(n);
      keys(q, 'predicateId,quote,reason');
      text(q.predicateId, 64);
      text(q.quote);
      text(q.reason, 256);
    }
  }
  if (['SOURCE_UNAVAILABLE', 'BLOCKED'].includes(String(r.status)) && array(r.answers, 16).length)
    invalid();
  return r as unknown as SurferGuidedAnswer;
}
/** Same-origin read POSTs share existing session CSRF refresh/serialization. No model or write endpoint. */
export function createSurferMemoryReadTransport(
  fetchImplementation: typeof fetch = globalThis.fetch,
) {
  const csrf = getSharedCsrfMutationManager(fetchImplementation);
  const post = async (path: string, body: unknown, signal?: AbortSignal) => {
    const response = await csrf.run(
      (token) =>
        fetchImplementation('/api/v1/surfer/memory/' + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: JSON.stringify(body),
          signal,
        }),
      { signal, recoverOnResponse: isCsrfFailureResponse },
    );
    const raw = await response.text();
    if (raw.length > 2097152) invalid();
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
  return post;
}
export function createSurferMemoryClient(
  fetchImplementation: typeof fetch = globalThis.fetch,
): SurferMemoryClient {
  const post = createSurferMemoryReadTransport(fetchImplementation);
  return {
    catalog: async (signal) => catalog(await post('catalog', {}, signal)),
    ask: async (question, signal) => answer(await post('guided-ask', question, signal)),
  };
}
