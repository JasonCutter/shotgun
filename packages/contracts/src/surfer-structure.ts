import { SchemaRegistry } from './schema-registry.js';
import { assertSurferJson, surferDigest, surferFailure } from './surfer-learning.js';
import type { SurferObservation } from './surfer-learning.js';
import type { SurferAnchorRef, SurferSemanticFrameProposal } from './surfer-cognition.js';

export type SurferStructureMention = { anchorRef: SurferAnchorRef; start: number; end: number };
export type SurferStructureExpression =
  | { op: 'predicate'; id: string }
  | { op: 'not'; arg: SurferStructureExpression }
  | { op: 'all' | 'any'; args: SurferStructureExpression[] };
export type SurferStructureOperand =
  | { type: 'NUMBER'; decimal: string; unit: string | null; mention: SurferStructureMention }
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'TEXT'; value: string };
export type SurferDeclaredStructure = {
  entities: { id: string; mention: SurferStructureMention }[];
  predicates: {
    id: string;
    subject: string;
    attribute: string;
    comparison: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
    operand: SurferStructureOperand;
    anchorRefs: SurferAnchorRef[];
  }[];
  assertion: {
    target: string;
    condition: SurferStructureExpression | null;
    direction: 'IF' | 'ONLY_IF' | 'IFF' | 'UNCONDITIONAL';
    quantifier: { kind: 'ALL' | 'SOME' | 'NONE'; domain: string; predicate: string } | null;
    exceptions: { appliesTo: string; when: SurferStructureExpression }[];
    scope: {
      entities: string[];
      condition: SurferStructureExpression | null;
      time: {
        from: string | null;
        to: string | null;
        fromInclusive: boolean;
        toInclusive: boolean;
        anchorRefs: SurferAnchorRef[];
      } | null;
    };
    documentRole: 'NORMATIVE' | 'OBSERVATION' | 'DEFINITION' | 'EXAMPLE';
  };
};
export type SurferStructureProposal = {
  schemaVersion: '1.0.0';
  contract: 'surfer.semantic-structure.v1';
  proposalId: string;
  parentFrame: { frameId: string; digest: string };
  viewDigest: string;
  anchorRefs: SurferAnchorRef[];
  rendering: string;
  interpretation:
    | { state: 'RESOLVED'; structure: SurferDeclaredStructure }
    | { state: 'MISSING' | 'UNMODELED'; reason: string }
    | { state: 'AMBIGUOUS'; reason: string; candidates: SurferDeclaredStructure[] };
};
export type SurferStructureComparison = {
  schemaVersion: '1.0.0';
  scope: 'DECLARED_STRUCTURE_COMPARISON_NOT_TRUTH';
  leftDigest: string;
  rightDigest: string;
  status: 'EXACT' | 'FORM_ONLY' | 'STRUCTURE_MATCHED' | 'CONTRADICTED' | 'NOT_COMPARABLE';
  reasons: string[];
  probes: number;
  kernelOperations: number;
  witness: {
    features: Record<string, SurferObservation>;
    left: 'TRUE' | 'FALSE';
    right: 'TRUE' | 'FALSE';
  } | null;
};
export interface SurferStructureComparisonPort {
  readonly revision: string;
  compare(left: unknown, right: unknown): SurferStructureComparison;
}
/** Server evaluation capability, never exposed as an unrestricted learner/oracle tool. */
export interface SurferStructureReferencePort {
  resolve(input: { referenceId: string; candidateDigest: string; viewDigest: string }): Promise<{
    frame: SurferSemanticFrameProposal;
    proposal: SurferStructureProposal;
    referenceDigest: string;
    comparatorRevision: string;
  }>;
}
const obj = (p: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties: p,
  required: Object.keys(p),
});
const text = { type: 'string', minLength: 1, maxLength: 256 },
  id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
  hash = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] }),
  list = (s: object, min = 0, max = 12) => ({
    type: 'array',
    items: s,
    minItems: min,
    maxItems: max,
  });
