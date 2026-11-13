import type {
  SurferExperimentDatasetPort,
  SurferExperimentStorePort,
  SurferExperimentReceipt,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import type {
  SurferReplacementPreparation,
  SurferSupportedFutureReceipt,
} from '../../../modules/surfer-learning/src/replacement-proof.js';
import {
  surferReplacementSpec,
  type surferReplacementCandidate,
} from '../../../modules/surfer-learning/src/replacement-proof.js';
import { applySurferObservedRule } from '../../../modules/surfer-learning/src/scoped-rule-application.js';
import { SurferExperimentService } from '../../../modules/surfer-learning/src/experiment-service.js';
import type { SurferCompletedExperimentPort } from '../../../packages/contracts/src/surfer-rule-memory.js';
/** Evaluator owner only. The proposer receives none of these capabilities. Admission proof uses the same journal completion. */
export async function evaluateSurferReplacementFuture(
  p: SurferReplacementPreparation,
  candidate: ReturnType<typeof surferReplacementCandidate>,
  dataset: SurferExperimentDatasetPort,
  store: SurferExperimentStorePort & SurferCompletedExperimentPort,
) {
  let support: SurferSupportedFutureReceipt['applicationSupport'] | null = null;
  const guarded: SurferExperimentDatasetPort = {
      describe: async (c) => {
        const d = await dataset.describe(c);
        if (surferDigest(d) !== surferDigest(p.descriptor))
          throw surferFailure('Replacement future descriptor changed.');
        return d;
      },
      read: async (c, partition) => {
        if (partition !== 'future')
          throw surferFailure('Replacement evaluator only reads the new future partition.');
        const raw = await dataset.read(c, partition);
        assertSurferJson(raw);
        const data = structuredClone(raw);
        if (
          data.inputs.length !== 16 ||
          data.inputs.some(
            (row) =>
              applySurferObservedRule(candidate, p.development.cases, { ...row.features })
                .outcome === 'UNKNOWN',
          )
        )
          throw surferFailure('Future input is outside deployed observed support.');
        support = {
          contract: 'surfer.observed-support-gate.v1',
          supportDigest: surferDigest(p.development.cases),
          candidateDigest: surferDigest(candidate),
          futureDigest: p.descriptor.partitions.future.digest,
          inputs: data.inputs.map((row) => ({
            caseId: row.caseId,
            featuresDigest: surferDigest(row.features),
          })),
          supported: 16,
        };
        return data;
      },
    },
    journal: SurferExperimentStorePort = {
      claim: (r) => store.claim(r),
      fail: (r, s) => store.fail(r, s),
      complete: async (r, receipt: SurferExperimentReceipt) => {
        if (!support) throw surferFailure('Missing future support admission proof.');
        await store.complete(r, {
          ...receipt,
          applicationSupport: support,
        } as SurferSupportedFutureReceipt);
      },
    };
  const spec = surferReplacementSpec(p, candidate);
  await new SurferExperimentService(guarded, journal).evaluate(candidate, spec, p.context);
  const receipt = await store.readCompleted(spec.experimentId);
  if (!receipt) throw surferFailure('Replacement future completion is unavailable.');
  return receipt as SurferSupportedFutureReceipt;
}
