import {
  type EntityVaultImport,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
  stableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type {
  EntityVaultReviewWrite,
  KnowledgeModelRepositoryPort,
  KnowledgeReviewWrite,
} from '../../../modules/knowledge-model/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryKnowledgeModelRepository implements KnowledgeModelRepositoryPort {
  private readonly groups = new Map<string, KnowledgeReviewGroup>();
  private readonly imports = new Map<string, EntityVaultImport>();

  async saveGroup(group: KnowledgeReviewGroup): Promise<KnowledgeReviewGroup> {
    const key = `${group.projectId}:${group.groupId}`;
    const existing = this.groups.get(key);
    if (existing) {
      if (existing.contentDigest !== group.contentDigest) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Knowledge Group ID already identifies different content.',
          module: 'stage9-in-memory',
          operation: 'save-group',
        });
      }
      return clone(existing);
    }
    this.groups.set(key, clone(group));
    return clone(group);
  }

  async findGroup(projectId: string, groupId: string): Promise<KnowledgeReviewGroup | undefined> {
    const value = this.groups.get(`${projectId}:${groupId}`);
    return value ? clone(value) : undefined;
  }

  async listGroups(projectId: string): Promise<readonly KnowledgeReviewGroup[]> {
    return [...this.groups.values()]
      .filter((group) => group.projectId === projectId)
      .sort((left, right) => left.groupId.localeCompare(right.groupId))
      .map(clone);
  }

  async reviewGroup(write: KnowledgeReviewWrite): Promise<KnowledgeReviewGroup> {
    const key = `${write.projectId}:${write.groupId}`;
    const current = this.groups.get(key);
    if (!current) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Knowledge Review Group was not found.',
        module: 'stage9-in-memory',
        operation: 'review-group',
      });
    }
    if (
      current.revisionNumber !== write.expectedRevisionNumber ||
      current.contentDigest !== write.expectedContentDigest ||
      !['PENDING_REVIEW', 'ON_HOLD'].includes(current.status)
    ) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Knowledge Review Group changed before the decision was saved.',
        module: 'stage9-in-memory',
        operation: 'review-group',
      });
    }
    this.groups.set(key, clone(write.updated));
    return clone(write.updated);
  }

  async listApprovedItems(projectId: string): Promise<readonly KnowledgeCandidate[]> {
    return [...this.groups.values()]
      .filter((group) => group.projectId === projectId && group.status === 'APPROVED')
      .flatMap((group) => group.items)
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
      .map(clone);
  }

  async saveEntityVaultImport(value: EntityVaultImport): Promise<EntityVaultImport> {
    const key = `${value.projectId}:${value.importId}`;
    const existing = this.imports.get(key);
    if (existing) {
      if (stableJson(existing) !== stableJson(value)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Entity Vault Import ID already identifies different content.',
          module: 'stage9-in-memory',
          operation: 'save-entity-vault-import',
        });
      }
      return clone(existing);
    }
    this.imports.set(key, clone(value));
    return clone(value);
  }

  async findEntityVaultImport(
    projectId: string,
    importId: string,
  ): Promise<EntityVaultImport | undefined> {
    const value = this.imports.get(`${projectId}:${importId}`);
    return value ? clone(value) : undefined;
  }

  async reviewEntityVaultImport(write: EntityVaultReviewWrite): Promise<EntityVaultImport> {
    const key = `${write.projectId}:${write.importId}`;
    const current = this.imports.get(key);
    if (!current) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The Entity Vault Import was not found.',
        module: 'stage9-in-memory',
        operation: 'review-entity-vault-import',
      });
    }
    if (current.contentDigest !== write.expectedContentDigest) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Entity Vault Import changed before approval.',
        module: 'stage9-in-memory',
        operation: 'review-entity-vault-import',
      });
    }
    if (current.status !== 'PENDING_APPROVAL') return clone(current);
    this.imports.set(key, clone(write.updated));
    return clone(write.updated);
  }

  counts(): { groups: number; imports: number } {
    return { groups: this.groups.size, imports: this.imports.size };
  }
}
