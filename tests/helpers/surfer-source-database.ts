import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Pool } from 'pg';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresOriginalAssetRepository } from '../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { buildEvidenceCandidates } from '../../modules/evidence/src/index.js';
import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';

/** Applies actual repository migrations to the disposable DB only; never imports dotenv/database.ts. */
export async function migrateSurferSourceDatabase(pool: Pool, through?: string): Promise<string[]> {
  const directory = new URL('../../db/migrations/', import.meta.url);
  const all = (await readdir(directory)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  if (through && !all.includes(through)) throw Error('Unknown migration boundary');
  const files = through ? all.slice(0, all.indexOf(through) + 1) : all;
  const client = await pool.connect();
  try {
    await client.query(
      'CREATE SCHEMA runtime; CREATE TABLE runtime.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files) {
      await client.query('BEGIN');
      try {
        await client.query(await readFile(new URL(file, directory), 'utf8'));
        await client.query('INSERT INTO runtime.schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK');
        throw new Error(`Isolated source migration failed: ${file}`, { cause });
      }
    }
    return files;
  } finally {
    client.release();
  }
}

export async function createSurferSourceFixture(
  pool: Pool,
  principalId: string,
  projectId = `surfer-source-${randomUUID()}`,
) {
  const now = new Date().toISOString();
  await pool.query("INSERT INTO project_admin.projects(id,name,status) VALUES ($1,$1,'ACTIVE')", [
    projectId,
  ]);
  await pool.query('INSERT INTO project_admin.project_knowledge_epoch(project_id) VALUES ($1)', [
    projectId,
  ]);
  const auth = new PostgresAuthRepository(pool);
  await auth.createProjectOwnerMembership({
    principalId,
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const session = await auth.createSession(
    principalId,
    projectId,
    new Date(Date.now() + 3600_000).toISOString(),
  );
  const request = { projectId, sessionToken: session.sessionToken };
  const transformer = new LucasAugmentedPlainTextAdapter();
  async function source(
    text: string,
    options: {
      sourceId?: string;
      indexed?: boolean;
      noEvidence?: boolean;
      mediaType?: 'text/plain' | 'text/markdown';
      accessScope?: string[];
    } = {},
  ) {
    const mediaType = options.mediaType ?? 'text/plain',
      accessScope = options.accessScope ?? ['owner'];
    const contentHash = sha256Text(text);
    const stored = await new PostgresOriginalAssetRepository(pool).store({
      submissionId: randomUUID(),
      projectId,
      actorId: principalId,
      ...(options.sourceId ? { requestedSourceId: options.sourceId } : {}),
      channel: 'direct_text',
      materialKind: 'plain_text',
      mediaType,
      contentHash,
      sizeBytes: Buffer.byteLength(text),
      storageKey: `surfer-fixture/${randomUUID()}`,
      accessScope,
      sensitivity: 'private',
      createdAt: now,
    });
    if (options.indexed === false) return { ...stored, revisionId: null, evidenceIds: [] };
    const output = transformer.transform({
      sourceId: stored.sourceId,
      sourceVersionId: stored.sourceVersionId,
      sourceContentHash: contentHash,
      mediaType,
      text,
    });
    const saved = await new PostgresTransformationRepository(pool).save({
      projectId,
      sourceId: stored.sourceId,
      sourceVersionId: stored.sourceVersionId,
      sourceContentHash: contentHash,
      transformer: transformer.identity,
      output,
      accessScope,
      sensitivity: 'private',
      createdAt: now,
    });
    // An explicit source-owner NO_EVIDENCE receipt fixture, not a transformer-quality claim.
    const indexed = options.noEvidence
      ? { items: [], reusedCount: 0 }
      : await new PostgresEvidenceRepository(pool).index(
          buildEvidenceCandidates(saved.revision, transformer),
        );
    const indexingId = randomUUID(),
      ids = indexed.items.map((e) => e.evidenceId).sort();
    await pool.query(
      `INSERT INTO evidence.indexing_results(indexing_result_id,project_id,source_id,source_version_id,revision_id,
      transformer_id,transformer_version,status,evidence_count,reused_count,evidence_set_digest,contract_version,security_scope_digest,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$12,$8,0,$9,'surfer-fixture-v1',$10,$11,$11)`,
      [
        indexingId,
        projectId,
        stored.sourceId,
        stored.sourceVersionId,
        saved.revision.revisionId,
        transformer.identity.id,
        transformer.identity.version,
        ids.length,
        sha256Text(stableJson(ids)),
        sha256Text(stableJson({ accessScope, sensitivity: 'private' })),
        now,
        options.noEvidence ? 'NO_EVIDENCE' : 'INDEXED',
      ],
    );
    await pool.query(
      `INSERT INTO source_product.source_stage3_progress(project_id,source_id,source_version_id,state,indexing_result_id,created_at,updated_at)
      VALUES ($1,$2,$3,$6,$4,$5,$5)`,
      [
        projectId,
        stored.sourceId,
        stored.sourceVersionId,
        indexingId,
        now,
        options.noEvidence ? 'NO_EVIDENCE' : 'STAGE3_COMPLETED',
      ],
    );
    return { ...stored, revisionId: saved.revision.revisionId, evidenceIds: ids };
  }
  async function emptyIntake() {
    const commandId = `surfer-empty-${randomUUID()}`,
      submissionId = randomUUID(),
      requestId = randomUUID();
    await pool.query(
      `INSERT INTO frontend_command.command_ledger(command_id,command_revision,client_request_id,idempotency_key,
      principal_id,target_project_id,resource_project_id,command_type,command_schema_version,command_semantic_digest,
      policy_binding,accepted_principal_context,accepted_project_context,accepted_policy_context,preconditions,command_payload,
      outcome_state,completion_disposition,correlation_id,trace_id,received_at,accepted_at,completed_at,last_updated_at)
      VALUES ($1,1,$2,$2,$3,$4,$4,'CreateIntakeSubmission','1.0.0',$5,'{}','{}','{}','{}','{}','{}',
        'COMPLETED','SUCCEEDED',$1,$1,now(),now(),now(),now())`,
      [commandId, requestId, principalId, projectId, sha256Text(commandId)],
    );
    await pool.query(
      `INSERT INTO source_product.intake_submissions(submission_id,project_id,principal_id,session_id,create_command_id,
      state,accepted_policy_context_id,accepted_policy_binding,access_revision,policy_context_revision,created_at,updated_at,completed_at)
      VALUES ($1,$2,$3,$4,$5,'SUCCEEDED',$6,'{"mode":"CURRENT","policyContextRevision":"1"}','fixture-access','1',now(),now(),now())`,
      [
        submissionId,
        projectId,
        principalId,
        session.sessionId,
        commandId,
        `project-policy-context/${projectId}`,
      ],
    );
  }
  return { projectId, principalId, session, request, source, emptyIntake };
}
