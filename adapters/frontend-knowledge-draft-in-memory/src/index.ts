import {
  FrontendKnowledgeDraftCommandError,
  stableJson,
  type FrontendKnowledgeDraftChangeSetV1,
} from '../../../packages/contracts/src/index.js';
import type {
  DraftMaterializationRecordV1,
  FrontendKnowledgeDraftOperationAppendV1,
  FrontendKnowledgeDraftRepositoryBoundaryPort,
  FrontendKnowledgeDraftRevisionRecordV1,
  FrontendKnowledgeDraftTransactionHandleV1,
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
  readonly projectPolicyContext: unknown;
};

const conflict = (message: string): never => {
  throw new FrontendKnowledgeDraftCommandError('DRAFT_REVISION_CONFLICT', message);
};

const digestMismatch = (message: string): never => {
  throw new FrontendKnowledgeDraftCommandError('DIGEST_MISMATCH', message);
};

/**
 * In-memory implementation of the FE-P3-S2 Draft Repository Boundary. It
 * mirrors every PostgreSQL invariant (unique Seed identity, one materialization
 * per Draft, unique draft+revision, unique draft+revision+operationId,
 * unique command replay identity, one authoritative artifact reference per
 * (draft_id, draft_revision, artifact_kind), transactional rollback on
 * failure) so the two adapters share exact semantics. No domain invariant is
 * reinterpreted: the aggregate is round-tripped and the shared domain module
 * owns all validation.
 *
 * Concurrency model — full FIFO transaction serialization:
 * Every `transaction()` runs inside a fair global queue. One transaction
 * executes to completion (commit or rollback) before the next starts, so no
 * transaction can ever observe another transaction's uncommitted writes
 * (dirty reads are structurally impossible) and a rollback can never erase a
 * concurrently committed write. A transaction-local snapshot is taken at
 * execution start and restored only on failure. The queue always continues
 * after success and failure (lock is always released) and preserves request
 * order. This mirrors PostgreSQL's observable correctness for the single
 * process / test boundary while prioritising correctness over throughput.
 */
export class InMemoryFrontendKnowledgeDraftRepository implements FrontendKnowledgeDraftRepositoryBoundaryPort {
  readonly drafts = new Map<string, FrontendKnowledgeDraftChangeSetV1>();
  readonly revisions: FrontendKnowledgeDraftRevisionRecordV1[] = [];
  readonly operations: FrontendKnowledgeDraftOperationAppendV1[] = [];
  readonly materializations: DraftMaterializationRecordV1[] = [];
  artifactRefs: InMemoryDraftArtifactRefRow[] = [];

  /** Test failpoint: throws when appending operations, verifying atomic rollback. */
  failOperationAppend = false;

  /** Fair FIFO queue serializing every transaction. Resolves after the head settles. */
  private tail: Promise<unknown> = Promise.resolve();

