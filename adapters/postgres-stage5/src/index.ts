import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  analysisInputSetDigestV2,
  comparisonV2AggregateContentDigest,
  comparisonV2StorageIdentity,
  validateComparisonV2Aggregate,
  type AnalysisRevisionTransitionV2,
  type ComparisonV2Aggregate,
  type ComparisonV2RepositoryPort,
  type ComparisonV2StorageIdentity,
  type ComparisonRepositoryPort,
} from '../../../modules/comparison/src/index.js';
import type {
  ChangeSetReviewRepositoryPort,
  ReviewV2RepositoryPort,
  ReviewDecisionWrite,
} from '../../../modules/change-set-review/src/index.js';
import {
  type ApprovedChangeSetManifest,
  assertAnalysisStateTransitionV2,
  type AnalysisOutcomeV2,
  type AnalysisRevisionV2,
  type ComparisonResultV2,
  type SemanticRelationshipV2,
  type ComparisonResult,
  type DraftChangeSet,
  type DraftChangeSetV2,
  type ReversalDraftChangeSetV1,
  stableJson,
  sha256Text,
  ShotgunError,
  validateAnalysisRevisionV2,
  validateComparisonResultV2,
  validateDraftChangeSetV2,
  shortlistAuditDigestV2,
} from '../../../packages/contracts/src/index.js';

type ComparisonRow = QueryResultRow & {
  readonly result_json: ComparisonResult;
};

type ChangeSetRow = QueryResultRow & {
  readonly change_set_json: DraftChangeSet;
  readonly manifest_json: ApprovedChangeSetManifest | null;
};

type ChangeSetV2Row = QueryResultRow & {
  readonly change_set_json: DraftChangeSetV2;
};

type DecisionRow = QueryResultRow & {
  readonly decision_json: ReviewDecisionWrite['decision'];
  readonly change_set_json?: DraftChangeSet;
  readonly manifest_json?: ApprovedChangeSetManifest | null;
};

type ReversalRow = QueryResultRow & {
  readonly reversal_json: ReversalDraftChangeSetV1;
};

const comparisonSelect = `
  SELECT result_json
  FROM comparison.results
`;

const changeSetSelect = `
  SELECT change_set_json, manifest_json
  FROM review.change_sets
`;

const loadChangeSetForUpdate = async (
  client: PoolClient,
  projectId: string,
  changeSetId: string,
): Promise<ChangeSetRow | undefined> => {
  const result = await client.query<ChangeSetRow>(
    `${changeSetSelect} WHERE project_id = $1 AND change_set_id = $2 FOR UPDATE`,
    [projectId, changeSetId],
  );
  return result.rows[0];
};

export class PostgresComparisonRepository implements ComparisonRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(result: ComparisonResult): Promise<ComparisonResult> {
    const inserted = await this.pool.query<ComparisonRow>(
      `
        INSERT INTO comparison.results (
          comparison_id, project_id, source_version_id, candidate_id,
          snapshot_id, snapshot_version, snapshot_digest, classification,
          candidate_digest, diff_digest, result_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (project_id, candidate_id, snapshot_digest) DO NOTHING
        RETURNING result_json
      `,
      [
        result.comparisonId,
        result.projectId,
        result.sourceVersionId,
        result.candidateId,
        result.snapshotId,
        result.snapshotVersion,
        result.snapshotDigest,
        result.classification,
        result.candidateDigest,
        result.diffDigest,
        JSON.stringify(result),
        result.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return inserted.rows[0].result_json;
    }
    const existing = await this.findByCandidateAndSnapshot(
      result.projectId,
      result.candidateId,
      result.snapshotDigest,
    );
    if (!existing) {
      throw new Error('Comparison Result was not stored.');
    }
    if (
      stableJson({ ...existing, comparisonId: undefined }) !==
      stableJson({ ...result, comparisonId: undefined })
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The same Candidate and Snapshot produced a different comparison.',
        module: 'postgres-stage5',
        operation: 'save-comparison',
      });
    }
    return existing;
  }

  async findById(projectId: string, comparisonId: string): Promise<ComparisonResult | undefined> {
    const result = await this.pool.query<ComparisonRow>(
      `${comparisonSelect} WHERE project_id = $1 AND comparison_id = $2`,
      [projectId, comparisonId],
    );
    return result.rows[0]?.result_json;
  }

  async findByCandidateAndSnapshot(
    projectId: string,
    candidateId: string,
    snapshotDigest: string,
  ): Promise<ComparisonResult | undefined> {
    const result = await this.pool.query<ComparisonRow>(
      `${comparisonSelect}
       WHERE project_id = $1 AND candidate_id = $2 AND snapshot_digest = $3`,
      [projectId, candidateId, snapshotDigest],
    );
    return result.rows[0]?.result_json;
  }
}

type ComparisonV2Row = QueryResultRow & {
  readonly result_json: ComparisonResultV2;
  readonly logical_identity_digest: string;
  readonly content_digest: string;
};

