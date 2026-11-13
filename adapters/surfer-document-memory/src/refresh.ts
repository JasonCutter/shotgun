import type { SurferDirectiveMemoryRefreshService } from '../../../modules/surfer-core/src/memory-refresh.js';
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
import type { SurferMemoryRefreshIntent } from '../../../packages/contracts/src/surfer-memory-refresh.js';
import { SurferDirectiveExtractionCodecV3 } from '../../surfer-structure-extraction/src/directive-v3.js';
export class SurferDocumentMemoryRefreshAdapter {
  constructor(
    private readonly memories: SurferDirectiveMemoryRefreshService,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly gateway: SurferProviderGatewayPort,
    private readonly profile: SurferProviderProfile,
  ) {}
  async refresh(
    actor: unknown,
    task: SurferInterpretationTask,
    command: { replaces: SurferArtifactRef; expectedActiveSnapshotId: string },
  ) {
    assertSurferJson(command);
    if (
      !command ||
      Object.keys(command).sort().join(',') !== 'expectedActiveSnapshotId,replaces' ||
      typeof task.operationId !== 'string' ||
      task.operationId.length > 100
    )
      throw surferFailure('Invalid document refresh command.');
    const intent: SurferMemoryRefreshIntent = {
      schemaVersion: '1.0.0',
      contract: 'surfer.memory-refresh.v1',
      operationId: task.operationId + ':remember',
      expectedActiveSnapshotId: command.expectedActiveSnapshotId,
      replaces: command.replaces,
      basis: task.basis,
      selections: task.selections,
    };
    const preview = await this.memories.inspect(actor, intent);
    const execution = await new SurferProviderExecutor(
      this.source,
      this.ledger,
      this.gateway,
      this.profile,
      new SurferDirectiveExtractionCodecV3(),
    ).interpret(actor, task);
    if (
      !execution.frame ||
      execution.frame.clauses.proposal.interpretation.state !== 'RESOLVED' ||
      !execution.frame.meaning
    )
      return { execution, memory: null, preview };
    return {
      execution,
      memory: await this.memories.refresh(actor, { ...intent, packet: execution.frame }),
      preview,
    };
  }
}
