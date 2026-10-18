import { expect, it } from 'vitest';

import { PostgresVPAskEvidenceSearch } from '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { verifyVPProjectionReplay } from '../../scripts/vp-projection-replay.js';
import {
  answerCitations,
  createVPFullApplicationFixture,
  waitForProduct,
} from '../helpers/vp-full-application-fixture.js';

const target = await requireTestDatabaseTarget();
const revision = 'vp-deepseek-relation-v6-evidence-context';
const question = 'quasar';

const preparePair = async (f: Awaited<ReturnType<typeof createVPFullApplicationFixture>>) => {
  const a = await f.submit('The quasar catalogue contains 42 items.', 'quasar-count.txt');
  const b = await f.submit('The quasar archive contains 19 cabinets.', 'quasar-archive.txt');
  const evidenceIds = await waitForProduct(async () => {
    const rows = await f.pool.query<{ source_version_id: string; evidence_id: string }>(
      `SELECT source_version_id::text,evidence_id::text
         FROM vp.current_assertions WHERE project_id=$1
           AND source_version_id::text=ANY($2::text[])`,
      [f.projectId, [a.sourceVersionId, b.sourceVersionId]],
    );
    const ids = new Set(rows.rows.map((row) => row.source_version_id));
    return ids.has(a.sourceVersionId) && ids.has(b.sourceVersionId)
      ? rows.rows.map((row) => row.evidence_id)
      : undefined;
  }, 'two current source assertions');
  expect(evidenceIds).toHaveLength(2);
  return evidenceIds;
};

const currentJob = async (f: Awaited<ReturnType<typeof createVPFullApplicationFixture>>) =>
  f.pool.query<{
    status: string;
    attempt_count: number;
    last_failure_code: string | null;
  }>(
    'SELECT status,attempt_count,last_failure_code FROM vp.relation_jobs WHERE project_id=$1 AND policy_revision=$2',
    [f.projectId, revision],
  );

it.skipIf(!target)(
  'answers from both ready sources while the normal v6 relation frontier is budget paused',
  async () => {
    const f = await createVPFullApplicationFixture();
    try {
      // Synthetic authority saturation precedes the second Source; no relation
      // call or clock manipulation is needed to keep the real worker pending.
      await f.authority.query(
        `INSERT INTO vp_global_budget.daily_usage(authority_id,budget_day,claimed_count)
         VALUES($1,vp_global_budget.current_budget_day(),100)
         ON CONFLICT(authority_id,budget_day) DO UPDATE SET claimed_count=100`,
        [f.authorityId],
      );
      const evidenceIds = await preparePair(f);
      await f.restart();
      const pending = await waitForProduct(async () => {
        const rows = (await currentJob(f)).rows;
        return rows.length > 0 &&
          rows.every(
            (row) =>
              row.status === 'RETRYABLE' &&
              row.last_failure_code === 'RELATION_BUDGET_PAUSED:EXHAUSTED',
          )
          ? rows
          : undefined;
      }, 'budget-paused relation jobs');
      expect(pending).toHaveLength(1);
      expect(pending.every((row) => row.attempt_count === 0)).toBe(true);
      expect(f.calls.filter((call) => call.kind === 'relation')).toHaveLength(0);
      const claims = await f.authority.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM vp_global_budget.claims WHERE authority_id=$1',
        [f.authorityId],
      );
      expect(claims.rows[0]?.count).toBe('0');
      const run = await f.ask(question);
      expect(run.state).toBe('SUCCEEDED');
      for (const id of evidenceIds) {
        expect(answerCitations(run).map((item) => item.evidenceId)).toContain(id);
      }
      const usage = await f.authority.query<{ claimed_count: number }>(
        `SELECT claimed_count FROM vp_global_budget.daily_usage
         WHERE authority_id=$1 AND budget_day=vp_global_budget.current_budget_day()`,
        [f.authorityId],
      );
      expect(usage.rows).toEqual([{ claimed_count: 100 }]);
      expect((await f.pool.query('SELECT call_id FROM vp.relation_provider_calls')).rows).toEqual(
        [],
      );
      const replay = await verifyVPProjectionReplay(f.pool, f.projectId);
      expect(replay).toMatchObject({
        historyValid: true,
        sourceProcessingComplete: true,
        candidateMaterializationComplete: true,
        relationQueueSettled: false,
        relationQueueComplete: false,
      });
      expect(replay.pendingRelationJobs).toBeGreaterThan(0);
      expect(replay.matches).toBe(false);
      f.assertNoLiveEgress();
    } finally {
      await f.cleanup();
    }
  },
  180_000,
);