type AnalysisV2Row = QueryResultRow & {
  readonly analysis_json: AnalysisRevisionV2;
};

type RelationshipV2Row = QueryResultRow & {
  readonly relationship_json: SemanticRelationshipV2;
};

const jsonValue = <T>(value: unknown): T =>
  typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);

const normalizedAnalysis = (analysis: AnalysisRevisionV2): string =>
  stableJson({
    ...analysis,
    analysisRevisionId: undefined,
    comparisonId: undefined,
    candidate: {
      ...analysis.candidate,
      evidenceIds: [...analysis.candidate.evidenceIds].sort(),
    },
    comparedResourceIdentities: [...analysis.comparedResourceIdentities].sort((left, right) =>
      `${left.resourceType}:${left.resourceId}:${left.resourceRevision}`.localeCompare(
        `${right.resourceType}:${right.resourceId}:${right.resourceRevision}`,
      ),
    ),
  });

const normalizedRelationship = (relationship: SemanticRelationshipV2): string =>
  stableJson({
    ...relationship,
    relationshipId: undefined,
    comparisonId: undefined,
    candidateEvidenceIds: [...relationship.candidateEvidenceIds].sort(),
    accessScope: [...relationship.accessScope].sort(),
  });

const validatedAnalysis = (value: unknown, operation: string): AnalysisRevisionV2 => {
  const analysis = jsonValue<AnalysisRevisionV2>(value);
  try {
    validateAnalysisRevisionV2(analysis);
  } catch (error) {
    throw new ShotgunError({
      code: 'FORMAT_CORRUPT',
      safeMessage: 'Stored AnalysisRevision failed contract validation.',
      module: 'postgres-stage5',
      operation,
      cause: error,
    });
  }
  return analysis;
};

const relationshipStorageDigest = (
  projectId: string,
  comparisonIdentityDigest: string,
  relationship: SemanticRelationshipV2,
): string =>
  sha256Text(
    stableJson({
      projectId,
      comparisonIdentityDigest,
      candidateId: relationship.candidateId,
      candidateRevision: relationship.candidateRevision,
      candidateDigest: relationship.candidateDigest,
      candidateEvidenceIds: [...relationship.candidateEvidenceIds].sort(),
      comparedResource: relationship.comparedResource,
      analysisRevisionId: relationship.analysisRevisionId,
      type: relationship.type,
      conflictKind: relationship.conflictKind,
      ruleIdentity: relationship.ruleIdentity,
      materialDigest: relationship.materialDigest,
      accessScope: [...relationship.accessScope].sort(),
      sensitivity: relationship.sensitivity,
      relationshipRevision: relationship.revision,
    }),
  );

const dbError = (error: unknown, operation: string): ShotgunError => {
  const code = (error as { readonly code?: string }).code;
  if (code === '23505') {
    return new ShotgunError({
      code: 'CONFLICT',
      safeMessage: 'The v2 persistence identity is already bound to different content.',
      module: 'postgres-stage5',
      operation,
      cause: error,
    });
  }
  if (code === '23503' || code === '23514' || code === '22P02') {
    return new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'The v2 persistence payload violates a database integrity constraint.',
      module: 'postgres-stage5',
      operation,
      cause: error,
    });
  }
  return error instanceof ShotgunError
    ? error
    : new ShotgunError({
        code: 'INTERNAL_UNCLASSIFIED',
        safeMessage: 'The v2 persistence operation failed.',
        module: 'postgres-stage5',
        operation,
        cause: error,
      });
};

type PostgresComparisonV2RepositoryOptions = {
  readonly writeEnabled?: boolean;
};

/** Additive PostgreSQL adapter for the frozen v2 Comparison contracts. */
export class PostgresComparisonV2Repository implements ComparisonV2RepositoryPort {
  private writeEnabled: boolean;

  constructor(
    private readonly pool: Pool,
    options: PostgresComparisonV2RepositoryOptions = {},
  ) {
    this.writeEnabled = options.writeEnabled ?? true;
  }

  setWriterEnabled(enabled: boolean): void {
    this.writeEnabled = enabled;
  }

  isWriterEnabled(): boolean {
    return this.writeEnabled;
  }

