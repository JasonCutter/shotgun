import {
  SURFER_ACTION_MODES,
  type SurferDirectiveExtraction,
} from '../../../packages/contracts/src/surfer-directive.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferClauseExtraction } from './clause.js';
/** Checks declared modality/state consistency and exact operation provenance; never meaning or Fact authority. */
export function groundSurferDirective(
  input: unknown,
  view: SurferCognitiveView,
): SurferDirectiveExtraction {
  assertSurferJson(input);
  const d = structuredClone(input) as SurferDirectiveExtraction;
  if (
    !d ||
    Object.keys(d).sort().join(',') !== 'clauses,contract,meaning,schemaVersion' ||
    d.schemaVersion !== '1.0.0' ||
    d.contract !== 'surfer.directive-meaning.v1'
  )
    throw surferFailure('Invalid directive envelope.');
  const c = groundSurferClauseExtraction(d.clauses, view);
  if (c.proposal.interpretation.state !== 'RESOLVED') {
    if (d.meaning !== null)
      throw surferFailure('Unresolved directive cannot claim operation meaning.');
    return d;
  }
  const m = d.meaning,
    s = c.proposal.interpretation.structure,
    a = m?.action,
    b = c.bindings.find((x) => x.role === 'ACTION')!,
    target = s.predicates.find((x) => x.id === s.assertion.target)!;
  if (
    !m ||
    Object.keys(m).sort().join(',') !== 'action,exceptionTruth' ||
    !a ||
    Object.keys(a).sort().join(',') !== 'mode,operation,operationQuote' ||
    !SURFER_ACTION_MODES.includes(a.mode) ||
    typeof a.operationQuote !== 'string' ||
    !a.operationQuote.length ||
    a.operationQuote.length > 128 ||
    a.operationQuote.trim() !== a.operationQuote ||
    target.operand.type !== 'BOOLEAN' ||
    target.operand.value !== ['REQUIRED', 'ASSERTED'].includes(a.mode)
  )
    throw surferFailure('Directive mode and action truth disagree.');
  const normative = ['REQUIRED', 'PROHIBITED'].includes(a.mode);
  if (
    s.assertion.documentRole !== 'EXAMPLE' &&
    normative !== (s.assertion.documentRole === 'NORMATIVE')
  )
    throw surferFailure('Directive modality and document role disagree.');
  const p = a.operation;
  if (
    !p ||
    Object.keys(p).sort().join(',') !== 'anchorRef,end,start' ||
    !Number.isSafeInteger(p.start) ||
    !Number.isSafeInteger(p.end) ||
    p.end <= p.start ||
    surferDigest(p.anchorRef) !== surferDigest(b.mention.anchorRef) ||
    p.start < b.mention.start ||
    p.end > b.mention.end
  )
    throw surferFailure('Operation is outside its action evidence.');
  const anchor = view.anchors.find((x) => x.anchorId === p.anchorRef.anchorId)!;
  if (Array.from(anchor.rawLiteral).slice(p.start, p.end).join('') !== a.operationQuote)
    throw surferFailure('Operation quote is not an exact Source subspan.');
  const exc = s.predicates.find((x) => x.id === 'exception1');
  if (
    !exc
      ? m.exceptionTruth !== null
      : !['TRUE', 'FALSE'].includes(m.exceptionTruth ?? '') ||
        exc.operand.type !== 'BOOLEAN' ||
        exc.operand.value !== (m.exceptionTruth === 'TRUE')
  )
    throw surferFailure('Exception antecedent and exemption effect are mixed.');
  return d;
}
