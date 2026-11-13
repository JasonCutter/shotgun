import type {
  SurferObservationSelection,
  SurferCognitiveSourcePort,
  SurferSemanticFrameProposal,
} from './surfer-cognition.js';
import type { SurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import { assertSurferSourceBasisV2 } from './surfer-source-binding-v2.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import { SchemaRegistry } from './schema-registry.js';

export type SurferSemanticDatasetPort = {
  manifest: {
    datasetId: string;
    sourceDigest: string;
    oracleDigest: string;
    evaluatorRevision: string;
    records: { id: string }[];
  };
  input(id: string): { text: string; textDigest: string };
  evaluate(rows: { caseId: string; frame: unknown }[]): unknown;
};
export type SurferSemanticProtocol = {
  schemaVersion: '1.0.0';
  runId: string;
  mode: 'LIVE' | 'ISOLATED_CONTRACT';
  reviewDigest: string;
  profileDigest: string;
  budgetPolicyDigest: string;
  codeDigest: string;
  metadataDigest: string;
  pricingDigest: string;
  datasetDigest: string;
  sourceDigest: string;
  oracleDigest: string;
  evaluatorRevision: string;
  caseIds: string[];
  maxProviderCalls: number;
  maxRepairs: 0;
  concurrency: 1;
  expiresAtMs: number;
};
export type SurferSemanticBatchSpec = {
  schemaVersion: '1.0.0';
  protocol: SurferSemanticProtocol;
  basis: SurferSourceBasisV2;
  cases: { caseId: string; textDigest: string; selection: SurferObservationSelection }[];
};
export type SurferSemanticApproval = {
  approvalRef: string;
  specDigest: string;
  reviewDigest: string;
  profileDigest: string;
  mode: 'LIVE' | 'ISOLATED_CONTRACT';
  expiresAtMs: number;
};
/** Issued by trusted runtime authority. Never accept an approved=true browser/model object. */
export interface SurferSemanticApprovalPort {
  verify(spec: SurferSemanticBatchSpec): Promise<SurferSemanticApproval>;
  recover?(spec: SurferSemanticBatchSpec, previousOwner: string): Promise<void>;
}
export type SurferSemanticRunRow = {
  caseId: string;
  operationId: string;
  reservationId: string | null;
  status: string;
  frameDigest: string | null;
  possibleCall: boolean;
  observedResponse: boolean;
};
export type SurferSemanticRunState = {
  schemaVersion: '1.0.0';
  runId: string;
  sequence: number;
  specDigest: string | null;
  approvalRef: string | null;
  stage: 'NEW' | 'RUNNING' | 'STOPPED' | 'COMPLETED';
  owner: string | null;
  inflight: string | null;
  rows: SurferSemanticRunRow[];
  stopReason: string | null;
  evaluation: unknown | null;
};
export interface SurferSemanticRunStorePort {
  transaction<T>(runId: string, apply: (state: SurferSemanticRunState) => T): Promise<T>;
}
export const emptySurferSemanticRun = (runId: string): SurferSemanticRunState => ({
  schemaVersion: '1.0.0',
  runId,
  sequence: 0,
  specDigest: null,
  approvalRef: null,
  stage: 'NEW',
  owner: null,
  inflight: null,
  rows: [],
  stopReason: null,
  evaluation: null,
});
export function assertSurferSemanticRunTransition(
  before: SurferSemanticRunState,
  after: SurferSemanticRunState,
): void {
  assertSurferJson(after);
  if (
    after.schemaVersion !== '1.0.0' ||
    after.runId !== before.runId ||
    !Number.isSafeInteger(after.sequence) ||
    after.sequence < before.sequence ||
    after.sequence > before.sequence + 1 ||
    after.rows.length > 24 ||
    after.rows.length < before.rows.length ||
    after.rows.length > before.rows.length + 1 ||
    !['NEW', 'RUNNING', 'STOPPED', 'COMPLETED'].includes(after.stage) ||
    before.rows.some((row, i) => surferDigest(row) !== surferDigest(after.rows[i])) ||
    (before.specDigest !== null && after.specDigest !== before.specDigest) ||
    (before.approvalRef !== null && after.approvalRef !== before.approvalRef) ||
    (['COMPLETED', 'STOPPED'].includes(before.stage) &&
      surferDigest(after) !== surferDigest(before)) ||
    (after.sequence === before.sequence && surferDigest(after) !== surferDigest(before))
  )
    throw surferFailure('Semantic run state/fence changed invalidly.');
}
const text = { type: 'string', minLength: 1, maxLength: 256 },
  hash = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const registry = new SchemaRegistry();
registry.register({
  name: 'surfer.semantic-batch',
  version: '1.0.0',
  kind: 'command',
  inputSchema: object({
    schemaVersion: { const: '1.0.0' },
    protocol: object({
      schemaVersion: { const: '1.0.0' },
      runId: text,
      mode: { enum: ['LIVE', 'ISOLATED_CONTRACT'] },
      reviewDigest: hash,
      profileDigest: hash,
      budgetPolicyDigest: hash,
      codeDigest: hash,
      metadataDigest: hash,
      pricingDigest: hash,
      datasetDigest: hash,
      sourceDigest: hash,
      oracleDigest: hash,
      evaluatorRevision: text,
      caseIds: { type: 'array', minItems: 1, maxItems: 24, uniqueItems: true, items: text },
      maxProviderCalls: { type: 'integer', minimum: 1, maximum: 24 },
      maxRepairs: { const: 0 },
      concurrency: { const: 1 },
      expiresAtMs: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    }),
    basis: { type: 'object' },
    cases: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: object({
        caseId: text,
        textDigest: hash,
        selection: object({
          sourceId: text,
          evidenceId: text,
          start: { type: 'integer', minimum: 0 },
          end: { type: 'integer', minimum: 1 },
          targetUnit: { type: 'null' },
        }),
      }),
    },
  }),
});
export function decodeSurferSemanticBatch(input: unknown): SurferSemanticBatchSpec {
  assertSurferJson(input);
  registry.validateInput('surfer.semantic-batch', '1.0.0', input);
  const s = structuredClone(input) as SurferSemanticBatchSpec;
  assertSurferSourceBasisV2(s.basis);
  if (
    s.protocol.maxProviderCalls !== s.cases.length ||
    surferDigest(s.protocol.caseIds) !== surferDigest(s.cases.map((c) => c.caseId)) ||
    new Set(s.cases.map((c) => c.caseId)).size !== s.cases.length ||
    s.cases.some(
      (c) =>
        c.selection.end <= c.selection.start ||
        c.selection.end - c.selection.start > 2048 ||
        !s.basis.sources.some((d) => d.sourceId === c.selection.sourceId),
    )
  )
    throw surferFailure('Semantic batch cases/source scope disagree.');
  return s;
}
/** Source IDs are bound only after intake. Expected semantic fields stay exclusively in the evaluator. */
export async function bindSurferSemanticSources(
  source: SurferCognitiveSourcePort,
  sourceRequest: unknown,
  protocol: SurferSemanticProtocol,
  dataset: SurferSemanticDatasetPort,
  selections: SurferObservationSelection[],
): Promise<SurferSemanticBatchSpec> {
  if (protocol.caseIds.length !== selections.length)
    throw surferFailure('Semantic input count changed.');
  const view = await source.observe(sourceRequest, { schemaVersion: '1.0.0', selections });
  const cases = protocol.caseIds.map((caseId, i) => {
    const input = dataset.input(caseId),
      anchor = view.anchors[i];
    if (!anchor || surferDigest(anchor.rawLiteral) !== input.textDigest)
      throw surferFailure('Source text differs from approved semantic input.');
    return { caseId, textDigest: input.textDigest, selection: structuredClone(selections[i]!) };
  });
  return decodeSurferSemanticBatch({ schemaVersion: '1.0.0', protocol, basis: view.basis, cases });
}
export type SurferSemanticEvaluationRow = {
  caseId: string;
  frame: SurferSemanticFrameProposal | null;
};
