import { parentPort, workerData } from 'node:worker_threads';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { proposeSurferReplacement } from '../../../modules/surfer-learning/src/replacement-proposer.js';
assertSurferJson(workerData);
const { input, checkpoint } = workerData;
if (!input || Object.keys(input).join(',') !== 'request' || checkpoint !== null)
  throw surferFailure('Invalid static replacement worker payload.');
const proposal = proposeSurferReplacement(input.request);
parentPort!.postMessage({
  type: 'complete',
  checkpoint: proposal,
  resultRef: surferDigest(proposal),
});
