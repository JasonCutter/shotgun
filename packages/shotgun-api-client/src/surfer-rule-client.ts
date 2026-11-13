import type {
  SurferGuidedRuleCatalog,
  SurferGuidedRuleQuestion,
  SurferGuidedRuleAnswer,
} from '../../contracts/src/surfer-guided-rule.js';
import { createSurferMemoryReadTransport } from './surfer-memory-client.js';
export type { SurferGuidedRuleCatalog, SurferGuidedRuleQuestion, SurferGuidedRuleAnswer };
export interface SurferRuleClient {
  catalog(signal?: AbortSignal): Promise<SurferGuidedRuleCatalog>;
  ask(input: SurferGuidedRuleQuestion, signal?: AbortSignal): Promise<SurferGuidedRuleAnswer>;
}
const invalid = (): never => {
  throw new Error('Invalid rule response.');
};
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : invalid();
const keys = (v: Record<string, unknown>, names: string) => {
  if (Object.keys(v).sort().join(',') !== names.split(',').sort().join(',')) invalid();
};
const text = (v: unknown, max = 2048) => {
  if (typeof v !== 'string' || !v.length || v.length > max) invalid();
};
const arr = (v: unknown, max: number): unknown[] =>
  Array.isArray(v) && v.length <= max ? v : invalid();
const ref = (v: unknown) => {
  const r = obj(v);
  keys(r, 'artifactId,revision,digest');
  text(r.artifactId, 256);
  text(r.digest, 80);
  if (!Number.isSafeInteger(r.revision) || Number(r.revision) < 1) invalid();
};
const snapshot = (v: unknown) => {
  const s = obj(v);
  keys(s, 'snapshotId,digest');
  text(s.snapshotId, 256);
  text(s.digest, 80);
};
const state = (v: unknown) => {
  if (!['ACTIVE', 'QUARANTINED', 'RETRACTED'].includes(String(v))) invalid();
};
function catalog(v: unknown): SurferGuidedRuleCatalog {
  const r = obj(v);
  keys(r, 'schemaVersion,status,snapshot,items');
  if (r.schemaVersion !== '1.0.0' || !['READY', 'UNAVAILABLE'].includes(String(r.status)))
    invalid();
  const items = arr(r.items, 16);
  if (r.status === 'UNAVAILABLE' && (r.snapshot !== null || items.length)) invalid();
  if (r.status === 'READY') snapshot(r.snapshot);
  const memories = new Set();
  for (const entry of items) {
    const i = obj(entry);
    keys(i, 'memory,description,domain,state,applySupported,fields');
    ref(i.memory);
    const memory = obj(i.memory).artifactId;
    if (memories.has(memory)) invalid();
    memories.add(memory);
    text(i.description);
    text(i.domain, 256);
    state(i.state);
    if (typeof i.applySupported !== 'boolean' || (i.state !== 'ACTIVE' && i.applySupported))
      invalid();
    const names = new Set();
    for (const entry of arr(i.fields, 8)) {
      const f = obj(entry);
      keys(f, 'name,type,unit,values');
      text(f.name, 64);
      if (names.has(f.name)) invalid();
      names.add(f.name);
      if (!['NUMBER', 'BOOLEAN', 'TEXT'].includes(String(f.type))) invalid();
      if (f.unit !== null) {
        text(f.unit, 64);
        if (f.type !== 'NUMBER') invalid();
      }
      const values = arr(f.values, 64);
      if (!values.length) invalid();
      for (const value of values) {
        if (
          (f.type === 'NUMBER' && (typeof value !== 'number' || !Number.isFinite(value))) ||
          (f.type === 'BOOLEAN' && typeof value !== 'boolean') ||
          (f.type === 'TEXT' && (typeof value !== 'string' || value.length > 2048))
        )
          invalid();
      }
    }
  }
  return r as unknown as SurferGuidedRuleCatalog;
}
function answer(v: unknown): SurferGuidedRuleAnswer {
  const r = obj(v);
  keys(r, 'schemaVersion,status,answers,semanticAssessment,execution,premisesOrigin,modelCalls');
  if (
    r.schemaVersion !== '1.0.0' ||
    !['ANSWER', 'UNKNOWN', 'SOURCE_UNAVAILABLE', 'BLOCKED'].includes(String(r.status)) ||
    r.semanticAssessment !== 'NOT_EVALUATED' ||
    r.execution !== 'ADVISORY_NOT_ACTION' ||
    r.premisesOrigin !== 'CALLER_SUPPLIED_SCENARIO' ||
    r.modelCalls !== 0
  )
    invalid();
  const answers = arr(r.answers, 1);
  if (['SOURCE_UNAVAILABLE', 'BLOCKED'].includes(String(r.status)) && answers.length) invalid();
  for (const entry of answers) {
    const a = obj(entry);
    keys(a, 'description,state,outcome,reasons,citations');
    text(a.description);
    state(a.state);
    if (
      !['TRUE', 'FALSE', 'UNKNOWN', 'RECALLED'].includes(String(a.outcome)) ||
      (a.state !== 'ACTIVE' && a.outcome !== 'UNKNOWN')
    )
      invalid();
    for (const reason of arr(a.reasons, 64)) text(reason, 256);
    for (const entry of arr(a.citations, 64)) {
      const c = obj(entry);
      keys(c, 'sourceId,sourceVersionId,evidenceId,revisionId,start,end,quote');
      for (const name of ['sourceId', 'sourceVersionId', 'evidenceId', 'revisionId'])
        text(c[name], 256);
      text(c.quote, 65536);
      if (
        !Number.isSafeInteger(c.start) ||
        !Number.isSafeInteger(c.end) ||
        Number(c.start) < 0 ||
        Number(c.end) < Number(c.start)
      )
        invalid();
    }
  }
  return r as unknown as SurferGuidedRuleAnswer;
}
export function createSurferRuleClient(
  fetchImplementation: typeof fetch = globalThis.fetch,
): SurferRuleClient {
  const post = createSurferMemoryReadTransport(fetchImplementation);
  return {
    catalog: async (signal) => catalog(await post('rule-catalog', {}, signal)),
    ask: async (input, signal) => answer(await post('guided-rule-ask', input, signal)),
  };
}
