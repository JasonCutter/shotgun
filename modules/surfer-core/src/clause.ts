import type { SurferClauseExtraction } from '../../../packages/contracts/src/surfer-clause.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferStructureExpression } from '../../../packages/contracts/src/surfer-structure.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferStructure } from './structure.js';

/** Source binding only. Does not certify that clauses have been understood or that a statement is true. */
export function groundSurferClauseExtraction(
  input: unknown,
  view: SurferCognitiveView,
): SurferClauseExtraction {
  assertSurferJson(input);
  const b = structuredClone(input) as SurferClauseExtraction;
  if (
    !b ||
    Object.keys(b).sort().join(',') !== 'bindings,contract,frame,proposal,schemaVersion' ||
    b.schemaVersion !== '1.0.0' ||
    b.contract !== 'surfer.source-clauses.v1' ||
    !Array.isArray(b.bindings) ||
    b.bindings.length > 4
  )
    throw surferFailure('Invalid Source clause envelope.');
  const proposal = groundSurferStructure(b.proposal, b.frame, view);
  if (proposal.interpretation.state !== 'RESOLVED') {
    if (b.bindings.length)
      throw surferFailure('Unresolved structures cannot assert clause bindings.');
    return b;
  }
  const s = proposal.interpretation.structure;
  const ids = (x: SurferStructureExpression | null): string[] =>
    !x ? [] : x.op === 'predicate' ? [x.id] : x.op === 'not' ? ids(x.arg) : x.args.flatMap(ids);
  const conditions = ids(s.assertion.condition),
    exceptions = s.assertion.exceptions.flatMap((e) => ids(e.when));
  if (
    s.predicates.length !== b.bindings.length ||
    new Set(b.bindings.map((x) => x.predicateId)).size !== s.predicates.length
  )
    throw surferFailure('Clause predicate coverage changed.');
  const spans: { anchor: string; start: number; end: number }[] = [];
  for (const binding of b.bindings) {
    if (
      Object.keys(binding).sort().join(',') !== 'mention,predicateId,quote,role' ||
      typeof binding.quote !== 'string' ||
      binding.quote.length < 2 ||
      binding.quote.length > 256 ||
      binding.quote.trim() !== binding.quote
    )
      throw surferFailure('Invalid clause binding.');
    const p = s.predicates.find((p) => p.id === binding.predicateId),
      m = binding.mention;
    if (
      !p ||
      !m ||
      Object.keys(m).sort().join(',') !== 'anchorRef,end,start' ||
      !Number.isSafeInteger(m.start) ||
      !Number.isSafeInteger(m.end) ||
      m.start < 0 ||
      m.end <= m.start
    )
      throw surferFailure('Invalid clause predicate/position.');
    const a = view.anchors.find(
      (a) =>
        surferDigest({ anchorId: a.anchorId, revision: a.revision, digest: a.digest }) ===
        surferDigest(m.anchorRef),
    );
    if (
      !a ||
      m.end > Array.from(a.rawLiteral).length ||
      Array.from(a.rawLiteral).slice(m.start, m.end).join('') !== binding.quote ||
      !p.anchorRefs.some((r) => surferDigest(r) === surferDigest(m.anchorRef))
    )
      throw surferFailure('Clause is outside its exact Source anchor.');
    const role =
      p.id === s.assertion.target
        ? 'ACTION'
        : conditions.includes(p.id)
          ? 'CONDITION'
          : exceptions.includes(p.id)
            ? 'EXCEPTION'
            : null;
    if (
      binding.role !== role ||
      (role === 'ACTION' && p.attribute !== 'action') ||
      (role === 'EXCEPTION' && p.attribute !== 'exception1') ||
      (role === 'CONDITION' &&
        !new RegExp(p.operand.type === 'NUMBER' ? '^measure[12]$' : '^condition[12]$').test(
          p.attribute,
        ))
    )
      throw surferFailure('Clause role/predicate meaning binding changed.');
    if (spans.some((x) => x.anchor === a.anchorId && x.start < m.end && m.start < x.end))
      throw surferFailure('Overlapping action/condition/exception evidence is unsupported.');
    let occurrences = 0;
    for (const anchor of view.anchors) {
      let at = anchor.rawLiteral.indexOf(binding.quote);
      while (at >= 0) {
        occurrences++;
        at = anchor.rawLiteral.indexOf(binding.quote, at + 1);
      }
    }
    if (occurrences !== 1)
      throw surferFailure('Clause quote does not identify a unique Source occurrence.');
    spans.push({ anchor: a.anchorId, start: m.start, end: m.end });
    if (
      p.operand.type === 'NUMBER' &&
      (surferDigest(p.operand.mention.anchorRef) !== surferDigest(m.anchorRef) ||
        p.operand.mention.start < m.start ||
        p.operand.mention.end > m.end)
    )
      throw surferFailure('Numeric evidence is not inside its condition clause.');
  }
  if (
    s.assertion.scope.entities.length !== 1 ||
    s.predicates.find((p) => p.id === s.assertion.target)!.subject !== s.assertion.scope.entities[0]
  )
    throw surferFailure('Subject applicability is separate from quantifier domain/participants.');
  return b;
}
