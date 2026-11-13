import type { SurferDirectiveMemoryCollectionService } from '../../../modules/surfer-core/src/directive-memory-collection.js';
import {
  SurferProviderExecutor,
  type SurferInterpretationTask,
} from '../../../modules/surfer-execution/src/provider-executor.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import type {
  SurferProviderGatewayPort,
  SurferProviderProfile,
} from '../../../packages/contracts/src/surfer-provider.js';
import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { SurferDirectiveExtractionCodecV3 } from '../../surfer-structure-extraction/src/directive-v3.js';
export type SurferDocumentMemoryCommand = {
  memoryId: string;
  expectedRevision: number | null;
  expectedActiveSnapshotId: string | null;
};
/** The caller persists one immutable Source task for replay; no model call is made inside collection transactions. */
export class SurferDocumentMemoryAdapter {
  constructor(
    private readonly memories: SurferDirectiveMemoryCollectionService,
    private readonly source: SurferCognitiveSourcePort,
    private readonly ledger: SurferExecutionLedger,
    private readonly gateway: SurferProviderGatewayPort,
    private readonly profile: SurferProviderProfile,
  ) {}
  async ingest(
    actor: unknown,
    task: SurferInterpretationTask,
    command: SurferDocumentMemoryCommand,
  ) {
    assertSurferJson(command);
    if (
      !command ||
      Object.keys(command).sort().join(',') !==
        'expectedActiveSnapshotId,expectedRevision,memoryId' ||
      typeof command.memoryId !== 'string' ||
      !command.memoryId.length ||
      command.memoryId.length > 96 ||
      (command.expectedRevision !== null &&
        (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1)) ||
      (command.expectedActiveSnapshotId !== null &&
        (typeof command.expectedActiveSnapshotId !== 'string' ||
          !command.expectedActiveSnapshotId.length ||
          command.expectedActiveSnapshotId.length > 256)) ||
      typeof task.operationId !== 'string' ||
      task.operationId.length > 100
    )
      throw surferFailure('Invalid document memory command.');
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
      return { execution, memory: null };
    const memory = await this.memories.remember(actor, {
      schemaVersion: '1.0.0',
      contract: 'surfer.directive-memory.v1',
      ...command,
      operationId: task.operationId + ':remember',
      basis: task.basis,
      selections: task.selections,
      packet: execution.frame,
    });
    return { execution, memory };
  }
}
