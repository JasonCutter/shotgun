import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresVPImageObservationLedger } from '../../adapters/vp-knowledge-postgres/src/image-observations.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import { askGeneratedImageObservationReferenceFor } from '../../packages/contracts/src/frontend-ask-image-observation.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';

describe('historical generated image references on isolated PostgreSQL', () => {
  let database: IsolatedPostgresTestDatabase;
  let pool: Pool;
  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    pool = database.createPool();
  }, 60_000);
  afterAll(async () => database?.dispose());

  it('preserves saved output, uses per-source latest version on every read path and refuses unauthorized/mismatching observations', async () => {
    const observation = imageObservationFixture();
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: observation.projectId,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId: observation.projectId,
      name: 'Image reference projection',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    const project = {
      id: observation.projectId,
      label: 'Image reference projection',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    };
    const scope = {
      principalId: principal.principalId,
      sessionId: randomUUID(),
      activeProject: project,
      accessibleProjects: [project],
      accessRevision: 'a',
      policyContextRevision: 'p',
      accessScope: ['owner'],
      executionAuthorities: {
        [project.id]: {
          projectId: project.id,
          accessRevision: 'a',
          policyContextRevision: 'p',
          accessScope: ['owner'],
          sensitivityClearance: 'private' as const,
        },
      },
    };
    await pool.query(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,1,$3,now())`,
      [observation.originalAssetId, observation.sourceContentHash, randomUUID()],
    );
    await pool.query(
      `INSERT INTO asset.sources(source_id,project_id,created_by_actor_id,created_at) VALUES($1,$2,$3,now())`,
      [observation.sourceId, observation.projectId, principal.principalId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at) VALUES($1,$2,1,$3,'image/png','{owner}','private',now())`,
      [observation.sourceVersionId, observation.sourceId, observation.originalAssetId],
    );
    await pool.query(
      `INSERT INTO transformation.revisions(revision_id,project_id,source_id,source_version_id,source_content_hash,transformer_id,transformer_version,document_ir,source_map,document_hash,source_map_hash,access_scope,sensitivity,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'{}','{}',$5,$5,'{owner}','private',now())`,
      [
        observation.derivation.transformationRevisionId,
        observation.projectId,
        observation.sourceId,
        observation.sourceVersionId,
        observation.sourceContentHash,
        observation.derivation.transformerId,
        observation.derivation.transformerVersion,
      ],
    );
    // Trusted fixture seed isolates the read projection. Publication/execution proofs are tested separately.
    await pool.query(
      `INSERT INTO ai.image_observation_executions(call_id,project_id,request_id,source_version_id,state,attempt_id,request_digest,record_json,output_json,transformation_revision_id,created_at) VALUES($1,$2,$3,$4,'COMPLETED',$5,$6,'{}','{}',$7,$8)`,
      [
        observation.derivation.callId,
        observation.projectId,
        randomUUID(),
        observation.sourceVersionId,
        observation.derivation.attemptId,
        observation.derivation.requestDigest,
        observation.derivation.transformationRevisionId,
        observation.createdAt,
      ],
    );
    await pool.query(
      `INSERT INTO vp.image_observations(observation_id,project_id,source_id,source_version_id,original_asset_id,transformation_revision_id,call_id,attempt_id,source_content_hash,observation_text,epistemic_status,access_scope,sensitivity,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'GENERATED_UNVERIFIED','{owner}','private',$11::jsonb,$12)`,
      [
        observation.observationId,
        observation.projectId,
        observation.sourceId,
        observation.sourceVersionId,
        observation.originalAssetId,
        observation.derivation.transformationRevisionId,
        observation.derivation.callId,
        observation.derivation.attemptId,
        observation.sourceContentHash,
        observation.text,
        JSON.stringify(observation),
        observation.createdAt,
      ],
    );
    const ledger = new PostgresVPImageObservationLedger(pool, {
      findCompleted: async () => undefined,
    });
    const projection = new PostgresAskWorkspaceProjection(pool, ledger);
    const coordinator = new AskCommandCoordinator(
      new PostgresFrontendCommandGateway(pool),
      new PostgresAskConversationRepository(pool),
      projection,
      new PostgresAskSourceSelectionValidator(pool),
    );
    const submission = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question: 'What is in the image?',
        mode: 'CANONICAL_ONLY',
        sourceSelections: [],
      },
    });
    const run = submission.answerRun;
    const reference = askGeneratedImageObservationReferenceFor(observation, randomUUID());
    await pool.query(
      `UPDATE frontend_ask.answer_runs SET state='SUCCEEDED', attention_reason=NULL WHERE answer_run_id=$1`,
      [run.answerRunId],
    );
    const statementId = randomUUID();
    await pool.query(
      `INSERT INTO frontend_ask.statements(statement_id,answer_run_id,ordinal,text,statement_revision,generated_observation_references) VALUES($1,$2,0,'Generated observation, not an original quote','1',$3::jsonb)`,
      [statementId, run.answerRunId, JSON.stringify([reference])],
    );
    const read = () => projection.getAnswerRun({ ...scope, answerRunId: run.answerRunId });
    const history = async () =>
      (
        await pool.query(
          `SELECT to_jsonb(run) AS run,(SELECT jsonb_agg(to_jsonb(statement)) FROM frontend_ask.statements AS statement WHERE statement.answer_run_id=run.answer_run_id) AS statements FROM frontend_ask.answer_runs AS run WHERE run.answer_run_id=$1`,
          [run.answerRunId],
        )
      ).rows;
    const original = await read(),
      saved = await history();
    expect(original.stale).toBe(false);
    expect(original.statements[0]?.generatedObservationReferences).toEqual([reference]);
    expect(original.statements[0]?.citations).toEqual([]);
    expect(reference).not.toHaveProperty('evidenceId');
    // Another Source does not change the actual referenced version's freshness.
    const otherSource = randomUUID();
    await pool.query(
      `INSERT INTO asset.sources(source_id,project_id,created_by_actor_id,created_at) VALUES($1,$2,$3,now())`,
      [otherSource, project.id, principal.principalId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at) VALUES($1,$2,1,$3,'image/png','{owner}','private',now())`,
      [randomUUID(), otherSource, observation.originalAssetId],
    );
    expect((await read()).stale).toBe(false);
    const latestVersion = randomUUID();
    const latestAsset = randomUUID();
    await pool.query(
      `INSERT INTO asset.original_assets(asset_id,content_hash,size_bytes,storage_key,created_at) VALUES($1,$2,1,$3,now())`,
      [
        latestAsset,
        `sha256:${createHash('sha256').update(latestAsset).digest('hex')}`,
        latestAsset,
      ],
    );
    await pool.query(
      `INSERT INTO asset.source_versions(source_version_id,source_id,version_number,original_asset_id,media_type,access_scope,sensitivity,created_at) VALUES($1,$2,2,$3,'image/png','{owner}','private',now()-interval '1 day')`,
      [latestVersion, observation.sourceId, latestAsset],
    );
    expect(await read()).toEqual({ ...original, stale: true });
    const conversation = await projection.getConversation({
      ...scope,
      conversationId: run.conversationId,
    });
    const branch = await projection.getBranch({
      ...scope,
      conversationId: run.conversationId,
      branchId: run.branchId,
    });
    const workspace = await projection.getWorkspace({
      ...scope,
      conversationId: run.conversationId,
    });
    expect(conversation.branches[0]?.turns[0]?.answerRun.stale).toBe(true);
    expect(branch.turns[0]?.answerRun.stale).toBe(true);
    expect(workspace.selectedConversation?.branches[0]?.turns[0]?.answerRun.stale).toBe(true);
    expect(await history()).toEqual(saved);
    await expect(
      new PostgresAskWorkspaceProjection(pool).getAnswerRun({
        ...scope,
        answerRunId: run.answerRunId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query(
      `UPDATE asset.source_versions SET access_scope='{other}' WHERE source_version_id=$1`,
      [latestVersion],
    );
    await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query(
      `UPDATE asset.source_versions SET access_scope='{owner}' WHERE source_version_id=$1`,
      [latestVersion],
    );
    await pool.query(
      `UPDATE frontend_ask.statements SET generated_observation_references=$2::jsonb WHERE statement_id=$1`,
      [statementId, JSON.stringify([{ ...reference, observationText: 'Tampered saved text' }])],
    );
    await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pool.query(
      `UPDATE frontend_ask.statements SET generated_observation_references=$2::jsonb WHERE statement_id=$1`,
      [statementId, JSON.stringify([reference])],
    );
    await expect(
      new PostgresAskWorkspaceProjection(pool, {
        findHistorical: async () => {
          throw new Error('VP authority unavailable');
        },
      }).getAnswerRun({ ...scope, answerRunId: run.answerRunId }),
    ).rejects.toThrow();
    expect(await history()).toEqual(saved);
  });
});
