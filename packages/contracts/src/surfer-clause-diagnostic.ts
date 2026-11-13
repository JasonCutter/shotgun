import type { SurferClauseExtraction } from './surfer-clause.js';
import type { SurferCognitiveView } from './surfer-cognition.js';
export type SurferClauseSpanRelation =
  | 'EXACT_SPAN'
  | 'CONTEXT_EXPANSION'
  | 'CONTEXT_NARROWING'
  | 'PARTIAL_OVERLAP'
  | 'DISJOINT'
  | 'UNALIGNED';
export type SurferClauseEvidenceDiagnostic = {
  scope: 'SOURCE_SPAN_RELATION_NOT_MEANING';
  status: 'COMPARED' | 'UNRESOLVED';
  leftDigest: string;
  rightDigest: string;
  relations: {
    leftPredicateId: string;
    rightPredicateId: string | null;
    relation: SurferClauseSpanRelation;
  }[];
  semanticEquivalence: null;
};
/** Diagnostic capability only; it never normalizes negation, repairs a model response, or awards a score. */
export interface SurferClauseEvidenceComparisonPort {
  compare(
    left: SurferClauseExtraction,
    right: SurferClauseExtraction,
    view: SurferCognitiveView,
  ): SurferClauseEvidenceDiagnostic;
}
