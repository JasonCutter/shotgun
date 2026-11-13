import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferDeclaredStructure,
  SurferStructureExpression,
  SurferStructureProposal,
} from '../../../packages/contracts/src/surfer-structure.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import {
  surferStructureParent,
  surferStructureMentionCatalog,
  type SurferStructureExtraction,
} from '../../surfer-structure-extraction/src/index.js';
import {
  groundSurferStructure,
  parseSurferLiteral,
} from '../../../modules/surfer-core/src/index.js';
import { SurferDeclaredStructureComparator } from '../../surfer-structure-comparison/src/index.js';

export type SurferExtractionCase = {
  id: string;
  text: string;
  entity: string;
  otherEntity?: string;
  kind: string;
  number?: string;
  from?: string;
  to?: string;
  expectedState: string;
};
/** Private authored diagnostic oracle. Only input() may supply model text; no expected structure in generation. */
export function createSurferExtractionSuite(
  data: { cases: SurferExtractionCase[] },
  selectedIds?: string[],
) {
  const cases = structuredClone(
      selectedIds ? data.cases.filter((x) => selectedIds.includes(x.id)) : data.cases,
    ),
    views = new Map<string, SurferCognitiveView>();
  if (
    data.cases.length !== 12 ||
    !cases.length ||
    cases.length > 12 ||
    new Set(cases.map((x) => x.id)).size !== cases.length ||
    (selectedIds &&
      (new Set(selectedIds).size !== selectedIds.length || selectedIds.length !== cases.length))
  )
    throw new Error('Extraction dataset shape changed.');
  const manifest = {
    datasetId: 'surfer-fresh-extraction-v1',
    sourceDigest: surferDigest(cases.map(({ id, text }) => ({ id, text }))),
    oracleDigest: surferDigest(cases),
    evaluatorRevision: 'authored-extraction-roles-reference-v1',
    records: cases.map(({ id }) => ({ id })),
  };
  function reference(id: string) {
    const item = cases.find((x) => x.id === id)!,
      view = views.get(id);
    if (!view) throw new Error('Reference requires current Source view.');
    const frame = surferStructureParent(
      view,
      'authored-reference:' + id,
      'AUTHORED_NOT_MODEL',
      manifest.evaluatorRevision,
    );
    const refs = frame.anchorRefs,
      catalog = surferStructureMentionCatalog(view);
    const mention = (text: string) => {
      const m = catalog.find((x) => x.rawLiteral === text);
      if (!m) throw new Error('Authored literal missing.');
      return m.mention;
    };
    const predicate = (id: string): SurferStructureExpression => ({ op: 'predicate', id });
    const s: SurferDeclaredStructure = {
      entities: [
        { id: 'subject', mention: mention(item.entity) },
        ...(item.otherEntity ? [{ id: 'object', mention: mention(item.otherEntity) }] : []),
      ],
      predicates: [
        {
          id: 'action',
          subject: 'subject',
          attribute: 'action',
          comparison: 'eq',
          operand: { type: 'BOOLEAN', value: item.kind !== 'polarity' },
          anchorRefs: refs,
        },
      ],
      assertion: {
        target: 'action',
        condition: null,
        direction: 'UNCONDITIONAL',
        quantifier: null,
        exceptions: [],
        scope: { entities: ['subject'], condition: null, time: null },
        documentRole: 'NORMATIVE',
      },
    };
    const boolean = (id: string) =>
      s.predicates.push({
        id,
        subject: 'subject',
        attribute: id,
        comparison: 'eq',
        operand: { type: 'BOOLEAN', value: true },
        anchorRefs: refs,
      });
    if (['direction', 'conjunction', 'exception', 'form'].includes(item.kind)) {
      boolean('condition1');
      s.assertion.condition = predicate('condition1');
      s.assertion.direction = item.kind === 'direction' ? 'ONLY_IF' : 'IF';
    }
    if (item.kind === 'conjunction') {
      boolean('condition2');
      s.assertion.condition = {
        op: 'all',
        args: [predicate('condition1'), predicate('condition2')],
      };
    }
    if (item.number) {
      const n = parseSurferLiteral(item.number);
      if (n.kind !== 'NUMBER') throw new Error('Number invalid.');
      s.predicates.push({
        id: 'measure1',
        subject: 'subject',
        attribute: 'measure1',
        comparison: 'gte',
        operand: {
          type: 'NUMBER',
          decimal: n.decimal,
          unit: n.unit,
          mention: mention(item.number),
        },
        anchorRefs: refs,
      });
      s.assertion.direction = 'IF';
      s.assertion.condition = predicate('measure1');
    }
    if (['quantifier', 'quantifier-domain'].includes(item.kind))
      s.assertion.quantifier = {
        kind: 'ALL',
        domain: item.otherEntity ? 'object' : 'subject',
        predicate: 'action',
      };
    if (item.kind === 'exception') {
      boolean('exception1');
      s.assertion.exceptions = [{ appliesTo: 'action', when: predicate('exception1') }];
    }
    if (item.kind === 'time')
      s.assertion.scope.time = {
        from: item.from!,
        to: item.to!,
        fromInclusive: true,
        toInclusive: true,
        anchorRefs: refs,
      };
    const proposal: SurferStructureProposal = {
      schemaVersion: '1.0.0',
      contract: 'surfer.semantic-structure.v1',
      proposalId: 'reference:' + id,
      parentFrame: { frameId: frame.frameId, digest: surferDigest(frame) },
      viewDigest: view.viewDigest,
      anchorRefs: refs,
      rendering: item.text,
      interpretation:
        item.expectedState === 'UNMODELED'
          ? { state: 'UNMODELED', reason: 'Relative date without base date' }
          : { state: 'RESOLVED', structure: s },
    };
    return { frame, proposal: groundSurferStructure(proposal, frame, view) };
  }
  return {
    manifest,
    input(id: string) {
      const c = cases.find((x) => x.id === id);
      if (!c) throw new Error('Unknown extraction case.');
      return { text: c.text, textDigest: surferDigest(c.text) };
    },
    bindView(id: string, view: SurferCognitiveView) {
      if (
        views.has(id) ||
        surferDigest(view.anchors.map((x) => x.rawLiteral).join('\n')) !== this.input(id).textDigest
      )
        throw new Error('Source view mismatch/rebind.');
      views.set(id, structuredClone(view));
      reference(id);
    },
    reference,
    evaluate(rows: { caseId: string; frame: unknown }[]) {
      const comparator = new SurferDeclaredStructureComparator();
      const results = cases.map((c) => {
        const row = rows.find((x) => x.caseId === c.id);
        try {
          const v = row?.frame as SurferStructureExtraction;
          const ref = reference(c.id),
            view = views.get(c.id)!;
          const p = groundSurferStructure(v.proposal, v.frame, view);
          const comparison = comparator.compare(ref.proposal, p);
          return {
            caseId: c.id,
            status: 'GROUNDED',
            state: p.interpretation.state,
            expectedState: c.expectedState,
            stateMatched: p.interpretation.state === c.expectedState,
            comparison,
            matched:
              c.expectedState === 'UNMODELED'
                ? p.interpretation.state === 'UNMODELED'
                : ['EXACT', 'FORM_ONLY', 'STRUCTURE_MATCHED'].includes(comparison.status),
          };
        } catch {
          return { caseId: c.id, status: row ? 'INVALID_OUTPUT' : 'NOT_OBSERVED', matched: false };
        }
      });
      return {
        scope: 'AUTHORED_DIAGNOSTIC_NOT_POPULATION_SEMANTIC_CERTIFICATION',
        total: cases.length,
        grounded: results.filter((x) => x.status === 'GROUNDED').length,
        matched: results.filter((x) => x.matched).length,
        cases: results,
      };
    },
  };
}
