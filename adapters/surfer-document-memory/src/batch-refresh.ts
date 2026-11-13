import type { SurferDirectiveMemoryBatchRefreshService } from '../../../modules/surfer-core/src/memory-batch-refresh.js';
import {
  SurferProviderExecutor,
  type SurferInterpretationTask,
} from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type { SurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { SurferDirectiveExtractionCodecV3 } from '../../surfer-structure-extraction/src/directive-v3.js';
import type {
  SurferMemoryBatchRefreshIntent,
  SurferMemoryBatchRefreshRequest,
} from '../../../packages/contracts/src/surfer-memory-batch-refresh.js';

/** Sequential provider work is checkpointed before one atomic memory publication. */
export class SurferDocumentMemoryBatchRefreshAdapter {
  constructor(
    private readonly memories: SurferDirectiveMemoryBatchRefreshService,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly gateway: SurferProviderGatewayPort,
    private readonly profile: SurferProviderProfile,
  ) {}
  async refresh(
    actor: unknown,
    input: {
      operationId: string;
      expectedActiveSnapshotId: string;
      targets: { task: SurferInterpretationTask; replaces: SurferArtifactRef }[];
    },
  ) {
    assertSurferJson(input);
    const r = structuredClone(input);
    if (
      !r ||
      Object.keys(r).sort().join(',') !== 'expectedActiveSnapshotId,operationId,targets' ||
      !Array.isArray(r.targets) ||
      r.targets.some(
        (t) =>
          !t ||
          Object.keys(t).sort().join(',') !== 'replaces,task' ||
          !t.task ||
          typeof t.task.operationId !== 'string',
      ) ||
      new Set(r.targets.map((t) => t.task.operationId)).size !== r.targets.length
    )
      throw surferFailure('Invalid batch document tasks.');
    r.targets.sort((a, b) =>
      a.replaces.artifactId < b.replaces.artifactId
        ? -1
        : a.replaces.artifactId > b.replaces.artifactId
          ? 1
          : 0,
    );
    if (r.targets.some((t, index) => t.task.operationId !== r.operationId + ':extract:' + index))
      throw surferFailure('Batch extraction task IDs must be bound to the batch and target order.');
    const intent: SurferMemoryBatchRefreshIntent = {
      schemaVersion: '1.0.0',
      contract: 'surfer.memory-batch-refresh.v1',
      operationId: r.operationId,
      expectedActiveSnapshotId: r.expectedActiveSnapshotId,
      targets: r.targets.map((t) => ({
        replaces: t.replaces,
        basis: t.task.basis,
        selections: t.task.selections,
      })),
    };
    const preview = await this.memories.inspect(actor, intent);
    const executor = new SurferProviderExecutor(
      this.source,
      this.ledger,
      this.gateway,
      this.profile,
      new SurferDirectiveExtractionCodecV3(),
    );
    const executions = [],
      targets: SurferMemoryBatchRefreshRequest['targets'] = [];
    for (const [index, t] of r.targets.entries()) {
      const execution = await executor.interpret(actor, t.task);
      executions.push(execution);
      if (
        !execution.frame ||
        execution.frame.clauses.proposal.interpretation.state !== 'RESOLVED' ||
        !execution.frame.meaning
      )
        return { executions, memory: null, preview };
      targets.push({ ...intent.targets[index]!, packet: execution.frame });
    }
    return {
      executions,
      memory: await this.memories.refresh(actor, { ...intent, targets }),
      preview,
    };
  }
}
