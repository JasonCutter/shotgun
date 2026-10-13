import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  NodeUrlResolver,
  NodeUrlHopTransport,
} from '../../adapters/url-acquisition-node/src/index.js';
import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import {
  answerCitations,
  createVPFullApplicationFixture,
  waitForProduct,
} from '../helpers/vp-full-application-fixture.js';

const target = await requireTestDatabaseTarget();
const question = 'What are the quasar archive count and access conditions?';

it.skipIf(!target)(
  'uses the actual application for A/B/revision citations and immutable historical AnswerRun freshness',
  async () => {
    const f = await createVPFullApplicationFixture();
    try {
      const a = await f.submit('The quasar archive contains 42 records.', 'A.txt');
      const old = await f.ask(question);
      expect(answerCitations(old).some((c) => c.sourceVersionId === a.sourceVersionId)).toBe(true);
      const history = async () =>
        (
          await f.pool.query(
            `SELECT jsonb_build_object('run',to_jsonb(r),
        'statements',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.ordinal) FROM frontend_ask.statements s WHERE s.answer_run_id=r.answer_run_id),
        'citations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.citation_id) FROM frontend_ask.citations c JOIN frontend_ask.statements s USING(statement_id) WHERE s.answer_run_id=r.answer_run_id),
        'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attempt_number) FROM frontend_ask.answer_run_attempts a WHERE a.answer_run_id=r.answer_run_id)) AS history
       FROM frontend_ask.answer_runs r WHERE r.answer_run_id=$1 AND r.project_id=$2`,
            [old.answerRunId, f.projectId],
          )
        ).rows[0]!.history;
      const recorded = await history();
      const b = await f.submit('The quasar archive is accessible only to licensed users.', 'B.txt');
      const both = await f.ask(question);
      expect(answerCitations(both).some((c) => c.sourceVersionId === b.sourceVersionId)).toBe(true);
      const updated = await f.submit(
        'The quasar archive contains 43 records.',
        'A.txt',
        a.sourceId,
      );
      expect(updated.sourceId).toBe(a.sourceId);
      expect(updated.sourceVersionId).not.toBe(a.sourceVersionId);
      const current = await f.ask(question);
      const cited = answerCitations(current);
      expect(cited.some((c) => c.sourceVersionId === updated.sourceVersionId)).toBe(true);
      expect(cited.some((c) => c.sourceVersionId === b.sourceVersionId)).toBe(true);
      expect(cited.some((c) => c.sourceVersionId === a.sourceVersionId)).toBe(false);
      expect(JSON.stringify(current.statements)).not.toContain('42 records');
      const historical = await f.getAnswer(old.answerRunId);
      expect(historical.stale).toBe(true);
      expect(historical.state).toBe('SUCCEEDED');
      expect(historical.statements).toEqual(old.statements);
      expect(historical.answerRevision).toBe(old.answerRevision);
      expect(historical.capabilities).toEqual(old.capabilities);
      expect((await f.getAnswer(current.answerRunId)).stale).toBe(false);
      expect(await history()).toEqual(recorded);
      for (const citation of cited) {
        const row = (
          await f.pool.query(
            'SELECT project_id, source_id::text, source_version_id::text FROM evidence.spans WHERE evidence_id=$1',
            [citation.evidenceId],
          )
        ).rows[0];
        expect(row).toMatchObject({
          project_id: f.projectId,
          source_id: citation.sourceId,
          source_version_id: citation.sourceVersionId,
        });
      }
      const bindings = await waitForProduct(
        async () => {
          const rows = (
            await f.pool.query(
              'SELECT job.policy_revision,call.global_claim_id,call.semantic_attempt_id FROM vp.relation_provider_calls call JOIN vp.relation_jobs job USING(project_id,job_id) WHERE call.project_id=$1',
              [f.projectId],
            )
          ).rows;
          return rows.length > 0 ? rows : undefined;
        },
        'actual relation worker durable claim/attempt binding',
        75_000,
      );
      expect(bindings.length).toBeGreaterThan(0);
      expect(
        bindings.every(
          (b) =>
            b.policy_revision === 'vp-deepseek-relation-v6-evidence-context' &&
            b.global_claim_id &&
            b.semantic_attempt_id,
        ),
      ).toBe(true);
      f.assertNoLiveEgress();
    } finally {
      await f.cleanup();
    }
  },
  180_000,
);

