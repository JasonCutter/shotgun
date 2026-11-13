import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferClauseExtraction } from '../../../packages/contracts/src/surfer-clause.js';
import type {
  SurferActionMode,
  SurferStateTruth,
} from '../../../packages/contracts/src/surfer-directive.js';
import { groundSurferDirectiveV2 } from '../../../modules/surfer-core/src/directive-v2.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { SurferDeclaredStructureComparator } from '../../surfer-structure-comparison/src/index.js';
export type SurferDocumentMemoryExpectation = {
  operation: string;
  mode: SurferActionMode;
  exceptionTruth: SurferStateTruth | null;
  cores: { action: string; conditions?: string[]; exception?: string };
};
/** Evaluator-only independent reference. Contract enum truth is distinct from Boolean observation values. */
export function compareSurferDocumentMemory(
  view: SurferCognitiveView,
  reference: SurferClauseExtraction,
  packet: unknown,
  expected: SurferDocumentMemoryExpectation,
) {
  try {
    if (expected.exceptionTruth !== null && !['TRUE', 'FALSE'].includes(expected.exceptionTruth))
      throw Error('Invalid truth enum reference.');
    const p = groundSurferDirectiveV2(packet, view),
      left = reference.proposal.interpretation,
      right = p.clauses.proposal.interpretation;
    if (left.state !== 'RESOLVED' || right.state !== 'RESOLVED' || !p.meaning)
      throw Error('Unresolved reference/proposal.');
    const comparison = new SurferDeclaredStructureComparator().compare(
      reference.proposal,
      p.clauses.proposal,
    );
    let index = 0;
    const coverage = reference.bindings.map((binding) => {
      const rp = left.structure.predicates.find((v) => v.id === binding.predicateId)!,
        entity = left.structure.entities.find((v) => v.id === rp.subject)!;
      const candidates = p.clauses.bindings.filter((b) => {
        const pred = right.structure.predicates.find((v) => v.id === b.predicateId)!,
          subject = right.structure.entities.find((v) => v.id === pred.subject)!;
        return (
          b.role === binding.role &&
          pred.attribute === rp.attribute &&
          surferDigest(subject.mention) === surferDigest(entity.mention)
        );
      });
      const core =
        binding.role === 'ACTION'
          ? expected.cores.action
          : binding.role === 'EXCEPTION'
            ? expected.cores.exception
            : expected.cores.conditions?.[index++];
      const anchor = view.anchors.find((v) => v.anchorId === binding.mention.anchorRef.anchorId)!;
      if (
        !core ||
        anchor.rawLiteral.indexOf(core) < 0 ||
        anchor.rawLiteral.indexOf(core, anchor.rawLiteral.indexOf(core) + 1) >= 0
      )
        throw Error('Reference core is not a unique Source occurrence.');
      const start = Array.from(anchor.rawLiteral.slice(0, anchor.rawLiteral.indexOf(core))).length,
        end = start + Array.from(core).length;
      return {
        predicateId: rp.id,
        covered:
          candidates.length === 1 &&
          surferDigest(candidates[0]!.mention.anchorRef) ===
            surferDigest(binding.mention.anchorRef) &&
          candidates[0]!.mention.start <= start &&
          candidates[0]!.mention.end >= end,
      };
    });
    const operationExact = p.meaning.action.operationQuote === expected.operation,
      modeExact = p.meaning.action.mode === expected.mode,
      exceptionTruthExact = p.meaning.exceptionTruth === expected.exceptionTruth;
    return {
      scope: 'DECLARED_EXTRACTION_REFERENCE_NOT_POPULATION_CERTIFICATION' as const,
      revision: 'surfer.document-memory-comparison.v2',
      matched:
        ['EXACT', 'FORM_ONLY', 'STRUCTURE_MATCHED'].includes(comparison.status) &&
        coverage.length > 0 &&
        coverage.every((v) => v.covered) &&
        operationExact &&
        modeExact &&
        exceptionTruthExact,
      comparison,
      coverage,
      operationExact,
      modeExact,
      exceptionTruthExact,
    };
  } catch {
    return {
      scope: 'DECLARED_EXTRACTION_REFERENCE_NOT_POPULATION_CERTIFICATION' as const,
      revision: 'surfer.document-memory-comparison.v2',
      matched: false,
    };
  }
}
