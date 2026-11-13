import type { SurferProviderCodec } from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferObservedProviderResponse,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import type {
  SurferMemoryLanguageContext,
  SurferNaturalQuestionProposal,
} from '../../../packages/contracts/src/surfer-memory-language.js';
import { SurferMemoryQuestionCodec } from './memory-question.js';
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const text = { type: 'string', minLength: 1, maxLength: 256 };
/** Post-v1 diagnostic improvement. Closed per-candidate predicate IDs; no natural-language ID repair. */
export class SurferMemoryQuestionCodecV2 implements SurferProviderCodec<SurferNaturalQuestionProposal> {
  readonly revision = 'surfer-memory-language-role-catalog-v2';
  private readonly original: SurferMemoryQuestionCodec;
  private readonly catalog: SurferMemoryLanguageContext;
  constructor(context: SurferMemoryLanguageContext) {
    this.original = new SurferMemoryQuestionCodec(context);
    this.catalog = structuredClone(context);
  }
  generation(view: SurferCognitiveView, profile: SurferProviderProfile) {
    const base = this.original.generation(view, profile);
    const branches = this.catalog.candidates.map((c) => {
      const p = c.packet.clauses.proposal.interpretation;
      const roles = c.packet.clauses.bindings.filter((b) => b.role !== 'ACTION');
      const bool = roles
        .filter(
          (b) =>
            p.state === 'RESOLVED' &&
            p.structure.predicates.find((v) => v.id === b.predicateId)?.operand.type === 'BOOLEAN',
        )
        .map((b) => b.predicateId);
      const number = roles
        .filter(
          (b) =>
            p.state === 'RESOLVED' &&
            p.structure.predicates.find((v) => v.id === b.predicateId)?.operand.type === 'NUMBER',
        )
        .map((b) => b.predicateId);
      const items = [
        ...(bool.length
          ? [
              object({
                predicate: { enum: bool },
                type: { const: 'BOOLEAN' },
                truth: { enum: ['TRUE', 'FALSE'] },
                quote: text,
              }),
            ]
          : []),
        ...(number.length
          ? [object({ predicate: { enum: number }, type: { const: 'NUMBER' }, quote: text })]
          : []),
      ];
      return object({
        state: { const: 'RESOLVED' },
        candidate: { const: c.candidateId },
        kind: { enum: ['RECALL', 'APPLY'] },
        observations: items.length
          ? { type: 'array', maxItems: roles.length, items: { anyOf: items } }
          : { type: 'array', maxItems: 0, items: false },
        dateQuote: { anyOf: [text, { type: 'null' }] },
      });
    });
    return {
      ...base,
      systemInstruction:
        base.systemInstruction.replace(this.original.revision, this.revision) +
        `
The predicate property MUST copy an exact machine ID from this candidate's roles[].predicate, e.g. "condition1", "measure1", "exception1". Never write a condition sentence in predicate. The candidate ID and its allowed predicates are constrained together by the JSON schema.
BOOLEAN truth records the underlying variable's state in the question. Example: if the catalog predicate is "approval is false", a question stating "approval is false" supplies truth="FALSE" for that predicate ID, because approval itself is false. It does NOT supply TRUE for the fact that the sentence is true. An exception "drill is true" with a question "not a drill" supplies FALSE. Copy the complete original question phrase in quote. Do not negate the underlying state to match the memory comparison.`,
      responseSchema: object({
        interpretation: {
          anyOf: [
            object({ state: { enum: ['AMBIGUOUS', 'UNMODELED', 'MISSING'] }, reason: text }),
            ...branches,
          ],
        },
      }),
    };
  }
  decode(
    response: SurferObservedProviderResponse,
    view: SurferCognitiveView,
    reservationId: string,
    profile: SurferProviderProfile,
  ) {
    if (profile.promptRevision !== this.revision) return null;
    const proposal = this.original.decode(response, view, reservationId, {
      ...profile,
      promptRevision: this.original.revision,
    });
    return proposal
      ? { ...proposal, producer: { ...proposal.producer, promptRevision: this.revision } }
      : null;
  }
}
