import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferClauseExtraction } from '../../../modules/surfer-core/src/clause.js';
import { groundSurferDirective } from '../../../modules/surfer-core/src/directive.js';
import { SurferDeclaredStructureComparator } from '../../surfer-structure-comparison/src/index.js';
import { createSurferClauseSuite } from './clause.js';
type Data = Parameters<typeof createSurferClauseSuite>[0];
type Policy = {
  cases: Record<string, { action: string; conditions?: string[]; exception?: string }>;
};
/** Same sealed oracle/policy for both arms, including failures/abstentions in the whole supported-task denominator. */
export function createSurferDirectivePairedSuite(data: Data, policy: Policy) {
  const cases = structuredClone(data.cases),
    cores = structuredClone(policy),
    views = new Map<string, SurferCognitiveView>();
  const exactPolicy = {
    cases: Object.fromEntries(
      cases.map((c) => [
        c.id,
        {
          action: [c.action!],
          ...(c.condition ? { conditions: c.condition.map((t) => [t.quote]) } : {}),
          ...(c.exception ? { exception: [c.exception] } : {}),
        },
      ]),
    ),
  };
  const base = createSurferClauseSuite(data, exactPolicy, 8);
  const manifest = {
    ...base.manifest,
    datasetId: 'surfer-directive-paired-v1',
    oracleDigest: surferDigest({ cases, cores }),
    evaluatorRevision: 'same-source-core-coverage-v1',
  };
  return {
    manifest,
    input: base.input,
    reference: base.reference,
    bindView(id: string, v: SurferCognitiveView) {
      base.bindView(id, v);
      views.set(id, structuredClone(v));
    },
    evaluate(rows: { caseId: string; frame: unknown }[]) {
      const comparator = new SurferDeclaredStructureComparator();
      const results = cases.map((c) => {
        const row = rows.find((x) => x.caseId === c.id),
          view = views.get(c.id)!;
        try {
          const raw = row?.frame as { contract?: string },
            bundle =
              raw?.contract === 'surfer.directive-meaning.v1'
                ? groundSurferDirective(raw, view).clauses
                : groundSurferClauseExtraction(raw, view);
          const ref = base.reference(c.id),
            comparison = comparator.compare(ref.proposal, bundle.proposal);
          if (bundle.proposal.interpretation.state !== 'RESOLVED')
            return {
              caseId: c.id,
              state: bundle.proposal.interpretation.state,
              status: 'ABSTAINED',
              solved: false,
              comparison,
            };
          const s = bundle.proposal.interpretation.structure;
          const quoteCoverage: { predicateId: string; covered: boolean }[] = [];
          let i = 0;
          for (const expected of ref.bindings) {
            const refStructure = ref.proposal.interpretation;
            if (refStructure.state !== 'RESOLVED') throw new Error('Reference profile.');
            const rp = refStructure.structure.predicates.find(
              (p) => p.id === expected.predicateId,
            )!;
            const subject = refStructure.structure.entities.find((e) => e.id === rp.subject)!;
            const candidates = bundle.bindings.filter((b) => {
              const p = s.predicates.find((p) => p.id === b.predicateId)!,
                entity = s.entities.find((e) => e.id === p.subject)!;
              return (
                b.role === expected.role &&
                p.attribute === rp.attribute &&
                surferDigest(entity.mention) === surferDigest(subject.mention)
              );
            });
            const core =
              expected.role === 'ACTION'
                ? cores.cases[c.id]!.action
                : expected.role === 'EXCEPTION'
                  ? cores.cases[c.id]!.exception
                  : cores.cases[c.id]!.conditions?.[i++];
            const a = view.anchors.find((a) => a.anchorId === expected.mention.anchorRef.anchorId)!;
            if (
              !core ||
              a.rawLiteral.indexOf(core) < 0 ||
              a.rawLiteral.indexOf(core, a.rawLiteral.indexOf(core) + 1) >= 0
            )
              throw new Error('Authored core must identify a unique Source occurrence.');
            const start = Array.from(a.rawLiteral.slice(0, a.rawLiteral.indexOf(core))).length,
              end = start + Array.from(core).length;
            quoteCoverage.push({
              predicateId: rp.id,
              covered:
                candidates.length === 1 &&
                surferDigest(candidates[0]!.mention.anchorRef) ===
                  surferDigest(expected.mention.anchorRef) &&
                candidates[0]!.mention.start <= start &&
                candidates[0]!.mention.end >= end,
            });
          }
          const solved =
            ['EXACT', 'FORM_ONLY', 'STRUCTURE_MATCHED'].includes(comparison.status) &&
            quoteCoverage.length > 0 &&
            quoteCoverage.every((x) => x.covered);
          return {
            caseId: c.id,
            state: 'RESOLVED',
            status: 'GROUNDED',
            solved,
            comparison,
            quoteCoverage,
          };
        } catch {
          return { caseId: c.id, status: row ? 'INVALID_OUTPUT' : 'NOT_OBSERVED', solved: false };
        }
      });
      return {
        scope: 'PAIRED_AUTHORED_SUPPORTED_TASKS_NOT_POPULATION_CERTIFICATION',
        total: 8,
        resolved: results.filter((x) => x.state === 'RESOLVED').length,
        abstained: results.filter((x) => x.status === 'ABSTAINED').length,
        invalid: results.filter((x) => x.status === 'INVALID_OUTPUT').length,
        solved: results.filter((x) => x.solved).length,
        cases: results,
      };
    },
  };
}