  private assertWriterEnabled(operation: string): void {
    if (!this.writeEnabled) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Comparison v2 persistence writes are disabled.',
        module: 'postgres-stage5',
        operation,
      });
    }
  }

  private async withTransaction<T>(
    operation: string,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { readonly code?: string }).code === 'INVALID_TRANSITION') throw error;
      throw dbError(error, operation);
    } finally {
      client.release();
    }
  }

  private async loadAggregateByComparisonIdClient(
    client: PoolClient,
    projectId: string,
    comparisonId: string,
  ): Promise<ComparisonV2Aggregate | undefined> {
    const summary = await client.query<ComparisonV2Row>(
      `SELECT result_json
              , logical_identity_digest
              , content_digest
       FROM comparison.results_v2
       WHERE project_id = $1 AND comparison_id = $2`,
      [projectId, comparisonId],
    );
    const row = summary.rows[0];
    if (!row) return undefined;
    const comparison = jsonValue<ComparisonResultV2>(row.result_json);
    validateComparisonResultV2(comparison);
    const analysisIds = [...comparison.analysisRevisionIds];
    const relationshipIds = [...comparison.relationshipIds];
    const [analysisResult, relationshipResult] = await Promise.all([
      analysisIds.length === 0
        ? Promise.resolve({ rows: [] as AnalysisV2Row[] })
        : client.query<AnalysisV2Row>(
            `SELECT analysis_json
             FROM comparison.analysis_revisions_v2
             WHERE project_id = $1 AND analysis_revision_id = ANY($2::text[])`,
            [projectId, analysisIds],
          ),
      relationshipIds.length === 0
        ? Promise.resolve({ rows: [] as RelationshipV2Row[] })
        : client.query<RelationshipV2Row>(
            `SELECT relationship_json
             FROM comparison.relationships_v2
             WHERE project_id = $1 AND relationship_id = ANY($2::text[])`,
            [projectId, relationshipIds],
          ),
    ]);
    const analysisRows = new Map(
      analysisResult.rows.map((child) => {
        const value = jsonValue<AnalysisRevisionV2>(child.analysis_json);
        return [value.analysisRevisionId, value] as const;
      }),
    );
    const relationshipRows = new Map(
      relationshipResult.rows.map((child) => {
        const value = jsonValue<SemanticRelationshipV2>(child.relationship_json);
        return [value.relationshipId, value] as const;
      }),
    );
    const aggregate = {
      comparison,
      analyses: analysisIds
        .map((id) => analysisRows.get(id))
        .filter((value): value is AnalysisRevisionV2 => value !== undefined),
      relationships: relationshipIds
        .map((id) => relationshipRows.get(id))
        .filter((value): value is SemanticRelationshipV2 => value !== undefined),
    } satisfies ComparisonV2Aggregate;
    try {
      validateComparisonV2Aggregate(aggregate);
      if (
        row.content_digest !== comparisonV2AggregateContentDigest(aggregate) ||
        row.logical_identity_digest !==
          sha256Text(stableJson(comparisonV2StorageIdentity(aggregate)))
      ) {
        throw new Error('Stored v2 persistence digests do not match the reconstructed aggregate.');
      }
    } catch (error) {
      throw new ShotgunError({
        code: 'FORMAT_CORRUPT',
        safeMessage: 'Stored Comparison v2 aggregate failed contract validation.',
        module: 'postgres-stage5',
        operation: 'read-comparison-v2',
        cause: error,
      });
    }
    return aggregate;
  }

  private async loadAggregateByIdentityClient(
    client: PoolClient,
    identity: ComparisonV2StorageIdentity,
  ): Promise<ComparisonV2Aggregate | undefined> {
    const logicalIdentityDigest = sha256Text(stableJson(identity));
    const result = await client.query<{ comparison_id: string }>(
      `SELECT comparison_id
       FROM comparison.results_v2
       WHERE project_id = $1 AND logical_identity_digest = $2`,
      [identity.projectId, logicalIdentityDigest],
    );
    const comparisonId = result.rows[0]?.comparison_id;
    return comparisonId
      ? this.loadAggregateByComparisonIdClient(client, identity.projectId, comparisonId)
      : undefined;
  }

  private async insertAnalysisClient(
    client: PoolClient,
    projectId: string,
    revision: AnalysisRevisionV2,
  ): Promise<AnalysisRevisionV2> {
    const inserted = await client.query<AnalysisV2Row>(
      `INSERT INTO comparison.analysis_revisions_v2 (
         analysis_revision_id, project_id, comparison_id, candidate_id,
         candidate_revision, candidate_digest, candidate_source_version_id,
         candidate_evidence_ids, snapshot_id, snapshot_version, snapshot_digest,
         input_digest, shortlist_digest, compared_resource_types,
         compared_resource_identities, provider_id, model_id, capability_id,
         credential_revision_ref, prompt_template_revision, output_schema_revision,
         semantic_policy_revision, attempt, state, outcome, started_at,
         completed_at, duration_ms, output_digest, material_digest,
         safe_failure_code, analysis_json, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
         $26, $27, $28, $29, $30, $31, $32, $33
       )
       ON CONFLICT (
         project_id, candidate_id, candidate_revision, snapshot_digest, input_digest, attempt
       ) DO NOTHING
       RETURNING analysis_json`,
      [
        revision.analysisRevisionId,
        projectId,
        revision.comparisonId,
        revision.candidate.id,
        revision.candidate.revision,
        revision.candidate.digest,
        revision.candidate.sourceVersionId,
        [...revision.candidate.evidenceIds],
        revision.canonicalSnapshot.id,
        revision.canonicalSnapshot.version,
        revision.canonicalSnapshot.digest,
        revision.inputDigest,
        revision.shortlistDigest,
        revision.comparedResourceIdentities.map((resource) => resource.resourceType),
        JSON.stringify(revision.comparedResourceIdentities),
        revision.providerIdentity.providerId,
        revision.providerIdentity.modelId,
        revision.providerIdentity.capabilityId,
        revision.credentialRevisionRef,
        revision.promptTemplateRevision,
        revision.outputSchemaRevision,
        revision.semanticPolicyRevision,
        revision.attempt,
        revision.state,
        revision.outcome ?? null,
        revision.startedAt,
        revision.completedAt ?? null,
        revision.durationMs ?? null,
        revision.outputDigest ?? null,
        revision.materialDigest ?? null,
        revision.safeFailureCode ?? null,
        JSON.stringify(revision),
        revision.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return validatedAnalysis(inserted.rows[0].analysis_json, 'save-analysis-revision-v2');
    }

    const byId = await client.query<AnalysisV2Row>(
      `SELECT analysis_json
       FROM comparison.analysis_revisions_v2
       WHERE project_id = $1 AND analysis_revision_id = $2`,
      [projectId, revision.analysisRevisionId],
    );
    const byIdentity = await client.query<AnalysisV2Row>(
      `SELECT analysis_json
       FROM comparison.analysis_revisions_v2
       WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = $3
         AND snapshot_digest = $4 AND input_digest = $5 AND attempt = $6`,
      [
        projectId,
        revision.candidate.id,
        revision.candidate.revision,
        revision.canonicalSnapshot.digest,
        revision.inputDigest,
        revision.attempt,
      ],
    );
    const existing = byId.rows[0] ?? byIdentity.rows[0];
    if (!existing) throw new Error('AnalysisRevision was not stored.');
    const stored = validatedAnalysis(existing.analysis_json, 'save-analysis-revision-v2');
    if (normalizedAnalysis(stored) !== normalizedAnalysis(revision)) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The same AnalysisRevision attempt was reused with different content.',
        module: 'postgres-stage5',
        operation: 'save-analysis-revision-v2',
      });
    }
    return stored;
  }

  async saveAnalysisRevision(input: {
    readonly projectId: string;
    readonly revision: AnalysisRevisionV2;
  }): Promise<AnalysisRevisionV2> {
    this.assertWriterEnabled('save-analysis-revision-v2');
    validateAnalysisRevisionV2(input.revision);
    return this.withTransaction('save-analysis-revision-v2', (client) =>
      this.insertAnalysisClient(client, input.projectId, input.revision),
    );
  }

  async transitionAnalysisRevision(
    transition: AnalysisRevisionTransitionV2,
  ): Promise<AnalysisRevisionV2> {
    this.assertWriterEnabled('transition-analysis-revision-v2');
    return this.withTransaction('transition-analysis-revision-v2', async (client) => {
      const result = await client.query<AnalysisV2Row>(
        `SELECT analysis_json
         FROM comparison.analysis_revisions_v2
         WHERE project_id = $1 AND analysis_revision_id = $2
         FOR UPDATE`,
        [transition.projectId, transition.analysisRevisionId],
      );
      const currentRow = result.rows[0];
      if (!currentRow) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The AnalysisRevision was not found.',
          module: 'postgres-stage5',
          operation: 'transition-analysis-revision-v2',
        });
      }
      const current = validatedAnalysis(
        currentRow.analysis_json,
        'transition-analysis-revision-v2',
      );
      validateAnalysisRevisionV2(current);
      if (current.state !== transition.expectedState) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The AnalysisRevision state changed before transition.',
          module: 'postgres-stage5',
          operation: 'transition-analysis-revision-v2',
        });
      }
      assertAnalysisStateTransitionV2(current.state, transition.nextState);
      const updates = transition.updates ?? {};
      const terminal = !['PENDING', 'ANALYZING'].includes(transition.nextState);
      const updated: AnalysisRevisionV2 = {
        ...current,
        ...updates,
        state: transition.nextState,
        outcome: terminal ? (transition.nextState as AnalysisOutcomeV2) : undefined,
        completedAt: terminal ? (updates.completedAt ?? current.completedAt) : undefined,
        safeFailureCode:
          terminal && transition.nextState !== 'COMPLETED'
            ? (updates.safeFailureCode ?? current.safeFailureCode)
            : undefined,
      };
      validateAnalysisRevisionV2(updated);
      await client.query(
        `UPDATE comparison.analysis_revisions_v2
         SET state = $3, outcome = $4, started_at = $5, completed_at = $6,
             duration_ms = $7, output_digest = $8, material_digest = $9,
             safe_failure_code = $10, analysis_json = $11
         WHERE project_id = $1 AND analysis_revision_id = $2 AND state = $12`,
        [
          transition.projectId,
          transition.analysisRevisionId,
          updated.state,
          updated.outcome ?? null,
          updated.startedAt,
          updated.completedAt ?? null,
          updated.durationMs ?? null,
          updated.outputDigest ?? null,
          updated.materialDigest ?? null,
          updated.safeFailureCode ?? null,
          JSON.stringify(updated),
          transition.expectedState,
        ],
      );
      return updated;
    });
  }

  async findAnalysisRevision(
    projectId: string,
    analysisRevisionId: string,
  ): Promise<AnalysisRevisionV2 | undefined> {
    const result = await this.pool.query<AnalysisV2Row>(
      `SELECT analysis_json
       FROM comparison.analysis_revisions_v2
       WHERE project_id = $1 AND analysis_revision_id = $2`,
      [projectId, analysisRevisionId],
    );
    return result.rows[0]
      ? validatedAnalysis(result.rows[0].analysis_json, 'read-analysis-revision-v2')
      : undefined;
  }

  async findAnalysisRevisionByInput(input: {
    readonly projectId: string;
    readonly candidateId: string;
    readonly candidateRevision: number;
    readonly canonicalSnapshotDigest: string;
    readonly inputDigest: string;
    readonly attempt: number;
  }): Promise<AnalysisRevisionV2 | undefined> {
    const result = await this.pool.query<AnalysisV2Row>(
      `SELECT analysis_json
       FROM comparison.analysis_revisions_v2
       WHERE project_id = $1 AND candidate_id = $2 AND candidate_revision = $3
         AND snapshot_digest = $4 AND input_digest = $5 AND attempt = $6`,
      [
        input.projectId,
        input.candidateId,
        input.candidateRevision,
        input.canonicalSnapshotDigest,
        input.inputDigest,
        input.attempt,
      ],
    );
    return result.rows[0]
      ? validatedAnalysis(result.rows[0].analysis_json, 'read-analysis-revision-v2')
      : undefined;
  }

  async saveCompletedAggregate(aggregate: ComparisonV2Aggregate): Promise<ComparisonV2Aggregate> {
    this.assertWriterEnabled('save-completed-comparison-v2');
    validateComparisonV2Aggregate(aggregate);
    const identity = comparisonV2StorageIdentity(aggregate);
    const logicalIdentityDigest = sha256Text(stableJson(identity));
    const contentDigest = comparisonV2AggregateContentDigest(aggregate);
    const analysisSetDigest =
      identity.mode === 'SEMANTIC' ? analysisInputSetDigestV2(aggregate.analyses) : null;
    return this.withTransaction('save-completed-comparison-v2', async (client) => {
      const inserted = await client.query<ComparisonV2Row>(
        `INSERT INTO comparison.results_v2 (
           comparison_id, project_id, candidate_id, candidate_revision,
           candidate_digest, source_version_id, snapshot_id, snapshot_version,
           snapshot_digest, disposition, review_recommendation, comparison_mode,
           exact_duplicate_claim_id, exact_duplicate_claim_revision,
           shortlist_digest, analysis_input_set_digest, access_scope, sensitivity,
           logical_identity_digest, content_digest, result_json, created_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
         )
         ON CONFLICT DO NOTHING
         RETURNING result_json`,
        [
          aggregate.comparison.comparisonId,
          aggregate.comparison.projectId,
          aggregate.comparison.candidate.id,
          aggregate.comparison.candidate.revision,
          aggregate.comparison.candidate.digest,
          aggregate.comparison.candidate.sourceVersionId,
          aggregate.comparison.canonicalSnapshot.id,
          aggregate.comparison.canonicalSnapshot.version,
          aggregate.comparison.canonicalSnapshot.digest,
          aggregate.comparison.disposition,
          aggregate.comparison.reviewRecommendation,
          identity.mode,
          identity.mode === 'DETERMINISTIC_EXACT' ? identity.exactDuplicateClaimId : null,
          identity.mode === 'DETERMINISTIC_EXACT' ? identity.exactDuplicateClaimRevision : null,
          aggregate.comparison.shortlist
            ? shortlistAuditDigestV2(aggregate.comparison.shortlist)
            : null,
          analysisSetDigest,
          [...aggregate.comparison.accessScope],
          aggregate.comparison.sensitivity,
          logicalIdentityDigest,
          contentDigest,
          JSON.stringify(aggregate.comparison),
          aggregate.comparison.createdAt,
        ],
      );
      if (!inserted.rows[0]) {
        const existingById = await this.loadAggregateByComparisonIdClient(
          client,
          aggregate.comparison.projectId,
          aggregate.comparison.comparisonId,
        );
        const existing =
          existingById ?? (await this.loadAggregateByIdentityClient(client, identity));
        if (!existing) throw new Error('Comparison v2 was not stored.');
        if (
          comparisonV2AggregateContentDigest(existing) !== contentDigest ||
          sha256Text(stableJson(comparisonV2StorageIdentity(existing))) !== logicalIdentityDigest
        ) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'The same Comparison v2 identity was reused with different content.',
            module: 'postgres-stage5',
            operation: 'save-completed-comparison-v2',
          });
        }
        return existing;
      }

      for (const analysis of aggregate.analyses) {
        const stored = await this.insertAnalysisClient(
          client,
          aggregate.comparison.projectId,
          analysis,
        );
        if (stored.analysisRevisionId !== analysis.analysisRevisionId) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'A completed aggregate references a different AnalysisRevision identity.',
            module: 'postgres-stage5',
            operation: 'save-completed-comparison-v2',
          });
        }
      }
      for (const relationship of aggregate.relationships) {
        const relationshipDigest = relationshipStorageDigest(
          aggregate.comparison.projectId,
          logicalIdentityDigest,
          relationship,
        );
        const relationshipInsert = await client.query<RelationshipV2Row>(
          `INSERT INTO comparison.relationships_v2 (
             relationship_id, project_id, comparison_id, candidate_id,
             candidate_revision, candidate_digest, candidate_evidence_ids,
             compared_resource_type, compared_resource_id, compared_resource_revision,
             snapshot_id, snapshot_version, snapshot_digest, relationship_type,
             conflict_kind, analysis_revision_id, rule_identity, rationale,
             material_digest, access_scope, sensitivity, relationship_revision,
             relationship_identity_digest, relationship_json, created_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
           )
           ON CONFLICT (project_id, relationship_identity_digest) DO NOTHING
           RETURNING relationship_json`,
          [
            relationship.relationshipId,
            aggregate.comparison.projectId,
            relationship.comparisonId,
            relationship.candidateId,
            relationship.candidateRevision,
            relationship.candidateDigest,
            [...relationship.candidateEvidenceIds],
            relationship.comparedResource.resourceType,
            relationship.comparedResource.resourceId,
            relationship.comparedResource.resourceRevision,
            relationship.canonicalSnapshot.snapshotId,
            relationship.canonicalSnapshot.version,
            relationship.canonicalSnapshot.digest,
            relationship.type,
            relationship.conflictKind ?? null,
            relationship.analysisRevisionId,
            relationship.ruleIdentity,
            relationship.rationale,
            relationship.materialDigest,
            [...relationship.accessScope],
            relationship.sensitivity,
            relationship.revision,
            relationshipDigest,
            JSON.stringify(relationship),
            relationship.createdAt,
          ],
        );
        if (!relationshipInsert.rows[0]) {
          const existing = await client.query<RelationshipV2Row>(
            `SELECT relationship_json
             FROM comparison.relationships_v2
             WHERE project_id = $1 AND relationship_identity_digest = $2`,
            [aggregate.comparison.projectId, relationshipDigest],
          );
          const stored = existing.rows[0]
            ? jsonValue<SemanticRelationshipV2>(existing.rows[0].relationship_json)
            : undefined;
          if (!stored || normalizedRelationship(stored) !== normalizedRelationship(relationship)) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The same Relationship identity was reused with different content.',
              module: 'postgres-stage5',
              operation: 'save-completed-comparison-v2',
            });
          }
        }
      }
      return aggregate;
    });
  }

  async findComparisonById(
    projectId: string,
    comparisonId: string,
  ): Promise<ComparisonV2Aggregate | undefined> {
    const client = await this.pool.connect();
    try {
      return await this.loadAggregateByComparisonIdClient(client, projectId, comparisonId);
    } finally {
      client.release();
    }
  }

  async findComparisonByIdentity(
    identity: ComparisonV2StorageIdentity,
  ): Promise<ComparisonV2Aggregate | undefined> {
    const client = await this.pool.connect();
    try {
      return await this.loadAggregateByIdentityClient(client, identity);
    } finally {
      client.release();
    }
  }
}