it.skipIf(!target)(
  'automatically refreshes the same AnswerRun after an in-flight Source revision without republishing the stale response',
  async () => {
    const f = await createVPFullApplicationFixture();
    const gate = f.holdNextAnswer();
    try {
      const old = await f.submit('The quasar archive contains 42 records.', 'A.txt');
      const runId = await f.startAsk(question);
      await waitForProduct(
        async () => (gate.isEntered() ? true : undefined),
        'fake answer entered',
      );
      const revised = await f.submit(
        'The quasar archive contains 43 records after correction.',
        'A.txt',
        old.sourceId,
      );
      gate.release();
      const answer = await f.waitAnswer(runId);
      expect(answer.answerRunId).toBe(runId);
      expect(answer.attemptNumber).toBe(2);
      expect(
        answerCitations(answer).some((c) => c.sourceVersionId === revised.sourceVersionId),
      ).toBe(true);
      expect(answerCitations(answer).some((c) => c.sourceVersionId === old.sourceVersionId)).toBe(
        false,
      );
      const attempts = (
        await f.pool.query(
          'SELECT attempt_number,attempt_kind,state,failure_code,failure_outcome_unknown,resolved_context_digest FROM frontend_ask.answer_run_attempts WHERE answer_run_id=$1 ORDER BY attempt_number',
          [runId],
        )
      ).rows;
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toMatchObject({
        attempt_number: 1,
        state: 'FAILED',
        failure_code: 'STALE_VERSION',
        failure_outcome_unknown: false,
      });
      expect(attempts[1]).toMatchObject({
        attempt_number: 2,
        attempt_kind: 'RETRY_CURRENT_POLICY',
        state: 'SUCCEEDED',
      });
      expect(attempts[1].resolved_context_digest).not.toBe(attempts[0].resolved_context_digest);
      expect(
        (
          await f.pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.answer_runs WHERE project_id=$1',
            [f.projectId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(f.calls.filter((c) => c.kind === 'answer')).toHaveLength(2);
      f.assertNoLiveEgress();
    } finally {
      gate.release();
      await f.cleanup();
    }
  },
  180_000,
);

it.skipIf(!target)(
  'refreshes an expired URL through the actual worker and command gateway with fake bounded acquisition',
  async () => {
    let firstReceipt = true,
      requests = 0;
    let body =
      '<html><body><p>The comet collection contains 18 records.</p><script>fetch("https://evil.invalid")</script></body></html>';
    const resolve = vi
      .spyOn(NodeUrlResolver.prototype, 'resolve')
      .mockResolvedValue(['93.184.216.34']);
    const transport = vi
      .spyOn(NodeUrlHopTransport.prototype, 'request')
      .mockImplementation(async () => {
        requests++;
        return {
          status: 200,
          connectedAddress: '93.184.216.34',
          headers: { 'content-type': 'text/html' },
          body: Buffer.from(body),
          compressedBytes: Buffer.byteLength(body),
        };
      });
    // Test-only clock at receipt creation preserves immutable provenance; no
    // stored acquisition timestamp or operating receipt is subsequently changed.
    const prototype = SealedSourcesStagingService.prototype as unknown as {
      authoritativeNow(): Promise<Date>;
    };
    const originalClock = prototype.authoritativeNow;
    const clock = vi.spyOn(prototype, 'authoritativeNow').mockImplementation(async function (
      this: SealedSourcesStagingService,
    ) {
      return firstReceipt ? new Date(Date.now() - 25 * 60 * 60 * 1000) : originalClock.call(this);
    });
    let f: Awaited<ReturnType<typeof createVPFullApplicationFixture>> | undefined;
    try {
      f = await createVPFullApplicationFixture({ sourceRefresh: true });
      const draftId = randomUUID(),
        itemId = randomUUID();
      const staged = await f.request<{ receipt: { stagingReference: string } }>(
        'POST',
        '/product-api/frontend/sources/staging/url',
        { draftId, itemId, label: 'Comet URL', requestedUrl: 'https://example.org/comet.html' },
      );
      firstReceipt = false;
      body =
        '<html><body><p>The comet collection contains 19 records after correction.</p></body></html>';
      const initial = await f.submitStaged(draftId, [
        {
          itemId,
          kind: 'URL',
          label: 'Comet URL',
          stagingReference: staged.receipt.stagingReference,
        },
      ]);
      const fixture = f;
      const refreshed = await waitForProduct(async () => {
        const job = (
          await fixture.pool.query(
            'SELECT phase,command_id,submission_id,produced_source_version_id,attempts FROM source_product.url_refresh_jobs WHERE source_id=$1',
            [initial.sourceId],
          )
        ).rows[0];
        if (job?.phase === 'FAILED' || job?.phase === 'OUTCOME_UNKNOWN')
          throw new Error(`Refresh failed: ${job.phase}`);
        return job?.phase === 'SUCCEEDED' ? job : undefined;
      }, 'actual URL refresh worker');
      const ledger = (
        await f.pool.query(
          'SELECT outcome_state,completion_disposition,produced_resources FROM frontend_command.command_ledger WHERE command_id=$1',
          [refreshed.command_id],
        )
      ).rows[0];
      expect(ledger).toMatchObject({
        outcome_state: 'COMPLETED',
        completion_disposition: 'SUCCEEDED',
      });
      expect(ledger.produced_resources[0].resourceId).toBe(refreshed.submission_id);
      expect(refreshed.attempts).toBe(1);
      expect(requests).toBe(2);
      const versions = (
        await f.pool.query(
          'SELECT source_version_id::text FROM asset.source_versions WHERE source_id=$1 ORDER BY version_number',
          [initial.sourceId],
        )
      ).rows;
      expect(versions).toHaveLength(2);
      expect(versions[0].source_version_id).toBe(initial.sourceVersionId);
      expect(versions[1].source_version_id).toBe(refreshed.produced_source_version_id);
      const answer = await f.ask('What is the comet collection count?');
      expect(
        answerCitations(answer).some(
          (c) => c.sourceVersionId === refreshed.produced_source_version_id,
        ),
      ).toBe(true);
      expect(
        answerCitations(answer).some((c) => c.sourceVersionId === initial.sourceVersionId),
      ).toBe(false);
      expect(JSON.stringify(answer.statements)).not.toContain('evil.invalid');
      f.assertNoLiveEgress();
    } finally {
      await f?.cleanup();
      resolve.mockRestore();
      transport.mockRestore();
      clock.mockRestore();
    }
  },
  180_000,
);
