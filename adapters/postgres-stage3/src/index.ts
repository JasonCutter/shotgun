import { randomUUID } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';

import {
  stableJson,
  ShotgunError,
  type EvidenceSpan,
  type TransformationRevision,
} from '../../../packages/contracts/src/index.js';
import type {
  EvidenceCandidate,
  EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import type {
  SavedTransformation,
  SaveTransformationInput,
  TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';

type RevisionRow = QueryResultRow & {
  readonly revision_id: string;
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly source_content_hash: string;
  readonly transformer_id: string;
  readonly transformer_version: string;
  readonly document_ir: TransformationRevision['documentIR'];
  readonly source_map: TransformationRevision['sourceMap'];
  readonly document_hash: string;
  readonly source_map_hash: string;
  readonly access_scope: string[];
  readonly sensitivity: TransformationRevision['sensitivity'];
  readonly created_at: Date;
};

type EvidenceRow = QueryResultRow & {
  readonly evidence_id: string;
  readonly revision_id: string;
  readonly project_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly pointer: string;
  readonly node_kind: EvidenceSpan['nodeKind'];
  readonly origin: 'source';
  readonly position: EvidenceSpan['position'];
  readonly quote: EvidenceSpan['quote'];
  readonly selectors: EvidenceSpan['selectors'];
  readonly exact_hash: string;
  readonly access_scope: string[];
  readonly sensitivity: EvidenceSpan['sensitivity'];
  readonly created_at: Date;
};

const mapRevision = (row: RevisionRow): TransformationRevision => ({
  revisionId: row.revision_id,
  projectId: row.project_id,
  sourceId: row.source_id,
  sourceVersionId: row.source_version_id,
  sourceContentHash: row.source_content_hash,
  transformer: {
    id: row.transformer_id,
    version: row.transformer_version,
  },
  documentIR: row.document_ir,
  sourceMap: row.source_map,
  documentHash: row.document_hash,
  sourceMapHash: row.source_map_hash,
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  createdAt: row.created_at.toISOString(),
});

const mapEvidence = (row: EvidenceRow): EvidenceSpan => ({
  evidenceId: row.evidence_id,
  revisionId: row.revision_id,
  projectId: row.project_id,
  sourceId: row.source_id,
  sourceVersionId: row.source_version_id,
  pointer: row.pointer,
  nodeKind: row.node_kind,
  origin: row.origin,
  position: row.position,
  quote: row.quote,
  selectors: row.selectors,
  exactHash: row.exact_hash,
  accessScope: row.access_scope,
  sensitivity: row.sensitivity,
  createdAt: row.created_at.toISOString(),
});

const revisionSelect = `
  SELECT
    revision_id::text,
    project_id,
    source_id::text,
    source_version_id::text,
    source_content_hash,
    transformer_id,
    transformer_version,
    document_ir,
    source_map,
    document_hash,
    source_map_hash,
    access_scope,
    sensitivity,
    created_at
  FROM transformation.revisions
`;

const evidenceSelect = `
  SELECT
    evidence_id::text,
    revision_id::text,
    project_id,
    source_id::text,
    source_version_id::text,
    pointer,
    node_kind,
    origin,
    position,
    quote,
    selectors,
    exact_hash,
    access_scope,
    sensitivity,
    created_at
  FROM evidence.spans
`;

export class PostgresTransformationRepository implements TransformationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(input: SaveTransformationInput): Promise<SavedTransformation> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.projectId}:${input.sourceVersionId}:${input.transformer.id}:${input.transformer.version}`,
      ]);
      let revision = await client.query<RevisionRow>(
        `${revisionSelect}
         WHERE project_id = $1
           AND source_version_id = $2
           AND transformer_id = $3
           AND transformer_version = $4`,
        [input.projectId, input.sourceVersionId, input.transformer.id, input.transformer.version],
      );
      let reusedRevision = revision.rowCount === 1;
      if (!reusedRevision) {
        const revisionId = randomUUID();
        await client.query(
          `
            INSERT INTO transformation.revisions (
              revision_id, project_id, source_id, source_version_id, source_content_hash,
              transformer_id, transformer_version, document_ir, source_map, document_hash,
              source_map_hash, access_scope, sensitivity, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            revisionId,
            input.projectId,
            input.sourceId,
            input.sourceVersionId,
            input.sourceContentHash,
            input.transformer.id,
            input.transformer.version,
            input.output.documentIR,
            input.output.sourceMap,
            input.output.documentHash,
            input.output.sourceMapHash,
            input.accessScope,
            input.sensitivity,
            input.createdAt,
          ],
        );
        revision = await client.query<RevisionRow>(`${revisionSelect} WHERE revision_id = $1`, [
          revisionId,
        ]);
        reusedRevision = false;
      }

      const stored = revision.rows[0];
      if (!stored) {
        throw new Error('Transformation Revision was not stored.');
      }
      const mapped = mapRevision(stored);
      if (
        mapped.sourceId !== input.sourceId ||
        mapped.sourceContentHash !== input.sourceContentHash ||
        mapped.documentHash !== input.output.documentHash ||
        mapped.sourceMapHash !== input.output.sourceMapHash ||
        stableJson([...mapped.accessScope].sort()) !== stableJson([...input.accessScope].sort()) ||
        mapped.sensitivity !== input.sensitivity ||
        stableJson(mapped.documentIR) !== stableJson(input.output.documentIR) ||
        stableJson(mapped.sourceMap) !== stableJson(input.output.sourceMap)
      ) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The same SourceVersion and transformer version produced different output.',
          module: 'postgres-stage3',
          operation: 'save-transformation',
        });
      }

      const attemptId = randomUUID();
      await client.query(
        `
          INSERT INTO transformation.attempts (
            attempt_id, project_id, source_version_id, transformer_id, transformer_version,
            revision_id, reused_revision, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          attemptId,
          input.projectId,
          input.sourceVersionId,
          input.transformer.id,
          input.transformer.version,
          mapped.revisionId,
          reusedRevision,
          input.createdAt,
        ],
      );
      await client.query('COMMIT');
      return { attemptId, revision: mapped, reusedRevision };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findBySourceVersion(
    projectId: string,
    sourceVersionId: string,
    transformerId: string,
    transformerVersion: string,
  ): Promise<TransformationRevision | undefined> {
    const result = await this.pool.query<RevisionRow>(
      `${revisionSelect}
       WHERE project_id = $1
         AND source_version_id = $2
         AND transformer_id = $3
         AND transformer_version = $4`,
      [projectId, sourceVersionId, transformerId, transformerVersion],
    );
    return result.rows[0] ? mapRevision(result.rows[0]) : undefined;
  }
}

export class PostgresEvidenceRepository implements EvidenceRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async index(candidates: readonly EvidenceCandidate[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const items: EvidenceSpan[] = [];
      let reusedCount = 0;
      for (const candidate of candidates) {
        const inserted = await client.query<EvidenceRow>(
          `
            INSERT INTO evidence.spans (
              evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
              node_kind, origin, position, quote, selectors, exact_hash, access_scope, sensitivity, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (project_id, revision_id, pointer) DO NOTHING
            RETURNING
              evidence_id::text, revision_id::text, project_id, source_id::text,
              source_version_id::text, pointer, node_kind, origin, position, quote, selectors,
              exact_hash, access_scope, sensitivity, created_at
          `,
          [
            randomUUID(),
            candidate.revisionId,
            candidate.projectId,
            candidate.sourceId,
            candidate.sourceVersionId,
            candidate.pointer,
            candidate.nodeKind,
            candidate.origin,
            candidate.position,
            candidate.quote,
            JSON.stringify(candidate.selectors ?? []),
            candidate.exactHash,
            candidate.accessScope,
            candidate.sensitivity,
            candidate.createdAt,
          ],
        );
        let row = inserted.rows[0];
        if (!row) {
          reusedCount += 1;
          const existing = await client.query<EvidenceRow>(
            `${evidenceSelect}
             WHERE project_id = $1 AND revision_id = $2 AND pointer = $3`,
            [candidate.projectId, candidate.revisionId, candidate.pointer],
          );
          row = existing.rows[0];
        }
        if (!row) {
          throw new Error('Evidence Span was not stored.');
        }
        const mapped = mapEvidence(row);
        if (
          stableJson({ ...mapped, evidenceId: undefined }) !==
          stableJson({ ...candidate, evidenceId: undefined })
        ) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'An Evidence pointer was reused for different source content.',
            module: 'postgres-stage3',
            operation: 'index-evidence',
          });
        }
        items.push(mapped);
      }
      await client.query('COMMIT');
      return { items, reusedCount };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly EvidenceSpan[]> {
    const result = await this.pool.query<EvidenceRow>(
      `${evidenceSelect}
       WHERE project_id = $1 AND source_version_id = $2
       ORDER BY (position ->> 'start')::integer, pointer`,
      [projectId, sourceVersionId],
    );
    return result.rows.map(mapEvidence);
  }

  async findById(projectId: string, evidenceId: string): Promise<EvidenceSpan | undefined> {
    const result = await this.pool.query<EvidenceRow>(
      `${evidenceSelect} WHERE project_id = $1 AND evidence_id = $2`,
      [projectId, evidenceId],
    );
    return result.rows[0] ? mapEvidence(result.rows[0]) : undefined;
  }
}