export class PostgresChangeSetReviewRepository implements ChangeSetReviewRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(changeSet: DraftChangeSet): Promise<DraftChangeSet> {
    const inserted = await this.pool.query<ChangeSetRow>(
      `
        INSERT INTO review.change_sets (
          change_set_id, project_id, source_version_id, candidate_id, comparison_id,
          revision_number, status, content_digest, expected_canonical_version,
          snapshot_digest, change_set_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (project_id, comparison_id) DO NOTHING
        RETURNING change_set_json, manifest_json
      `,
      [
        changeSet.changeSetId,
        changeSet.projectId,
        changeSet.sourceVersionId,
        changeSet.candidateId,
        changeSet.comparisonId,
        changeSet.revisionNumber,
        changeSet.status,
        changeSet.contentDigest,
        changeSet.expectedCanonicalVersion,
        changeSet.snapshotDigest,
        JSON.stringify(changeSet),
        changeSet.createdAt,
        changeSet.updatedAt,
      ],
    );
    if (inserted.rows[0]) {
      return inserted.rows[0].change_set_json;
    }
    const existing = await this.findByComparisonId(changeSet.projectId, changeSet.comparisonId);
    if (!existing) {
      throw new Error('Draft Change Set was not stored.');
    }
    if (
      stableJson({ ...existing, changeSetId: undefined }) !==
      stableJson({ ...changeSet, changeSetId: undefined })
    ) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The same Comparison produced a different Draft Change Set.',
        module: 'postgres-stage5',
        operation: 'save-draft-change-set',
      });
    }
    return existing;
  }

  async findById(projectId: string, changeSetId: string): Promise<DraftChangeSet | undefined> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect} WHERE project_id = $1 AND change_set_id = $2`,
      [projectId, changeSetId],
    );
    return result.rows[0]?.change_set_json;
  }

  async findByComparisonId(
    projectId: string,
    comparisonId: string,
  ): Promise<DraftChangeSet | undefined> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect} WHERE project_id = $1 AND comparison_id = $2`,
      [projectId, comparisonId],
    );
    return result.rows[0]?.change_set_json;
  }

  async listBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<readonly DraftChangeSet[]> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect}
       WHERE project_id = $1 AND source_version_id = $2
       ORDER BY created_at, change_set_id`,
      [projectId, sourceVersionId],
    );
    return result.rows.map((row) => row.change_set_json);
  }

  async findDecision(
    projectId: string,
    decisionId: string,
  ): Promise<
    | {
        readonly changeSet: DraftChangeSet;
        readonly decision: ReviewDecisionWrite['decision'];
        readonly manifest?: ApprovedChangeSetManifest;
      }
    | undefined
  > {
    const result = await this.pool.query<DecisionRow>(
      `
        SELECT d.decision_json, c.change_set_json, c.manifest_json
        FROM review.decisions d
        JOIN review.change_sets c ON c.change_set_id = d.change_set_id
        WHERE d.project_id = $1 AND d.decision_id = $2
      `,
      [projectId, decisionId],
    );
    const row = result.rows[0];
    if (!row?.change_set_json) {
      return undefined;
    }
    return {
      changeSet: row.change_set_json,
      decision: row.decision_json,
      manifest: row.manifest_json ?? undefined,
    };
  }

  async recordDecision(write: ReviewDecisionWrite): Promise<{
    readonly changeSet: DraftChangeSet;
    readonly manifest?: ApprovedChangeSetManifest;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await loadChangeSetForUpdate(client, write.projectId, write.changeSetId);
      if (!row) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The Draft Change Set was not found.',
          module: 'postgres-stage5',
          operation: 'record-review-decision',
        });
      }
      const existingDecision = await client.query<DecisionRow>(
        'SELECT decision_json FROM review.decisions WHERE decision_id = $1',
        [write.decision.decisionId],
      );
      if (existingDecision.rows[0]) {
        if (stableJson(existingDecision.rows[0].decision_json) !== stableJson(write.decision)) {
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'The review decision id was reused with different content.',
            module: 'postgres-stage5',
            operation: 'record-review-decision',
          });
        }
        await client.query('COMMIT');
        return {
          changeSet: row.change_set_json,
          manifest: row.manifest_json ?? undefined,
        };
      }
      const current = row.change_set_json;
      if (
        current.revisionNumber !== write.expectedRevisionNumber ||
        current.contentDigest !== write.expectedContentDigest
      ) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The Draft Change Set changed before the decision was stored.',
          module: 'postgres-stage5',
          operation: 'record-review-decision',
        });
      }
      if (['APPROVED', 'REJECTED', 'STALE'].includes(current.status)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The Draft Change Set already has a final status.',
          module: 'postgres-stage5',
          operation: 'record-review-decision',
        });
      }
      await client.query(
        `
          INSERT INTO review.decisions (
            decision_id, project_id, change_set_id, decision, actor_type,
            actor_id, reason, content_digest, decision_json, decided_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          write.decision.decisionId,
          write.projectId,
          write.changeSetId,
          write.decision.decision,
          write.decision.actor.type,
          write.decision.actor.id,
          write.decision.reason,
          write.decision.contentDigest,
          JSON.stringify(write.decision),
          write.decision.decidedAt,
        ],
      );
      await client.query(
        `
          UPDATE review.change_sets
          SET status = $3,
              change_set_json = $4,
              manifest_json = $5,
              updated_at = $6
          WHERE project_id = $1 AND change_set_id = $2
        `,
        [
          write.projectId,
          write.changeSetId,
          write.updated.status,
          JSON.stringify(write.updated),
          write.manifest ? JSON.stringify(write.manifest) : null,
          write.updated.updatedAt,
        ],
      );
      await client.query('COMMIT');
      return { changeSet: write.updated, manifest: write.manifest };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markStale(
    projectId: string,
    changeSetId: string,
    expectedContentDigest: string,
    updatedAt: string,
  ): Promise<DraftChangeSet> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await loadChangeSetForUpdate(client, projectId, changeSetId);
      if (!row) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The Draft Change Set was not found.',
          module: 'postgres-stage5',
          operation: 'mark-change-set-stale',
        });
      }
      const current = row.change_set_json;
      if (current.contentDigest !== expectedContentDigest) {
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'The Draft Change Set changed before it could be marked stale.',
          module: 'postgres-stage5',
          operation: 'mark-change-set-stale',
        });
      }
      if (current.status === 'STALE') {
        await client.query('COMMIT');
        return current;
      }
      if (['APPROVED', 'REJECTED'].includes(current.status)) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'A final Draft Change Set cannot be marked stale.',
          module: 'postgres-stage5',
          operation: 'mark-change-set-stale',
        });
      }
      const stale = { ...current, status: 'STALE' as const, updatedAt };
      await client.query(
        `
          UPDATE review.change_sets
          SET status = 'STALE', change_set_json = $3, updated_at = $4
          WHERE project_id = $1 AND change_set_id = $2
        `,
        [projectId, changeSetId, JSON.stringify(stale), updatedAt],
      );
      await client.query('COMMIT');
      return stale;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findApprovedManifest(
    projectId: string,
    changeSetId: string,
  ): Promise<ApprovedChangeSetManifest | undefined> {
    const result = await this.pool.query<ChangeSetRow>(
      `${changeSetSelect} WHERE project_id = $1 AND change_set_id = $2`,
      [projectId, changeSetId],
    );
    return result.rows[0]?.manifest_json ?? undefined;
  }

  // FE-P5-S2 WP5 (Round 4 Option 1): owning-Domain Reversal durable authority
  // (additive `review.reversals` record set, migration 033).
  async saveReversal(reversal: ReversalDraftChangeSetV1): Promise<ReversalDraftChangeSetV1> {
    const inserted = await this.pool.query<ReversalRow>(
      `
        INSERT INTO review.reversals (reversal_id, project_id, reversal_json, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (reversal_id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          reversal_json = EXCLUDED.reversal_json,
          created_at = EXCLUDED.created_at
        RETURNING reversal_json
      `,
      [
        reversal.reversalId,
        reversal.resourceProjectId,
        JSON.stringify(reversal),
        reversal.createdAt,
      ],
    );
    return inserted.rows[0]?.reversal_json ?? reversal;
  }

  async findReversalById(
    projectId: string,
    reversalId: string,
  ): Promise<ReversalDraftChangeSetV1 | undefined> {
    const result = await this.pool.query<ReversalRow>(
      `
        SELECT reversal_json
        FROM review.reversals
        WHERE project_id = $1 AND reversal_id = $2
      `,
      [projectId, reversalId],
    );
    return result.rows[0]?.reversal_json;
  }

  async listReversals(projectId: string): Promise<readonly ReversalDraftChangeSetV1[]> {
    const result = await this.pool.query<ReversalRow>(
      `
        SELECT reversal_json
        FROM review.reversals
        WHERE project_id = $1
        ORDER BY created_at, reversal_id
      `,
      [projectId],
    );
    return result.rows.map((row) => row.reversal_json);
  }
}

