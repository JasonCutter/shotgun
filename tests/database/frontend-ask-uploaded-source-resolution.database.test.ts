import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import type { AskExecutionScope } from '../../modules/frontend-ask-execution/src/index.js';
import { ASK_SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe('PostgreSQL uploaded Source automatic Evidence resolution', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('resolves bounded Evidence for the Browser source-only selection without calling the original reader', async () => {
    const suffix = randomUUID();
    const projectId = `ask-uploaded-resolution-project-${suffix}`;
    const accountId = `ask-uploaded-resolution-account-${suffix}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const content = `Uploaded source content for automatic Evidence resolution ${suffix}.`;
    const contentHash = hash(content);
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId,
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: `ask-uploaded-resolution-project-command-${suffix}`,
      clientRequestId: `ask-uploaded-resolution-project-request-${suffix}`,
      idempotencyKey: `ask-uploaded-resolution-project-idempotency-${suffix}`,
      projectId,
      name: 'Uploaded Source Resolution Fixture',
      description: 'Focused automatic Evidence resolution fixture',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await new PostgresAuthRepository(pool).createProjectOwnerMembership({
      principalId: principal.principalId,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });

    await pool.query(
      `INSERT INTO asset.original_assets
         (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [assetId, contentHash, Buffer.byteLength(content), `ask-uploaded-resolution-${suffix}`],
    );
    await pool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, $3, now())`,
      [sourceId, projectId, principal.principalId],
    );
    await pool.query(
      `INSERT INTO asset.source_versions
         (source_version_id, source_id, version_number, original_asset_id,
          media_type, access_scope, sensitivity, created_at)
       VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'private', now())`,
      [sourceVersionId, sourceId, assetId],
    );
    await pool.query(
      `INSERT INTO transformation.revisions
         (revision_id, project_id, source_id, source_version_id, source_content_hash,
          transformer_id, transformer_version, document_ir, source_map, document_hash,
          source_map_hash, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', '{}'::jsonb, '{}'::jsonb,
               $6, $7, '{owner}', 'private', now())`,
      [revisionId, projectId, sourceId, sourceVersionId, contentHash, hash(content), hash('map')],
    );

    const evidenceIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const evidenceId = randomUUID();
      evidenceIds.push(evidenceId);
      const quote = `Verification number A is ${17 + index}.`;
      await pool.query(
        `INSERT INTO evidence.spans
           (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
            node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'sentence', 'source', $7::jsonb, $8::jsonb,
                 $9, '{owner}', 'private', now())`,
        [
          evidenceId,
          revisionId,
          projectId,
          sourceId,
          sourceVersionId,
          `/paragraph[${index + 1}]/sentence[1]`,
          JSON.stringify({ start: index * 40, end: index * 40 + quote.length }),
          JSON.stringify({ exact: quote }),
          hash(quote),
        ],
      );
    }

    const scope = {
      principalId: principal.principalId,
      sessionId: `ask-uploaded-resolution-session-${suffix}`,
      activeProject: {
        id: projectId,
        label: 'Uploaded Source Resolution Fixture',
        isOwner: true as const,
        sensitivityClearance: 'private' as const,
      },
      accessibleProjects: [
        {
          id: projectId,
          label: 'Uploaded Source Resolution Fixture',
          isOwner: true as const,
          sensitivityClearance: 'private' as const,
        },
      ],
      accessRevision: `ask-uploaded-resolution-access-${suffix}`,
      policyContextRevision: `ask-uploaded-resolution-policy-${suffix}`,
      executionAuthorities: {
        [projectId]: {
          projectId,
          accessRevision: `ask-uploaded-resolution-access-${suffix}`,
          policyContextRevision: `ask-uploaded-resolution-policy-${suffix}`,
          accessScope: ['owner'] as const,
          sensitivityClearance: 'private' as const,
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
    const submission = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: `ask-uploaded-resolution-request-${suffix}`,
        idempotencyKey: `ask-uploaded-resolution-idempotency-${suffix}`,
        question: 'What is verification number A?',
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [{ sourceId, sourceVersionId, evidenceIds: [] }],
      },
    });

    const executionScope: AskExecutionScope = {
      principalId: principal.principalId,
      projectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      sensitivityClearance: 'private',
      accessScope: ['owner'],
    };
    let originalReaderCalls = 0;
    const executionRepository = new PostgresAskAnswerExecutionRepository(pool, projection, {
      resolve: async () => {
        originalReaderCalls += 1;
        throw new Error('Automatic Evidence resolution must not require original Source context.');
      },
    });
    const context = await executionRepository.getRunContext(
      executionScope,
      submission.answerRun.answerRunId,
    );

    expect(context).toBeDefined();
    expect(context?.contextStatus).toBe('SUPPORTED');
    expect(context?.queryPlanRevision).toBe('ask-query-plan-v4');
    expect(context?.evidence).toHaveLength(8);
    expect(context?.context.filter((item) => item.kind === 'EVIDENCE')).toHaveLength(8);
    expect(context?.context).not.toContainEqual(
      expect.objectContaining({ kind: 'SOURCE_VERSION' }),
    );
    expect(originalReaderCalls).toBe(0);
    expect(
      context?.evidence.every(
        (item) =>
          item.sourceId === sourceId &&
          item.sourceVersionId === sourceVersionId &&
          evidenceIds.includes(item.evidenceId),
      ),
    ).toBe(true);
  });
});
