import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';

/** Integer units; moneyMicros uses the frozen policy currency, never floating FX. */
export type SurferUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  moneyMicros: number;
  elapsedMs: number;
};
export const SURFER_USAGE_KEYS = [
  'calls',
  'inputTokens',
  'outputTokens',
  'moneyMicros',
  'elapsedMs',
] as const;
export const zeroSurferUsage = (): SurferUsage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  moneyMicros: 0,
  elapsedMs: 0,
});
export type SurferExecutionPolicy = {
  schemaVersion: '1.0.0';
  budgetId: string;
  generation: string;
  executionIdentity: string;
  modelRevision: string;
  egressPolicyRevision: string;
  pricingRevision: string;
  currency: string;
  allowedSpaceIds: string[];
  limits: SurferUsage;
  backgroundLimits: SurferUsage;
  maxConcurrent: number;
  maxBackgroundConcurrent: number;
  maxQueued: number;
  unitMaxMs: number;
  workerMemoryMb: number;
  deadlineAtMs: number;
};
export type SurferReservationRequest = {
  schemaVersion: '1.0.0';
  operationId: string;
  attempt: number;
  runId: string;
  stepId: string;
  spaceId: string;
  inputDigest: string;
  priority: 'FOREGROUND' | 'BACKGROUND';
  kind:
    | 'INGEST'
    | 'INTERPRET'
    | 'PROPOSE'
    | 'VALIDATE'
    | 'QUESTION'
    | 'REPAIR'
    | 'CANARY'
    | 'CONSOLIDATE';
  executionKind: 'LOCAL_DETERMINISTIC' | 'PROVIDER';
  dependsOn: string[];
  maximum: SurferUsage;
};
export type SurferExecutionRecord = {
  reservationId: string;
  requestDigest: string;
  request: SurferReservationRequest;
  state:
    | 'RESERVED'
    | 'DISPATCHED'
    | 'OUTCOME_UNKNOWN'
    | 'SETTLED'
    | 'FAILED_KNOWN'
    | 'CANCELLED_BEFORE_DISPATCH';
  dispatchToken: string | null;
  usage: SurferUsage | null;
  outcome: 'SUCCEEDED' | 'FAILED' | 'YIELDED' | null;
  checkpoint: unknown;
  checkpointSequence: number;
  resultRef: string | null;
  settlementDigest: string | null;
};
export type SurferExecutionState = {
  schemaVersion: '1.0.0';
  budgetId: string;
  sequence: number;
  policyDigest: string | null;
  records: SurferExecutionRecord[];
};
export const emptySurferExecutionState = (budgetId: string): SurferExecutionState => ({
  schemaVersion: '1.0.0',
  budgetId,
  sequence: 0,
  policyDigest: null,
  records: [],
});
/** Trusted backend capability. Callbacks must be synchronous and cannot dispatch work. */
export interface SurferExecutionStorePort {
  transaction<T>(budgetId: string, apply: (state: SurferExecutionState) => T): Promise<T>;
}
export type SurferWorkerResult = {
  outcome: 'SUCCEEDED' | 'FAILED' | 'YIELDED';
  checkpoint: unknown;
  resultRef: string | null;
};
/** Static trusted workers only; this is execution isolation, not an untrusted-code sandbox. */
export interface SurferLocalWorkerPort {
  run(
    input: unknown,
    checkpoint: unknown,
    signal: AbortSignal,
    profile: { unitMaxMs: number; workerMemoryMb: number },
    onCheckpoint?: (checkpoint: unknown, sequence: number) => Promise<void>,
  ): Promise<SurferWorkerResult>;
}

const text = { type: 'string', minLength: 1, maxLength: 256 };
const integer = { type: 'integer', minimum: 0, maximum: 1_000_000_000_000 };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const usage = obj(Object.fromEntries(SURFER_USAGE_KEYS.map((k) => [k, integer])));
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.execution-policy',
  version: '1.0.0',
  kind: 'command',
  inputSchema: obj({
    schemaVersion: { const: '1.0.0' },
    budgetId: text,
    generation: text,
    executionIdentity: text,
    modelRevision: text,
    egressPolicyRevision: text,
    pricingRevision: text,
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    allowedSpaceIds: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: text },
    limits: usage,
    backgroundLimits: usage,
    maxConcurrent: { type: 'integer', minimum: 1, maximum: 64 },
    maxBackgroundConcurrent: { type: 'integer', minimum: 0, maximum: 64 },
    maxQueued: { type: 'integer', minimum: 1, maximum: 1024 },
    unitMaxMs: { type: 'integer', minimum: 1, maximum: 60000 },
    workerMemoryMb: { type: 'integer', minimum: 8, maximum: 4096 },
    deadlineAtMs: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  }),
});
registry.register({
  name: 'surfer.reservation',
  version: '1.0.0',
  kind: 'command',
  inputSchema: obj({
    schemaVersion: { const: '1.0.0' },
    operationId: text,
    attempt: { type: 'integer', minimum: 1, maximum: 1024 },
    runId: text,
    stepId: text,
    spaceId: text,
    inputDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    priority: { enum: ['FOREGROUND', 'BACKGROUND'] },
    kind: {
      enum: [
        'INGEST',
        'INTERPRET',
        'PROPOSE',
        'VALIDATE',
        'QUESTION',
        'REPAIR',
        'CANARY',
        'CONSOLIDATE',
      ],
    },
    executionKind: { enum: ['LOCAL_DETERMINISTIC', 'PROVIDER'] },
    dependsOn: { type: 'array', maxItems: 64, uniqueItems: true, items: text },
    maximum: usage,
  }),
});
registry.register({ name: 'surfer.usage', version: '1.0.0', kind: 'command', inputSchema: usage });
function decode<T>(name: string, input: unknown): T {
  assertSurferJson(input);
  registry.validateInput(name, '1.0.0', input);
  return structuredClone(input) as T;
}
export function decodeSurferExecutionPolicy(value: unknown): SurferExecutionPolicy {
  const p = decode<SurferExecutionPolicy>('surfer.execution-policy', value);
  if (
    p.maxBackgroundConcurrent > p.maxConcurrent ||
    SURFER_USAGE_KEYS.some((k) => p.backgroundLimits[k] > p.limits[k])
  )
    throw surferFailure('Background policy cannot exceed root limits.');
  return p;
}
export function decodeSurferReservation(value: unknown): SurferReservationRequest {
  const r = decode<SurferReservationRequest>('surfer.reservation', value);
  if (
    r.maximum.elapsedMs < 1 ||
    (r.executionKind === 'PROVIDER' && r.maximum.calls !== 1) ||
    (r.executionKind === 'LOCAL_DETERMINISTIC' &&
      (r.maximum.calls || r.maximum.inputTokens || r.maximum.outputTokens || r.maximum.moneyMicros))
  )
    throw surferFailure('Execution kind and bounded resource reservation disagree.');
  return r;
}
export const decodeSurferUsage = (input: unknown): SurferUsage => decode('surfer.usage', input);

export function assertSurferExecutionTransition(
  original: SurferExecutionState,
  draft: SurferExecutionState,
): void {
  surferDigest(draft);
  if (
    draft.schemaVersion !== '1.0.0' ||
    draft.budgetId !== original.budgetId ||
    !Number.isSafeInteger(draft.sequence) ||
    draft.sequence < original.sequence ||
    draft.sequence > original.sequence + 2 ||
    draft.records.length > 1024 ||
    (draft.sequence === original.sequence && surferDigest(draft) !== surferDigest(original))
  )
    throw surferFailure('Execution transaction changed identity/schema/sequence.');
}
