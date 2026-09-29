import type { Pool, QueryResultRow } from 'pg';

type VersionRow = QueryResultRow & {
  readonly source_id: string;
  readonly source_version_id: string;
  readonly version_number: number;
  readonly stage3_state: string | null;
  readonly revision_id: string | null;
};
type BatchRow = QueryResultRow & {
  readonly batch_id: string;
  readonly source_version_id: string;
  readonly revision_id: string;
  readonly created_at: Date;
};
type CandidateRow = QueryResultRow & {
  readonly candidate_id: string;
  readonly batch_id: string;
  readonly source_version_id: string;
  readonly revision_number: number;
  readonly claim_text: string;
  readonly evidence_id: string;
  readonly evidence_source_id: string | null;
  readonly evidence_source_version_id: string | null;
  readonly evidence_revision_id: string | null;
  readonly evidence_exact: string | null;
  readonly evidence_access_scope: string[] | null;
  readonly evidence_sensitivity: string | null;
  readonly candidate_access_scope: string[];
  readonly candidate_sensitivity: string;
  readonly status: string;
  readonly validation_status: string | null;
};
type AssertionRow = QueryResultRow & {
  readonly assertion_id: string;
  readonly candidate_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly evidence_id: string;
  readonly claim_text: string;
  readonly access_scope: string[];
  readonly sensitivity: string;
};
type EventRow = QueryResultRow & {
  readonly epoch: string;
  readonly event_kind: string;
  readonly assertion_id: string;
  readonly relation_ids: string[];
};
type RelationRow = QueryResultRow & {
  readonly relation_id: string;
  readonly left_assertion_id: string;
  readonly right_assertion_id: string;
  readonly decision_created_at: Date;
};
type UnresolvedRow = QueryResultRow & {
  readonly left_assertion_id: string;
  readonly right_assertion_id: string;
  readonly updated_at: Date;
};

const sameIds = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((id) => right.has(id));

const sameStrings = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

const assertionMatchesCandidate = (
  candidate: CandidateRow,
  version: VersionRow,
  assertion: AssertionRow | undefined,
): boolean => {
  if (!assertion) return false;
  const validEvidence =
    candidate.evidence_source_id !== null &&
    candidate.evidence_source_version_id === version.source_version_id &&
    candidate.evidence_revision_id === version.revision_id &&
    candidate.evidence_exact !== null &&
    candidate.evidence_access_scope !== null &&
    candidate.evidence_sensitivity !== null &&
    candidate.claim_text.length > 0 &&
    candidate.evidence_exact.includes(candidate.claim_text) &&
    sameStrings(candidate.evidence_access_scope, candidate.candidate_access_scope) &&
    candidate.evidence_sensitivity === candidate.candidate_sensitivity;
  return (
    validEvidence &&
    assertion.source_id === candidate.evidence_source_id &&
    assertion.source_version_id === candidate.source_version_id &&
    assertion.evidence_id === candidate.evidence_id &&
    assertion.claim_text === candidate.claim_text &&
    sameStrings(assertion.access_scope, candidate.candidate_access_scope) &&
    assertion.sensitivity === candidate.candidate_sensitivity
  );
};

const orderedPair = (left: string, right: string): string => `${left}:${right}`;

