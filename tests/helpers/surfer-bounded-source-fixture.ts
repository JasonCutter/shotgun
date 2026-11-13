import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';
import { createSurferSourceFixture } from './surfer-source-database.js';
import { createSurferInductionF1 } from '../../adapters/surfer-reference-corpus/src/induction-f1-v2.js';
import { surferInductionPages } from '../../packages/contracts/src/surfer-induction.js';
import {
  surferDigest,
  type SurferLearningCase,
} from '../../packages/contracts/src/surfer-learning.js';
import { PostgresSurferSourceSession } from '../../adapters/surfer-shotgun-source-postgres/src/index.js';
import {
  ShotgunSurferCognitiveSource,
  ShotgunSurferSourceBridgeV2,
} from '../../adapters/surfer-shotgun-bridge/src/index.js';
import { PostgresSurferExecutionStore } from '../../adapters/surfer-execution-postgres/src/index.js';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import { zeroSurferUsage } from '../../packages/contracts/src/surfer-execution.js';
import { SurferBoundedLocalProposer } from '../../adapters/surfer-symbolic-proposer/src/index.js';
import { SurferWorkerThreads } from '../../adapters/surfer-worker-threads/src/index.js';
import { boundedWorkerUrl } from './surfer-bounded-induction-fixture.js';
import { LocalSurferExperimentStore } from '../../adapters/surfer-experiment-local/src/index.js';
import { SurferBoundedInductionTrial } from '../../adapters/surfer-document-memory/src/bounded-induction-trial.js';
import { unicodeLength } from '../../packages/contracts/src/document-evidence.js';
import type { SurferBoundedProposerPort } from '../../packages/contracts/src/surfer-bounded-induction.js';
export async function boundedSourceFixture(
  pool: Pool,
  principalId: string,
  root: string,
  seed: string = randomUUID(),
  mutate?: (c: SurferLearningCase[]) => SurferLearningCase[],
  corpusFactory: typeof createSurferInductionF1 = createSurferInductionF1,
  existingActual?: Awaited<ReturnType<typeof createSurferSourceFixture>>,
) {
  const actual = existingActual ?? (await createSurferSourceFixture(pool, principalId)),
    context = { spaceId: actual.projectId, accessScope: ['owner'], clearance: 'private' as const },
    corpus = corpusFactory(seed, {
      spaceId: context.spaceId,
      accessScope: context.accessScope,
      sensitivity: 'private',
    }),
    development = corpus.development.read(context);
  if (mutate) development.cases = mutate(development.cases);
  const dataset = mutate
      ? {
          ...corpus.evaluation,
          describeDevelopment: async () => ({
            datasetId: development.datasetId,
            revision: 2,
            developmentDigest: surferDigest(development.cases),
          }),
        }
      : corpus.evaluation,
    pages = surferInductionPages(development),
    text = pages.join('\n'),
    stored = await actual.source(text),
    sessions = new PostgresSurferSourceSession(pool),
    source = new ShotgunSurferCognitiveSource(new ShotgunSurferSourceBridgeV2(sessions));
  const material = await sessions.withSnapshotV2(
      actual.request,
      async (s) => (await s.readMaterialV2(stored.sourceId)).material,
    ),
    evidence = material.evidence.find((e) => e.pointer === '')!;
  if (evidence.quote.exact !== text) throw Error('Bounded Source transformation changed.');
  let cursor = 0;
  const selections = pages.map((page) => {
      const s = {
        sourceId: stored.sourceId,
        evidenceId: evidence.evidenceId,
        start: cursor,
        end: cursor + unicodeLength(page),
        targetUnit: null,
      };
      cursor = s.end + 1;
      return s;
    }),
    view = await source.observe(actual.request, { schemaVersion: '1.0.0', selections }),
    runId = randomUUID();
  const policy = {
      schemaVersion: '1.0.0',
      budgetId: randomUUID(),
      generation: 'bounded-' + runId,
      executionIdentity: 'local-deterministic-bounded-v1',
      modelRevision: 'local-symbolic/bounded-v1',
      egressPolicyRevision: 'DENY_NETWORK',
      pricingRevision: 'ZERO_PROVIDER',
      currency: 'USD',
      allowedSpaceIds: [actual.projectId],
      limits: { ...zeroSurferUsage(), elapsedMs: 15000 },
      backgroundLimits: zeroSurferUsage(),
      maxConcurrent: 1,
      maxBackgroundConcurrent: 0,
      maxQueued: 4,
      unitMaxMs: 5000,
      workerMemoryMb: 64,
      deadlineAtMs: Date.now() + 60000,
    },
    ledger = new SurferExecutionLedger(new PostgresSurferExecutionStore(pool), policy),
    worker = new SurferWorkerThreads(boundedWorkerUrl()),
    proposer = new SurferBoundedLocalProposer(ledger, worker),
    journal = path.join(root, randomUUID()),
    experiments = new LocalSurferExperimentStore(journal),
    task = {
      schemaVersion: '1.0.0' as const,
      runId,
      operationId: 'semantic:' + runId + ':bounded-induction',
      stepId: 'propose',
      attempt: 1,
      priority: 'FOREGROUND' as const,
      basis: view.basis,
      selections,
    },
    options = {
      runId,
      development,
      context,
      source,
      proposer: proposer as SurferBoundedProposerPort,
      dataset,
      experiments,
    };
  return {
    actual,
    context,
    corpus,
    development,
    pages,
    stored,
    sessions,
    source,
    view,
    policy,
    ledger,
    worker,
    proposer,
    journal,
    experiments,
    task,
    options,
    trial: () => new SurferBoundedInductionTrial(options),
  };
}
