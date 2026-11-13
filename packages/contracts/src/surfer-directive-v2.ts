import type { SurferDirectiveExtraction } from './surfer-directive.js';
import type { SurferStructureMention } from './surfer-structure.js';
/** Broad evidence may include context; the atomic action remains a distinct exact operation span. */
export type SurferDirectiveExtractionV2 = Omit<
  SurferDirectiveExtraction,
  'contract' | 'meaning'
> & {
  contract: 'surfer.directive-meaning.v2';
  meaning: {
    action: NonNullable<SurferDirectiveExtraction['meaning']>['action'] & {
      evidenceQuote: string;
      evidence: SurferStructureMention;
    };
    exceptionTruth: NonNullable<SurferDirectiveExtraction['meaning']>['exceptionTruth'];
  } | null;
};
