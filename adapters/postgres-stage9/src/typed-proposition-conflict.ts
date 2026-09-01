import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  TypedPropositionConflictAssertionRepositoryPort,
  TypedPropositionConflictRuleRepositoryPort,
  TypedPropositionConflictRuleTransactionHandleV1,
} from '../../../modules/knowledge-model/src/typed-proposition-conflict.js';
import type {
  TypedPropositionConflictAssertionV1,
  TypedPropositionConflictRuleV1,
} from '../../../packages/contracts/src/index.js';
import { semanticStableJson } from '../../../packages/contracts/src/semantic-representation.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type QueryExecutor = Pick<Pool, 'query'>;
type RuleRow = QueryResultRow & {
  readonly rule: TypedPropositionConflictRuleV1;
};
type AssertionRow = QueryResultRow & {
  readonly assertion: TypedPropositionConflictAssertionV1;
};

const assertionContentKey = (assertion: TypedPropositionConflictAssertionV1): string => {
  return semanticStableJson({
    ...assertion,
    assertionRevision: undefined,
    status: undefined,
    createdAt: undefined,
    supersededAt: undefined,
    retiredAt: undefined,
    provenance: { ...assertion.provenance, createdAt: undefined },
  });
};

export class PostgresTypedPropositionConflictRuleRepository implements TypedPropositionConflictRuleRepositoryPort {
  public constructor(
    private readonly pool: Pool,
    private readonly executor: QueryExecutor = pool,
  ) {}

  async listRuleRevisions(projectId: string) {
    const result = await this.executor.query<RuleRow>(
      `SELECT rule FROM knowledge.typed_proposition_conflict_rules
       WHERE project_id = $1 ORDER BY rule_id, rule_revision`,
      [projectId],
    );
    return result.rows.map((row) => row.rule);
  }

  async findRule(projectId: string, ruleId: string, revision?: number) {
    const result = await this.executor.query<RuleRow>(
      `SELECT rule FROM knowledge.typed_proposition_conflict_rules
       WHERE project_id = $1 AND rule_id = $2
       ${revision === undefined ? 'ORDER BY rule_revision DESC LIMIT 1' : 'AND rule_revision = $3'}
       FOR UPDATE`,
      revision === undefined ? [projectId, ruleId] : [projectId, ruleId, revision],
    );
    return result.rows[0]?.rule;
  }

  async saveRule(rule: TypedPropositionConflictRuleV1) {
    const result = await this.executor.query<RuleRow>(
      `INSERT INTO knowledge.typed_proposition_conflict_rules
       (project_id, rule_id, rule_revision, semantic_key, status, rule)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING rule`,
      [
        rule.projectId,
        rule.ruleId,
        rule.ruleRevision,
        rule.semanticKey,
        rule.status,
        JSON.stringify(rule),
      ],
    );
    return result.rows[0]!.rule;
  }

  async supersedeRule(
    projectId: string,
    ruleId: string,
    expectedRevision: number,
    supersededBy: { readonly ruleId: string; readonly ruleRevision: number },
  ) {
    const result = await this.executor.query(
      `UPDATE knowledge.typed_proposition_conflict_rules
       SET status = 'SUPERSEDED', rule = jsonb_set(
         jsonb_set(rule, '{status}', '"SUPERSEDED"'::jsonb),
         '{supersededBy}', $4::jsonb
       )
       WHERE project_id = $1 AND rule_id = $2 AND rule_revision = $3 AND status = 'ACTIVE'`,
      [projectId, ruleId, expectedRevision, JSON.stringify(supersededBy)],
    );
    if (result.rowCount !== 1)
      throw new Error('Conflict rule supersede raced with another writer.');
  }

  async retireRule(projectId: string, ruleId: string, expectedRevision: number, retiredAt: string) {
    const result = await this.executor.query(
      `UPDATE knowledge.typed_proposition_conflict_rules
       SET status = 'RETIRED', rule = jsonb_set(
         jsonb_set(rule, '{status}', '"RETIRED"'::jsonb),
         '{retiredAt}', to_jsonb($4::text)
       )
       WHERE project_id = $1 AND rule_id = $2 AND rule_revision = $3 AND status = 'ACTIVE'`,
      [projectId, ruleId, expectedRevision, retiredAt],
    );
    if (result.rowCount !== 1) throw new Error('Conflict rule retire raced with another writer.');
  }

