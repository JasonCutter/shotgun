import type {
  SurferExperimentDatasetPort,
  SurferExperimentStorePort,
} from '../../../packages/contracts/src/surfer-experiment.js';
import type { SurferCompletedExperimentPort } from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
  type SurferLearningCase,
  type SurferRuleCandidate,
} from '../../../packages/contracts/src/surfer-learning.js';
import { SurferExperimentService } from '../../../modules/surfer-learning/src/experiment-service.js';
import { applySurferObservedRule } from '../../../modules/surfer-learning/src/scoped-rule-application.js';
import {
  chainNovelValues,
  chainSpec,
  type ChainPlan,
  type ChainState,
  type ChainReceipt,
} from '../../../modules/surfer-learning/src/rule-chain-state.js';
export async function evaluateSurferChainFuture(
  plan: ChainPlan,
  state: ChainState,
  cases: SurferLearningCase[],
  candidate: SurferRuleCandidate,
  dataset: SurferExperimentDatasetPort,
  store: SurferExperimentStorePort & SurferCompletedExperimentPort,
) {
  let admission: ChainReceipt['applicationSupport'] | null = null;
  const novel = chainNovelValues(state.cases, cases),
    training = new Set(cases.map((c) => surferDigest(c.features)));
  const guarded: SurferExperimentDatasetPort = {
      describe: async (c) => {
        const d = await dataset.describe(c);
        if (surferDigest(d) !== surferDigest(plan.descriptor))
          throw surferFailure('Chain future descriptor changed.');
        return d;
      },
      read: async (c, p) => {
        if (p !== 'future')
          throw surferFailure('Chain evaluator only opens the new future partition.');
        const raw = await dataset.read(c, p);
        assertSurferJson(raw);
        const data = structuredClone(raw);
        if (
          data.inputs.length !== 16 ||
          data.inputs.some(
            (row) =>
              state.history.caseIds.includes(row.caseId) ||
              state.history.groups.includes(row.eventGroup) ||
              state.history.features.includes(surferDigest(row.features)) ||
              training.has(surferDigest(row.features)) ||
              applySurferObservedRule(candidate, cases, { ...row.features }).outcome === 'UNKNOWN',
          )
        )
          throw surferFailure(
            'Chain future overlaps previous evaluation/training or leaves observed support.',
          );
        const covered = novel
          .filter((v) =>
            data.inputs.some(
              (row) =>
                Object.hasOwn(row.features, v.name) &&
                surferDigest(row.features[v.name]) === surferDigest(v.value),
            ),
          )
          .map((v) => v.key)
          .sort();
        if (covered.length !== novel.length)
          throw surferFailure('Chain future does not cover every newly admitted feature value.');
        admission = {
          contract: 'surfer.observed-support-gate.v2',
          supportDigest: plan.supportDigest,
          candidateDigest: surferDigest(candidate),
          futureDigest: plan.descriptor.partitions.future.digest,
          priorFutureDigest: plan.priorFutureDigest,
          novelValuesDigest: surferDigest(novel),
          coveredValues: covered,
          inputs: data.inputs.map((row) => ({
            caseId: row.caseId,
            eventGroup: row.eventGroup,
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
      complete: async (r, receipt) => {
        if (!admission) throw surferFailure('Missing chain support/non-reuse admission.');
        await store.complete(r, { ...receipt, applicationSupport: admission } as ChainReceipt);
      },
    };
  const spec = chainSpec(plan, candidate);
  await new SurferExperimentService(guarded, journal).evaluate(candidate, spec, plan.context);
  const r = await store.readCompleted(spec.experimentId);
  if (!r) throw surferFailure('Chain future completion unavailable.');
  return r as ChainReceipt;
}
