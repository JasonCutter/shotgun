import {
  FrontendKnowledgeDraftCommandError,
  type FrontendKnowledgeDraftChangeSetV1,
} from '../../../packages/contracts/src/index.js';
import type {
  DraftMaterializationRecordV1,
  FrontendKnowledgeDraftOperationAppendV1,
  FrontendKnowledgeDraftRepositoryBoundaryPort,
  FrontendKnowledgeDraftRevisionRecordV1,
  FrontendKnowledgeDraftTransactionRepositoriesV1,
} from '../../../modules/frontend-knowledge-draft/src/index.js';

export type InMemoryDraftArtifactRefRow = {
  readonly artifactId: string;
  readonly kind: 'VALIDATION' | 'IMPACT';
  readonly draftId: string;
  readonly draftRevision: number;
  readonly artifactRevision: number;
  readonly digest: string;
  readonly status: string;
  readonly projectId: string;
};

const conflict = (message: string): never => {
  throw new FrontendKnowledgeDraftCommandError('DRAFT_REVISION_CONFLICT', message);
};

/** Undo closure that reverts a single mutation made by the owning transaction. */
type Undo = () => void;

/**
 * In-memory implementation of the FE-P3-S2 Draft Repository Boundary. It
 * mirrors every PostgreSQL invariant (unique Seed identity, one materialization
 * per Draft, unique draft+revision, unique draft+revision+operationId,
 * unique command replay identity, transactional rollback on failure) so the
 * two adapters share exact semantics. No domain invariant is reinterpreted:
 * the aggregate is round-tripped and the shared domain module owns all
 * validation.
 *
 * Concurrency model:
 * - Transactions run concurrently against the shared state. Every mutation
 *   records an undo closure in a transaction-local journal; a failed
 *   transaction reverts only its own writes, so a concurrently committed
 *   transaction is never erased (PostgreSQL-equivalent rollback isolation).
 * - Draft CAS (`replaceIfRevision`) compares against the live shared revision,
 *   so concurrent saves race and exactly one winner commits.
 * - Seed and command replay-key lookups are serialized per key (a fair
 *   async queue) and the lock is held until the transaction ends. This makes
 *   concurrent materializations of the same Seed / replay identity resolve
 *   atomically instead of creating duplicates.
 */
export class InMemoryFrontendKnowledgeDraftRepository implements FrontendKnowledgeDraftRepositoryBoundaryPort {
  readonly drafts = new Map<string, FrontendKnowledgeDraftChangeSetV1>();
  readonly revisions: FrontendKnowledgeDraftRevisionRecordV1[] = [];
  readonly operations: FrontendKnowledgeDraftOperationAppendV1[] = [];
  readonly materializations: DraftMaterializationRecordV1[] = [];
  artifactRefs: InMemoryDraftArtifactRefRow[] = [];

  /** Test failpoint: throws when appending operations, verifying atomic rollback. */
  failOperationAppend = false;

  /** Per-key serialization queues for Seed and command replay-key identity. */
  private readonly keyQueues = new Map<string, Promise<void>>();

