import type { SurferProviderCodec } from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import type {
  SurferObservedProviderResponse,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import { surferStructureMentionCatalog } from './index.js';
import { SurferDirectiveExtractionCodecV2 } from './directive-v2.js';

/** Generation-only role guidance. Reuses the unchanged v2 decoder and never repairs a model's chosen aliases. */
export class SurferDirectiveExtractionCodecV3 implements SurferProviderCodec<SurferDirectiveExtractionV2> {
  readonly revision = 'surfer-directive-role-catalog-v3';
  private readonly previous = new SurferDirectiveExtractionCodecV2();
  generation(view: SurferCognitiveView, profile: SurferProviderProfile) {
    const g = this.previous.generation(view, profile),
      catalog = surferStructureMentionCatalog(view),
      ofKind = (kind: (typeof catalog)[number]['kind']) => catalog.filter((m) => m.kind === kind),
      entities = ofKind('ENTITY_ID'),
      numbers = ofKind('NUMBER'),
      dates = ofKind('DATE');
    const choices = (items: typeof catalog): Record<string, unknown> | false =>
      items.length ? { type: 'string', enum: items.map((m) => m.alias) } : false;
    const transform = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(transform);
      if (!input || typeof input !== 'object') return input;
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          key === 'subject' || key === 'domain'
            ? choices(entities)
            : key === 'mention'
              ? choices(numbers)
              : key === 'subjectScope'
                ? { ...(value as Record<string, unknown>), items: choices(entities) }
                : key === 'from' || key === 'to'
                  ? { anyOf: [choices(dates), { type: 'null' }] }
                  : transform(value),
        ]),
      );
    };
    const schema = transform(g.responseSchema) as {
      properties: { interpretation: { anyOf: unknown[] } };
    };
    if (!entities.length) schema.properties.interpretation.anyOf[1] = false;
    const labels = (items: typeof catalog) =>
      items.map(({ alias, rawLiteral, anchorAlias }) => ({ alias, rawLiteral, anchorAlias }));
    return {
      ...g,
      responseSchema: schema,
      systemInstruction:
        g.systemInstruction.replace(this.previous.revision, this.revision) +
        '\nChoose aliases by ROLE, never by their order in the Source: subjects/domains/subjectScope use entitySubjects ONLY, numerical condition.mention uses numericValues ONLY, and time bounds use dates ONLY. A measurement appearing before the entity is still a value, never its subject. Different terms may use different entities only when the source explicitly assigns those subjects. Do not guess a missing entity.\nKeep operationQuote separate from modal wording: for the generic example "밸브를 닫아야 한다", the operation is "밸브를 닫", while REQUIRED carries the obligation. For "밸브를 닫아서는 안 된다", the operation is also "밸브를 닫" and mode is PROHIBITED. Preserve the full original modal sentence in action.quote. This example is a formatting guide, not a rule or answer for the supplied Source.',
      prompt: JSON.stringify({
        ...JSON.parse(g.prompt),
        roleCatalog: {
          entitySubjects: labels(entities),
          numericValues: labels(numbers),
          dates: labels(dates),
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
    return this.previous.decode(response, view, reservationId, profile);
  }
}
