import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import { groundSurferDirectiveV2 } from '../../../modules/surfer-core/src/directive-v2.js';
import { createSurferDirectivePairedSuite } from './directive.js';

/** Versioned evaluation boundary: validate the entire v2 packet before comparing common clauses. */
export function createSurferDirectivePairedSuiteV2(
  data: Parameters<typeof createSurferDirectivePairedSuite>[0],
  policy: Parameters<typeof createSurferDirectivePairedSuite>[1],
) {
  const base = createSurferDirectivePairedSuite(data, policy),
    views = new Map<string, SurferCognitiveView>();
  return {
    ...base,
    manifest: {
      ...base.manifest,
      datasetId: 'surfer-directive-v2-fresh-paired-v1',
      evaluatorRevision: 'whole-v2-packet-then-same-source-core-coverage-v1',
    },
    bindView(id: string, view: SurferCognitiveView) {
      base.bindView(id, view);
      views.set(id, structuredClone(view));
    },
    evaluate(rows: { caseId: string; frame: unknown }[]) {
      return base.evaluate(
        rows.map((r) => {
          if ((r.frame as { contract?: string })?.contract !== 'surfer.directive-meaning.v2')
            return r;
          try {
            return {
              caseId: r.caseId,
              frame: groundSurferDirectiveV2(r.frame, views.get(r.caseId)!).clauses,
            };
          } catch {
            // Retain the row in the supported-task denominator; never award a forged packet's clauses.
            return { caseId: r.caseId, frame: {} };
          }
        }),
      );
    },
  };
}