  async transaction<T>(
    action: (repositories: FrontendKnowledgeDraftTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    const journal: Undo[] = [];
    const heldLocks: Array<() => void> = [];
    try {
      return await action(this.repositories(journal, heldLocks));
    } catch (error) {
      for (let index = journal.length - 1; index >= 0; index -= 1) {
        journal[index]?.();
      }
      throw error;
    } finally {
      for (const release of heldLocks) release();
    }
  }

  /**
   * Acquires a fair per-key lock and returns once every earlier holder has
   * released it. The release closure is recorded in `heldLocks` so it is
   * always released when the owning transaction ends (commit or rollback).
   */
  private async acquireKey(key: string, heldLocks: Array<() => void>): Promise<void> {
    const previous = this.keyQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.keyQueues.set(
      key,
      previous.then(() => gate),
    );
    await previous;
    heldLocks.push(release);
  }

  private repositories(
    journal: Undo[],
    heldLocks: Array<() => void>,
  ): FrontendKnowledgeDraftTransactionRepositoriesV1 {
    return {
      drafts: {
        findById: async (projectId: string, draftId: string) => {
          const draft = this.drafts.get(draftId);
          return draft !== undefined && draft.resourceProjectId === projectId ? draft : undefined;
        },
        insert: async (draft: FrontendKnowledgeDraftChangeSetV1) => {
          if (this.drafts.has(draft.draftId)) {
            conflict('A Draft with this identity already exists.');
          }
          this.drafts.set(draft.draftId, draft);
          journal.push(() => {
            this.drafts.delete(draft.draftId);
          });
          this.replaceArtifactRefs(draft, journal);
          return draft;
        },
        replaceIfRevision: async ({ projectId, draft, expectedRevision }) => {
          const current = this.drafts.get(draft.draftId);
          if (current === undefined || current.resourceProjectId !== projectId) {
            return 'NOT_FOUND';
          }
          if (current.revision !== expectedRevision) {
            return 'REVISION_CONFLICT';
          }
          const previous = this.drafts.get(draft.draftId);
          this.drafts.set(draft.draftId, draft);
          journal.push(() => {
            if (previous !== undefined) this.drafts.set(draft.draftId, previous);
          });
          this.replaceArtifactRefs(draft, journal);
          return 'UPDATED';
        },
      },
      revisions: {
        find: async (projectId, draftId, revision) =>
          this.revisions.find(
            (entry) =>
              entry.resourceProjectId === projectId &&
              entry.draftId === draftId &&
              entry.revision === revision,
          ),
        append: async (revision: FrontendKnowledgeDraftRevisionRecordV1) => {
          if (
            this.revisions.some(
              (entry) => entry.draftId === revision.draftId && entry.revision === revision.revision,
            )
          ) {
            conflict('A Draft revision already exists and is immutable.');
          }
          const index = this.revisions.length;
          this.revisions.push(revision);
          journal.push(() => {
            this.revisions.splice(index, 1);
          });
          return revision;
        },
      },
      operations: {
        append: async (input: FrontendKnowledgeDraftOperationAppendV1) => {
          if (this.failOperationAppend) {
            throw new Error('operation append failpoint');
          }
          const start = this.operations.length;
          for (const incoming of input.operations) {
            const duplicate = this.operations.some(
              (entry) =>
                entry.draftId === input.draftId &&
                entry.revision === input.revision &&
                entry.operations.some(
                  (operation) => operation.operationId === incoming.operationId,
                ),
            );
            if (duplicate) {
              conflict('An operation with this ID already exists for the Draft revision.');
            }
          }
          this.operations.push(input);
          journal.push(() => {
            this.operations.splice(start, this.operations.length - start);
          });
        },
        list: async (projectId, draftId, revision) =>
          this.operations
            .filter(
              (entry) =>
                entry.projectId === projectId &&
                entry.draftId === draftId &&
                entry.revision === revision,
            )
            .flatMap((entry) => entry.operations),
      },
      materializations: {
        findBySeed: async (seedId) => {
          await this.acquireKey(`seed:${seedId}`, heldLocks);
          return this.materializations.find((entry) =>
            entry.target.kind === 'SEED' ? entry.target.seedId === seedId : false,
          );
        },
        findByDraftId: async (projectId, draftId) =>
          this.materializations.find(
            (entry) => entry.resourceProjectId === projectId && entry.draftId === draftId,
          ),
        findByCommandReplayKey: async (projectId, replayKey) => {
          await this.acquireKey(
            `replay:${projectId}:${replayKey.principalId}:${replayKey.clientRequestId}:${replayKey.idempotencyKey}`,
            heldLocks,
          );
          return this.materializations.find(
            (entry) =>
              entry.resourceProjectId === projectId &&
              entry.commandIdentity.principalId === replayKey.principalId &&
              entry.commandIdentity.clientRequestId === replayKey.clientRequestId &&
              entry.commandIdentity.idempotencyKey === replayKey.idempotencyKey,
          );
        },
        insert: async (materialization: DraftMaterializationRecordV1) => {
          if (this.materializations.some((entry) => entry.draftId === materialization.draftId)) {
            conflict('A Draft identity is already materialized.');
          }
          if (materialization.target.kind === 'SEED') {
            const seedId = materialization.target.seedId;
            if (
              this.materializations.some(
                (entry) => entry.target.kind === 'SEED' && entry.target.seedId === seedId,
              )
            ) {
              conflict('A Seed identity is already materialized.');
            }
          }
          const replayDuplicate = this.materializations.some(
            (entry) =>
              entry.resourceProjectId === materialization.resourceProjectId &&
              entry.commandIdentity.principalId === materialization.commandIdentity.principalId &&
              entry.commandIdentity.clientRequestId ===
                materialization.commandIdentity.clientRequestId &&
              entry.commandIdentity.idempotencyKey ===
                materialization.commandIdentity.idempotencyKey,
          );
          if (replayDuplicate) {
            conflict('A command replay identity is already materialized.');
          }
          const index = this.materializations.length;
          this.materializations.push(materialization);
          journal.push(() => {
            this.materializations.splice(index, 1);
          });
          return materialization;
        },
      },
    };
  }

  /**
   * Appends the current aggregate's Validation/Impact references for the
   * current revision. References are never deleted: past revision references
   * are retained, and re-saving the same artifact within the same revision is
   * idempotent (mirrors PostgreSQL INSERT ... ON CONFLICT DO NOTHING).
   */
  private replaceArtifactRefs(draft: FrontendKnowledgeDraftChangeSetV1, journal: Undo[]): void {
    const push = (
      kind: 'VALIDATION' | 'IMPACT',
      ref: FrontendKnowledgeDraftChangeSetV1['validation'] | undefined,
    ): void => {
      if (ref === undefined) return;
      const existing = this.artifactRefs.some(
        (row) =>
          row.draftId === draft.draftId &&
          row.draftRevision === draft.revision &&
          row.kind === kind &&
          row.artifactId === ref.artifactId,
      );
      if (existing) return;
      const index = this.artifactRefs.length;
      this.artifactRefs.push({
        artifactId: ref.artifactId,
        kind,
        draftId: draft.draftId,
        draftRevision: draft.revision,
        artifactRevision: ref.artifactRevision,
        digest: ref.digest,
        status: ref.status,
        projectId: draft.resourceProjectId,
      });
      journal.push(() => {
        this.artifactRefs.splice(index, 1);
      });
    };
    push('VALIDATION', draft.validation);
    push('IMPACT', draft.impactPreview);
  }

  /** Test inspection: normalized persisted state shared with the Postgres adapter. */
  snapshotState() {
    return {
      drafts: [...this.drafts.values()].map((draft) => ({
        draftId: draft.draftId,
        projectId: draft.resourceProjectId,
        revision: draft.revision,
        status: draft.status,
        startMode: draft.startMode,
        seedId: draft.seedId ?? null,
      })),
      revisions: this.revisions.map((revision) => ({
        draftId: revision.draftId,
        revision: revision.revision,
        projectId: revision.resourceProjectId,
        status: revision.status,
        contentDigest: revision.contentDigest,
      })),
      operations: this.operations.flatMap((entry) =>
        entry.operations.map((operation) => ({
          draftId: entry.draftId,
          revision: entry.revision,
          projectId: entry.projectId,
          operationId: operation.operationId,
        })),
      ),
      materializations: this.materializations.map((entry) => ({
        materializationId: entry.materializationId,
        draftId: entry.draftId,
        projectId: entry.resourceProjectId,
        seedId: entry.target.kind === 'SEED' ? entry.target.seedId : null,
        kind: entry.target.kind,
      })),
      artifacts: this.artifactRefs.map((ref) => ({
        artifactId: ref.artifactId,
        kind: ref.kind,
        draftId: ref.draftId,
        draftRevision: ref.draftRevision,
        projectId: ref.projectId,
        status: ref.status,
      })),
    };
  }
}
