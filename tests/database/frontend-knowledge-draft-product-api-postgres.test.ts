import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { InMemoryFrontendKnowledgeDraftTargetResolver } from '../../adapters/frontend-knowledge-draft-api-in-memory/src/index.js';
import { FrontendKnowledgeDraftProductCoordinator } from '../../modules/frontend-knowledge-draft/src/product-api.js';
import { frontendKnowledgeDraftRevisionDigest } from '../../modules/frontend-knowledge-draft/src/index.js';
import {
  sha256Text,
  stableJson,
  type FrontendKnowledgeOperationV1,
} from '../../packages/contracts/src/index.js';
import { pBase, pOperation } from '../helpers/frontend-knowledge-draft-parity.js';

const PROJECT_ID = 'project-1';
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const digestOf = (value: unknown): string => sha256Text(stableJson(value));

describe.runIf(pool)('FE-P3-S2 Product API coordinator on PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(
      `TRUNCATE frontend_knowledge_draft.drafts,
                frontend_knowledge_draft.revisions,
                frontend_knowledge_draft.operations,
                frontend_knowledge_draft.materializations,
                frontend_knowledge_draft.artifact_refs,
                frontend_command.command_ledger
       CASCADE`,
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  const buildCoordinator = () => {
    const resolver = new InMemoryFrontendKnowledgeDraftTargetResolver();
    resolver.registerSeed('seed-1', {
      resourceId: 'resource-1',
      resourceProjectId: PROJECT_ID,
      draftProjectId: PROJECT_ID,
      effectiveProjectId: PROJECT_ID,
      base: pBase,
    });
    return {
      resolver,
      coordinator: new FrontendKnowledgeDraftProductCoordinator(
        new PostgresFrontendKnowledgeDraftRepository(pool!),
        new PostgresFrontendCommandGateway(pool!),
        resolver,
      ),
    };
  };

  const scope = {
    principalId: 'principal-1',
    sessionId: 'session-1',
    activeProjectId: PROJECT_ID,
    accessRevision: 'access-7',
    policyContextRevision: '7',
    sensitivityClearance: 'private' as const,
    accessScope: ['owner'],
  };

  it('materializes a Seed, persists the Draft + Materialization and records a durable COMPLETED outcome', async () => {
    const { coordinator } = buildCoordinator();
    const request = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      seedId: 'seed-1',
    };
    const result = await coordinator.materializeDraft(scope, request);
    expect(result.outcome).toBe('COMPLETED');
    expect(result.draft.seedId).toBe('seed-1');
    expect(result.draft.revision).toBe(1);

    const drafts = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_knowledge_draft.drafts',
    );
    const materializations = await pool!.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM frontend_knowledge_draft.materializations',
    );
    expect(drafts.rows[0]?.count).toBe('1');
    expect(materializations.rows[0]?.count).toBe('1');

    const outcome = await coordinator.resolveCommandOutcome(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      semanticDigest: digestOf(request),
    });
    expect(outcome.outcome).toBe('COMPLETED');
    expect(outcome.draft?.draftId).toBe(result.draft.draftId);

    // Idempotent replay with the same meaning returns the same Draft.
    const replay = await coordinator.materializeDraft(scope, request);
    expect(replay.draft.draftId).toBe(result.draft.draftId);
  });

  it('persists a REJECTED command outcome and rolls back a stale save transactionally', async () => {
    const { coordinator } = buildCoordinator();
    const materialized = await coordinator.materializeDraft(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-1',
      idempotencyKey: 'key-request-1',
      seedId: 'seed-1',
    });
    const draft = materialized.draft;
    const operations: readonly FrontendKnowledgeOperationV1[] = [pOperation(2)];
    const savePayload = {
      schemaVersion: '1.0.0' as const,
      clientRequestId: 'request-2',
      idempotencyKey: 'key-request-2',
      expectedDraftRevision: 5,
      draftId: draft.draftId,
      expectedBaseRevision: draft.base.canonicalVersion,
      operationRevision: 2,
      operations,
      contentDigest: frontendKnowledgeDraftRevisionDigest({
        draftId: draft.draftId,
        revision: 2,
        base: draft.base,
        operations,
      }),
    };
    await expect(coordinator.saveDraft(scope, savePayload)).rejects.toMatchObject({
      apiCode: 'DRAFT_REVISION_CONFLICT',
    });

    // The failed save did not mutate the Draft (revision stays 1) and the
    // command outcome is durably recorded as REJECTED.
    const drafts = await pool!.query<{ revision: number }>(
      'SELECT revision FROM frontend_knowledge_draft.drafts WHERE draft_id = $1',
      [draft.draftId],
    );
    expect(drafts.rows[0]?.revision).toBe(1);
    const resolved = await coordinator.resolveCommandOutcome(scope, {
      schemaVersion: '1.0.0',
      clientRequestId: 'request-2',
      idempotencyKey: 'key-request-2',
      semanticDigest: digestOf(savePayload),
    });
    expect(resolved.outcome).toBe('REJECTED');
  });
});
