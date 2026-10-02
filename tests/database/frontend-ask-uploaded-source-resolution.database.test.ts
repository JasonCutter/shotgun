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
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresVPAskEvidenceSearch } from '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import type {
  AskExecutionScope,
  AskKnowledgeEvidenceSearchPort,
} from '../../modules/frontend-ask-execution/src/index.js';
import { ASK_SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
import {
  createIsolatedPostgresTestDatabase,
  type IsolatedPostgresTestDatabase,
} from '../helpers/isolated-postgres-test-database.js';

let isolatedTestDatabase: IsolatedPostgresTestDatabase | undefined;
let pool: Pool;

const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

describe('PostgreSQL uploaded Source automatic Evidence resolution', () => {
  beforeAll(async () => {
    isolatedTestDatabase = await createIsolatedPostgresTestDatabase();
    pool = isolatedTestDatabase.createPool();
  });

  afterAll(async () => {
    await isolatedTestDatabase?.dispose();
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
            node_kind, origin, position, quote, selectors, exact_hash, access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'sentence', 'source', $7::jsonb, $8::jsonb,
                 $9::jsonb, $10, '{owner}', 'private', now())`,
        [
          evidenceId,
          revisionId,
          projectId,
          sourceId,
          sourceVersionId,
          `/paragraph[${index + 1}]/sentence[1]`,
          JSON.stringify({ start: index * 40, end: index * 40 + quote.length }),
          JSON.stringify({ exact: quote }),
          JSON.stringify([{ type: 'PageSelector', page: index < 5 ? 1 : 2 }]),
          hash(quote),
        ],
      );
    }
    const vpLinkedEvidenceId = randomUUID();
    const outOfClearanceEvidenceId = randomUUID();
    for (const [index, [evidenceId, sensitivity]] of (
      [
        [vpLinkedEvidenceId, 'private'],
        [outOfClearanceEvidenceId, 'restricted'],
      ] as const
    ).entries()) {
      const quote = `Unrelated archive note ${evidenceId}.`;
      await pool.query(
        `INSERT INTO evidence.spans
           (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
            node_kind, origin, position, quote, selectors, exact_hash, access_scope, sensitivity, created_at)
         VALUES ($1, $2, $3, $4, $5, $11,
                 'sentence', 'source', $6::jsonb, $7::jsonb, $8::jsonb, $9, '{owner}', $10, now())`,
        [
          evidenceId,
          revisionId,
          projectId,
          sourceId,
          sourceVersionId,
          JSON.stringify({ start: 500, end: 500 + quote.length }),
          JSON.stringify({ exact: quote }),
          JSON.stringify([{ type: 'PageSelector', page: 11 + index }]),
          hash(quote),
          sensitivity,
          `/paragraph[${11 + index}]/sentence[1]`,
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
    const executionRepository = new PostgresAskAnswerExecutionRepository(
      pool,
      projection,
      {
        resolve: async () => {
          originalReaderCalls += 1;
          throw new Error(
            'Automatic Evidence resolution must not require original Source context.',
          );
        },
      },
      undefined,
      new PostgresVPAskEvidenceSearch(pool),
    );
    const context = await executionRepository.getRunContext(
      executionScope,
      submission.answerRun.answerRunId,
    );

    expect(context).toBeDefined();
    expect(context?.contextStatus).toBe('SUPPORTED');
    expect(context?.queryPlanRevision).toBe('ask-query-plan-v6');
    expect(context?.evidence).toHaveLength(8);
    expect(context?.evidence[0]?.pageNumbers).toEqual([1]);
    expect(context?.evidence[7]?.pageNumbers).toEqual([2]);
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

    const indexingResultId = randomUUID();
    await pool.query(
      `INSERT INTO evidence.indexing_results (
         indexing_result_id, project_id, source_id, source_version_id, revision_id,
         transformer_id, transformer_version, status, evidence_count, reused_count,
         evidence_set_digest, contract_version, security_scope_digest, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', 'INDEXED', 12, 0,
                 $6, 'stage3-evidence-index.v1', $7, now(), now())`,
      [
        indexingResultId,
        projectId,
        sourceId,
        sourceVersionId,
        revisionId,
        hash('evidence-set'),
        hash('owner-private'),
      ],
    );
    await pool.query(
      `INSERT INTO source_product.source_stage3_progress (
         project_id, source_id, source_version_id, state, indexing_result_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'STAGE3_COMPLETED', $4, now(), now())`,
      [projectId, sourceId, sourceVersionId, indexingResultId],
    );
    expect(await executionRepository.isProjectKnowledgePending(executionScope)).toBe(true);
    await pool.query(
      `INSERT INTO candidate.batches (
         batch_id, project_id, source_version_id, revision_id, idempotency_key,
         provider_call, created_at
       ) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
      [randomUUID(), projectId, sourceVersionId, revisionId, `empty-candidate-batch-${suffix}`],
    );

    const automaticCoordinator = new AskCommandCoordinator(
      new PostgresFrontendCommandGateway(pool),
      new PostgresAskConversationRepository(pool),
      projection,
      new PostgresAskSourceSelectionValidator(pool),
      { enqueue: async () => undefined },
    );
    const automatic = await automaticCoordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: `ask-vp-automatic-request-${suffix}`,
        idempotencyKey: `ask-vp-automatic-idempotency-${suffix}`,
        question: 'What is verification number A?',
        mode: 'AUTO_PROJECT_KNOWLEDGE',
        sourceSelections: [],
      },
    });
    const automaticContext = await executionRepository.getRunContext(
      executionScope,
      automatic.answerRun.answerRunId,
    );
    expect(automaticContext).toMatchObject({
      contextStatus: 'NO_SUPPORTED_ANSWER',
      queryPlanRevision: 'ask-query-plan-vp5',
    });
    expect(automaticContext?.evidence).toHaveLength(0);
    const vpAugmented = new PostgresAskAnswerExecutionRepository(
      pool,
      projection,
      { resolve: async () => undefined },
      undefined,
      {
        search: async () => ({
          knowledgeEpoch: '1',
          sourceWatermark: hash('ask-vp-source-watermark'),
          evidenceIds: [vpLinkedEvidenceId, outOfClearanceEvidenceId, randomUUID()],
        }),
        isSnapshotCurrent: async () => true,
      },
    );
    const augmentedContext = await vpAugmented.getRunContext(
      executionScope,
      automatic.answerRun.answerRunId,
    );
    expect(augmentedContext?.queryPlanRevision).toBe('ask-query-plan-vp5');
    expect(augmentedContext?.evidence.map((item) => item.evidenceId)).toContain(vpLinkedEvidenceId);
    expect(augmentedContext?.evidence).toHaveLength(1);
    expect(augmentedContext?.evidence[0]?.pageNumbers).toEqual([11]);
    expect(augmentedContext?.vpKnowledgeEpoch).toBe('1');
    expect(augmentedContext?.vpSourceWatermark).toBe(hash('ask-vp-source-watermark'));
    expect(augmentedContext?.evidence.map((item) => item.evidenceId)).not.toContain(
      outOfClearanceEvidenceId,
    );
    expect(augmentedContext?.resolvedContextDigest).not.toBe(
      automaticContext?.resolvedContextDigest,
    );
    let refreshSearches = 0;
    let refreshSnapshotChecks = 0;
    const refreshOnStale = new PostgresAskAnswerExecutionRepository(
      pool,
      projection,
      { resolve: async () => undefined },
      undefined,
      {
        search: async () => {
          refreshSearches += 1;
          return {
            knowledgeEpoch: '1',
            sourceWatermark: hash(`ask-vp-refreshed-watermark-${refreshSearches}`),
            evidenceIds: [vpLinkedEvidenceId],
          };
        },
        isSnapshotCurrent: async () => {
          refreshSnapshotChecks += 1;
          return refreshSnapshotChecks > 1;
        },
      },
    );
    const refreshedContext = await refreshOnStale.getRunContext(
      executionScope,
      automatic.answerRun.answerRunId,
    );
    expect(refreshedContext?.evidence.map((item) => item.evidenceId)).toEqual([vpLinkedEvidenceId]);
    expect(refreshSearches).toBe(2);
    expect(refreshSnapshotChecks).toBe(2);

    const staleAfterRefresh = new PostgresAskAnswerExecutionRepository(
      pool,
      projection,
      { resolve: async () => undefined },
      undefined,
      {
        search: async () => ({
          knowledgeEpoch: '1',
          sourceWatermark: hash('ask-vp-stale-watermark'),
          evidenceIds: [vpLinkedEvidenceId],
        }),
        isSnapshotCurrent: async () => false,
      },
    );
    await expect(
      staleAfterRefresh.getRunContext(executionScope, automatic.answerRun.answerRunId),
    ).rejects.toMatchObject({
      code: 'STALE_VERSION',
      operation: 'resolve-vp-snapshot',
    });
    const noVpAuthority = new PostgresAskAnswerExecutionRepository(
      pool,
      projection,
      { resolve: async () => undefined },
      undefined,
    );
    await expect(
      noVpAuthority.getRunContext(executionScope, automatic.answerRun.answerRunId),
    ).rejects.toThrow('VP knowledge authority is not configured');

    const intakeSessionId = randomUUID();
    const intakeCommandId = randomUUID();
    const intakeSubmissionId = randomUUID();
    const intakeItemId = randomUUID();
    await pool.query(
      `INSERT INTO auth.sessions
         (session_id, token_hash, csrf_hash, principal_id, active_project_id,
          expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', now())`,
      [
        intakeSessionId,
        hash(`intake-session-${suffix}`),
        hash(`intake-csrf-${suffix}`),
        principal.principalId,
        projectId,
      ],
    );
    await pool.query(
      `INSERT INTO frontend_command.command_ledger (
         command_id, command_revision, client_request_id, idempotency_key,
         principal_id, envelope_version, scope_kind, active_project_id,
         target_project_id, resource_project_id, scope_binding_key,
         command_type, command_schema_version, command_semantic_digest,
         policy_binding, accepted_principal_context, accepted_project_context,
         accepted_policy_context, preconditions, command_payload, outcome_state,
         completion_disposition, produced_resources, rejection, correlation_id,
         trace_id, received_at, accepted_at, completed_at, last_updated_at
       ) VALUES (
         $1, 1, $2, $3, $4, '2.0.0', 'PROJECT', $5, $5, NULL, $6,
         'sources.intake.submit.v1', '1.0.0', $7, '{}'::jsonb,
         $8::jsonb, $9::jsonb, $10::jsonb, '[]'::jsonb, '{}'::jsonb,
         'ACCEPTED', NULL, '[]'::jsonb, NULL, $11, $12, now(), now(), NULL, now()
       )`,
      [
        intakeCommandId,
        `vp-intake-client-${suffix}`,
        `vp-intake-idempotency-${suffix}`,
        principal.principalId,
        projectId,
        JSON.stringify({ scope: 'PROJECT', projectId }),
        hash(`vp-intake-command-${suffix}`),
        JSON.stringify({ principalId: principal.principalId }),
        JSON.stringify({ activeProjectId: projectId, targetProjectId: projectId }),
        JSON.stringify({ policyContextId: 'vp/1', policyContextRevision: '1' }),
        `vp-intake-correlation-${suffix}`,
        `vp-intake-trace-${suffix}`,
      ],
    );
    await pool.query(
      `INSERT INTO source_product.intake_submissions
         (submission_id, project_id, principal_id, session_id, create_command_id,
          state, accepted_policy_context_id, accepted_policy_binding,
          access_revision, policy_context_revision, duplicate_handling,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', 'vp/1', '{}'::jsonb,
               'access/1', 'policy/1', 'AUTOMATIC', now(), now())`,
      [intakeSubmissionId, projectId, principal.principalId, intakeSessionId, intakeCommandId],
    );
    await pool.query(
      `INSERT INTO source_product.intake_submission_items
         (submission_item_id, project_id, submission_id, client_item_id, ordinal,
          input_kind, label, input_manifest, state, created_at, updated_at)
       VALUES ($1, $2, $3, 'vp-awaiting-source', 0, 'DIRECT_TEXT',
               'Pending VP materialization', $4::jsonb, 'RUNNING', now(), now())`,
      [
        intakeItemId,
        projectId,
        intakeSubmissionId,
        JSON.stringify({
          effectiveResourceSecurity: { accessScope: ['owner'], sensitivity: 'private' },
        }),
      ],
    );
    expect(await executionRepository.isProjectKnowledgePending(executionScope)).toBe(true);
    expect(
      await executionRepository.claimInitial(executionScope, automatic.answerRun.answerRunId),
    ).toBeUndefined();
    expect(
      await executionRepository.isProjectKnowledgePending({
        ...executionScope,
        sensitivityClearance: 'public',
      }),
    ).toBe(false);
    await pool.query(
      `UPDATE source_product.intake_submission_items
          SET state = 'FAILED', completed_at = now(), updated_at = now()
        WHERE submission_item_id = $1`,
      [intakeItemId],
    );
    await pool.query(
      `UPDATE source_product.intake_submissions
          SET state = 'FAILED', completed_at = now(), updated_at = now()
        WHERE submission_id = $1`,
      [intakeSubmissionId],
    );
    expect(await executionRepository.isProjectKnowledgePending(executionScope)).toBe(false);

    const inaccessibleContext = await executionRepository.getRunContext(
      { ...executionScope, accessScope: [] },
      automatic.answerRun.answerRunId,
    );
    expect(inaccessibleContext?.contextStatus).toBe('NO_SUPPORTED_ANSWER');

    const newerAssetId = randomUUID();
    const newerVersionId = randomUUID();
    const newerContent = 'The revised document is still being processed.';
    await pool.query(
      `INSERT INTO asset.original_assets
         (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [newerAssetId, hash(newerContent), Buffer.byteLength(newerContent), `ask-vp-newer-${suffix}`],
    );
    await pool.query(
      `INSERT INTO asset.source_versions
         (source_version_id, source_id, version_number, original_asset_id,
          media_type, access_scope, sensitivity, created_at)
       VALUES ($1, $2, 2, $3, 'text/plain', '{owner}', 'private', now())`,
      [newerVersionId, sourceId, newerAssetId],
    );
    const staleContext = await executionRepository.getRunContext(
      executionScope,
      automatic.answerRun.answerRunId,
    );
    expect(staleContext?.contextStatus).toBe('NO_SUPPORTED_ANSWER');
    expect(staleContext?.vpSourceWatermark).not.toBe(automaticContext?.vpSourceWatermark);
    expect(await executionRepository.isProjectKnowledgePending(executionScope)).toBe(true);
    expect(
      await executionRepository.claimInitial(executionScope, automatic.answerRun.answerRunId),
    ).toBeUndefined();
    expect(await executionRepository.claimQueuedForWorker('vp-wait-worker', 1)).toEqual([]);

    const newerRevisionId = randomUUID();
    const newerEvidenceId = randomUUID();
    const relationExpandedEvidenceId = randomUUID();
    const newerQuote = 'Verification number A is 99 in the revised document.';
    await pool.query(
      `INSERT INTO transformation.revisions
         (revision_id, project_id, source_id, source_version_id, source_content_hash,
          transformer_id, transformer_version, document_ir, source_map, document_hash,
          source_map_hash, access_scope, sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', '{}'::jsonb,
               '{}'::jsonb, $6, $7, '{owner}', 'private', now())`,
      [
        newerRevisionId,
        projectId,
        sourceId,
        newerVersionId,
        hash(newerContent),
        hash(newerQuote),
        hash('newer-map'),
      ],
    );
    const relationExpandedQuote = 'Verification number A is 100 in the revised document.';
    await pool.query(
      `INSERT INTO evidence.spans
         (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
          node_kind, origin, position, quote, selectors, exact_hash, access_scope,
          sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, '/paragraph[2]/sentence[1]', 'sentence',
               'source', $6::jsonb, $7::jsonb, $8::jsonb, $9, '{owner}', 'private', now())`,
      [
        relationExpandedEvidenceId,
        newerRevisionId,
        projectId,
        sourceId,
        newerVersionId,
        JSON.stringify({ start: 1000, end: 1000 + relationExpandedQuote.length }),
        JSON.stringify({ exact: relationExpandedQuote }),
        JSON.stringify([{ type: 'PageSelector', page: 12 }]),
        hash(relationExpandedQuote),
      ],
    );
    await pool.query(
      `INSERT INTO evidence.spans
         (evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
          node_kind, origin, position, quote, exact_hash, access_scope,
          sensitivity, created_at)
       VALUES ($1, $2, $3, $4, $5, '/paragraph[1]/sentence[1]', 'sentence',
               'source', $6::jsonb, $7::jsonb, $8, '{owner}', 'private', now())`,
      [
        newerEvidenceId,
        newerRevisionId,
        projectId,
        sourceId,
        newerVersionId,
        JSON.stringify({ start: 0, end: newerQuote.length }),
        JSON.stringify({ exact: newerQuote }),
        hash(newerQuote),
      ],
    );
    const newerIndexingResultId = randomUUID();
    await pool.query(
      `INSERT INTO evidence.indexing_results (
         indexing_result_id, project_id, source_id, source_version_id, revision_id,
         transformer_id, transformer_version, status, evidence_count, reused_count,
         evidence_set_digest, contract_version, security_scope_digest,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'test-transformer', '1.0.0', 'INDEXED',
                 1, 0, $6, 'stage3-evidence-index.v1', $7, now(), now())`,
      [
        newerIndexingResultId,
        projectId,
        sourceId,
        newerVersionId,
        newerRevisionId,
        hash(newerEvidenceId),
        hash('owner-private-newer'),
      ],
    );
    await pool.query(
      `INSERT INTO source_product.source_stage3_progress (
         project_id, source_id, source_version_id, state, indexing_result_id,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 'STAGE3_COMPLETED', $4, now(), now())`,
      [projectId, sourceId, newerVersionId, newerIndexingResultId],
    );
    expect(await executionRepository.isProjectKnowledgePending(executionScope)).toBe(true);
    await pool.query(
      `INSERT INTO candidate.batches (
         batch_id, project_id, source_version_id, revision_id, idempotency_key,
         provider_call, created_at
       ) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now())`,
      [randomUUID(), projectId, newerVersionId, newerRevisionId, `newer-empty-batch-${suffix}`],
    );
    expect(await executionRepository.isProjectKnowledgePending(executionScope)).toBe(false);
    let transactionBoundSearchObserved = false;
    const movingEvidenceSearch: AskKnowledgeEvidenceSearchPort = {
      search: async (input) => {
        if (input.queryExecutor) transactionBoundSearchObserved = true;
        return {
          knowledgeEpoch: '0',
          sourceWatermark: hash(`vp-ask-moving-${projectId}`),
          evidenceIds: [input.queryExecutor ? relationExpandedEvidenceId : newerEvidenceId],
        };
      },
      isSnapshotCurrent: async (input) => {
        const expectedEvidenceId = input.queryExecutor
          ? relationExpandedEvidenceId
          : newerEvidenceId;
        return (
          input.snapshot.sourceWatermark === hash(`vp-ask-moving-${projectId}`) &&
          input.evidenceIds.length === 1 &&
          input.evidenceIds[0] === expectedEvidenceId
        );
      },
    };
    const movingExecutionRepository = new PostgresAskAnswerExecutionRepository(
      pool,
      projection,
      { resolve: async () => undefined },
      undefined,
      movingEvidenceSearch,
    );
    const resumed = await movingExecutionRepository.claimQueuedForWorker('vp-wait-worker', 1);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.claimed.context.snapshot.answerRunId).toBe(automatic.answerRun.answerRunId);
    expect(resumed[0]?.claimed.context.contextStatus).toBe('SUPPORTED');
    expect(resumed[0]?.claimed.context.evidence.map((item) => item.evidenceId)).toEqual([
      relationExpandedEvidenceId,
    ]);
    expect(resumed[0]?.claimed.context.evidence[0]?.pageNumbers).toEqual([12]);
    expect(transactionBoundSearchObserved).toBe(true);
    const pinnedAttempt = resumed[0]!.claimed.attempt;
    const persistedPin = await pool.query<{
      readonly vp_knowledge_epoch: string;
      readonly vp_source_watermark: string;
    }>(
      `SELECT vp_knowledge_epoch, vp_source_watermark
         FROM frontend_ask.answer_run_attempts
        WHERE attempt_id = $1`,
      [pinnedAttempt.attemptId],
    );
    expect(persistedPin.rows[0]).toEqual({
      vp_knowledge_epoch: '0',
      vp_source_watermark: resumed[0]!.claimed.context.vpSourceWatermark,
    });
    const newestAssetId = randomUUID();
    const newestVersionId = randomUUID();
    await pool.query(
      `INSERT INTO asset.original_assets
         (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 1, $3, now())`,
      [newestAssetId, hash(`ask-vp-latest-${suffix}`), `ask-vp-latest-${suffix}`],
    );
    await pool.query(
      `INSERT INTO asset.source_versions
         (source_version_id, source_id, version_number, original_asset_id,
          media_type, access_scope, sensitivity, created_at)
       VALUES ($1, $2, 3, $3, 'text/plain', '{owner}', 'private', now())`,
      [newestVersionId, sourceId, newestAssetId],
    );
    const staleCompletion = {
      scope: executionScope,
      answerRunId: automatic.answerRun.answerRunId,
      attemptNumber: pinnedAttempt.attemptNumber,
      answer: 'This stale result must not be published.',
      citations: [],
      provider: { provider: 'test', model: 'test', adapterVersion: 'test' },
      resolvedContextDigest: resumed[0]!.claimed.context.resolvedContextDigest,
      queryPlanRevision: resumed[0]!.claimed.context.queryPlanRevision,
      workerId: 'vp-wait-worker',
    };
    await expect(executionRepository.complete(staleCompletion)).rejects.toMatchObject({
      code: 'STALE_VERSION',
      operation: 'complete-vp-snapshot',
    });
    const unpublished = await pool.query<{ readonly statements: string }>(
      `SELECT count(*)::text AS statements FROM frontend_ask.statements
        WHERE answer_run_id = $1`,
      [automatic.answerRun.answerRunId],
    );
    expect(unpublished.rows[0]?.statements).toBe('0');

    const citationReadback = await automaticCoordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: `ask-vp-citation-readback-request-${suffix}`,
        idempotencyKey: `ask-vp-citation-readback-idempotency-${suffix}`,
        question: 'Show the page for this Evidence.',
        mode: 'AUTO_PROJECT_KNOWLEDGE',
        sourceSelections: [],
      },
    });
    const statementId = `ask-vp-citation-readback-statement-${suffix}`;
    await pool.query(
      `INSERT INTO frontend_ask.statements (
         statement_id, answer_run_id, ordinal, text, statement_revision
       ) VALUES ($1, $2, 0, 'The recorded Evidence is on page 11.', 'revision-1')`,
      [statementId, citationReadback.answerRun.answerRunId],
    );
    await pool.query(
      `INSERT INTO frontend_ask.citations (
         citation_id, statement_id, citation_ordinal, source_id, source_version_id,
         evidence_id, exact_quote
       ) VALUES ($1, $2, 0, $3, $4, $5, 'Unrelated archive note')`,
      [
        `ask-vp-citation-readback-citation-${suffix}`,
        statementId,
        sourceId,
        sourceVersionId,
        vpLinkedEvidenceId,
      ],
    );
    const readback = await projection.getConversation({
      ...scope,
      conversationId: citationReadback.answerRun.conversationId,
    });
    expect(readback.branches[0]?.turns[0]?.answerRun.statements[0]?.citations[0]).toMatchObject({
      sourceId,
      sourceVersionId,
      evidenceId: vpLinkedEvidenceId,
      pageNumbers: [11],
    });
  });
});
