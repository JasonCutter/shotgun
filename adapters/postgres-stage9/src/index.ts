import type { Pool, QueryResultRow } from 'pg';

export * from './typed-proposition-conflict.js';

import type {
  EntityVaultReviewWrite,
  KnowledgeModelRepositoryPort,
  KnowledgeReviewWrite,
} from '../../../modules/knowledge-model/src/index.js';
import {
  type EntityCandidate,
  type EntityVaultImport,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';

type GroupRow = QueryResultRow & {
  readonly project_id: string;
  readonly group_id: string;
  readonly source_version_id: string;
  readonly revision_number: number;
  readonly status: KnowledgeReviewGroup['status'];
  readonly content_digest: string;
  readonly items: KnowledgeReviewGroup['items'];
  readonly decisions: KnowledgeReviewGroup['decisions'];
  readonly access_scope: string[];
  readonly sensitivity: KnowledgeReviewGroup['sensitivity'];
  readonly created_at: Date;
  readonly updated_at: Date;
};

type ImportRow = QueryResultRow & {
  readonly project_id: string;
  readonly import_id: string;
  readonly source_version_id: string;
  readonly status: EntityVaultImport['status'];
  readonly content_digest: string;
  readonly entity_count: number;
  readonly entities: EntityCandidate[];
  readonly canonical_write: false;
  readonly next_action: EntityVaultImport['nextAction'];
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly approved_by: string | null;
};

const mapGroup = (row: GroupRow): KnowledgeReviewGroup => ({
  groupId: row.group_id,
  projectId: row.project_id,
  sourceVersionId: row.source_version_id,
  revisionNumber: row.revision_number,
  status: row.status,
  contentDigest: row.content_digest,
  items: row.items,
  decisions: row.decisions,
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapImport = (row: ImportRow): EntityVaultImport => ({
  importId: row.import_id,
  projectId: row.project_id,
  sourceVersionId: row.source_version_id,
  status: row.status,
  contentDigest: row.content_digest,
  entityCount: row.entity_count,
  entities: row.entities,
  canonicalWrite: false,
  nextAction: row.next_action,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  ...(row.approved_by ? { approvedBy: row.approved_by } : {}),
});

const groupColumns = `project_id, group_id, source_version_id, revision_number, status,
  content_digest, items, decisions, access_scope, sensitivity, created_at, updated_at`;

const importColumns = `project_id, import_id, source_version_id, status, content_digest,
  entity_count, entities, canonical_write, next_action, created_at, updated_at, approved_by`;

export class PostgresKnowledgeModelRepository implements KnowledgeModelRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveGroup(group: KnowledgeReviewGroup): Promise<KnowledgeReviewGroup> {
    const result = await this.pool.query<GroupRow>(
      `INSERT INTO knowledge.review_groups (${groupColumns})
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
       ON CONFLICT (project_id, group_id) DO UPDATE SET
         group_id = EXCLUDED.group_id
       WHERE knowledge.review_groups.content_digest = EXCLUDED.content_digest
       RETURNING ${groupColumns}`,
      [
        group.projectId,
        group.groupId,
        group.sourceVersionId,
        group.revisionNumber,
        group.status,
        group.contentDigest,
        JSON.stringify(group.items),
        JSON.stringify(group.decisions),
        group.accessScope,
        group.sensitivity,
        group.createdAt,
        group.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Knowledge Group ID already identifies different content.',
        module: 'postgres-stage9',
        operation: 'save-group',
      });
    }
    return mapGroup(row);
  }

  async findGroup(projectId: string, groupId: string): Promise<KnowledgeReviewGroup | undefined> {
    const result = await this.pool.query<GroupRow>(
      `SELECT ${groupColumns} FROM knowledge.review_groups
       WHERE project_id = $1 AND group_id = $2`,
      [projectId, groupId],
    );
    return result.rows[0] ? mapGroup(result.rows[0]) : undefined;
  }

  async listGroups(projectId: string): Promise<readonly KnowledgeReviewGroup[]> {
    const result = await this.pool.query<GroupRow>(
      `SELECT ${groupColumns} FROM knowledge.review_groups
       WHERE project_id = $1 ORDER BY group_id`,
      [projectId],
    );
    return result.rows.map(mapGroup);
  }

  async reviewGroup(write: KnowledgeReviewWrite): Promise<KnowledgeReviewGroup> {
    const updated = write.updated;
    const result = await this.pool.query<GroupRow>(
      `UPDATE knowledge.review_groups
       SET status = $5, decisions = $6::jsonb, updated_at = $7
       WHERE project_id = $1 AND group_id = $2
         AND revision_number = $3 AND content_digest = $4
         AND status IN ('PENDING_REVIEW', 'ON_HOLD')
       RETURNING ${groupColumns}`,
      [
        write.projectId,
        write.groupId,
        write.expectedRevisionNumber,
        write.expectedContentDigest,
        updated.status,
        JSON.stringify(updated.decisions),
        updated.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Knowledge Review Group changed before the decision was saved.',
        module: 'postgres-stage9',
        operation: 'review-group',
      });
    }
    return mapGroup(row);
  }

  async listApprovedItems(projectId: string): Promise<readonly KnowledgeCandidate[]> {
    const result = await this.pool.query<{ readonly items: KnowledgeCandidate[] } & QueryResultRow>(
      `SELECT items FROM knowledge.review_groups
       WHERE project_id = $1 AND status = 'APPROVED'
       ORDER BY group_id`,
      [projectId],
    );
    return result.rows
      .flatMap((row) => row.items)
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  }

  async saveEntityVaultImport(value: EntityVaultImport): Promise<EntityVaultImport> {
    const result = await this.pool.query<ImportRow>(
      `INSERT INTO knowledge.entity_vault_imports (${importColumns})
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, false, $8, $9, $10, $11)
       ON CONFLICT (project_id, import_id) DO UPDATE SET
         import_id = EXCLUDED.import_id
       WHERE knowledge.entity_vault_imports.content_digest = EXCLUDED.content_digest
       RETURNING ${importColumns}`,
      [
        value.projectId,
        value.importId,
        value.sourceVersionId,
        value.status,
        value.contentDigest,
        value.entityCount,
        JSON.stringify(value.entities),
        value.nextAction,
        value.createdAt,
        value.updatedAt,
        value.approvedBy ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The Entity Vault Import ID already identifies different content.',
        module: 'postgres-stage9',
        operation: 'save-entity-vault-import',
      });
    }
    return mapImport(row);
  }

  async findEntityVaultImport(
    projectId: string,
    importId: string,
  ): Promise<EntityVaultImport | undefined> {
    const result = await this.pool.query<ImportRow>(
      `SELECT ${importColumns} FROM knowledge.entity_vault_imports
       WHERE project_id = $1 AND import_id = $2`,
      [projectId, importId],
    );
    return result.rows[0] ? mapImport(result.rows[0]) : undefined;
  }

  async reviewEntityVaultImport(write: EntityVaultReviewWrite): Promise<EntityVaultImport> {
    const result = await this.pool.query<ImportRow>(
      `UPDATE knowledge.entity_vault_imports
       SET status = $4, updated_at = $5, approved_by = $6
       WHERE project_id = $1 AND import_id = $2
         AND content_digest = $3 AND status = 'PENDING_APPROVAL'
       RETURNING ${importColumns}`,
      [
        write.projectId,
        write.importId,
        write.expectedContentDigest,
        write.updated.status,
        write.updated.updatedAt,
        write.updated.approvedBy ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      const current = await this.findEntityVaultImport(write.projectId, write.importId);
      if (current && current.contentDigest === write.expectedContentDigest) return current;
      throw new ShotgunError({
        code: 'STALE_VERSION',
        safeMessage: 'The Entity Vault Import changed before approval.',
        module: 'postgres-stage9',
        operation: 'review-entity-vault-import',
      });
    }
    return mapImport(row);
  }
}
