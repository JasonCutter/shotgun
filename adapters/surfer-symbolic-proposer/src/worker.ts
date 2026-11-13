/** Static trusted entry compiled by surfer-induction-worker-build.ts; no source-selected code. */
import { parentPort, workerData } from 'node:worker_threads';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { proposeSurferBoundedComparison } from '../../../modules/surfer-learning/src/bounded-proposer.js';
assertSurferJson(workerData);
const { input, checkpoint } = workerData;
if (!input || Object.keys(input).sort().join(',') !== 'limits,request' || checkpoint !== null)
  throw surferFailure('Invalid fresh bounded worker payload.');
const proposal = proposeSurferBoundedComparison(input.request, input.limits);
parentPort!.postMessage({
  type: 'complete',
  checkpoint: proposal,
  resultRef: surferDigest(proposal),
});