const ref = obj({ anchorId: text, revision: { const: 1 }, digest: hash });
const mention = obj({
  anchorRef: ref,
  start: { type: 'integer', minimum: 0, maximum: 2048 },
  end: { type: 'integer', minimum: 1, maximum: 2048 },
});
const expression = {
  anyOf: [
    obj({ op: { const: 'predicate' }, id }),
    obj({ op: { const: 'not' }, arg: { $ref: '#/definitions/expression' } }),
    obj({ op: { enum: ['all', 'any'] }, args: list({ $ref: '#/definitions/expression' }, 2, 12) }),
  ],
};
const operand = {
  anyOf: [
    obj({
      type: { const: 'NUMBER' },
      decimal: { type: 'string', maxLength: 40, pattern: '^-?(0|[1-9][0-9]*)([.][0-9]+)?$' },
      unit: nullable({ type: 'string', minLength: 1, maxLength: 64 }),
      mention,
    }),
    obj({ type: { const: 'BOOLEAN' }, value: { type: 'boolean' } }),
    obj({ type: { const: 'TEXT' }, value: { type: 'string', maxLength: 256 } }),
  ],
};
const structure = obj({
  entities: list(obj({ id, mention }), 1, 8),
  predicates: list(
    obj({
      id,
      subject: id,
      attribute: id,
      comparison: { enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
      operand,
      anchorRefs: list(ref, 1),
    }),
    1,
  ),
  assertion: obj({
    target: id,
    condition: nullable(expression),
    direction: { enum: ['IF', 'ONLY_IF', 'IFF', 'UNCONDITIONAL'] },
    quantifier: nullable(
      obj({ kind: { enum: ['ALL', 'SOME', 'NONE'] }, domain: id, predicate: id }),
    ),
    exceptions: list(obj({ appliesTo: id, when: expression }), 0, 4),
    scope: obj({
      entities: { ...list(id, 1, 8), uniqueItems: true },
      condition: nullable(expression),
      time: nullable(
        obj({
          from: nullable(text),
          to: nullable(text),
          fromInclusive: { type: 'boolean' },
          toInclusive: { type: 'boolean' },
          anchorRefs: list(ref, 1),
        }),
      ),
    }),
    documentRole: { enum: ['NORMATIVE', 'OBSERVATION', 'DEFINITION', 'EXAMPLE'] },
  }),
});
const registry = new SchemaRegistry();
/** Extraction body only: provenance/authority is always attached by the Source owner. */
export function surferStructureInterpretationSchema(): Record<string, unknown> {
  return structuredClone({
    ...obj({
      interpretation: {
        anyOf: [
          obj({ state: { const: 'RESOLVED' }, structure }),
          obj({ state: { enum: ['MISSING', 'UNMODELED'] }, reason: text }),
          obj({ state: { const: 'AMBIGUOUS' }, reason: text, candidates: list(structure, 2, 4) }),
        ],
      },
    }),
    definitions: { expression },
  });
}
registry.register({
  name: 'surfer.semantic-structure',
  version: '1.0.0',
  kind: 'command',
  inputSchema: {
    ...obj({
      schemaVersion: { const: '1.0.0' },
      contract: { const: 'surfer.semantic-structure.v1' },
      proposalId: text,
      parentFrame: obj({ frameId: text, digest: hash }),
      viewDigest: hash,
      anchorRefs: list(ref, 1),
      rendering: { type: 'string', maxLength: 2048 },
      interpretation: {
        anyOf: [
          obj({ state: { const: 'RESOLVED' }, structure }),
          obj({ state: { enum: ['MISSING', 'UNMODELED'] }, reason: text }),
          obj({ state: { const: 'AMBIGUOUS' }, reason: text, candidates: list(structure, 2, 4) }),
        ],
      },
    }),
    definitions: { expression },
  },
});
function checkStructure(s: SurferDeclaredStructure) {
  const entities = new Set(s.entities.map((e) => e.id)),
    predicates = new Set(s.predicates.map((p) => p.id));
  if (
    entities.size !== s.entities.length ||
    predicates.size !== s.predicates.length ||
    new Set(s.entities.map((e) => surferDigest(e.mention))).size !== entities.size
  )
    throw surferFailure('Duplicate structure identity/mention.');
  const use = (v: string, set: Set<string>) => {
    if (!set.has(v)) throw surferFailure('Unknown structure reference.');
  };
  const span = (m: SurferStructureMention) => {
    if (m.end <= m.start) throw surferFailure('Invalid structure mention interval.');
  };
  for (const e of s.entities) span(e.mention);
  for (const p of s.predicates) {
    use(p.subject, entities);
    if (p.operand.type === 'NUMBER') span(p.operand.mention);
    else if (!['eq', 'ne'].includes(p.comparison))
      throw surferFailure('Ordered comparison requires a number.');
  }
  let nodes = 0;
  const visit = (e: SurferStructureExpression, depth = 0) => {
    if (++nodes > 64 || depth > 8) throw surferFailure('Structure expression budget exceeded.');
    if (e.op === 'predicate') use(e.id, predicates);
    else if (e.op === 'not') visit(e.arg, depth + 1);
    else e.args.forEach((x) => visit(x, depth + 1));
  };
  const a = s.assertion;
  use(a.target, predicates);
  if ((a.direction === 'UNCONDITIONAL') !== (a.condition === null))
    throw surferFailure('Condition direction requires an explicit condition.');
  if (a.condition) visit(a.condition);
  for (const e of a.exceptions) {
    use(e.appliesTo, predicates);
    visit(e.when);
  }
  if (a.scope.condition) visit(a.scope.condition);
  a.scope.entities.forEach((e) => use(e, entities));
  if (!a.scope.entities.includes(s.predicates.find((p) => p.id === a.target)!.subject))
    throw surferFailure('Target is outside declared entity scope.');
  if (a.quantifier) {
    use(a.quantifier.domain, entities);
    use(a.quantifier.predicate, predicates);
  }
  if (a.scope.time) {
    const t = a.scope.time;
    for (const d of [t.from, t.to])
      if (
        d !== null &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          !Number.isFinite(Date.parse(d)) ||
          new Date(d).toISOString().slice(0, 10) !== d)
      )
        throw surferFailure('Invalid structure ISO date.');
    if (
      (t.from === null && t.to === null) ||
      (t.from &&
        t.to &&
        (t.from > t.to || (t.from === t.to && (!t.fromInclusive || !t.toInclusive))))
    )
      throw surferFailure('Invalid/empty structure time range.');
  }
}
export function decodeSurferStructureProposal(input: unknown): SurferStructureProposal {
  assertSurferJson(input); // Bound depth before recursive AJV.
  registry.validateInput('surfer.semantic-structure', '1.0.0', input);
  const p = structuredClone(input) as SurferStructureProposal;
  const v = p.interpretation;
  if (v.state === 'RESOLVED') checkStructure(v.structure);
  else if (v.state === 'AMBIGUOUS') {
    v.candidates.forEach(checkStructure);
    if (new Set(v.candidates.map(surferDigest)).size !== v.candidates.length)
      throw surferFailure('Ambiguous structures must be distinct.');
  }
  return p;
}
export function assertSurferStructureComparison(input: unknown): SurferStructureComparison {
  assertSurferJson(input);
  const r = input as SurferStructureComparison;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      'kernelOperations,leftDigest,probes,reasons,rightDigest,schemaVersion,scope,status,witness' ||
    !/^sha256:[a-f0-9]{64}$/.test(r.leftDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(r.rightDigest) ||
    r.schemaVersion !== '1.0.0' ||
    r.scope !== 'DECLARED_STRUCTURE_COMPARISON_NOT_TRUTH' ||
    !['EXACT', 'FORM_ONLY', 'STRUCTURE_MATCHED', 'CONTRADICTED', 'NOT_COMPARABLE'].includes(
      r.status,
    ) ||
    !Array.isArray(r.reasons) ||
    r.reasons.length > 16 ||
    r.reasons.some((x) => typeof x !== 'string' || x.length > 256) ||
    !Number.isSafeInteger(r.probes) ||
    r.probes < 0 ||
    r.probes > 512 ||
    !Number.isSafeInteger(r.kernelOperations) ||
    r.kernelOperations < 0 ||
    r.kernelOperations > 50000
  )
    throw surferFailure('Invalid structure comparison receipt.');
  if (r.status === 'CONTRADICTED') {
    if (
      !r.witness ||
      !['TRUE', 'FALSE'].includes(r.witness.left) ||
      !['TRUE', 'FALSE'].includes(r.witness.right) ||
      r.witness.left === r.witness.right ||
      r.probes === 0
    )
      throw surferFailure('A structure disagreement requires a witness.');
  } else if (r.witness !== null) throw surferFailure('Unexpected structure witness.');
  if (r.kernelOperations < 2 * r.probes || (r.probes === 0 && r.kernelOperations !== 0))
    throw surferFailure('Invalid structure probe accounting.');
  if (r.witness) {
    if (
      Object.keys(r.witness).sort().join(',') !== 'features,left,right' ||
      !r.witness.features ||
      typeof r.witness.features !== 'object'
    )
      throw surferFailure('Invalid structure witness envelope.');
    const entries = Object.entries(r.witness.features);
    if (!entries.length || entries.length > 9)
      throw surferFailure('Invalid witness feature budget.');
    for (const [key, value] of entries) {
      if (
        !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
        !value ||
        Object.keys(value).some((k) => k !== 'value' && k !== 'unit') ||
        !['number', 'string', 'boolean'].includes(typeof value.value) ||
        (typeof value.value === 'number' && !Number.isFinite(value.value)) ||
        (typeof value.value === 'string' && value.value.length > 256) ||
        (value.unit !== undefined &&
          (typeof value.value !== 'number' ||
            typeof value.unit !== 'string' ||
            !value.unit ||
            value.unit.length > 64))
      )
        throw surferFailure('Invalid structure witness feature.');
    }
  }
  return structuredClone(r);
}
