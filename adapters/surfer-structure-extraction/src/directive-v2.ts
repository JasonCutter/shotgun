import type { SurferProviderCodec } from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import {
  decodeSurferDirectiveWire,
  surferDirectiveResponseSchema,
} from '../../../packages/contracts/src/surfer-directive.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import type {
  SurferObservedProviderResponse,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferStructureMention } from '../../../packages/contracts/src/surfer-structure.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import { groundSurferDirectiveV2 } from '../../../modules/surfer-core/src/directive-v2.js';
import { SurferDirectiveExtractionCodec } from './directive.js';
export const SURFER_DIRECTIVE_V2_REVISION = 'surfer-directive-meaning-v2';
/** Deterministic atom/context separation. Does not change model meaning, repair JSON, or call a model. */
export class SurferDirectiveExtractionCodecV2 implements SurferProviderCodec<SurferDirectiveExtractionV2> {
  readonly revision = SURFER_DIRECTIVE_V2_REVISION;
  private readonly previous = new SurferDirectiveExtractionCodec();
  generation(view: SurferCognitiveView, profile: SurferProviderProfile) {
    const g = this.previous.generation(view, profile),
      schema = surferDirectiveResponseSchema();
    const props = (
      (
        schema.properties as {
          interpretation: { anyOf: { properties: Record<string, unknown> }[] };
        }
      ).interpretation.anyOf[1]!.properties.action as {
        properties: { operationQuote: { minLength: number } };
      }
    ).properties;
    props.operationQuote.minLength = 2;
    return {
      ...g,
      responseSchema: schema,
      systemInstruction:
        g.systemInstruction
          .replace('surfer-directive-meaning-v1', this.revision)
          .replace(
            'Longer context/particles are allowed if exact, unique and not overlapping action/condition/exception evidence.',
            'Action evidence may be broad. Operation, condition and exception atoms must remain exact, unique and nonoverlapping.',
          ) +
        '\nAction evidence quote may be a broad contiguous Source sentence that includes antecedents; operationQuote is the separate atomic action span inside it. The owner will preserve the full context and ground the operation as the action atom. OperationQuote must contain at least two characters (include the object for a one-character verb). Other condition/exception atoms must stay nonoverlapping.',
    };
  }
  decode(
    response: SurferObservedProviderResponse,
    view: SurferCognitiveView,
    reservationId: string,
    profile: SurferProviderProfile,
  ): SurferDirectiveExtractionV2 | null {
    try {
      const original = decodeSurferDirectiveWire(JSON.parse(response.rawText)),
        projected = structuredClone(original),
        w = original.interpretation;
      if (projected.interpretation.state === 'RESOLVED') {
        if (projected.interpretation.action.operationQuote.length < 2) return null;
        projected.interpretation.action.quote = projected.interpretation.action.operationQuote;
      }
      const old = this.previous.decode(
        { ...response, rawText: JSON.stringify(projected) },
        view,
        reservationId,
        profile,
      );
      if (!old) return null;
      old.clauses.frame.producer.promptRevision = profile.promptRevision;
      old.clauses.proposal.parentFrame.digest = surferDigest(old.clauses.frame);
      old.clauses.proposal.proposalId =
        'directive-v2:' + surferDigest([reservationId, response.rawText, this.revision]);
      let meaning: SurferDirectiveExtractionV2['meaning'] = null;
      if (w.state === 'RESOLVED' && old.meaning) {
        const matches: SurferStructureMention[] = [];
        for (const a of view.anchors) {
          let at = a.rawLiteral.indexOf(w.action.quote);
          while (at >= 0) {
            const start = Array.from(a.rawLiteral.slice(0, at)).length;
            matches.push({
              anchorRef: { anchorId: a.anchorId, revision: a.revision, digest: a.digest },
              start,
              end: start + Array.from(w.action.quote).length,
            });
            at = a.rawLiteral.indexOf(w.action.quote, at + 1);
          }
        }
        if (matches.length !== 1) return null;
        meaning = {
          ...old.meaning,
          action: { ...old.meaning.action, evidenceQuote: w.action.quote, evidence: matches[0]! },
        };
      }
      return groundSurferDirectiveV2(
        {
          schemaVersion: '1.0.0',
          contract: 'surfer.directive-meaning.v2',
          clauses: old.clauses,
          meaning,
        },
        view,
      );
    } catch {
      return null;
    }
  }
}
