import { createSurferInductionF1 } from '../../adapters/surfer-reference-corpus/src/induction-f1-v2.js';
import { surferInductionPages } from '../../packages/contracts/src/surfer-induction.js';
import { InMemorySurferExperimentStore } from '../../adapters/surfer-experiment-in-memory/src/index.js';
import { InMemorySurferExecutionStore } from '../../adapters/surfer-execution-in-memory/src/index.js';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import {
  buildSurferObservationAnchor,
  cognitiveViewDigest,
} from '../../modules/surfer-core/src/cognition.js';
import { cognitiveFixture } from './surfer-cognitive-fixture.js';
import { providerFixture } from './surfer-provider-contracts.js';
import type {
  SurferExpression,
  SurferLearningCase,
} from '../../packages/contracts/src/surfer-learning.js';
import type { SurferCognitiveSourcePort } from '../../packages/contracts/src/surfer-cognition.js';
import { SurferInductionTrial } from '../../adapters/surfer-document-memory/src/induction-trial.js';

/** Deliberate deterministic proposer DOUBLE inferred from training observations; not a real model. */
export function inductionWire(cases: readonly SurferLearningCase[]) {
  const positive = cases.filter((c) => c.observedOutcome),
    a = Math.min(...positive.map((c) => Number(c.features.temperature!.value))),
    b = Math.min(...positive.map((c) => Number(c.features.humidity!.value)));
  const expression: SurferExpression = {
    op: 'all',
    args: [
      {
        op: 'gte',
        left: { op: 'field', name: 'temperature' },
        right: { op: 'literal', value: a, unit: 'Cel' },
      },
      {
        op: 'gte',
        left: { op: 'field', name: 'humidity' },
        right: { op: 'literal', value: b, unit: '%' },
      },
    ],
  };
  return {
    description: 'Deterministic provider double only',
    expression,
    assumptions: ['Authored observations;training material grade A only.'],
  };
}
export function inductionFixture() {
  const context = {
      spaceId: 'cognitive-fixture',
      accessScope: ['owner'],
      clearance: 'private' as const,
    },
    scope = {
      spaceId: context.spaceId,
      accessScope: context.accessScope,
      sensitivity: context.clearance,
    },
    corpus = createSurferInductionF1('contract-seed-not-live-generation', scope),
    development = corpus.development.read(context),
    pages = surferInductionPages(development),
    f = cognitiveFixture(pages.join('\n'), pages[0]!, null),
    p = providerFixture(new InMemorySurferExecutionStore());
  p.profile.promptRevision = 'surfer-induction-f1-v1';
  p.response.rawText = JSON.stringify(inductionWire(development.cases));
  let cursor = 0;
  const selections = pages.map((page) => {
      const selection = { ...f.selection, start: cursor, end: cursor + page.length };
      cursor += page.length + 1;
      return selection;
    }),
    anchors = selections.map((s) => buildSurferObservationAnchor(f.material, f.basis, s)),
    view = { ...f.view, anchors, viewDigest: cognitiveViewDigest(f.basis, anchors) },
    source: SurferCognitiveSourcePort = {
      observe: async () => structuredClone(view),
      withCurrent: async (_actor, _basis, _selections, apply) => {
        if (!p.control.allowSource) throw Error('Source revoked');
        return apply(structuredClone(view));
      },
    },
    task = {
      ...p.task,
      operationId: 'semantic:' + p.task.runId + ':induction',
      basis: f.basis,
      selections,
    },
    experiments = new InMemorySurferExperimentStore(),
    ledger = new SurferExecutionLedger(p.store, {
      ...p.policy,
      limits: { ...p.policy.limits, calls: 1 },
      backgroundLimits: { ...p.policy.backgroundLimits, calls: 1 },
      maxConcurrent: 1,
    }),
    actor = { projectId: context.spaceId, sessionToken: 'fixture-only' };
  const options = {
    runId: task.runId,
    development,
    context,
    dataset: corpus.evaluation,
    experiments,
    source,
    ledger,
    gateway: p.gateway,
    profile: p.profile,
  };
  return {
    corpus,
    development,
    pages,
    p,
    source,
    view,
    task,
    experiments,
    ledger,
    actor,
    context,
    options,
    trial: () => new SurferInductionTrial(options),
  };
}
