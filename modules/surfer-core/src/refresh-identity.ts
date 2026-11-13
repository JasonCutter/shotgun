import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import { groundSurferDirectiveV2 } from './directive-v2.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
export function refreshIdentity(packet: SurferDirectiveExtractionV2, view: SurferCognitiveView) {
  const grounded = groundSurferDirectiveV2(packet, view),
    v = grounded.clauses.proposal.interpretation;
  if (v.state !== 'RESOLVED' || !grounded.meaning)
    throw surferFailure('Refresh interpretation is unresolved.');
  const entity = v.structure.entities.find(
    (e) =>
      e.id === v.structure.predicates.find((p) => p.id === v.structure.assertion.target)!.subject,
  )!;
  const anchor = view.anchors.find((a) => a.anchorId === entity.mention.anchorRef.anchorId)!;
  return {
    subject: Array.from(anchor.rawLiteral).slice(entity.mention.start, entity.mention.end).join(''),
    operation: grounded.meaning.action.operationQuote,
  };
}
export function uniqueRefreshIdentity(
  text: string,
  identity: { subject: string; operation: string },
) {
  const occurrences = (term: string, identifier: boolean) => {
    if (!term.length) return 0;
    const chars = Array.from(text),
      needle = Array.from(term);
    let count = 0;
    for (let i = 0; i <= chars.length - needle.length; i++) {
      if (chars.slice(i, i + needle.length).join('') !== term) continue;
      // ASCII IDs may be followed by Korean particles, but V28 must not match V280/V28_A.
      const part = (v: string | undefined) => !!v && /[A-Za-z0-9_-]/.test(v);
      if (identifier && (part(chars[i - 1]) || part(chars[i + needle.length]))) continue;
      count++;
    }
    return count;
  };
  return (
    occurrences(identity.subject, /^[A-Za-z0-9_-]+$/.test(identity.subject)) === 1 &&
    occurrences(identity.operation, false) === 1
  );
}
