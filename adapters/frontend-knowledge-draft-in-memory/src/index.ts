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

/**
 * In-memory implementation of the FE-P3-S2 Draft Repository Boundary. It
 * mirrors every PostgreSQL invariant (unique Seed identity, one materialization
 * per Draft, unique draft+revision, unique draft+revision+operationId,
 * transactional rollback on failure) so the two adapters share exact semantics.
 * No domain invariant is reinterpreted: the aggregate is round-tripped and the
 * shared domain module owns all validation.
 */
export class InMemoryFrontendKnowledgeDraftRepository implements FrontendKnowledgeDraftRepositoryBoundaryPort {
  readonly drafts = new Map<string, FrontendKnowledgeDraftChangeSetV1>();
  readonly revisions: FrontendKnowledgeDraftRevisionRecordV1[] = [];
  readonly operations: FrontendKnowledgeDraftOperationAppendV1[] = [];
  readonly materializations: DraftMaterializationRecordV1[] = [];
  artifactRefs: InMemoryDraftArtifactRefRow[] = [];

  /** Test failpoint: throws when appending operations, verifying atomic rollback. */
  failOperationAppend = false;

  async transaction<T>(
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
          this.materializations.push(materialization);
          return materialization;
        },
      },
    };
  }

  private replaceArtifactRefs(draft: FrontendKnowledgeDraftChangeSetV1): void {
    this.artifactRefs = this.artifactRefs.filter((ref) => ref.draftId !== draft.draftId);
    const push = (
      kind: 'VALIDATION' | 'IMPACT',
      ref: FrontendKnowledgeDraftChangeSetV1['validation'] | undefined,
    ): void => {
      if (ref === undefined) return;
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
