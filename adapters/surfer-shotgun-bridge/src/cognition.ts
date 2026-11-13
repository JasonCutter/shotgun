import {
  decodeSurferObservationSelections,
  type SurferCognitiveSourcePort,
  type SurferCognitiveReadReceipt,
  type SurferCognitiveView,
  type SurferObservationSelection,
} from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferSourceBasisV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import {
  buildSurferObservationAnchor,
  cognitiveViewDigest,
  cognitiveFailure,
} from '../../../modules/surfer-core/src/cognition.js';
import type { SurferSourceMaterial } from '../../../packages/contracts/src/surfer-source.js';
type CognitiveBridge = {
  capture(
    request: unknown,
    input: unknown,
  ): Promise<{
    basis: SurferSourceBasisV2;
    materials: readonly SurferSourceMaterial[];
    readReceipt: SurferCognitiveReadReceipt;
  }>;
  withCurrentBasis<T>(
    request: unknown,
    basis: unknown,
    apply: (view: {
      basis: SurferSourceBasisV2;
      materials: readonly SurferSourceMaterial[];
      readReceipt: SurferCognitiveReadReceipt;
    }) => T,
  ): Promise<T>;
};

/** Builds observations from the current Source owner, never from model-supplied material/authority JSON. */
export class ShotgunSurferCognitiveSource implements SurferCognitiveSourcePort {
  constructor(private readonly bridge: CognitiveBridge) {}
  async observe(sourceRequest: unknown, input: unknown): Promise<SurferCognitiveView> {
    const { selections } = decodeSurferObservationSelections(input);
    const captured = await this.bridge.capture(sourceRequest, {
      schemaVersion: '2.0.0',
      sourceIds: [...new Set(selections.map((s) => s.sourceId))].sort(),
      artifacts: [],
      queries: [],
    });
    const anchors = selections.map((s) =>
      buildSurferObservationAnchor(
        captured.materials.find((m) => m.sourceId === s.sourceId) ??
          (() => {
            throw cognitiveFailure('Selection is not in the validated Source basis.');
          })(),
        captured.basis,
        s,
      ),
    );
    return {
      schemaVersion: '1.0.0',
      basis: captured.basis,
      anchors,
      viewDigest: cognitiveViewDigest(captured.basis, anchors),
      readReceipt: captured.readReceipt,
    };
  }
  async withCurrent<T>(
    sourceRequest: unknown,
    basis: SurferSourceBasisV2,
    selectionsInput: SurferObservationSelection[],
    apply: (view: SurferCognitiveView) => T,
  ): Promise<T> {
    const { selections } = decodeSurferObservationSelections({
      schemaVersion: '1.0.0',
      selections: selectionsInput,
    });
    return this.bridge.withCurrentBasis(sourceRequest, basis, (current) => {
      const anchors = selections.map((s) =>
        buildSurferObservationAnchor(
          current.materials.find((m) => m.sourceId === s.sourceId) ??
            (() => {
              throw cognitiveFailure('Selection is not in the validated Source basis.');
            })(),
          current.basis,
          s,
        ),
      );
      const view: SurferCognitiveView = {
        schemaVersion: '1.0.0',
        basis: current.basis,
        anchors,
        viewDigest: cognitiveViewDigest(current.basis, anchors),
        readReceipt: current.readReceipt,
      };
      return apply(view);
    });
  }
}
