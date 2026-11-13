import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferDirective } from './directive.js';
export function groundSurferDirectiveV2(
  input: unknown,
  view: SurferCognitiveView,
): SurferDirectiveExtractionV2 {
  assertSurferJson(input);
  const d = structuredClone(input) as SurferDirectiveExtractionV2;
  if (
    !d ||
    Object.keys(d).sort().join(',') !== 'clauses,contract,meaning,schemaVersion' ||
    d.contract !== 'surfer.directive-meaning.v2'
  )
    throw surferFailure('Invalid directive v2 envelope.');
  const m = d.meaning;
  if (
    m &&
    Object.keys(m.action).sort().join(',') !==
      'evidence,evidenceQuote,mode,operation,operationQuote'
  )
    throw surferFailure('Invalid action context fields.');
  groundSurferDirective(
    {
      ...d,
      contract: 'surfer.directive-meaning.v1',
      meaning: m
        ? {
            ...m,
            action: {
              mode: m.action.mode,
              operationQuote: m.action.operationQuote,
              operation: m.action.operation,
            },
          }
        : null,
    },
    view,
  );
  if (!m) return d;
  const a = m.action,
    b = d.clauses.bindings.find((x) => x.role === 'ACTION')!,
    e = a.evidence;
  if (b.quote !== a.operationQuote || surferDigest(b.mention) !== surferDigest(a.operation))
    throw surferFailure('Action atom must be the operation, not its entire evidence sentence.');
  if (
    !e ||
    Object.keys(e).sort().join(',') !== 'anchorRef,end,start' ||
    !Number.isSafeInteger(e.start) ||
    !Number.isSafeInteger(e.end) ||
    e.start < 0 ||
    e.end <= e.start ||
    surferDigest(e.anchorRef) !== surferDigest(a.operation.anchorRef) ||
    e.start > a.operation.start ||
    e.end < a.operation.end ||
    typeof a.evidenceQuote !== 'string' ||
    a.evidenceQuote.length < 2 ||
    a.evidenceQuote.length > 256 ||
    a.evidenceQuote.trim() !== a.evidenceQuote
  )
    throw surferFailure('Operation is outside its broad evidence context.');
  const anchor = view.anchors.find((x) => x.anchorId === e.anchorRef.anchorId)!;
  if (
    e.end > Array.from(anchor.rawLiteral).length ||
    Array.from(anchor.rawLiteral).slice(e.start, e.end).join('') !== a.evidenceQuote
  )
    throw surferFailure('Context evidence is not an exact Source span.');
  return d;
}
