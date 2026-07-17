import type {
  CanonicalSearchMatch,
  CanonicalSearchResult,
  ProjectionWatermark,
  SearchProjectionDocument,
} from '../../../packages/contracts/src/index.js';
import { canonicalSnapshotDigest } from '../../../packages/contracts/src/index.js';
import type {
  ProjectionCommitWrite,
  ProjectionRebuildWrite,
  SearchProjectionRepositoryPort,
} from '../../../modules/projection-search/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);
const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().trim();
const trigrams = (value: string): Set<string> => {
  const padded = `  ${normalize(value)} `;
  return new Set(
    Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) =>
      padded.slice(index, index + 3),
    ),
  );
};
const similarity = (left: string, right: string): number => {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return (2 * intersection) / (a.size + b.size);
};
const scopeAllowed = (required: readonly string[], actual: readonly string[]): boolean => {
  const available = new Set(actual);
  return required.every((scope) => available.has(scope));
};

export type InMemoryProjectionOptions = { readonly failpoint?: 'after-document' };

export class InMemorySearchProjectionRepository implements SearchProjectionRepositoryPort {
  private readonly documents = new Map<string, SearchProjectionDocument>();
  private readonly watermarks = new Map<string, ProjectionWatermark>();

  constructor(private readonly options: InMemoryProjectionOptions = {}) {}

  async applyCommit(projectId: string, write: ProjectionCommitWrite): Promise<void> {
    const existing = this.watermarks.get(projectId);
    if (existing?.lastCommitId === write.commitId) return;
    const projectedVersion = existing?.canonicalVersion ?? 0;
    const expectedVersion =
      write.operation === 'ADD_CLAIM' ? projectedVersion + 1 : projectedVersion;
    if (write.canonicalVersion !== expectedVersion) {
      throw new Error(
        `Projection sequence gap: expected ${expectedVersion}, received ${write.canonicalVersion}.`,
      );
    }
    const nextDocuments = new Map(this.documents);
    if (write.document)
      nextDocuments.set(`${projectId}:${write.document.claimId}`, clone(write.document));
    if (this.options.failpoint === 'after-document')
      throw new Error('Stage 7 projection failpoint after document.');
    this.documents.clear();
    for (const [key, value] of nextDocuments) this.documents.set(key, value);
    this.watermarks.set(projectId, {
      projectId,
      lastCommitId: write.commitId,
      canonicalVersion: write.canonicalVersion,
      snapshotDigest: write.snapshotDigest,
      status: 'READY',
      updatedAt: write.projectedAt,
    });
  }

  async rebuild(projectId: string, write: ProjectionRebuildWrite): Promise<void> {
    const next = new Map(
      [...this.documents].filter(([, document]) => document.projectId !== projectId),
    );
    for (const document of write.documents)
      next.set(`${projectId}:${document.claimId}`, clone(document));
    if (this.options.failpoint === 'after-document')
      throw new Error('Stage 7 projection failpoint after document.');
    this.documents.clear();
    for (const [key, value] of next) this.documents.set(key, value);
    this.watermarks.set(projectId, clone(write.watermark));
  }

  async markDegraded(projectId: string, error: string, updatedAt: string): Promise<void> {
    const existing = this.watermarks.get(projectId);
    this.watermarks.set(projectId, {
      projectId,
      ...(existing?.lastCommitId ? { lastCommitId: existing.lastCommitId } : {}),
      canonicalVersion: existing?.canonicalVersion ?? 0,
      snapshotDigest: existing?.snapshotDigest ?? canonicalSnapshotDigest(projectId, 0, []),
      status: 'DEGRADED',
      lastError: error,
      updatedAt,
    });
  }

  async findWatermark(projectId: string): Promise<ProjectionWatermark | undefined> {
    const value = this.watermarks.get(projectId);
    return value ? clone(value) : undefined;
  }

  async search(
    projectId: string,
    query: string,
    limit: number,
    accessScopes: readonly string[],
  ): Promise<readonly CanonicalSearchResult[]> {
    const normalizedQuery = normalize(query);
    const queryTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
    return [...this.documents.values()]
      .filter(
        (document) =>
          document.projectId === projectId && scopeAllowed(document.accessScope, accessScopes),
      )
      .flatMap((document) => {
        const text = normalize(document.claimText);
        let matchType: CanonicalSearchMatch | undefined;
        let score = 0;
        if (text.includes(normalizedQuery)) {
          matchType = 'SUBSTRING';
          score = 1;
        } else if (queryTokens.every((token) => text.includes(token))) {
          matchType = 'FULL_TEXT';
          score = 0.8;
        } else {
          const value = similarity(text, normalizedQuery);
          if (value >= 0.3) {
            matchType = 'TRIGRAM';
            score = value;
          }
        }
        return matchType ? [{ ...clone(document), score, matchType }] : [];
      })
      .sort((left, right) => right.score - left.score || left.claimId.localeCompare(right.claimId))
      .slice(0, limit);
  }

  counts(): { documents: number; watermarks: number } {
    return { documents: this.documents.size, watermarks: this.watermarks.size };
  }
}
