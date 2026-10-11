import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const VP_GLOBAL_BUDGET_TIMEZONE = 'UTC' as const;
export const VP_GLOBAL_BUDGET_WORKLOAD_CLASS = 'VP_RELATION' as const;

export type GlobalRelationBudgetIdentity = {
  readonly storeId: string;
  readonly authorityId: string;
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly dailyLimit: number;
};

export type GlobalRelationBudgetClaim = {
  readonly claimId: string;
  readonly authorityId: string;
  readonly budgetDay: string;
  readonly claimedCount: number;
};

export type GlobalRelationBudgetPort = {
  claim(workloadIdentity: string): Promise<GlobalRelationBudgetClaim>;
  reserveAttempt?(input: {
    readonly workloadIdentity: string;
    readonly projectId: string;
    readonly relationJobId: string;
    readonly semanticAttemptId: string;
    readonly executionKey: string;
    readonly providerIdentity: string;
  }): Promise<GlobalRelationBudgetClaim>;
  reservedForJob?(relationJobId: string): Promise<
    | {
        readonly claim: GlobalRelationBudgetClaim;
        readonly semanticAttemptId: string;
        readonly executionAuthorized: boolean;
      }
    | undefined
  >;
  /** A successful transition is permission for exactly one execution, never replay permission. */
  authorizeExecution?(input: {
    readonly claim: GlobalRelationBudgetClaim;
    readonly projectId: string;
    readonly relationJobId: string;
    readonly semanticAttemptId: string;
    readonly executionKey: string;
    readonly providerIdentity: string;
  }): Promise<void>;
  bindAttempt(input: {
    readonly claim: GlobalRelationBudgetClaim;
    readonly projectId: string;
    readonly relationJobId: string;
    readonly semanticAttemptId: string;
    readonly executionKey: string;
    readonly providerIdentity: string;
  }): Promise<void>;
  releaseUnused(claim: GlobalRelationBudgetClaim): Promise<void>;
  settle(input: {
    readonly claim: GlobalRelationBudgetClaim;
    readonly state: 'PROVIDER_SUCCEEDED' | 'PROVIDER_FAILED';
    readonly projectId?: string;
    readonly relationRequestId?: string;
    readonly providerRequestId?: string;
    readonly model?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly failureCode?: string;
  }): Promise<void>;
  status(): Promise<{
    readonly storeId: string;
    readonly authorityId: string;
    readonly budgetDay: string;
    readonly claimedCount: number;
    readonly dailyLimit: number;
  }>;
};

export class GlobalRelationBudgetPausedError extends Error {
  constructor(
    readonly reason:
      'EXHAUSTED' | 'AUTHORITY_UNAVAILABLE' | 'IDENTITY_UNVERIFIED' | 'RECONCILIATION_REQUIRED',
  ) {
    super(`RELATION_BUDGET_PAUSED:${reason}`);
    this.name = 'GlobalRelationBudgetPausedError';
  }
}

const assertIdentity = (identity: GlobalRelationBudgetIdentity): void => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      identity.storeId,
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      identity.authorityId,
    ) ||
    !/^[a-z0-9_-]{1,40}$/u.test(identity.provider) ||
    !/^[a-f0-9]{64}$/u.test(identity.accountFingerprint) ||
    !Number.isSafeInteger(identity.dailyLimit) ||
    identity.dailyLimit < 1 ||
    identity.dailyLimit > 100
  ) {
    throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
  }
};

/** The pool must point at the same provisioned authority DB for every workload. */
export class PostgresGlobalRelationBudget implements GlobalRelationBudgetPort {
  constructor(
    private readonly authorityPool: Pool,
    private readonly identity: GlobalRelationBudgetIdentity,
  ) {
    assertIdentity(identity);
  }

