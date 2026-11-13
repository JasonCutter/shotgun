import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferDeclaredStructure,
  SurferStructureExpression,
  SurferStructureMention,
} from '../../../packages/contracts/src/surfer-structure.js';
import type {
  SurferClauseExtraction,
  SurferClauseBinding,
} from '../../../packages/contracts/src/surfer-clause.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { parseSurferLiteral } from '../../../modules/surfer-core/src/cognition.js';
import { groundSurferClauseExtraction } from '../../../modules/surfer-core/src/clause.js';
import {
  surferStructureParent,
  surferStructureMentionCatalog,
} from '../../surfer-structure-extraction/src/index.js';
import { SurferDeclaredStructureComparator } from '../../surfer-structure-comparison/src/index.js';
type Case = {
  id: string;
  text: string;
  entity: string;
  otherEntity?: string;
  action?: string;
  value?: boolean;
  condition?: { quote: string; number?: string; comparison?: 'gte' | 'lt'; value?: boolean }[];
  join?: 'ALL' | 'ANY';
  direction?: 'ONLY_IF';
  quantifier?: { kind: 'ALL'; domain: string };
  exception?: string;
  from?: string;
  to?: string;
  expectedState: 'RESOLVED' | 'UNMODELED';
};
type QuotePolicy = {
  cases: Record<string, { action?: string[]; conditions?: string[][]; exception?: string[] }>;
};
/** Authored oracle capability, independent from the model codec's wire-to-structure projection. */
export function createSurferClauseSuite(
  data: { cases: Case[] },
  policy: QuotePolicy,
  expectedCount = 12,
) {
  const cases = structuredClone(data.cases),
    quotes = structuredClone(policy),
    views = new Map<string, SurferCognitiveView>();
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 1 ||
    expectedCount > 24 ||
    cases.length !== expectedCount ||
    new Set(cases.map((c) => c.id)).size !== expectedCount
  )
    throw new Error('Clause dataset shape.');
  const manifest = {
    datasetId: 'surfer-fresh-clauses-v1',
    sourceDigest: surferDigest(cases.map(({ id, text }) => ({ id, text }))),
    oracleDigest: surferDigest({ cases, quotes }),
    evaluatorRevision: 'authored-clause-alignment-v1',
    records: cases.map(({ id }) => ({ id })),
  };
  function reference(id: string): SurferClauseExtraction {
    const c = cases.find((x) => x.id === id)!,
      v = views.get(id);
    if (!v) throw new Error('No current Source view.');
    const frame = surferStructureParent(
        v,
        'authored-clause:' + id,
        'AUTHORED_NOT_MODEL',
        manifest.evaluatorRevision,
      ),
      refs = frame.anchorRefs,
      inventory = surferStructureMentionCatalog(v);
    const mention = (text: string): SurferStructureMention => {
      const a = v.anchors.find((a) => a.rawLiteral.includes(text))!;
      const start = a.rawLiteral.indexOf(text),
        offset = Array.from(a.rawLiteral.slice(0, start)).length;
      if (start < 0) throw new Error('Authored clause missing.');
      return {
        anchorRef: { anchorId: a.anchorId, revision: a.revision, digest: a.digest },
        start: offset,
        end: offset + Array.from(text).length,
      };
    };
    const s: SurferDeclaredStructure = {
      entities: [
        { id: 'subject', mention: mention(c.entity) },
        ...(c.otherEntity ? [{ id: 'object', mention: mention(c.otherEntity) }] : []),
      ],
      predicates: [],
      assertion: {
        target: 'action',
        condition: null,
        direction: c.condition ? (c.direction ?? 'IF') : 'UNCONDITIONAL',
        quantifier: c.quantifier
          ? {
              kind: c.quantifier.kind,
              domain: c.quantifier.domain === c.entity ? 'subject' : 'object',
              predicate: 'action',
            }
          : null,
        exceptions: [],
        scope: {
          entities: ['subject'],
          condition: null,
          time: c.from
            ? { from: c.from, to: c.to!, fromInclusive: true, toInclusive: true, anchorRefs: refs }
            : null,
        },
        documentRole: 'NORMATIVE',
      },
    };
    const bindings: SurferClauseBinding[] = [];
    let n = 0,
      k = 0;
    if (c.expectedState === 'RESOLVED') {
      s.predicates.push({
        id: 'action',
        subject: 'subject',
        attribute: 'action',
        comparison: 'eq',
        operand: { type: 'BOOLEAN', value: c.value ?? true },
        anchorRefs: refs,
      });
      bindings.push({
        predicateId: 'action',
        role: 'ACTION',
        mention: mention(c.action!),
        quote: c.action!,
      });
      const conditions: SurferStructureExpression[] = [];
      for (const term of c.condition ?? []) {
        const id = term.number ? 'measure' + ++n : 'condition' + ++k;
        const literal = term.number ? parseSurferLiteral(term.number) : null;
        if (literal && literal.kind !== 'NUMBER') throw new Error('Authored number invalid.');
        s.predicates.push({
          id,
          subject: 'subject',
          attribute: id,
          comparison: term.comparison ?? 'eq',
          operand:
            literal?.kind === 'NUMBER'
              ? {
                  type: 'NUMBER',
                  decimal: literal.decimal,
                  unit: literal.unit,
                  mention: inventory.find((m) => m.rawLiteral === term.number)!.mention,
                }
              : { type: 'BOOLEAN', value: term.value ?? true },
          anchorRefs: refs,
        });
        conditions.push({ op: 'predicate', id });
        bindings.push({
          predicateId: id,
          role: 'CONDITION',
          mention: mention(term.quote),
          quote: term.quote,
        });
      }
      s.assertion.condition =
        conditions.length === 1
          ? conditions[0]!
          : conditions.length
            ? { op: c.join === 'ANY' ? 'any' : 'all', args: conditions }
            : null;
      if (c.exception) {
        s.predicates.push({
          id: 'exception1',
          subject: 'subject',
          attribute: 'exception1',
          comparison: 'eq',
          operand: { type: 'BOOLEAN', value: true },
          anchorRefs: refs,
        });
        s.assertion.exceptions = [
          { appliesTo: 'action', when: { op: 'predicate', id: 'exception1' } },
        ];
        bindings.push({
          predicateId: 'exception1',
          role: 'EXCEPTION',
          mention: mention(c.exception),
          quote: c.exception,
        });
      }
    }
    return groundSurferClauseExtraction(
      {
        schemaVersion: '1.0.0',
        contract: 'surfer.source-clauses.v1',
        frame,
        proposal: {
          schemaVersion: '1.0.0',
          contract: 'surfer.semantic-structure.v1',
          proposalId: 'authored-clause:' + id,
          parentFrame: { frameId: frame.frameId, digest: surferDigest(frame) },
          viewDigest: v.viewDigest,
          anchorRefs: refs,
          rendering: c.text,
          interpretation:
            c.expectedState === 'UNMODELED'
              ? { state: 'UNMODELED', reason: 'Relative date without base' }
              : { state: 'RESOLVED', structure: s },
        },
        bindings,
      },
      v,
    );
  }
  return {
    manifest,
    input(id: string) {
      const c = cases.find((c) => c.id === id);
      if (!c) throw new Error('Unknown clause case.');
      return { text: c.text, textDigest: surferDigest(c.text) };
    },
    bindView(id: string, v: SurferCognitiveView) {
      if (
        views.has(id) ||
        surferDigest(v.anchors.map((a) => a.rawLiteral).join('\n')) !== this.input(id).textDigest
      )
        throw new Error('View mismatch/rebind.');
      views.set(id, structuredClone(v));
      reference(id);
    },
    reference,
    evaluate(rows: { caseId: string; frame: unknown }[]) {
      const comparator = new SurferDeclaredStructureComparator();
      const results = cases.map((c) => {
        const row = rows.find((x) => x.caseId === c.id);
        try {
          const candidate = groundSurferClauseExtraction(row?.frame, views.get(c.id)!),
            ref = reference(c.id),
            comparison = comparator.compare(ref.proposal, candidate.proposal);
          let clauseAligned = true;
          if (candidate.proposal.interpretation.state === 'RESOLVED') {
            const q = quotes.cases[c.id]!;
            let k = 0;
            for (const bind of candidate.bindings) {
              const alternatives =
                bind.role === 'ACTION'
                  ? q.action
                  : bind.role === 'EXCEPTION'
                    ? q.exception
                    : q.conditions?.[k++];
              if (!alternatives?.includes(bind.quote)) clauseAligned = false;
            }
          }
          const stateMatched = c.expectedState === candidate.proposal.interpretation.state;
          return {
            caseId: c.id,
            status: 'GROUNDED',
            state: candidate.proposal.interpretation.state,
            comparison,
            clauseAligned,
            matched:
              stateMatched &&
              (c.expectedState === 'UNMODELED' ||
                (clauseAligned &&
                  ['EXACT', 'FORM_ONLY', 'STRUCTURE_MATCHED'].includes(comparison.status))),
          };
        } catch {
          return { caseId: c.id, status: row ? 'INVALID_OUTPUT' : 'NOT_OBSERVED', matched: false };
        }
      });
      return {
        scope: 'AUTHORED_STRUCTURE_AND_EXACT_CLAUSE_ALIGNMENT_NOT_SEMANTIC_CERTIFICATION',
        total: cases.length,
        grounded: results.filter((x) => x.status === 'GROUNDED').length,
        matched: results.filter((x) => x.matched).length,
        cases: results,
      };
    },
  };
}
