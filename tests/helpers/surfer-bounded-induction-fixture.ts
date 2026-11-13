import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inductionFixture } from './surfer-induction-fixture.js';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import {
  zeroSurferUsage,
  type SurferLocalWorkerPort,
} from '../../packages/contracts/src/surfer-execution.js';
import { SurferWorkerThreads } from '../../adapters/surfer-worker-threads/src/index.js';
import { SurferBoundedLocalProposer } from '../../adapters/surfer-symbolic-proposer/src/index.js';
import { SurferBoundedInductionTrial } from '../../adapters/surfer-document-memory/src/bounded-induction-trial.js';
import type {
  SurferBoundedRequest,
  SurferBoundedProposerPort,
} from '../../packages/contracts/src/surfer-bounded-induction.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
export function buildBoundedWorker() {
  execFileSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/surfer-induction-worker-build.ts'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 },
  );
}
export const boundedWorkerUrl = () =>
  pathToFileURL(
    path.resolve(
      '.data/surfer-bounded-worker-build/adapters/surfer-symbolic-proposer/src/worker.js',
    ),
  );
export function boundedFixture(worker?: SurferLocalWorkerPort) {
  const f = inductionFixture(),
    policy = {
      ...f.p.policy,
      executionIdentity: 'local-deterministic',
      modelRevision: 'local-symbolic/bounded-v1',
      egressPolicyRevision: 'DENY_NETWORK',
      pricingRevision: 'ZERO_PROVIDER',
      allowedSpaceIds: [f.context.spaceId],
      limits: { ...zeroSurferUsage(), elapsedMs: 15000 },
      backgroundLimits: zeroSurferUsage(),
      maxConcurrent: 1,
      maxBackgroundConcurrent: 0,
      unitMaxMs: 5000,
      workerMemoryMb: 64,
    },
    ledger = new SurferExecutionLedger(f.p.store, policy),
    proposer = new SurferBoundedLocalProposer(
      ledger,
      worker ?? new SurferWorkerThreads(boundedWorkerUrl()),
    ),
    task = { ...f.task, operationId: 'semantic:' + f.task.runId + ':bounded-induction' },
    options = { ...f.options, ledger, proposer: proposer as SurferBoundedProposerPort };
  return {
    ...f,
    ledger,
    proposer,
    task,
    options,
    trial: () => new SurferBoundedInductionTrial(options),
  };
}
export function boundedRequest(development = inductionFixture().development): SurferBoundedRequest {
  return {
    contract: 'surfer.bounded-induction-request.v1',
    runId: 'bounded-contract',
    operationId: 'semantic:bounded-contract:bounded-induction:propose',
    spaceId: development.cases[0]!.scope.spaceId,
    sourceDigest: surferDigest('contract-source'),
    development,
  };
}