it.skipIf(!target)(
  'keeps a terminal v6 UNRESOLVED relation distinct from a missing Ask answer or NO_RELATION',
  async () => {
    const f = await createVPFullApplicationFixture({
      relationFake: async () => ({
        rawText: JSON.stringify({
          choice: 'UNRESOLVED',
          direction: 'NONE',
          confidence: 1,
          probabilities: {
            EQUIVALENT: 0,
            SUPPORTS: 0,
            QUALIFIES: 0,
            CONTRADICTS: 0,
            RELATED: 0,
            UNRESOLVED: 1,
          },
        }),
        providerResponseId: 'fake-v6-unresolved',
        modelVersion: 'fake-no-semantic-certification',
        inputTokens: 10,
        outputTokens: 10,
      }),
    });
    try {
      const evidenceIds = await preparePair(f);
      await f.restart();
      const completed = await waitForProduct(async () => {
        const rows = (await currentJob(f)).rows;
        return rows.length > 0 && rows.every((row) => row.status === 'COMPLETED')
          ? rows
          : undefined;
      }, 'terminal relation abstention');
      expect(completed).toHaveLength(1);
      expect(completed.every((row) => row.attempt_count === 1)).toBe(true);
      expect(completed.every((row) => row.last_failure_code === 'INSUFFICIENT_EVIDENCE')).toBe(
        true,
      );
      const calls = await f.pool.query<{ state: string; choice: string }>(
        `SELECT state,output_json->>'choice' AS choice
           FROM vp.relation_provider_calls WHERE project_id=$1`,
        [f.projectId],
      );
      expect(calls.rows).toHaveLength(completed.length);
      expect(
        calls.rows.every((row) => row.state === 'OUTPUT_STORED' && row.choice === 'UNRESOLVED'),
      ).toBe(true);
      const receipts = await f.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM vp.decision_receipts WHERE project_id=$1',
        [f.projectId],
      );
      const edges = await f.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM vp.current_relations WHERE project_id=$1',
        [f.projectId],
      );
      expect(receipts.rows[0]?.count).toBe('0');
      expect(edges.rows[0]?.count).toBe('0');
      const claims = await f.authority.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM vp_global_budget.claims WHERE authority_id=$1',
        [f.authorityId],
      );
      expect(Number(claims.rows[0]?.count)).toBe(completed.length);
      expect(f.calls.filter((call) => call.kind === 'relation')).toHaveLength(completed.length);
      const run = await f.ask(question);
      expect(run.state).toBe('SUCCEEDED');
      for (const id of evidenceIds) {
        expect(answerCitations(run).map((item) => item.evidenceId)).toContain(id);
      }
      const publicSearch = await new PostgresVPAskEvidenceSearch(f.pool).search({
        projectId: f.projectId,
        question,
        accessScope: ['owner'],
        authorizedSensitivities: ['public'],
        limit: 12,
      });
      expect(publicSearch.evidenceIds).toEqual([]);
      const replay = await verifyVPProjectionReplay(f.pool, f.projectId);
      expect(replay).toMatchObject({ historyValid: true, currentRelations: 0 });
      f.assertNoLiveEgress();
    } finally {
      await f.cleanup();
    }
  },
  180_000,
);
