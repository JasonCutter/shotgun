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

  async findActive(projectId: string): Promise<SemanticEmbeddingProfile | undefined> {
    let highestActive: SemanticEmbeddingProfile | undefined;
    for (const profile of this.history.values()) {
      if (profile.projectId === projectId && profile.status === 'ACTIVE') {
        if (!highestActive || profile.profileRevision > highestActive.profileRevision) {
          highestActive = profile;
        }
      }
    }
    return highestActive ? copy(highestActive) : undefined;
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

    return copy(updated);
  }
}
