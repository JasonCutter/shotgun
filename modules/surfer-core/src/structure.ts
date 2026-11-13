import {
  decodeSurferStructureProposal,
  assertSurferStructureComparison,
  type SurferStructureProposal,
  type SurferStructureMention,
  type SurferStructureComparisonPort,
  type SurferStructureReferencePort,
} from '../../../packages/contracts/src/surfer-structure.js';
import {
  decodeSurferObservationSelections,
  validateSurferFrameGrounding,
  type SurferCognitiveSourcePort,
  type SurferCognitiveView,
} from '../../../packages/contracts/src/surfer-cognition.js';
import { assertSurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { parseSurferLiteral } from './cognition.js';
/** Checks provenance and explicit numeric mentions, never whether proposed meanings are true. */
export function groundSurferStructure(
  input: unknown,
  parentInput: unknown,
  view: SurferCognitiveView,
): SurferStructureProposal {
  const p = decodeSurferStructureProposal(input),
    parent = validateSurferFrameGrounding(parentInput, view.anchors, view.viewDigest),
    allowed = new Set(
      view.anchors.map((a) =>
        surferDigest({ anchorId: a.anchorId, revision: a.revision, digest: a.digest }),
      ),
    );
  const refs = (r: typeof p.anchorRefs) => {
    if (r.some((x) => !allowed.has(surferDigest(x))))
      throw surferFailure('Structure anchor is outside the current Source view.');
  };
  if (
    p.viewDigest !== view.viewDigest ||
    p.parentFrame.frameId !== parent.frameId ||
    p.parentFrame.digest !== surferDigest(parent) ||
    new Set(p.anchorRefs.map(surferDigest)).size !== allowed.size ||
    new Set(p.anchorRefs.map(surferDigest)).size !== p.anchorRefs.length
  )
    throw surferFailure('Structure parent/view/anchor binding changed.');
  refs(p.anchorRefs);
  const mention = (m: SurferStructureMention) => {
    refs([m.anchorRef]);
    const a = view.anchors.find((a) => a.anchorId === m.anchorRef.anchorId)!,
      chars = Array.from(a.rawLiteral);
    if (m.end > chars.length) throw surferFailure('Structure mention exceeds its Unicode anchor.');
    return chars.slice(m.start, m.end).join('');
  };
  const v = p.interpretation,
    structures =
      v.state === 'RESOLVED' ? [v.structure] : v.state === 'AMBIGUOUS' ? v.candidates : [];
  for (const s of structures) {
    s.entities.forEach((e) => mention(e.mention));
    for (const pred of s.predicates) {
      refs(pred.anchorRefs);
      const n = pred.operand;
      if (n.type === 'NUMBER') {
        if (!pred.anchorRefs.some((r) => surferDigest(r) === surferDigest(n.mention.anchorRef)))
          throw surferFailure('Numeric mention is not declared by its predicate.');
        const raw = mention(n.mention);
        const anchor = view.anchors.find((a) => a.anchorId === n.mention.anchorRef.anchorId)!;
        const chars = Array.from(anchor.rawLiteral),
          before = chars[n.mention.start - 1] ?? '',
          after = chars[n.mention.end] ?? '',
          tail = chars.slice(n.mention.end).join('');
        if (
          /[0-9.,_+\-\u2212]/u.test(before) ||
          /[0-9A-Za-z°%/_.+-]/u.test(after) ||
          /^,[0-9]/u.test(tail) ||
          (n.unit === null && /^[ \t]+[A-Za-z°%][A-Za-z0-9°%/_-]*/u.test(tail))
        )
          throw surferFailure('Numeric literal boundary truncates a stated number or unit.');
        const literal = parseSurferLiteral(raw);
        if (literal.kind !== 'NUMBER' || literal.decimal !== n.decimal || literal.unit !== n.unit)
          throw surferFailure('Numeric structure changed the stated literal/unit.');
      }
    }
    const t = s.assertion.scope.time;
    if (t) {
      refs(t.anchorRefs);
      for (const d of [t.from, t.to])
        if (
          d &&
          !view.anchors.some(
            (a) => t.anchorRefs.some((r) => r.anchorId === a.anchorId) && a.rawLiteral.includes(d),
          )
        )
          throw surferFailure('Structure time is not explicitly stated.');
    }
  }
  return p;
}
/** Server evaluation only. Reference capability is separate from model input and no endpoint is registered. */
export class SurferSourceStructureComparator {
  constructor(
    private readonly source: SurferCognitiveSourcePort,
    private readonly references: SurferStructureReferencePort,
    private readonly comparator: SurferStructureComparisonPort,
  ) {}
  async compare(
    actor: unknown,
    input: {
      schemaVersion: '1.0.0';
      basis: unknown;
      selections: unknown;
      frame: unknown;
      proposal: unknown;
      referenceId: string;
    },
  ) {
    assertSurferJson(input);
    const r = structuredClone(input);
    if (
      Object.keys(r).sort().join(',') !==
        'basis,frame,proposal,referenceId,schemaVersion,selections' ||
      r.schemaVersion !== '1.0.0' ||
      typeof r.referenceId !== 'string' ||
      !r.referenceId ||
      r.referenceId.length > 256
    )
      throw surferFailure('Invalid source structure comparison request.');
    assertSurferSourceBasisV2(r.basis);
    const selections = decodeSurferObservationSelections({
      schemaVersion: '1.0.0',
      selections: r.selections,
    }).selections;
    const candidate = await this.source.withCurrent(actor, r.basis, selections, (v) =>
      groundSurferStructure(r.proposal, r.frame, v),
    );
    const reference = await this.references.resolve({
      referenceId: r.referenceId,
      candidateDigest: surferDigest(candidate),
      viewDigest: candidate.viewDigest,
    });
    assertSurferJson(reference);
    if (
      reference.referenceDigest !==
        surferDigest({ frame: reference.frame, proposal: reference.proposal }) ||
      reference.comparatorRevision !== this.comparator.revision
    )
      throw surferFailure('Structure reference generation/comparator changed.');
    return this.source.withCurrent(actor, r.basis, selections, (v) => {
      const left = groundSurferStructure(candidate, r.frame, v),
        right = groundSurferStructure(reference.proposal, reference.frame, v),
        comparison = assertSurferStructureComparison(this.comparator.compare(left, right));
      if (
        comparison.leftDigest !== surferDigest(left) ||
        comparison.rightDigest !== surferDigest(right)
      )
        throw surferFailure('Structure comparison receipt belongs to different inputs.');
      return {
        schemaVersion: '1.0.0' as const,
        referenceId: r.referenceId,
        referenceDigest: reference.referenceDigest,
        candidateDigest: surferDigest(left),
        comparatorRevision: this.comparator.revision,
        comparison,
        sourceReceipt: structuredClone(v.readReceipt),
        validation: 'SOURCE_REFERENCES_AND_NUMERIC_LITERALS_ONLY' as const,
        authority: 'NO_FACT_OR_PUBLICATION_AUTHORITY' as const,
      };
    });
  }
}