  private async checkedPolicy(client: Pick<Pool, 'query'>): Promise<void> {
    const result = await client.query<{ authority_id: string; store_id: string }>(
      `SELECT policy.authority_id::text, store.store_id::text
         FROM vp_global_budget.authority_store AS store
         JOIN vp_global_budget.policies AS policy ON true
        WHERE store.singleton = true AND store.store_id = $5
          AND policy.authority_id = $1 AND policy.provider = $2
          AND policy.account_fingerprint = $3
          AND policy.workload_class = 'VP_RELATION' AND policy.budget_timezone = 'UTC'
          AND policy.daily_limit = $4
          AND EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'vp_global_budget' AND table_name = 'claims'
              AND column_name = 'execution_authorized_at')`,
      [
        this.identity.authorityId,
        this.identity.provider,
        this.identity.accountFingerprint,
        this.identity.dailyLimit,
        this.identity.storeId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
    }
  }

  async claim(workloadIdentity: string): Promise<GlobalRelationBudgetClaim> {
    if (!workloadIdentity || workloadIdentity.length > 256) {
      throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
    }
    let client;
    try {
      client = await this.authorityPool.connect();
      await client.query('BEGIN');
      await this.checkedPolicy(client);
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `${this.identity.authorityId}:${workloadIdentity}`,
      ]);
      const outstanding = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM vp_global_budget.claims
            WHERE authority_id = $1 AND workload_identity = $2 AND state = 'RESERVED'
         ) AS exists`,
        [this.identity.authorityId, workloadIdentity],
      );
      if (outstanding.rows[0]?.exists) {
        throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
      }
      const usage = await client.query<{ budget_day: string; claimed_count: number }>(
        `INSERT INTO vp_global_budget.daily_usage (authority_id, budget_day, claimed_count)
         VALUES ($1, vp_global_budget.current_budget_day(), 1)
         ON CONFLICT (authority_id, budget_day) DO UPDATE
           SET claimed_count = vp_global_budget.daily_usage.claimed_count + 1
           WHERE vp_global_budget.daily_usage.claimed_count < $2
         RETURNING budget_day::text, claimed_count`,
        [this.identity.authorityId, this.identity.dailyLimit],
      );
      const row = usage.rows[0];
      if (!row) throw new GlobalRelationBudgetPausedError('EXHAUSTED');
      const claimId = randomUUID();
      await client.query(
        `INSERT INTO vp_global_budget.claims
           (claim_id, authority_id, budget_day, workload_identity, state)
         VALUES ($1, $2, $3::date, $4, 'RESERVED')`,
        [claimId, this.identity.authorityId, row.budget_day, workloadIdentity],
      );
      await client.query('COMMIT');
      return {
        claimId,
        authorityId: this.identity.authorityId,
        budgetDay: row.budget_day,
        claimedCount: row.claimed_count,
      };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* transaction may have disconnected */
        }
      }
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }

  /** One transaction reserves and binds the exact execution; repeating the same key returns its receipt. */
  async reserveAttempt(
    input: Parameters<NonNullable<GlobalRelationBudgetPort['reserveAttempt']>>[0],
  ): Promise<GlobalRelationBudgetClaim> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (
      !input.workloadIdentity ||
      input.workloadIdentity.length > 256 ||
      !input.projectId ||
      input.projectId.length > 256 ||
      !uuid.test(input.relationJobId) ||
      !uuid.test(input.semanticAttemptId) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.executionKey) ||
      !input.providerIdentity.startsWith(`${this.identity.provider}/`) ||
      input.providerIdentity.length > 256
    )
      throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
    let client;
    try {
      client = await this.authorityPool.connect();
      await client.query('BEGIN');
      await this.checkedPolicy(client);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${this.identity.authorityId}:${input.relationJobId}`,
      ]);
      const prior = await client.query<{
        claim_id: string;
        budget_day: string;
        claimed_count: number;
        semantic_attempt_id: string;
        workload_identity: string;
        project_id: string;
        execution_key: string;
        provider_identity: string;
      }>(
        `SELECT claim.claim_id::text, claim.budget_day::text, usage.claimed_count,
                claim.semantic_attempt_id::text, claim.workload_identity,
                claim.project_id, claim.execution_key, claim.provider_identity
           FROM vp_global_budget.claims AS claim
           JOIN vp_global_budget.daily_usage AS usage
             ON usage.authority_id = claim.authority_id AND usage.budget_day = claim.budget_day
          WHERE claim.authority_id = $1 AND claim.relation_job_id = $2
            AND claim.state = 'RESERVED' FOR UPDATE OF claim`,
        [this.identity.authorityId, input.relationJobId],
      );
      if (prior.rows.length > 1)
        throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
      const old = prior.rows[0];
      if (old) {
        if (
          old.semantic_attempt_id !== input.semanticAttemptId ||
          old.workload_identity !== input.workloadIdentity ||
          old.project_id !== input.projectId ||
          old.execution_key !== input.executionKey ||
          old.provider_identity !== input.providerIdentity
        )
          throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
        await client.query('COMMIT');
        return {
          claimId: old.claim_id,
          authorityId: this.identity.authorityId,
          budgetDay: old.budget_day,
          claimedCount: old.claimed_count,
        };
      }
      const usage = await client.query<{ budget_day: string; claimed_count: number }>(
        `INSERT INTO vp_global_budget.daily_usage (authority_id, budget_day, claimed_count)
         VALUES ($1, vp_global_budget.current_budget_day(), 1)
         ON CONFLICT (authority_id, budget_day) DO UPDATE
           SET claimed_count = vp_global_budget.daily_usage.claimed_count + 1
           WHERE vp_global_budget.daily_usage.claimed_count < $2
         RETURNING budget_day::text, claimed_count`,
        [this.identity.authorityId, this.identity.dailyLimit],
      );
      const row = usage.rows[0];
      if (!row) throw new GlobalRelationBudgetPausedError('EXHAUSTED');
      const claimId = randomUUID();
      await client.query(
        `INSERT INTO vp_global_budget.claims
           (claim_id, authority_id, budget_day, workload_identity, project_id,
            relation_job_id, semantic_attempt_id, execution_key, provider_identity, state)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, 'RESERVED')`,
        [
          claimId,
          this.identity.authorityId,
          row.budget_day,
          input.workloadIdentity,
          input.projectId,
          input.relationJobId,
          input.semanticAttemptId,
          input.executionKey,
          input.providerIdentity,
        ],
      );
      await client.query('COMMIT');
      return {
        claimId,
        authorityId: this.identity.authorityId,
        budgetDay: row.budget_day,
        claimedCount: row.claimed_count,
      };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* disconnected */
        }
      }
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }

  async reservedForJob(relationJobId: string): Promise<
    | {
        claim: GlobalRelationBudgetClaim;
        semanticAttemptId: string;
        executionAuthorized: boolean;
      }
    | undefined
  > {
    try {
      await this.checkedPolicy(this.authorityPool);
      const result = await this.authorityPool.query<{
        claim_id: string;
        budget_day: string;
        claimed_count: number;
        semantic_attempt_id: string;
        execution_authorized: boolean;
      }>(
        `SELECT claim.claim_id::text, claim.budget_day::text, usage.claimed_count,
                claim.semantic_attempt_id::text,
                claim.execution_authorized_at IS NOT NULL AS execution_authorized
           FROM vp_global_budget.claims AS claim
           JOIN vp_global_budget.daily_usage AS usage
             ON usage.authority_id = claim.authority_id AND usage.budget_day = claim.budget_day
          WHERE claim.authority_id = $1 AND claim.relation_job_id = $2
            AND claim.state = 'RESERVED'`,
        [this.identity.authorityId, relationJobId],
      );
      if (result.rows.length > 1)
        throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
      const row = result.rows[0];
      return row
        ? {
            claim: {
              claimId: row.claim_id,
              authorityId: this.identity.authorityId,
              budgetDay: row.budget_day,
              claimedCount: row.claimed_count,
            },
            semanticAttemptId: row.semantic_attempt_id,
            executionAuthorized: row.execution_authorized,
          }
        : undefined;
    } catch (error) {
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    }
  }

  async authorizeExecution(
    input: Parameters<NonNullable<GlobalRelationBudgetPort['authorizeExecution']>>[0],
  ): Promise<void> {
    try {
      await this.checkedPolicy(this.authorityPool);
      if (input.claim.authorityId !== this.identity.authorityId) {
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      }
      const result = await this.authorityPool.query(
        `UPDATE vp_global_budget.claims
            SET execution_authorized_at = clock_timestamp()
          WHERE claim_id = $1 AND authority_id = $2 AND budget_day = $3::date
            AND project_id = $4 AND relation_job_id = $5 AND semantic_attempt_id = $6
            AND execution_key = $7 AND provider_identity = $8
            AND state = 'RESERVED' AND execution_authorized_at IS NULL`,
        [
          input.claim.claimId,
          this.identity.authorityId,
          input.claim.budgetDay,
          input.projectId,
          input.relationJobId,
          input.semanticAttemptId,
          input.executionKey,
          input.providerIdentity,
        ],
      );
      if (result.rowCount !== 1)
        throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
    } catch (error) {
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      // An unknown acknowledgement never authorizes a provider retry.
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    }
  }

  async bindAttempt(input: Parameters<GlobalRelationBudgetPort['bindAttempt']>[0]): Promise<void> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (
      input.claim.authorityId !== this.identity.authorityId ||
      !uuid.test(input.claim.claimId) ||
      !uuid.test(input.relationJobId) ||
      !uuid.test(input.semanticAttemptId) ||
      !input.projectId ||
      input.projectId.length > 256 ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.executionKey) ||
      !input.providerIdentity.startsWith(`${this.identity.provider}/`) ||
      input.providerIdentity.length > 256
    ) {
      throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
    }
    try {
      await this.checkedPolicy(this.authorityPool);
      const result = await this.authorityPool.query(
        `UPDATE vp_global_budget.claims
            SET project_id = $3, relation_job_id = $4, semantic_attempt_id = $5,
                execution_key = $6, provider_identity = $7
          WHERE claim_id = $1 AND authority_id = $2 AND budget_day = $8::date
            AND state = 'RESERVED' AND relation_job_id IS NULL`,
        [
          input.claim.claimId,
          this.identity.authorityId,
          input.projectId,
          input.relationJobId,
          input.semanticAttemptId,
          input.executionKey,
          input.providerIdentity,
          input.claim.budgetDay,
        ],
      );
      if (result.rowCount !== 1) {
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      }
    } catch (error) {
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      if ((error as { code?: string }).code === '23505') {
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      }
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    }
  }

  async releaseUnused(claim: GlobalRelationBudgetClaim): Promise<void> {
    let client;
    try {
      client = await this.authorityPool.connect();
      await client.query('BEGIN');
      await this.checkedPolicy(client);
      const row = await client.query<{
        state: string;
        budget_day: string;
        execution_authorized_at: Date | null;
      }>(
        `SELECT state, budget_day::text, execution_authorized_at FROM vp_global_budget.claims
         WHERE claim_id = $1 AND authority_id = $2 FOR UPDATE`,
        [claim.claimId, this.identity.authorityId],
      );
      if (
        claim.authorityId !== this.identity.authorityId ||
        row.rows[0]?.budget_day !== claim.budgetDay
      ) {
        throw new GlobalRelationBudgetPausedError('IDENTITY_UNVERIFIED');
      }
      if (row.rows[0]?.state === 'RESERVED') {
        if (row.rows[0].execution_authorized_at !== null) {
          throw new GlobalRelationBudgetPausedError('RECONCILIATION_REQUIRED');
        }
        await client.query(
          `UPDATE vp_global_budget.claims SET state = 'RELEASED', settled_at = clock_timestamp()
           WHERE claim_id = $1`,
          [claim.claimId],
        );
        await client.query(
          `UPDATE vp_global_budget.daily_usage SET claimed_count = claimed_count - 1
           WHERE authority_id = $1 AND budget_day = $2::date AND claimed_count > 0`,
          [this.identity.authorityId, claim.budgetDay],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* transaction may have disconnected */
        }
      }
      // Conservative reservation remains counted after an ambiguous release.
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    } finally {
      client?.release();
    }
  }

  async settle(input: Parameters<GlobalRelationBudgetPort['settle']>[0]): Promise<void> {
    try {
      const result = await this.authorityPool.query(
        `UPDATE vp_global_budget.claims
            SET state = $3, provider_request_id = $4, model = $5,
                input_tokens = $6, output_tokens = $7, failure_code = $8,
                project_id = COALESCE($9, project_id), relation_request_id = $10,
                settled_at = COALESCE(settled_at, clock_timestamp())
          WHERE claim_id = $1 AND authority_id = $2
            AND (relation_job_id IS NULL OR (project_id = $9 AND execution_authorized_at IS NOT NULL))
            AND (state = 'RESERVED' OR (state = $3
              AND provider_request_id IS NOT DISTINCT FROM $4
              AND model IS NOT DISTINCT FROM $5
              AND input_tokens IS NOT DISTINCT FROM $6
              AND output_tokens IS NOT DISTINCT FROM $7
              AND failure_code IS NOT DISTINCT FROM $8
              AND project_id IS NOT DISTINCT FROM $9
              AND relation_request_id IS NOT DISTINCT FROM $10))`,
        [
          input.claim.claimId,
          this.identity.authorityId,
          input.state,
          input.providerRequestId ?? null,
          input.model ?? null,
          input.inputTokens ?? null,
          input.outputTokens ?? null,
          input.failureCode ?? null,
          input.projectId ?? null,
          input.relationRequestId ?? null,
        ],
      );
      if (result.rowCount !== 1) throw new Error('Global budget claim could not be settled.');
    } catch {
      // The claim stays counted even if usage details cannot be acknowledged.
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    }
  }

  async status(): Promise<{
    storeId: string;
    authorityId: string;
    budgetDay: string;
    claimedCount: number;
    dailyLimit: number;
  }> {
    try {
      await this.checkedPolicy(this.authorityPool);
      const result = await this.authorityPool.query<{ budget_day: string; claimed_count: number }>(
        `WITH active_day AS (
           SELECT vp_global_budget.current_budget_day() AS day
         )
         SELECT active_day.day::text AS budget_day,
                coalesce(usage.claimed_count, 0) AS claimed_count
           FROM active_day
           LEFT JOIN vp_global_budget.daily_usage AS usage
             ON usage.authority_id = $1 AND usage.budget_day = active_day.day`,
        [this.identity.authorityId],
      );
      return {
        storeId: this.identity.storeId,
        authorityId: this.identity.authorityId,
        budgetDay: result.rows[0]!.budget_day,
        claimedCount: result.rows[0]!.claimed_count,
        dailyLimit: this.identity.dailyLimit,
      };
    } catch (error) {
      if (error instanceof GlobalRelationBudgetPausedError) throw error;
      throw new GlobalRelationBudgetPausedError('AUTHORITY_UNAVAILABLE');
    }
  }
}
