import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  assertDiscoveryFeedbackEventV1,
  assertDiscoveryRankingPolicyRevisionV1,
  assertDiscoverySuppressionDirectiveV1,
  assertPolicyId,
  assertPrincipalId,
  assertProjectId,
} from '../../../modules/discovery-feedback/src/index.js';
import type {
  DiscoveryFeedbackFindingLookupV1,
  DiscoveryFeedbackRepositoryPort,
  DiscoveryRankingPolicyLookupV1,
  DiscoverySuppressionLookupV1,
  DiscoverySuppressionHistoryLookupV1,
  DiscoveryPresentationFeedbackLookupV1,
  DiscoveryPresentationSuppressionLookupV1,
  DiscoveryFeedbackTransactionHandleV1,
} from '../../../modules/discovery-feedback/src/index.js';
import {
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoveryRankingPolicyRevisionV1,
  decodeDiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type FeedbackQueryExecutor = Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>;

type FeedbackRow = QueryResultRow & {
  readonly schema_version: string;
  readonly feedback_id: string;
  readonly project_id: string;
  readonly finding_id: string;
  readonly finding_revision: number;
  readonly actor_type: 'user' | 'service' | 'system';
  readonly actor_id: string;
  readonly principal_id: string | null;
  readonly feedback_class: 'EPISTEMIC' | 'UTILITY';
  readonly feedback_kind: string;
  readonly reason: string | null;
  readonly scope_kind: 'FINDING' | 'PROJECT' | null;
  readonly created_at: Date | string;
};

type SuppressionRow = QueryResultRow & {
  readonly schema_version: string;
  readonly suppression_id: string;
  readonly project_id: string;
  readonly actor_type: 'user' | 'service' | 'system';
  readonly actor_id: string;
  readonly principal_id: string | null;
  readonly source_finding_id: string;
  readonly source_finding_revision: number;
  readonly suppression_kind: 'SUPPRESS_EXACT' | 'SUPPRESS_SIMILAR' | 'SNOOZE';
  readonly scope_kind: 'FINDING' | 'PROJECT';
  readonly matcher_kind: 'NONE' | 'EXACT_FINGERPRINT' | 'SEMANTIC_FAMILY';
  readonly matcher_version: string | null;
  readonly fingerprint: string | null;
  readonly fingerprint_version: string | null;
  readonly expires_at: Date | string | null;
  readonly review_at: Date | string | null;
  readonly created_at: Date | string;
};

type RankingPolicyRow = QueryResultRow & {
  readonly schema_version: string;
  readonly policy_id: string;
  readonly policy_revision: number;
  readonly policy_scope: 'GLOBAL';
  readonly algorithm_version: string;
  readonly rules: unknown;
  readonly weights: unknown;
  readonly created_by_type: 'user' | 'service' | 'system';
  readonly created_by_id: string;
  readonly created_at: Date | string;
  readonly effective_from: Date | string;
};

const iso = (value: Date | string | null): string | undefined => {
  if (value === null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapFeedback = (row: FeedbackRow): DiscoveryFeedbackEventV1 =>
  decodeDiscoveryFeedbackEventV1({
    schemaVersion: row.schema_version,
    feedbackId: row.feedback_id,
    projectId: row.project_id,
    findingId: row.finding_id,
    findingRevision: Number(row.finding_revision),
    actor: { type: row.actor_type, id: row.actor_id },
    ...(row.principal_id === null ? {} : { principalId: row.principal_id }),
    feedbackClass: row.feedback_class,
    feedbackKind: row.feedback_kind,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.scope_kind === null ? {} : { scope: row.scope_kind }),
    createdAt: iso(row.created_at)!,
  });

const mapSuppression = (row: SuppressionRow): DiscoverySuppressionDirectiveV1 =>
  decodeDiscoverySuppressionDirectiveV1({
    schemaVersion: row.schema_version,
    suppressionId: row.suppression_id,
    projectId: row.project_id,
    actor: { type: row.actor_type, id: row.actor_id },
    ...(row.principal_id === null ? {} : { principalId: row.principal_id }),
    sourceFindingId: row.source_finding_id,
    sourceFindingRevision: Number(row.source_finding_revision),
    suppressionKind: row.suppression_kind,
    scope: row.scope_kind,
    matcherKind: row.matcher_kind,
    ...(row.matcher_version === null ? {} : { matcherVersion: row.matcher_version }),
    ...(row.fingerprint === null ? {} : { fingerprint: row.fingerprint }),
    ...(row.fingerprint_version === null ? {} : { fingerprintVersion: row.fingerprint_version }),
    ...(iso(row.expires_at) === undefined ? {} : { expiresAt: iso(row.expires_at) }),
    ...(iso(row.review_at) === undefined ? {} : { reviewAt: iso(row.review_at) }),
    createdAt: iso(row.created_at)!,
  });

const mapRankingPolicy = (row: RankingPolicyRow): DiscoveryRankingPolicyRevisionV1 =>
  decodeDiscoveryRankingPolicyRevisionV1({
    schemaVersion: row.schema_version,
    policyId: row.policy_id,
    policyRevision: Number(row.policy_revision),
    scope: row.policy_scope,
    algorithmVersion: row.algorithm_version,
    rules: row.rules,
    weights: row.weights,
    createdBy: { type: row.created_by_type, id: row.created_by_id },
    createdAt: iso(row.created_at)!,
    effectiveFrom: iso(row.effective_from)!,
  });

const feedbackColumns = `
  schema_version, feedback_id, project_id, finding_id, finding_revision,
  actor_type, actor_id, principal_id, feedback_class, feedback_kind,
  reason, scope_kind, created_at`;

const suppressionColumns = `
  schema_version, suppression_id, project_id, actor_type, actor_id,
  principal_id, source_finding_id, source_finding_revision, suppression_kind,
  scope_kind, matcher_kind, matcher_version, fingerprint, fingerprint_version,
  expires_at, review_at, created_at`;

const rankingPolicyColumns = `
  schema_version, policy_id, policy_revision, policy_scope, algorithm_version,
  rules, weights, created_by_type, created_by_id, created_at, effective_from`;

const dateForQuery = (value: string | undefined): string => {
  if (value === undefined) return new Date().toISOString();
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError('at must be a valid date-time');
  return value;
};

export class PostgresDiscoveryFeedbackRepository implements DiscoveryFeedbackRepositoryPort {
  constructor(private readonly pool: FeedbackQueryExecutor) {}

  async appendFeedback(event: DiscoveryFeedbackEventV1): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = assertDiscoveryFeedbackEventV1(event);
    const result = await this.pool.query(
      `INSERT INTO discovery.feedback_events (
         schema_version, feedback_id, project_id, finding_id, finding_revision,
         actor_type, actor_id, principal_id, feedback_class, feedback_kind,
         reason, scope_kind, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (project_id, feedback_id) DO NOTHING`,
      [
        normalized.schemaVersion,
        normalized.feedbackId,
        normalized.projectId,
        normalized.findingId,
        normalized.findingRevision,
        normalized.actor.type,
        normalized.actor.id,
        normalized.principalId ?? null,
        normalized.feedbackClass,
        normalized.feedbackKind,
        normalized.reason ?? null,
        normalized.scope ?? null,
        normalized.createdAt,
      ],
    );
    return result.rowCount === 1 ? 'CREATED' : 'CONFLICT';
  }

  async listFeedbackForFinding(
    lookup: DiscoveryFeedbackFindingLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const result = await this.pool.query<FeedbackRow>(
      `SELECT ${feedbackColumns}
       FROM discovery.feedback_events
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
         AND ($4::text IS NULL OR COALESCE(principal_id, actor_id) = $4)
       ORDER BY created_at ASC, feedback_id ASC`,
      [projectId, lookup.findingId, lookup.findingRevision, lookup.principalId ?? null],
    );
    return result.rows.map(mapFeedback);
  }

  async listLatestUtilityFeedbackForPresentation(
    lookup: DiscoveryPresentationFeedbackLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const at = dateForQuery(lookup.at);
    const result = await this.pool.query<FeedbackRow>(
      `SELECT ${feedbackColumns}
       FROM (
         SELECT DISTINCT ON (finding_id, finding_revision) ${feedbackColumns}
         FROM discovery.feedback_events
         WHERE project_id = $1
           AND COALESCE(principal_id, actor_id) = $2
           AND feedback_class = 'UTILITY'
           AND feedback_kind = ANY($3::text[])
           AND created_at <= $4::timestamptz
         ORDER BY finding_id, finding_revision, created_at DESC, feedback_id DESC
       ) latest
       ORDER BY finding_id ASC, finding_revision ASC`,
      [projectId, principalId, ['USEFUL', 'NOT_RELEVANT', 'ALREADY_KNOWN', 'TOO_FREQUENT'], at],
    );
    return result.rows.map(mapFeedback);
  }

  async listSuppressionHistoryForFinding(
    lookup: DiscoverySuppressionHistoryLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const result = await this.pool.query<SuppressionRow>(
      `SELECT ${suppressionColumns}
       FROM discovery.suppression_directives
       WHERE project_id = $1
         AND source_finding_id = $2
         AND source_finding_revision = $3
         AND COALESCE(principal_id, actor_id) = $4
       ORDER BY created_at ASC, suppression_id ASC`,
      [projectId, lookup.findingId, lookup.findingRevision, principalId],
    );
    return result.rows.map(mapSuppression);
  }

  async appendSuppression(
    directive: DiscoverySuppressionDirectiveV1,
  ): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = assertDiscoverySuppressionDirectiveV1(directive);
    const result = await this.pool.query(
      `INSERT INTO discovery.suppression_directives (
         schema_version, suppression_id, project_id, actor_type, actor_id,
         principal_id, source_finding_id, source_finding_revision,
         suppression_kind, scope_kind, matcher_kind, matcher_version,
         fingerprint, fingerprint_version, expires_at, review_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (project_id, suppression_id) DO NOTHING`,
      [
        normalized.schemaVersion,
        normalized.suppressionId,
        normalized.projectId,
        normalized.actor.type,
        normalized.actor.id,
        normalized.principalId ?? null,
        normalized.sourceFindingId,
        normalized.sourceFindingRevision,
        normalized.suppressionKind,
        normalized.scope,
        normalized.matcherKind,
        normalized.matcherVersion ?? null,
        normalized.fingerprint ?? null,
        normalized.fingerprintVersion ?? null,
        normalized.expiresAt ?? null,
        normalized.reviewAt ?? null,
        normalized.createdAt,
      ],
    );
    return result.rowCount === 1 ? 'CREATED' : 'CONFLICT';
  }

  async listRelevantSuppression(
    lookup: DiscoverySuppressionLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const at = dateForQuery(lookup.at);
    const result = await this.pool.query<SuppressionRow>(
      `SELECT ${suppressionColumns}
       FROM discovery.suppression_directives
       WHERE project_id = $1
         AND COALESCE(principal_id, actor_id) = $2
         AND (
           (
             suppression_kind = 'SNOOZE'
             AND source_finding_id = $3 AND source_finding_revision = $4
           )
           OR (
             suppression_kind <> 'SNOOZE'
             AND (
               scope_kind = 'PROJECT'
               OR (source_finding_id = $3 AND source_finding_revision = $4)
             )
           )
         )
         AND (expires_at IS NULL OR expires_at > $5::timestamptz)
         AND (
           suppression_kind = 'SNOOZE'
           OR (
             suppression_kind = 'SUPPRESS_EXACT'
             AND fingerprint = $6 AND fingerprint_version = $7
           )
           OR (
             suppression_kind = 'SUPPRESS_SIMILAR'
             AND matcher_version = $8
           )
         )
       ORDER BY created_at ASC, suppression_id ASC`,
      [
        projectId,
        principalId,
        lookup.findingId,
        lookup.findingRevision,
        at,
        lookup.fingerprint ?? null,
        lookup.fingerprintVersion ?? null,
        lookup.semanticMatcherVersion ?? null,
      ],
    );
    return result.rows.map(mapSuppression);
  }

  async listSuppressionForPresentation(
    lookup: DiscoveryPresentationSuppressionLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const at = dateForQuery(lookup.at);
    const result = await this.pool.query<SuppressionRow>(
      `SELECT ${suppressionColumns}
       FROM discovery.suppression_directives
       WHERE project_id = $1
         AND COALESCE(principal_id, actor_id) = $2
         AND created_at <= $3::timestamptz
         AND (expires_at IS NULL OR expires_at > $3::timestamptz)
       ORDER BY created_at ASC, suppression_id ASC`,
      [projectId, principalId, at],
    );
    return result.rows.map(mapSuppression);
  }

  async insertRankingPolicyRevision(
    policy: DiscoveryRankingPolicyRevisionV1,
  ): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = assertDiscoveryRankingPolicyRevisionV1(policy);
    const result = await this.pool.query(
      `INSERT INTO discovery.ranking_policy_revisions (
         schema_version, policy_id, policy_revision, policy_scope,
         algorithm_version, rules, weights, created_by_type, created_by_id,
         created_at, effective_from
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
       ON CONFLICT (policy_id, policy_revision) DO NOTHING`,
      [
        normalized.schemaVersion,
        normalized.policyId,
        normalized.policyRevision,
        normalized.scope,
        normalized.algorithmVersion,
        JSON.stringify(normalized.rules),
        JSON.stringify(normalized.weights),
        normalized.createdBy.type,
        normalized.createdBy.id,
        normalized.createdAt,
        normalized.effectiveFrom,
      ],
    );
    return result.rowCount === 1 ? 'CREATED' : 'CONFLICT';
  }

  async listRankingPolicyRevisions(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<readonly DiscoveryRankingPolicyRevisionV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const policyId = assertPolicyId(lookup.policyId);
    const at = dateForQuery(lookup.at);
    const result = await this.pool.query<RankingPolicyRow>(
      `SELECT ${rankingPolicyColumns}
       FROM discovery.ranking_policy_revisions r
       WHERE r.policy_id = $2
         AND EXISTS (
         SELECT 1 FROM project_admin.projects p WHERE p.id = $1
       )
         AND r.effective_from <= $3::timestamptz
       ORDER BY r.effective_from DESC, r.policy_revision DESC`,
      [projectId, policyId, at],
    );
    return result.rows.map(mapRankingPolicy);
  }

  async resolveEffectiveRankingPolicy(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<DiscoveryRankingPolicyRevisionV1 | undefined> {
    return (await this.listRankingPolicyRevisions(lookup))[0];
  }

  async transaction<T>(
    action: (handle: DiscoveryFeedbackTransactionHandleV1) => Promise<T>,
  ): Promise<T> {
    const connect = this.pool.connect;
    if (typeof connect !== 'function') {
      throw new TypeError('PostgreSQL feedback transactions require a Pool.');
    }
    return withSafePostgresTransaction(
      this.pool as unknown as Pick<Pool, 'connect'>,
      async (client: PoolClient) =>
        action({
          repository: new PostgresDiscoveryFeedbackRepository(
            client as unknown as Pick<Pool, 'query'>,
          ),
          raw: client,
        }),
      {
        module: 'discovery-feedback-postgres',
        operation: 'feedback-product-transaction',
      },
    );
  }
}
