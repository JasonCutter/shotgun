import type { KnowledgeReviewGroup } from '../../packages/contracts/src/index.js';
import { createChildQuery, createCommand } from '../../packages/kernel/src/index.js';
import type { directTextCommand } from './stage-3.js';

type Parent = ReturnType<typeof directTextCommand>;

export const buildCompiledTruthCommand = (
  parent: Parent,
  mode: 'FULL_REBUILD' | 'INCREMENTAL',
  suffix: string = mode,
) =>
  createCommand({
    messageType: 'BuildCompiledTruth',
    schemaVersion: '1.0.0',
    producerModule: 'stage10-test',
    producerVersion: '1.0.0',
    correlationId: parent.correlationId,
    traceId: parent.traceId,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    idempotencyKey: `stage10-build:${suffix}`,
    payload: { mode },
  });

export const runDiscoveryCommand = (
  parent: Parent,
  mode: 'INCREMENTAL' | 'WEEKLY',
  suffix: string,
  maxNodes = 100,
  maxSuggestions = 10,
) =>
  createCommand({
    messageType: 'RunKnowledgeDiscovery',
    schemaVersion: '1.0.0',
    producerModule: 'stage10-test',
    producerVersion: '1.0.0',
    correlationId: parent.correlationId,
    traceId: parent.traceId,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    idempotencyKey: `stage10-discovery:${suffix}`,
    payload: { mode, maxNodes, maxSuggestions },
  });

export const compiledTruthQuery = (parent: Parent) =>
  createChildQuery(parent, {
    messageType: 'GetCompiledTruth',
    schemaVersion: '1.0.0',
    producerModule: 'stage10-test',
    producerVersion: '1.0.0',
    payload: {},
  });

export const compiledTruthStatusQuery = (parent: Parent) =>
  createChildQuery(parent, {
    messageType: 'GetCompiledTruthStatus',
    schemaVersion: '1.0.0',
    producerModule: 'stage10-test',
    producerVersion: '1.0.0',
    payload: {},
  });

export const compiledTruthReadSnapshotQuery = (parent: Parent) =>
  createChildQuery(parent, {
    messageType: 'GetCompiledTruthReadSnapshot',
    schemaVersion: '1.0.0',
    producerModule: 'stage10-test',
    producerVersion: '1.0.0',
    payload: { schemaVersion: '1.0.0' },
  });

export const approvedGroup = (group: KnowledgeReviewGroup) => ({
  ...group,
  status: 'APPROVED' as const,
});
