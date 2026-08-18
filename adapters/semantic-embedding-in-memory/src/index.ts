import type {
  SemanticEmbeddingProfile,
  SemanticEmbeddingProfileRepositoryPort,
  SemanticEmbeddingProfileStatus,
} from '../../../packages/contracts/src/index.js';

const keyOf = (projectId: string, revision: number): string => `${projectId}:${revision}`;

const copy = (profile: SemanticEmbeddingProfile): SemanticEmbeddingProfile => ({
  ...profile,
});

export class InMemorySemanticEmbeddingProfileRepository implements SemanticEmbeddingProfileRepositoryPort {
  private readonly current = new Map<string, SemanticEmbeddingProfile>();
  private readonly history = new Map<string, SemanticEmbeddingProfile>();
  private readonly active = new Map<string, SemanticEmbeddingProfile>();

  async findActive(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    const value = this.active.get(projectId);
    return value ? copy(value) : undefined;
  }

  async findCurrent(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    const value = this.current.get(projectId);
    return value ? copy(value) : undefined;
  }

  async findByRevision(
    projectId: string,
    revision: number,
  ): Promise<SemanticEmbeddingProfile | undefined> {
    const value = this.history.get(keyOf(projectId, revision));
    return value ? copy(value) : undefined;
  }

  async saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: SemanticEmbeddingProfile;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    const existing = this.current.get(input.next.projectId);
    if ((existing?.profileRevision ?? 0) !== input.expectedRevision) return 'CONFLICT';
    if (input.next.profileRevision !== input.expectedRevision + 1) return 'CONFLICT';

    const historyKey = keyOf(input.next.projectId, input.next.profileRevision);
    if (this.history.has(historyKey)) return 'CONFLICT';

    const nextCopy = copy(input.next);
    this.history.set(historyKey, nextCopy);
    this.current.set(input.next.projectId, nextCopy);
    if (input.next.status === 'ACTIVE') {
      this.active.set(input.next.projectId, nextCopy);
    }
    return existing ? 'UPDATED' : 'CREATED';
  }

  async updateStatus(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly status: SemanticEmbeddingProfileStatus;
    readonly activatedAt?: string;
    readonly updatedBy: string;
    readonly updatedAt: string;
  }): Promise<SemanticEmbeddingProfile | 'NOT_FOUND' | 'CONFLICT'> {
    const historyKey = keyOf(input.projectId, input.profileRevision);
    const existing = this.history.get(historyKey);
    if (!existing || existing.profileId !== input.profileId) return 'NOT_FOUND';

    const updated: SemanticEmbeddingProfile = {
      ...existing,
      status: input.status,
      ...(input.activatedAt ? { activatedAt: input.activatedAt } : {}),
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt,
    };

    this.history.set(historyKey, updated);

    const latest = this.current.get(input.projectId);
    if (latest?.profileRevision === input.profileRevision) {
      this.current.set(input.projectId, updated);
    }

    if (input.status === 'ACTIVE') {
      const prevActive = this.active.get(input.projectId);
      if (prevActive && prevActive.profileRevision !== input.profileRevision) {
        const prevKey = keyOf(input.projectId, prevActive.profileRevision);
        const retiredPrev: SemanticEmbeddingProfile = {
          ...prevActive,
          status: 'RETIRED',
          updatedAt: input.updatedAt,
        };
        this.history.set(prevKey, retiredPrev);
        if (latest?.profileRevision === prevActive.profileRevision) {
          this.current.set(input.projectId, retiredPrev);
        }
      }
      this.active.set(input.projectId, updated);
    } else if (this.active.get(input.projectId)?.profileRevision === input.profileRevision) {
      this.active.delete(input.projectId);
    }

    return copy(updated);
  }
}
