import type { SurferSourceSessionPortV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferDirectiveScenarioEvaluationPort } from '../../../packages/contracts/src/surfer-directive-memory.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import { surferDigest } from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import { SurferMemoryReconcileService } from '../../../modules/surfer-core/src/memory-reconcile.js';
import { SurferMemoryRefreshDiscoveryService } from '../../../modules/surfer-core/src/memory-refresh-discovery.js';
import { ShotgunSurferMemoryRefreshDiscoverySession } from '../../surfer-shotgun-bridge/src/memory-refresh-discovery.js';
import { ShotgunSurferMemoryRefreshWork } from '../../surfer-shotgun-bridge/src/memory-refresh-work.js';
import {
  ShotgunSurferCognitiveSource,
  ShotgunSurferSourceBridgeV2,
} from '../../surfer-shotgun-bridge/src/index.js';
import { SurferMemoryRefreshWorker } from './refresh-work.js';

/** Trusted backend assembly. Callers provide a trigger, never these provider/authority dependencies. */
export function createSurferMemoryReconciler(options: {
  sessions: SurferSourceSessionPortV2;
  scenarios: SurferDirectiveScenarioEvaluationPort;
  ledger: SurferExecutionLedger;
  gateway: SurferProviderGatewayPort;
  profile: SurferProviderProfile;
  runId: string;
}) {
  const profile = structuredClone(options.profile);
  const work = new ShotgunSurferMemoryRefreshWork(options.sessions, options.scenarios);
  return new SurferMemoryReconcileService(
    new SurferMemoryRefreshDiscoveryService(
      new ShotgunSurferMemoryRefreshDiscoverySession(options.sessions),
    ),
    work,
    new SurferMemoryRefreshWorker(
      work,
      new ShotgunSurferCognitiveSource(new ShotgunSurferSourceBridgeV2(options.sessions)),
      options.ledger,
      options.gateway,
      profile,
    ),
    { runId: options.runId, profileDigest: surferDigest(profile) },
  );
}
