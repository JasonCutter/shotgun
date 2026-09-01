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
  DiscoveryPresentationBatchLookupV1,
  DiscoveryFeedbackTransactionHandleV1,
} from '../../../modules/discovery-feedback/src/index.js';
import {
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoveryEpistemicReentryTriggerV1,
  computeDiscoveryEpistemicReentryIdentityV1,
  decodeDiscoveryRankingPolicyRevisionV1,
  decodeDiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryEpistemicReentryTriggerV1,
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type FeedbackQueryExecutor = Pick<Pool, 'query'> &
  Partial<Pick<Pool, 'connect'>> &
  Partial<Pick<PoolClient, 'release'>>;

type SemanticFamilyKeyResolver = (input: {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
}) => Promise<string | undefined>;

type SemanticFamilyProjectionRebuildRow = QueryResultRow & {
  readonly project_id: string;
  readonly suppression_id: string;
  readonly source_finding_id: string;
  readonly source_finding_revision: number;
  readonly created_at: Date | string;
};

const MAX_PRESENTATION_SUPPRESSION_CANDIDATES = 256;
const PRESENTATION_BATCH_SIZE = 250;

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

const qualifiedFeedbackColumns = feedbackColumns
  .split(',')
  .map((column) => `f.${column.trim()}`)
  .join(', ');
const latestFeedbackColumns = feedbackColumns
  .split(',')
  .map((column) => `latest.${column.trim()}`)
  .join(', ');

const suppressionColumns = `
  schema_version, suppression_id, project_id, actor_type, actor_id,
  principal_id, source_finding_id, source_finding_revision, suppression_kind,
  scope_kind, matcher_kind, matcher_version, fingerprint, fingerprint_version,
  expires_at, review_at, created_at`;

const qualifiedSuppressionColumns = suppressionColumns
  .split(',')
  .map((column) => `d.${column.trim()}`)
  .join(', ');

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
  constructor(
    private readonly pool: FeedbackQueryExecutor,
    private readonly options: {
      readonly semanticFamilyKeyResolver?: SemanticFamilyKeyResolver;
    } = {},
  ) {}

  private async populateSemanticFamilyProjection(
    executor: Pick<Pool, 'query'>,
    directive: DiscoverySuppressionDirectiveV1,
  ): Promise<void> {
    if (
      directive.suppressionKind !== 'SUPPRESS_SIMILAR' ||
      directive.matcherKind !== 'SEMANTIC_FAMILY' ||
      directive.matcherVersion !== 'semantic-family:v1' ||
      this.options.semanticFamilyKeyResolver === undefined
    ) {
      return;
    }
    const semanticFamilyKey = await this.options.semanticFamilyKeyResolver({
      projectId: directive.projectId,
      findingId: directive.sourceFindingId,
      findingRevision: directive.sourceFindingRevision,
    });
    if (semanticFamilyKey === undefined) return;
    await executor.query(
      `INSERT INTO discovery.suppression_semantic_family_projection (
         project_id, suppression_id, source_finding_id, source_finding_revision,
         semantic_family_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id, suppression_id) DO UPDATE SET
         source_finding_id = EXCLUDED.source_finding_id,
         source_finding_revision = EXCLUDED.source_finding_revision,
         semantic_family_key = EXCLUDED.semantic_family_key,
         created_at = EXCLUDED.created_at`,
      [
        directive.projectId,
        directive.suppressionId,
        directive.sourceFindingId,
        directive.sourceFindingRevision,
        semanticFamilyKey,
        directive.createdAt,
      ],
    );
  }

  private async appendSuppressionWithExecutor(
    executor: Pick<Pool, 'query'>,
    normalized: DiscoverySuppressionDirectiveV1,
  ): Promise<'CREATED' | 'CONFLICT'> {
    const result = await executor.query(
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
    if (result.rowCount !== 1) return 'CONFLICT';
    await this.populateSemanticFamilyProjection(executor, normalized);
    return 'CREATED';
  }

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

  async appendEpistemicReentryTrigger(
    trigger: DiscoveryEpistemicReentryTriggerV1,
  ): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = decodeDiscoveryEpistemicReentryTriggerV1(trigger);
    const identity = computeDiscoveryEpistemicReentryIdentityV1(normalized);
    const result = await this.pool.query(
      `INSERT INTO discovery.epistemic_reentry_triggers (
         schema_version, identity_version, logical_identity_key,
         feedback_id, project_id, finding_id, finding_revision,
         feedback_class, feedback_kind, occurred_at,
         status, attempts, next_eligible_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 'PENDING', 0, NULL, $10, $10)
       ON CONFLICT (project_id, feedback_id) DO NOTHING`,
      [
        normalized.schemaVersion,
        identity.identityVersion,
        identity.logicalIdentityKey,
        normalized.feedbackId,
        normalized.projectId,
        normalized.findingId,
        normalized.findingRevision,
        normalized.feedbackClass,
        normalized.feedbackKind,
        normalized.occurredAt,
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

  async listLatestUtilityFeedbackForPresentationBatch(
    lookup: DiscoveryPresentationBatchLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const at = dateForQuery(lookup.at);
    if (lookup.findings.length === 0) return [];
    if (lookup.findings.length > PRESENTATION_BATCH_SIZE) {
      throw new TypeError('presentation Finding batch exceeds the bounded read size');
    }
    const result = await this.pool.query<FeedbackRow>(
      `SELECT ${latestFeedbackColumns}
       FROM (
         SELECT DISTINCT ON (f.finding_id, f.finding_revision)
                ${qualifiedFeedbackColumns}
         FROM discovery.feedback_events f
         JOIN unnest($4::text[], $5::integer[]) AS requested(finding_id, finding_revision)
           ON requested.finding_id = f.finding_id
          AND requested.finding_revision = f.finding_revision
         WHERE f.project_id = $1
           AND COALESCE(f.principal_id, f.actor_id) = $2
           AND f.feedback_class = 'UTILITY'
           AND f.feedback_kind = ANY($3::text[])
           AND f.created_at <= $6::timestamptz
         ORDER BY f.finding_id, f.finding_revision, f.created_at DESC, f.feedback_id DESC
       ) latest
       ORDER BY finding_id ASC, finding_revision ASC`,
      [
        projectId,
        principalId,
        ['USEFUL', 'NOT_RELEVANT', 'ALREADY_KNOWN', 'TOO_FREQUENT'],
        lookup.findings.map((finding) => finding.findingId),
        lookup.findings.map((finding) => finding.findingRevision),
        at,
      ],
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
    // A PoolClient also exposes connect(), but it is already inside the
    // coordinator-owned transaction and cannot be connected a second time.
    if (typeof this.pool.connect === 'function' && typeof this.pool.release !== 'function') {
      return withSafePostgresTransaction(
        this.pool as unknown as Pick<Pool, 'connect'>,
        async (client) => this.appendSuppressionWithExecutor(client, normalized),
        { module: 'discovery-feedback-postgres', operation: 'append-suppression' },
      );
    }
    return this.appendSuppressionWithExecutor(this.pool, normalized);
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

  async listSuppressionForPresentationBatch(
    lookup: DiscoveryPresentationBatchLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const at = dateForQuery(lookup.at);
    if (lookup.findings.length === 0) return [];
    if (lookup.findings.length > PRESENTATION_BATCH_SIZE) {
      throw new TypeError('presentation Finding batch exceeds the bounded read size');
    }
    const result = await this.pool.query<SuppressionRow>(
      `WITH requested AS (
         SELECT *
         FROM unnest(
           $4::text[], $5::integer[], $6::text[], $7::text[], $8::text[]
         ) AS r(finding_id, finding_revision, fingerprint, fingerprint_version, semantic_family_key)
       ), candidate_ids AS (
         SELECT d.project_id, d.suppression_id
         FROM requested r
         JOIN discovery.suppression_directives d
           ON d.project_id = $1
          AND d.source_finding_id = r.finding_id
          AND d.source_finding_revision = r.finding_revision
          AND d.suppression_kind = 'SNOOZE'
         UNION
         SELECT d.project_id, d.suppression_id
         FROM requested r
         JOIN discovery.suppression_directives d
           ON d.project_id = $1
          AND d.suppression_kind = 'SUPPRESS_EXACT'
          AND d.fingerprint = r.fingerprint
          AND d.fingerprint_version = r.fingerprint_version
          AND (
            d.scope_kind = 'PROJECT'
            OR (
              d.source_finding_id = r.finding_id
              AND d.source_finding_revision = r.finding_revision
            )
          )
         UNION
         SELECT p.project_id, p.suppression_id
         FROM requested r
         JOIN discovery.suppression_semantic_family_projection p
           ON p.project_id = $1
          AND p.semantic_family_key = r.semantic_family_key
       )
       SELECT ${qualifiedSuppressionColumns}
       FROM candidate_ids ids
       JOIN discovery.suppression_directives d
         ON d.project_id = ids.project_id
        AND d.suppression_id = ids.suppression_id
       WHERE d.project_id = $1
         AND COALESCE(d.principal_id, d.actor_id) = $2
         AND d.created_at <= $3::timestamptz
         AND (d.expires_at IS NULL OR d.expires_at > $3::timestamptz)
         AND (
           d.suppression_kind <> 'SUPPRESS_SIMILAR'
           OR (
             d.matcher_kind = 'SEMANTIC_FAMILY'
             AND d.matcher_version = 'semantic-family:v1'
           )
         )
       ORDER BY d.created_at ASC, d.suppression_id ASC
       LIMIT ${MAX_PRESENTATION_SUPPRESSION_CANDIDATES + 1}`,
      [
        projectId,
        principalId,
        at,
        lookup.findings.map((finding) => finding.findingId),
        lookup.findings.map((finding) => finding.findingRevision),
        lookup.findings.map((finding) => finding.fingerprint),
        lookup.findings.map((finding) => finding.fingerprintVersion),
        lookup.findings.map((finding) => finding.semanticFamilyKey ?? null),
      ],
    );
    if (result.rows.length > MAX_PRESENTATION_SUPPRESSION_CANDIDATES) {
      throw new TypeError('presentation suppression candidate limit exceeded');
    }
    return result.rows.map(mapSuppression);
  }

  /** Rebuilds only the derived semantic-family lookup. The authority tables
   * remain append-only and are read in keyset pages so startup memory is
   * independent of the number of stored directives. */
  async rebuildSemanticFamilyProjection(): Promise<number> {
    const resolver = this.options.semanticFamilyKeyResolver;
    if (resolver === undefined) return 0;
    let afterProjectId = '';
    let afterSuppressionId = '';
    let rebuilt = 0;
    for (;;) {
      const page = await this.pool.query<SemanticFamilyProjectionRebuildRow>(
        `SELECT project_id, suppression_id, source_finding_id,
                source_finding_revision, created_at
         FROM discovery.suppression_directives
         WHERE suppression_kind = 'SUPPRESS_SIMILAR'
           AND matcher_kind = 'SEMANTIC_FAMILY'
           AND matcher_version = 'semantic-family:v1'
           AND (
             project_id > $1
             OR (project_id = $1 AND suppression_id > $2)
           )
         ORDER BY project_id ASC, suppression_id ASC
         LIMIT 100`,
        [afterProjectId, afterSuppressionId],
      );
      if (page.rows.length === 0) break;
      for (const row of page.rows) {
        const semanticFamilyKey = await resolver({
          projectId: row.project_id,
          findingId: row.source_finding_id,
          findingRevision: Number(row.source_finding_revision),
        });
        if (semanticFamilyKey !== undefined) {
          await this.pool.query(
            `INSERT INTO discovery.suppression_semantic_family_projection (
               project_id, suppression_id, source_finding_id,
               source_finding_revision, semantic_family_key, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (project_id, suppression_id) DO UPDATE SET
               source_finding_id = EXCLUDED.source_finding_id,
               source_finding_revision = EXCLUDED.source_finding_revision,
               semantic_family_key = EXCLUDED.semantic_family_key,
               created_at = EXCLUDED.created_at`,
            [
              row.project_id,
              row.suppression_id,
              row.source_finding_id,
              row.source_finding_revision,
              semanticFamilyKey,
              iso(row.created_at),
            ],
          );
          rebuilt += 1;
        }
        afterProjectId = row.project_id;
        afterSuppressionId = row.suppression_id;
      }
      if (page.rows.length < 100) break;
    }
    return rebuilt;
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
            this.options,
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
