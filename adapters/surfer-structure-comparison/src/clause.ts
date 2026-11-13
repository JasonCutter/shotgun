import type {
  SurferClauseExtraction,
  SurferClauseBinding,
} from '../../../packages/contracts/src/surfer-clause.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferClauseEvidenceComparisonPort,
  SurferClauseEvidenceDiagnostic,
  SurferClauseSpanRelation,
} from '../../../packages/contracts/src/surfer-clause-diagnostic.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferClauseExtraction } from '../../../modules/surfer-core/src/clause.js';
export class SurferClauseEvidenceComparator implements SurferClauseEvidenceComparisonPort {
  compare(
    left: SurferClauseExtraction,
    right: SurferClauseExtraction,
    view: SurferCognitiveView,
  ): SurferClauseEvidenceDiagnostic {
    const a = groundSurferClauseExtraction(left, view),
      b = groundSurferClauseExtraction(right, view);
    const key = (bundle: SurferClauseExtraction, binding: SurferClauseBinding) => {
      if (bundle.proposal.interpretation.state !== 'RESOLVED') return null;
      const s = bundle.proposal.interpretation.structure,
        p = s.predicates.find((p) => p.id === binding.predicateId)!,
        subject = s.entities.find((e) => e.id === p.subject)!;
      return surferDigest({ role: binding.role, attribute: p.attribute, subject: subject.mention });
    };
    return {
      scope: 'SOURCE_SPAN_RELATION_NOT_MEANING',
      status:
        a.proposal.interpretation.state === 'RESOLVED' &&
        b.proposal.interpretation.state === 'RESOLVED'
          ? 'COMPARED'
          : 'UNRESOLVED',
      leftDigest: surferDigest(a),
      rightDigest: surferDigest(b),
      semanticEquivalence: null,
      relations: a.bindings.map((x) => {
        const candidates = b.bindings.filter((y) => key(a, x) === key(b, y));
        const y = candidates.length === 1 ? candidates[0]! : null;
        let relation: SurferClauseSpanRelation = 'UNALIGNED';
        if (y && surferDigest(x.mention.anchorRef) === surferDigest(y.mention.anchorRef)) {
          const l = x.mention,
            r = y.mention;
          relation =
            l.start === r.start && l.end === r.end
              ? 'EXACT_SPAN'
              : r.start <= l.start && r.end >= l.end
                ? 'CONTEXT_EXPANSION'
                : l.start <= r.start && l.end >= r.end
                  ? 'CONTEXT_NARROWING'
                  : l.start < r.end && r.start < l.end
                    ? 'PARTIAL_OVERLAP'
                    : 'DISJOINT';
        }
        return {
          leftPredicateId: x.predicateId,
          rightPredicateId: y?.predicateId ?? null,
          relation,
        };
      }),
    };
  }
}