/** Independent read-only reconstruction from current SourceVersion and durable Stage 4/VP records. */
export async function verifyVPProjectionReplay(
  pool: Pool,
  projectId: string,
): Promise<{
  readonly matches: boolean;
  readonly historyValid: boolean;
  readonly expectedAssertions: number;
  readonly currentAssertions: number;
  readonly expectedReadyCandidates: number;
  readonly ledgeredReadyCandidates: number;
  readonly sourceProcessingComplete: boolean;
  readonly candidateMaterializationComplete: boolean;
  readonly relationQueueSettled: boolean;
  readonly pendingRelationJobs: number;
  readonly expectedRelations: number;
  readonly currentRelations: number;
  readonly historyCounts: {
    readonly epoch: number;
    readonly events: number;
    readonly directEvents: number;
    readonly assertions: number;
    readonly relationEvents: number;
    readonly relations: number;
  };
  readonly historyChecks: {
    readonly epochsContiguous: boolean;
    readonly firstEpochMismatch: { readonly expected: number; readonly actual: number } | null;
    readonly assertionEventsMatch: boolean;
    readonly relationEventsMatch: boolean;
  };
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const versions = (
      await client.query<VersionRow>(
        `SELECT version.source_id::text, version.source_version_id::text,
                version.version_number, progress.state AS stage3_state,
                indexing.revision_id::text
           FROM asset.source_versions AS version
           JOIN asset.sources AS source ON source.source_id = version.source_id
           LEFT JOIN source_product.source_stage3_progress AS progress
             ON progress.project_id = source.project_id
            AND progress.source_version_id = version.source_version_id
           LEFT JOIN evidence.indexing_results AS indexing
             ON indexing.indexing_result_id = progress.indexing_result_id
          WHERE source.project_id = $1`,
        [projectId],
      )
    ).rows;
    const batches = (
      await client.query<BatchRow>(
        `SELECT batch_id::text, source_version_id::text, revision_id::text, created_at
           FROM candidate.batches WHERE project_id = $1`,
        [projectId],
      )
    ).rows;
    const candidates = (
      await client.query<CandidateRow>(
        `SELECT candidate.candidate_id::text, candidate.batch_id::text,
                candidate.source_version_id::text, candidate.revision_number,
                candidate.claim_text, candidate.evidence_id::text,
                evidence.source_id::text AS evidence_source_id,
                evidence.source_version_id::text AS evidence_source_version_id,
                evidence.revision_id::text AS evidence_revision_id,
                evidence.quote->>'exact' AS evidence_exact,
                evidence.access_scope AS evidence_access_scope,
                evidence.sensitivity AS evidence_sensitivity,
                candidate.access_scope AS candidate_access_scope,
                candidate.sensitivity AS candidate_sensitivity,
                candidate.status, validation.status AS validation_status
           FROM candidate.claim_candidates AS candidate
           LEFT JOIN evidence.spans AS evidence
             ON evidence.evidence_id = candidate.evidence_id
            AND evidence.project_id = candidate.project_id
            AND evidence.source_version_id = candidate.source_version_id
           LEFT JOIN validation.results AS validation
             ON validation.project_id = candidate.project_id
            AND validation.source_version_id = candidate.source_version_id
            AND validation.candidate_id = candidate.candidate_id
            AND validation.revision_number = candidate.revision_number
          WHERE candidate.project_id = $1`,
        [projectId],
      )
    ).rows;
    const assertions = (
      await client.query<AssertionRow>(
        `SELECT assertion_id::text, candidate_id::text, source_id::text,
                source_version_id::text, evidence_id::text, claim_text,
                access_scope, sensitivity
           FROM vp.assertions WHERE project_id = $1`,
        [projectId],
      )
    ).rows;
    const events = (
      await client.query<EventRow>(
        `SELECT history.epoch::text, history.event_kind,
                history.assertion_id::text, history.relation_ids::text[]
           FROM vp.history_events AS history
          WHERE history.project_id = $1 ORDER BY history.epoch`,
        [projectId],
      )
    ).rows;
    const relations = (
      await client.query<RelationRow>(
        `SELECT relation.relation_id::text, relation.left_assertion_id::text,
                relation.right_assertion_id::text,
                decision.created_at AS decision_created_at
           FROM vp.relations AS relation
           JOIN vp.decision_receipts AS decision
             ON decision.project_id = relation.project_id
            AND decision.decision_id = relation.decision_id
          WHERE relation.project_id = $1`,
        [projectId],
      )
    ).rows;
    const unresolved = (
      await client.query<UnresolvedRow>(
        `SELECT left_assertion_id::text, right_assertion_id::text, updated_at
           FROM vp.relation_jobs
          WHERE project_id = $1 AND status = 'COMPLETED'
            AND last_failure_code IN ('INSUFFICIENT_EVIDENCE', 'QUALIFIER_NOT_MODELED')`,
        [projectId],
      )
    ).rows;
    const actualAssertions = new Set(
      (
        await client.query<{ assertion_id: string }>(
          `SELECT assertion_id::text FROM vp.current_assertions WHERE project_id = $1`,
          [projectId],
        )
      ).rows.map((row) => row.assertion_id),
    );
    const actualRelations = new Set(
      (
        await client.query<{ relation_id: string }>(
          `SELECT relation_id::text FROM vp.current_relations WHERE project_id = $1`,
          [projectId],
        )
      ).rows.map((row) => row.relation_id),
    );
    const pendingRelationJobs = Number(
      (
        await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM vp.relation_jobs
            WHERE project_id = $1 AND status IN ('PENDING', 'RUNNING', 'RETRYABLE')`,
          [projectId],
        )
      ).rows[0]?.count ?? 0,
    );
    const epochRow = await client.query<{ current_epoch: string }>(
      `SELECT current_epoch::text FROM vp.project_epochs WHERE project_id = $1`,
      [projectId],
    );
    await client.query('COMMIT');

    const latestVersions = new Map<string, VersionRow>();
    for (const version of versions) {
      const current = latestVersions.get(version.source_id);
      if (!current || version.version_number > current.version_number) {
        latestVersions.set(version.source_id, version);
      }
    }
    const candidateByBatch = new Map<string, CandidateRow[]>();
    for (const candidate of candidates) {
      const batchCandidates = candidateByBatch.get(candidate.batch_id) ?? [];
      batchCandidates.push(candidate);
      candidateByBatch.set(candidate.batch_id, batchCandidates);
    }
    const assertionByCandidate = new Map(assertions.map((row) => [row.candidate_id, row]));
    const expectedAssertions = new Set<string>();
    let sourceProcessingComplete = true;
    let candidateMaterializationComplete = true;
    let expectedReadyCandidates = 0;
    let ledgeredReadyCandidates = 0;
    for (const version of latestVersions.values()) {
      if (version.stage3_state !== 'STAGE3_COMPLETED' || !version.revision_id) {
        sourceProcessingComplete = false;
        candidateMaterializationComplete = false;
        continue;
      }
      const versionBatches = batches
        .filter(
          (batch) =>
            batch.source_version_id === version.source_version_id &&
            batch.revision_id === version.revision_id,
        )
        .sort(
          (left, right) =>
            right.created_at.getTime() - left.created_at.getTime() ||
            right.batch_id.localeCompare(left.batch_id),
        );
      const latestBatch = versionBatches[0];
      if (!latestBatch) {
        candidateMaterializationComplete = false;
        continue;
      }
      for (const candidate of candidateByBatch.get(latestBatch.batch_id) ?? []) {
        if (candidate.status !== 'READY') continue;
        expectedReadyCandidates += 1;
        const assertion = assertionByCandidate.get(candidate.candidate_id);
        if (assertionMatchesCandidate(candidate, version, assertion)) {
          ledgeredReadyCandidates += 1;
        } else {
          candidateMaterializationComplete = false;
        }
      }
      const eligible = versionBatches.filter((batch) =>
        (candidateByBatch.get(batch.batch_id) ?? []).every(
          (candidate) =>
            candidate.status !== 'PENDING_VALIDATION' &&
            candidate.status === candidate.validation_status &&
            (candidate.status !== 'READY' || assertionByCandidate.has(candidate.candidate_id)),
        ),
      );
      const selected = eligible[0];
      if (!selected) {
        candidateMaterializationComplete = false;
        continue;
      }
      if (selected.batch_id !== latestBatch.batch_id) candidateMaterializationComplete = false;
      for (const candidate of candidateByBatch.get(selected.batch_id) ?? []) {
        if (candidate.status !== 'READY') continue;
        const assertion = assertionByCandidate.get(candidate.candidate_id);
        if (!assertion || !assertionMatchesCandidate(candidate, version, assertion)) {
          candidateMaterializationComplete = false;
          continue;
        }
        expectedAssertions.add(assertion.assertion_id);
      }
    }
    const latestRelationByPair = new Map<string, RelationRow>();
    for (const relation of relations) {
      if (
        !expectedAssertions.has(relation.left_assertion_id) ||
        !expectedAssertions.has(relation.right_assertion_id)
      )
        continue;
      const pair = orderedPair(relation.left_assertion_id, relation.right_assertion_id);
      const previous = latestRelationByPair.get(pair);
      if (
        !previous ||
        relation.decision_created_at.getTime() > previous.decision_created_at.getTime() ||
        (relation.decision_created_at.getTime() === previous.decision_created_at.getTime() &&
          relation.relation_id > previous.relation_id)
      )
        latestRelationByPair.set(pair, relation);
    }
    const expectedRelations = new Set<string>();
    for (const relation of latestRelationByPair.values()) {
      const pair = orderedPair(relation.left_assertion_id, relation.right_assertion_id);
      if (
        unresolved.some(
          (job) =>
            orderedPair(job.left_assertion_id, job.right_assertion_id) === pair &&
            job.updated_at.getTime() >= relation.decision_created_at.getTime(),
        )
      )
        continue;
      expectedRelations.add(relation.relation_id);
    }
    const directEventIds = events
      .filter((event) => event.event_kind === 'DIRECT_ASSERTION_RECORDED')
      .map((event) => event.assertion_id);
    const recordedRelationIds = events.flatMap((event) => event.relation_ids);
    const mismatchIndex = events.findIndex((event, index) => Number(event.epoch) !== index + 1);
    const epochsContiguous =
      events.every((event, index) => Number(event.epoch) === index + 1) &&
      Number(epochRow.rows[0]?.current_epoch ?? 0) === events.length;
    const assertionEventsMatch =
      directEventIds.length === assertions.length &&
      sameIds(new Set(directEventIds), new Set(assertions.map((row) => row.assertion_id)));
    const relationEventsMatch =
      recordedRelationIds.length === relations.length &&
      sameIds(new Set(recordedRelationIds), new Set(relations.map((row) => row.relation_id)));
    const historyValid = epochsContiguous && assertionEventsMatch && relationEventsMatch;
    return {
      matches:
        historyValid &&
        sourceProcessingComplete &&
        candidateMaterializationComplete &&
        pendingRelationJobs === 0 &&
        sameIds(expectedAssertions, actualAssertions) &&
        sameIds(expectedRelations, actualRelations),
      historyValid,
      expectedAssertions: expectedAssertions.size,
      currentAssertions: actualAssertions.size,
      expectedReadyCandidates,
      ledgeredReadyCandidates,
      sourceProcessingComplete,
      candidateMaterializationComplete,
      relationQueueSettled: pendingRelationJobs === 0,
      pendingRelationJobs,
      expectedRelations: expectedRelations.size,
      currentRelations: actualRelations.size,
      historyCounts: {
        epoch: Number(epochRow.rows[0]?.current_epoch ?? 0),
        events: events.length,
        directEvents: directEventIds.length,
        assertions: assertions.length,
        relationEvents: recordedRelationIds.length,
        relations: relations.length,
      },
      historyChecks: {
        epochsContiguous,
        firstEpochMismatch:
          mismatchIndex < 0
            ? null
            : { expected: mismatchIndex + 1, actual: Number(events[mismatchIndex]?.epoch) },
        assertionEventsMatch,
        relationEventsMatch,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
