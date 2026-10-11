import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import { ASK_SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';

describe('Historical AnswerRun citation authority', () => {
  let database: IsolatedPostgresTestDatabase;
  let pool: Pool;
  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    pool = database.createPool();
  });
  afterAll(async () => database?.dispose());

  it('derives freshness consistently without rewriting history and fails closed on inaccessible or missing authority', async () => {
    const projectId = `freshness-${randomUUID()}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: projectId,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'Historical freshness',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const project = {
      id: projectId,
      label: 'Historical freshness',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    };
    const scope = {
      principalId: principal.principalId,
      sessionId: randomUUID(),
      activeProject: project,
      accessibleProjects: [project],
      accessRevision: 'access-1',
      policyContextRevision: 'policy-1',
      executionAuthorities: {
        [projectId]: {
          projectId,
          accessScope: ['owner'],
          sensitivityClearance: 'private' as const,
          accessRevision: 'access-1',
          policyContextRevision: 'policy-1',
        },
      },
    };
    const projection = new PostgresAskWorkspaceProjection(pool);
    const coordinator = new AskCommandCoordinator(
      new PostgresFrontendCommandGateway(pool),
      new PostgresAskConversationRepository(pool),
      projection,
      new PostgresAskSourceSelectionValidator(pool),
    );
    const sourceId = randomUUID(),
      assetId = randomUUID(),
      versionId = randomUUID(),
      revisionId = randomUUID(),
      evidenceId = randomUUID();
    const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
    await pool.query(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,1,$3,now())`,
      [assetId, hash(assetId), assetId],
    );
    await pool.query(
      `INSERT INTO asset.sources(source_id,project_id,created_by_actor_id,created_at) VALUES($1,$2,$3,now())`,
      [sourceId, projectId, principal.principalId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at) VALUES($1,$2,1,$3,'text/plain','{owner}','private',now())`,
      [versionId, sourceId, assetId],
    );
    await pool.query(
      `INSERT INTO transformation.revisions(revision_id,project_id,source_id,source_version_id,source_content_hash,transformer_id,transformer_version,document_ir,source_map,document_hash,source_map_hash,access_scope,sensitivity,created_at) VALUES($1,$2,$3,$4,$5,'fixture','1','{}','{}',$5,$5,'{owner}','private',now())`,
      [revisionId, projectId, sourceId, versionId, hash(assetId)],
    );
    await pool.query(
      `INSERT INTO evidence.spans(evidence_id,revision_id,project_id,source_id,source_version_id,pointer,node_kind,origin,position,quote,selectors,exact_hash,access_scope,sensitivity,created_at) VALUES($1,$2,$3,$4,$5,'/sentence[1]','sentence','source','{}','{"exact":"42 records"}','[]',$6,'{owner}','private',now())`,
      [evidenceId, revisionId, projectId, sourceId, versionId, hash('42 records')],
    );
    const submission = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question: 'How many records?',
        mode: 'CANONICAL_ONLY',
        sourceSelections: [],
      },
    });
    const runId = submission.answerRun.answerRunId,
      conversationId = submission.answerRun.conversationId,
      branchId = submission.answerRun.branchId,
      statementId = randomUUID();
    // Seed a saved successful answer; actual worker/provider coverage is the application acceptance runner.
    await pool.query(
      `UPDATE frontend_ask.answer_runs SET state='SUCCEEDED', attention_reason=NULL WHERE answer_run_id=$1`,
      [runId],
    );
    await pool.query(
      `INSERT INTO frontend_ask.statements(statement_id,answer_run_id,ordinal,text,statement_revision) VALUES($1,$2,0,'42 records','revision-1')`,
      [statementId, runId],
    );
    await pool.query(
      `INSERT INTO frontend_ask.citations(citation_id,statement_id,citation_ordinal,source_id,source_version_id,evidence_id,exact_quote) VALUES($1,$2,0,$3,$4,$5,'42 records')`,
      [randomUUID(), statementId, sourceId, versionId, evidenceId],
    );
    const read = () => projection.getAnswerRun({ ...scope, answerRunId: runId });
    const original = await read();
    expect(original.stale).toBe(false);
    const history = async () =>
      (
        await pool.query(
          `SELECT to_jsonb(r) AS run, (SELECT jsonb_agg(to_jsonb(s)) FROM frontend_ask.statements s WHERE s.answer_run_id=r.answer_run_id) AS statements, (SELECT jsonb_agg(to_jsonb(c)) FROM frontend_ask.citations c JOIN frontend_ask.statements s USING(statement_id) WHERE s.answer_run_id=r.answer_run_id) AS citations FROM frontend_ask.answer_runs r WHERE r.answer_run_id=$1`,
          [runId],
        )
      ).rows;
    const saved = await history();
    // Latest is determined by version_number, even when created_at is earlier and no extraction exists yet.
    const newerId = randomUUID();
    const newerAssetId = randomUUID();
    await pool.query(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,1,$3,now())`,
      [newerAssetId, hash(newerAssetId), newerAssetId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at) VALUES($1,$2,2,$3,'text/plain','{owner}','private',now()-interval '1 day')`,
      [newerId, sourceId, newerAssetId],
    );
    expect(await read()).toEqual({ ...original, stale: true });
    const conversation = await projection.getConversation({ ...scope, conversationId });
    const branch = await projection.getBranch({ ...scope, conversationId, branchId });
    const workspace = await projection.getWorkspace({ ...scope, conversationId });
    expect(conversation.branches[0]?.turns[0]?.answerRun.stale).toBe(true);
    expect(branch.turns[0]?.answerRun.stale).toBe(true);
    expect(workspace.selectedConversation?.branches[0]?.turns[0]?.answerRun.stale).toBe(true);
    expect(await history()).toEqual(saved);
    const newerRevisionId = randomUUID(),
      newerEvidenceId = randomUUID();
    await pool.query(
      `INSERT INTO transformation.revisions(revision_id,project_id,source_id,source_version_id,source_content_hash,transformer_id,transformer_version,document_ir,source_map,document_hash,source_map_hash,access_scope,sensitivity,created_at) VALUES($1,$2,$3,$4,$5,'fixture','1','{}','{}',$5,$5,'{owner}','private',now())`,
      [newerRevisionId, projectId, sourceId, newerId, hash(newerAssetId)],
    );
    await pool.query(
      `INSERT INTO evidence.spans(evidence_id,revision_id,project_id,source_id,source_version_id,pointer,node_kind,origin,position,quote,selectors,exact_hash,access_scope,sensitivity,created_at) VALUES($1,$2,$3,$4,$5,'/sentence[1]','sentence','source','{}','{"exact":"43 records"}','[]',$6,'{owner}','private',now())`,
      [newerEvidenceId, newerRevisionId, projectId, sourceId, newerId, hash('43 records')],
    );
    const followUp = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        conversationId,
        branchId,
        expectedConversationRevision: conversation.conversationRevision,
        expectedBranchRevision: branch.branchRevision!,
        question: 'What is the current count?',
        mode: 'CANONICAL_ONLY',
        sourceSelections: [],
      },
    });
    const currentRunId = followUp.answerRun.answerRunId,
      currentStatementId = randomUUID();
    await pool.query(
      `UPDATE frontend_ask.answer_runs SET state='SUCCEEDED', attention_reason=NULL WHERE answer_run_id=$1`,
      [currentRunId],
    );
    await pool.query(
      `INSERT INTO frontend_ask.statements(statement_id,answer_run_id,ordinal,text,statement_revision) VALUES($1,$2,0,'43 records','revision-1')`,
      [currentStatementId, currentRunId],
    );
    await pool.query(
      `INSERT INTO frontend_ask.citations(citation_id,statement_id,citation_ordinal,source_id,source_version_id,evidence_id,exact_quote) VALUES($1,$2,0,$3,$4,$5,'43 records')`,
      [randomUUID(), currentStatementId, sourceId, newerId, newerEvidenceId],
    );
    const readCurrent = () => projection.getAnswerRun({ ...scope, answerRunId: currentRunId });
    expect((await readCurrent()).stale).toBe(false);
    await expect(
      projection.getAnswerRun({ ...scope, accessibleProjects: [], answerRunId: runId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const restriction of [
      { accessScope: ['reader'], sensitivityClearance: 'private' as const },
      { accessScope: ['owner'], sensitivityClearance: 'public' as const },
    ]) {
      await expect(
        projection.getAnswerRun({
          ...scope,
          answerRunId: runId,
          executionAuthorities: {
            [projectId]: { ...scope.executionAuthorities[projectId]!, ...restriction },
          },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await pool.query(
      `UPDATE asset.source_versions SET sensitivity='restricted' WHERE source_version_id=$1`,
      [newerId],
    );
    const hiddenLatest = await read();
    expect(hiddenLatest.stale).toBe(true);
    expect(JSON.stringify(hiddenLatest)).not.toContain(newerId);
    await expect(readCurrent()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query(
      `UPDATE asset.source_versions SET sensitivity='private' WHERE source_version_id=$1`,
      [newerId],
    );
    await pool.query(`UPDATE evidence.spans SET access_scope='{other}' WHERE evidence_id=$1`, [
      evidenceId,
    ]);
    await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await readCurrent()).stale).toBe(false);
    await expect(projection.getConversation({ ...scope, conversationId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await pool.query(`UPDATE evidence.spans SET access_scope='{owner}' WHERE evidence_id=$1`, [
      evidenceId,
    ]);
    // Existing FK authority forbids deleting evidence still cited by saved history.
    await expect(
      pool.query(`DELETE FROM evidence.spans WHERE evidence_id=$1`, [evidenceId]),
    ).rejects.toMatchObject({ code: '23503' });
    expect((await read()).stale).toBe(true);
    expect(await history()).toEqual(saved);
  });

  it('does not turn a failed authority read into stale=false', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT conversation_id, project_id'))
        return { rows: [{ conversation_id: 'conversation', project_id: 'project' }] };
      if (sql.includes('current_version')) throw new Error('authority unavailable');
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const projection = new PostgresAskWorkspaceProjection({
      query,
      connect: async () => client,
    } as never);
    await expect(
      projection.getAnswerRun({
        principalId: 'principal',
        sessionId: 'session',
        activeProject: null,
        accessibleProjects: [
          { id: 'project', label: 'Project', isOwner: true, sensitivityClearance: 'private' },
        ],
        accessRevision: 'a',
        policyContextRevision: 'p',
        answerRunId: 'run',
      }),
    ).rejects.toThrow();
    expect(query.mock.calls.some(([sql]) => sql.includes('current_version'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });
});
