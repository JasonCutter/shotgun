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
  readonly status: string;
  readonly validation_status: string | null;
};
type AssertionRow = QueryResultRow & {
  readonly assertion_id: string;
  readonly candidate_id: string;
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

const orderedPair = (left: string, right: string): string => `${left}:${right}`;

/** Independent read-only reconstruction from durable VP inputs and history. */
export async function verifyVPProjectionReplay(
  pool: Pool,
  projectId: string,
): Promise<{
  readonly matches: boolean;
  readonly historyValid: boolean;
  readonly expectedAssertions: number;
  readonly currentAssertions: number;
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
                candidate.status, validation.status AS validation_status
           FROM candidate.claim_candidates AS candidate
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
        `SELECT assertion_id::text, candidate_id::text
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
    for (const version of latestVersions.values()) {
      if (version.stage3_state !== 'STAGE3_COMPLETED' || !version.revision_id) continue;
      const eligible = batches
        .filter(
          (batch) =>
            batch.source_version_id === version.source_version_id &&
            batch.revision_id === version.revision_id &&
            (candidateByBatch.get(batch.batch_id) ?? []).every(
              (candidate) =>
                candidate.status !== 'PENDING_VALIDATION' &&
                candidate.status === candidate.validation_status &&
                (candidate.status !== 'READY' || assertionByCandidate.has(candidate.candidate_id)),
            ),
        )
        .sort(
          (left, right) =>
            right.created_at.getTime() - left.created_at.getTime() ||
            right.batch_id.localeCompare(left.batch_id),
        );
      const selected = eligible[0];
      if (!selected) continue;
      for (const candidate of candidateByBatch.get(selected.batch_id) ?? []) {
        const assertionId = assertionByCandidate.get(candidate.candidate_id)?.assertion_id;
        if (candidate.status === 'READY' && assertionId) expectedAssertions.add(assertionId);
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
        sameIds(expectedAssertions, actualAssertions) &&
        sameIds(expectedRelations, actualRelations),
      historyValid,
      expectedAssertions: expectedAssertions.size,
      currentAssertions: actualAssertions.size,
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