  async transaction<T>(
    action: (handle: TypedPropositionConflictRuleTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    return withSafePostgresTransaction(
      this.pool,
      async (client: PoolClient, afterCommit) =>
        action({
          repository: new PostgresTypedPropositionConflictRuleRepository(this.pool, client),
          rawTransaction: client,
          afterCommit,
        }),
      {
        module: 'postgres-stage9',
        operation: 'typed-proposition-conflict-rule-transaction',
      },
    );
  }
}

export class PostgresTypedPropositionConflictAssertionRepository implements TypedPropositionConflictAssertionRepositoryPort {
  public constructor(
    private readonly pool: Pool,
    private readonly executor: QueryExecutor = pool,
  ) {}

  private async findLatestByIdentity(
    projectId: string,
    identityKey: string,
    executor: QueryExecutor = this.executor,
  ) {
    const result = await executor.query<AssertionRow>(
      `SELECT assertion FROM knowledge.typed_incompatibility_assertions
       WHERE project_id = $1 AND identity_key = $2
       ORDER BY assertion_revision DESC LIMIT 1 FOR UPDATE`,
      [projectId, identityKey],
    );
    return result.rows[0]?.assertion;
  }

  async findByIdentity(projectId: string, identityKey: string) {
    const result = await this.executor.query<AssertionRow>(
      `SELECT assertion FROM knowledge.typed_incompatibility_assertions
       WHERE project_id = $1 AND identity_key = $2 AND status = 'ACTIVE'
       ORDER BY assertion_revision DESC LIMIT 1`,
      [projectId, identityKey],
    );
    return result.rows[0]?.assertion;
  }

  async listActiveAssertions(projectId: string) {
    const result = await this.executor.query<AssertionRow>(
      `SELECT assertion FROM knowledge.typed_incompatibility_assertions
       WHERE project_id = $1 AND status = 'ACTIVE'
       ORDER BY assertion_id, assertion_revision`,
      [projectId],
    );
    return result.rows.map((row) => row.assertion);
  }

  private async saveAssertionWithExecutor(
    executor: QueryExecutor,
    assertion: TypedPropositionConflictAssertionV1,
  ) {
    const latest = await this.findLatestByIdentity(
      assertion.projectId,
      assertion.identityKey,
      executor,
    );
    if (latest?.status === 'ACTIVE') {
      if (assertionContentKey(latest) === assertionContentKey(assertion)) return latest;
      const supersedeResult = await executor.query(
        `UPDATE knowledge.typed_incompatibility_assertions
         SET status = 'SUPERSEDED', assertion = jsonb_set(
           jsonb_set(assertion, '{status}', '"SUPERSEDED"'::jsonb),
           '{supersededAt}', to_jsonb($4::text)
         )
         WHERE project_id = $1 AND identity_key = $2 AND assertion_revision = $3 AND status = 'ACTIVE'`,
        [assertion.projectId, assertion.identityKey, latest.assertionRevision, assertion.createdAt],
      );
      if (supersedeResult.rowCount !== 1) {
        throw new Error('Conflict assertion supersede raced with another writer.');
      }
    }
    const stored = {
      ...assertion,
      assertionId: latest?.assertionId ?? assertion.assertionId,
      assertionRevision: Math.max(
        assertion.assertionRevision,
        (latest?.assertionRevision ?? 0) + 1,
      ),
      status: 'ACTIVE' as const,
    };
    const result = await executor.query<AssertionRow>(
      `INSERT INTO knowledge.typed_incompatibility_assertions
       (project_id, identity_key, assertion_id, assertion_revision, status, assertion)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING assertion`,
      [
        stored.projectId,
        stored.identityKey,
        stored.assertionId,
        stored.assertionRevision,
        stored.status,
        JSON.stringify(stored),
      ],
    );
    return result.rows[0]!.assertion;
  }

  async saveAssertion(assertion: TypedPropositionConflictAssertionV1) {
    return withSafePostgresTransaction(
      this.pool,
      (client) => this.saveAssertionWithExecutor(client, assertion),
      {
        module: 'postgres-stage9',
        operation: 'typed-proposition-conflict-assertion-save',
      },
    );
  }

  async supersedeAssertion(projectId: string, assertionId: string, expectedRevision: number) {
    await this.executor.query(
      `UPDATE knowledge.typed_incompatibility_assertions
       SET status = 'SUPERSEDED', assertion = jsonb_set(
         jsonb_set(assertion, '{status}', '"SUPERSEDED"'::jsonb),
         '{supersededAt}', to_jsonb(now()::text)
       )
       WHERE project_id = $1 AND assertion_id = $2 AND assertion_revision = $3 AND status = 'ACTIVE'`,
      [projectId, assertionId, expectedRevision],
    );
  }
}