/** Additive durable store for the v2 Review Draft boundary. */
export class PostgresChangeSetReviewV2Repository implements ReviewV2RepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveDraft(draft: DraftChangeSetV2): Promise<DraftChangeSetV2> {
    validateDraftChangeSetV2(draft);
    const inserted = await this.pool.query<ChangeSetV2Row>(
      `
        INSERT INTO review.change_sets_v2 (
          change_set_id, project_id, candidate_id, comparison_id, revision_number,
          status, content_digest, expected_canonical_version, snapshot_digest,
          change_set_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (project_id, comparison_id) DO NOTHING
        RETURNING change_set_json
      `,
      [
        draft.changeSetId,
        draft.projectId,
        draft.candidate.id,
        draft.comparisonId,
        draft.revisionNumber,
        draft.status,
        draft.contentDigest,
        draft.expectedCanonicalVersion,
        draft.snapshotDigest,
        JSON.stringify(draft),
        draft.createdAt,
        draft.updatedAt,
      ],
    );
    if (inserted.rows[0]) return inserted.rows[0].change_set_json;

    const existing = await this.findDraftByComparisonId(draft.projectId, draft.comparisonId);
    if (!existing) throw new Error('v2 Draft Change Set was not stored.');
    if (stableJson(existing) !== stableJson(draft)) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The same v2 Comparison produced a different Draft Change Set.',
        module: 'postgres-stage5',
        operation: 'save-draft-change-set-v2',
      });
    }
    return existing;
  }

  async findDraftByComparisonId(
    projectId: string,
    comparisonId: string,
  ): Promise<DraftChangeSetV2 | undefined> {
    const result = await this.pool.query<ChangeSetV2Row>(
      `
        SELECT change_set_json
        FROM review.change_sets_v2
        WHERE project_id = $1 AND comparison_id = $2
      `,
      [projectId, comparisonId],
    );
    const draft = result.rows[0]?.change_set_json;
    if (draft) validateDraftChangeSetV2(draft);
    return draft;
  }
}