  async transaction<T>(
    action: (repositories: FrontendKnowledgeDraftTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    const run = this.tail.then(
      () => this.execute(action),
      () => this.execute(action),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async transactionWithHandle<T>(
    action: (handle: FrontendKnowledgeDraftTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    const run = this.tail.then(
      () => this.executeHandle(action),
      () => this.executeHandle(action),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Executes one handle transaction with the same snapshot rollback semantics. */
  private async executeHandle<T>(
    action: (handle: FrontendKnowledgeDraftTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    const drafts = new Map(this.drafts);
    const revisions = [...this.revisions];
    const operations = [...this.operations];
    const materializations = [...this.materializations];
    const artifactRefs = [...this.artifactRefs];
    try {
      return await action({ repositories: this.repositories(), raw: undefined });
    } catch (error) {
      this.drafts.clear();
      for (const [key, value] of drafts) this.drafts.set(key, value);
      this.revisions.splice(0, this.revisions.length, ...revisions);
      this.operations.splice(0, this.operations.length, ...operations);
      this.materializations.splice(0, this.materializations.length, ...materializations);
      this.artifactRefs.splice(0, this.artifactRefs.length, ...artifactRefs);
      throw error;
    }
  }

  /** Executes one transaction against the shared state with snapshot rollback. */
  private async execute<T>(
    action: (repositories: FrontendKnowledgeDraftTransactionRepositoriesV1) => Promise<T>,
  ): Promise<T> {
    const drafts = new Map(this.drafts);
    const revisions = [...this.revisions];
    const operations = [...this.operations];
    const materializations = [...this.materializations];
    const artifactRefs = [...this.artifactRefs];
    try {
      return await action(this.repositories());
    } catch (error) {
      this.drafts.clear();
      for (const [key, value] of drafts) this.drafts.set(key, value);
      this.revisions.splice(0, this.revisions.length, ...revisions);
      this.operations.splice(0, this.operations.length, ...operations);
      this.materializations.splice(0, this.materializations.length, ...materializations);
      this.artifactRefs.splice(0, this.artifactRefs.length, ...artifactRefs);
      throw error;
    }
  }

  private repositories(): FrontendKnowledgeDraftTransactionRepositoriesV1 {
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
          this.replaceArtifactRefs(draft);
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
          this.drafts.set(draft.draftId, draft);
          this.replaceArtifactRefs(draft);
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
          this.revisions.push(revision);
          return revision;
        },
      },
      operations: {
        append: async (input: FrontendKnowledgeDraftOperationAppendV1) => {
          if (this.failOperationAppend) {
            throw new Error('operation append failpoint');
          }
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
        findBySeed: async (seedId) =>
          this.materializations.find((entry) =>
            entry.target.kind === 'SEED' ? entry.target.seedId === seedId : false,
          ),
        findByDraftId: async (projectId, draftId) =>
          this.materializations.find(
            (entry) => entry.resourceProjectId === projectId && entry.draftId === draftId,
          ),
        findByCommandReplayKey: async (projectId, replayKey) =>
          this.materializations.find(
            (entry) =>
              entry.resourceProjectId === projectId &&
              entry.commandIdentity.principalId === replayKey.principalId &&
              entry.commandIdentity.clientRequestId === replayKey.clientRequestId &&
              entry.commandIdentity.idempotencyKey === replayKey.idempotencyKey,
          ),
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
          this.materializations.push(materialization);
          return materialization;
        },
      },
    };
  }

  /**
   * Reconciles the current aggregate's Validation/Impact references for the
   * current revision. One authoritative reference per (draft_id,
   * draft_revision, artifact_kind) is allowed. Past revision references are
   * never deleted. When a reference for the same revision and kind already
   * exists, every immutable field is compared: an exact match is an idempotent
   * no-op, a digest change fails closed with DIGEST_MISMATCH, and any other
   * immutable field change fails closed with DRAFT_REVISION_CONFLICT.
   * Comparisons use stable serialization so object key order is irrelevant.
   */
  private replaceArtifactRefs(draft: FrontendKnowledgeDraftChangeSetV1): void {
    const push = (
      kind: 'VALIDATION' | 'IMPACT',
      ref: FrontendKnowledgeDraftChangeSetV1['validation'] | undefined,
    ): void => {
      if (ref === undefined) return;
      const existing = this.artifactRefs.find(
        (row) =>
          row.draftId === draft.draftId &&
          row.draftRevision === draft.revision &&
          row.kind === kind,
      );
      if (existing === undefined) {
        this.artifactRefs.push({
          artifactId: ref.artifactId,
          kind,
          draftId: draft.draftId,
          draftRevision: draft.revision,
          artifactRevision: ref.artifactRevision,
          digest: ref.digest,
          status: ref.status,
          projectId: draft.resourceProjectId,
          projectPolicyContext: ref.projectPolicyContext,
        });
        return;
      }
      if (
        existing.artifactId !== ref.artifactId ||
        existing.artifactRevision !== ref.artifactRevision ||
        existing.status !== ref.status ||
        existing.projectId !== draft.resourceProjectId ||
        stableJson(existing.projectPolicyContext) !== stableJson(ref.projectPolicyContext)
      ) {
        conflict('Artifact reference immutable fields differ for the same Draft revision.');
      }
      if (existing.digest !== ref.digest) {
        digestMismatch('Artifact reference digest differs for the same Draft revision.');
      }
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
        artifactRevision: ref.artifactRevision,
        digest: ref.digest,
        status: ref.status,
        projectId: ref.projectId,
        projectPolicyContext: ref.projectPolicyContext,
      })),
    };
  }
}
