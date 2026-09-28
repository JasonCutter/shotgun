import type { Pool } from 'pg';

import { PostgresVPCandidatePolicyRefresh } from '../../../adapters/vp-knowledge-postgres/src/candidate-policy-refresh.js';
import {
  VPCandidatePolicyRefreshWorker,
  type VPCandidatePolicyRefreshTarget,
} from '../../../modules/vp-candidate-policy-refresh/src/index.js';
import { createCommand, type CommandEnvelope } from '../../../packages/contracts/src/index.js';

export const createVPCandidatePolicyRefreshCommand = (
  target: VPCandidatePolicyRefreshTarget,
  promptVersion: string,
): CommandEnvelope => {
  const requestId = `vp-policy-refresh:${promptVersion}:${target.sourceVersionId}:${target.revisionId}`;
  return createCommand({
    messageType: 'ReextractCandidateMaterialization',
    schemaVersion: '1.1.0',
    producerModule: 'shotgun-app',
    producerVersion: '1.0.0',
    idempotencyKey: requestId,
    projectId: target.projectId,
    actor: { type: 'service', id: 'vp-candidate-policy-refresh' },
    security: {
      accessScope: target.accessScope,
      sensitivity: target.sensitivity,
      dataClassification: 'source-content',
    },
    provenance: { sourceVersionIds: [target.sourceVersionId], evidenceIds: [] },
    payload: {
      sourceVersionId: target.sourceVersionId,
      revisionId: target.revisionId,
      requestId,
    },
  });
};

export const startVPCandidatePolicyRefreshWorker = (
  pool: Pool,
  connector: { sendCommand(command: CommandEnvelope): Promise<unknown> },
): Promise<() => Promise<void>> => {
  const promptVersion = 'direct-claim-v2';
  const worker = new VPCandidatePolicyRefreshWorker(
    new PostgresVPCandidatePolicyRefresh(pool),
    async (target) => {
      await connector.sendCommand(createVPCandidatePolicyRefreshCommand(target, promptVersion));
    },
    promptVersion,
  );
  return worker.startWorker();
};
