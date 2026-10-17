import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresVPAskEvidenceSearch } from '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import {
  EXPLICIT_NEGATIVE_CHOICES,
  type ExplicitNegativeChoice,
} from '../../modules/vp-decision/src/explicit-negative-isolated.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { verifyVPProjectionReplay } from '../../scripts/vp-projection-replay.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';
import {
  answerCitations,
  createVPFullApplicationFixture,
  waitForProduct,
} from '../helpers/vp-full-application-fixture.js';

const target = await requireTestDatabaseTarget();
const r1 = 'vp-relation-v6-explicit-negative-product-fake-v1:r1';
const r2 = 'vp-relation-v6-explicit-negative-product-fake-v1:r2';
const question = 'quasar';
const artifactDirectory = path.join(
  process.env.VP_NEGATIVE_PRODUCT_TRACE_OUTPUT ??
    path.join(tmpdir(), `shotgun-negative-product-${process.pid}`),
  'runtime-tests',
);

const fakeResponse = (choice: ExplicitNegativeChoice) => ({
  rawText: JSON.stringify({
    choice,
    direction: choice === 'SUPPORTS' || choice === 'QUALIFIES' ? 'LEFT_TO_RIGHT' : 'NONE',
    confidence: 0.73,
    probabilities: Object.fromEntries(
      EXPLICIT_NEGATIVE_CHOICES.map((item) => [item, item === choice ? 1 : 0]),
    ),
  }),
  inputTokens: 20,
  outputTokens: 16,
});

it.skipIf(!target)(
  'withdraws a prior relation in the actual isolated application and preserves its history',
  async () => {
    const f = await createVPFullApplicationFixture({
      isolatedRelationPolicy: { revision: r1, expectedPreviousRevision: null },
    });
    try {
      const fake = f.relationFake!;
      fake.enqueue(fakeResponse('SUPPORTS'));
      const a = await f.submit('The quasar catalogue contains 42 items.', 'quasar-count.txt');
      const b = await f.submit('The archive vault contains 19 cabinets.', 'archive-cabinets.txt');
      const otherProject = `other-${randomUUID()}`;
      const owner = await new PostgresAuthRepository(f.pool).bootstrapLocalOwnerPrincipal({
        accountId: 'local-owner',
      });
      await new PostgresProjectAdministrationRepository(f.pool).createProject({
        commandId: randomUUID(),
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectId: otherProject,
        name: 'Other isolated project',
        actorPrincipalId: owner.principalId,
        expectedProjectRevision: 0,
      });
      for (const text of ['Another printer has duplex mode.', 'Another lake has a shore.']) {
        await seedAssertion(f.pool, {
          projectId: otherProject,
          principalId: owner.principalId,
          assertionId: randomUUID(),
          text,
        });
      }
      const evidenceId = async (sourceVersionId: string) =>
        (
          await f.pool.query<{ evidence_id: string }>(
            'SELECT evidence_id::text FROM vp.current_assertions WHERE project_id=$1 AND source_version_id=$2 LIMIT 1',
            [f.projectId, sourceVersionId],
          )
        ).rows[0]?.evidence_id;
      const aEvidence = await waitForProduct(
        () => evidenceId(a.sourceVersionId),
        'A current assertion',
      );
      const bEvidence = await waitForProduct(
        () => evidenceId(b.sourceVersionId),
        'B current assertion',
      );
      expect(aEvidence).toBeTruthy();
      expect(bEvidence).toBeTruthy();
      const search = new PostgresVPAskEvidenceSearch(f.pool);
      const query = (value: string) =>
        search.search({
          projectId: f.projectId,
          question: value,
          accessScope: ['owner'],
          // This fixture submits the normal private-by-default Source and acts
          // as its authenticated owner, as does the actual HTTP Ask below.
          authorizedSensitivities: ['public', 'internal', 'private', 'restricted'],
          limit: 12,
        });
      expect(
        (
          await search.search({
            projectId: f.projectId,
            question,
            accessScope: ['owner'],
            authorizedSensitivities: ['public'],
            limit: 12,
          })
        ).evidenceIds,
      ).toEqual([]);
      const positive = await waitForProduct(
        async () => {
          const row = (
            await f.pool.query<{ decision_id: string; provider_call_id: string; epoch: string }>(
              `SELECT d.decision_id::text,d.provider_call_id::text,h.epoch::text
               FROM vp.decision_receipts d JOIN vp.history_events h
                 ON h.project_id=d.project_id AND h.decision_id=d.decision_id
              WHERE d.project_id=$1 AND d.policy_revision=$2 AND d.outcome='SUPPORTS'`,
              [f.projectId, r1],
            )
          ).rows[0];
          return row && (await query(question)).evidenceIds.includes(bEvidence!) ? row : undefined;
        },
        'actual application positive relation and Ask neighbor',
        20_000,
      ).catch(async (error) => {
        const [jobs, calls, binding, receipts, currentRelations, assertions, ask] =
          await Promise.all([
            f.pool.query(
              'SELECT policy_revision,status,attempt_count,last_failure_code FROM vp.relation_jobs WHERE project_id=$1',
              [f.projectId],
            ),
            f.pool.query(
              "SELECT state,failure_code,output_json->>'contract' AS contract FROM vp.relation_provider_calls WHERE project_id=$1",
              [f.projectId],
            ),
            f.pool.query(
              'SELECT current_epoch,relation_policy_revision FROM vp.project_epochs WHERE project_id=$1',
              [f.projectId],
            ),
            f.pool.query(
              'SELECT outcome,left_assertion_id::text,right_assertion_id::text FROM vp.decision_receipts WHERE project_id=$1 AND policy_revision=$2',
              [f.projectId, r1],
            ),
            f.pool.query(
              'SELECT relation_kind,left_assertion_id::text,right_assertion_id::text FROM vp.current_relations WHERE project_id=$1',
              [f.projectId],
            ),
            f.pool.query(
              'SELECT assertion_id::text,source_version_id::text,evidence_id::text,claim_text FROM vp.current_assertions WHERE project_id=$1',
              [f.projectId],
            ),
            query(question),
          ]);
        throw new Error(
          `${String(error)}; diagnostic=${JSON.stringify({ jobs: jobs.rows, calls: calls.rows, binding: binding.rows, receipts: receipts.rows, currentRelations: currentRelations.rows, assertions: assertions.rows, ask: ask.evidenceIds, aEvidence, bEvidence, fakeCalls: fake.calls() })}`,
        );
      });
      expect(positive.provider_call_id).toBeTruthy();
      const replayBefore = await verifyVPProjectionReplay(f.pool, f.projectId, r1);
      expect(replayBefore).toMatchObject({
        matches: true,
        historyValid: true,
        expectedRelations: 1,
        currentRelations: 1,
      });
      const before = await f.ask(question);
      expect(answerCitations(before).some((citation) => citation.evidenceId === bEvidence)).toBe(
        true,
      );
      const historicalStatements = before.statements;
      const callsBefore = fake.calls();
      fake.enqueue(fakeResponse('NO_RELATION'));
      await f.restartWithRelationPolicy({ revision: r2, expectedPreviousRevision: r1 });
      const negative = await waitForProduct(
        async () => {
          const row = (
            await f.pool.query<{ decision_id: string; provider_call_id: string; epoch: string }>(
              `SELECT d.decision_id::text,d.provider_call_id::text,h.epoch::text
               FROM vp.decision_receipts d JOIN vp.history_events h
                 ON h.project_id=d.project_id AND h.decision_id=d.decision_id
              WHERE d.project_id=$1 AND d.policy_revision=$2 AND d.outcome='NO_RELATION'`,
              [f.projectId, r2],
            )
          ).rows[0];
          return row && !(await query(question)).evidenceIds.includes(bEvidence!) ? row : undefined;
        },
        'actual application negative receipt and Ask withdrawal',
        75_000,
      );
      expect(BigInt(negative.epoch)).toBeGreaterThan(BigInt(positive.epoch));
      expect(negative.provider_call_id).toBeTruthy();
      const replayAfter = await verifyVPProjectionReplay(f.pool, f.projectId, r2);
      expect(replayAfter).toMatchObject({
        matches: true,
        historyValid: true,
        expectedRelations: 0,
        currentRelations: 0,
        historyChecks: { negativeEventsMatch: true, policyBindingMatches: true },
      });
      expect((await query(question)).evidenceIds).toContain(aEvidence);
      expect((await query('archive vault cabinets')).evidenceIds).toContain(bEvidence);
      const after = await f.ask(question);
      expect(answerCitations(after).some((citation) => citation.evidenceId === bEvidence)).toBe(
        false,
      );
      expect((await f.getAnswer(before.answerRunId)).statements).toEqual(historicalStatements);
      const ledger = (
        await f.pool.query<{
          revision: string;
          current_edges: string;
          receipts: string;
          calls: string;
          jobs: string;
        }>(
          `SELECT (SELECT relation_policy_revision FROM vp.project_epochs WHERE project_id=$1) AS revision,
             (SELECT count(*)::text FROM vp.current_relations WHERE project_id=$1) AS current_edges,
             (SELECT count(*)::text FROM vp.decision_receipts WHERE project_id=$1 AND policy_revision IN ($2,$3)) AS receipts,
             (SELECT count(*)::text FROM vp.relation_provider_calls WHERE project_id=$1 AND state='OUTPUT_STORED') AS calls,
             (SELECT count(*)::text FROM vp.relation_jobs WHERE project_id=$1 AND status='COMPLETED' AND policy_revision IN ($2,$3)) AS jobs`,
          [f.projectId, r1, r2],
        )
      ).rows[0]!;
      expect(ledger).toMatchObject({
        revision: r2,
        current_edges: '0',
        receipts: '2',
        calls: '2',
        jobs: '2',
      });
      expect(
        (
          await f.pool.query(
            'SELECT 1 FROM vp.relation_jobs WHERE project_id=$1 AND policy_revision IN ($2,$3)',
            [otherProject, r1, r2],
          )
        ).rowCount,
      ).toBe(0);
      const claims = (
        await f.authority.query<{ claims: string }>(
          "SELECT count(*)::text AS claims FROM vp_global_budget.claims WHERE project_id=$1 AND state='PROVIDER_SUCCEEDED' AND execution_authorized_at IS NOT NULL",
          [f.projectId],
        )
      ).rows[0]!.claims;
      expect(claims).toBe('2');
      expect(fake.calls()).toBe(callsBefore + 1);
      const sameVersion = await f.restartWithRelationPolicy({
        revision: r2,
        expectedPreviousRevision: r1,
      });
      expect(sameVersion.askWorkerStarted).toBe(true);
      expect(fake.calls()).toBe(callsBefore + 1);
      expect((await query(question)).evidenceIds).not.toContain(bEvidence);
      const [jobs, calls, receipts, epochs, authorityClaims] = await Promise.all([
        f.pool.query(
          `SELECT job_id::text,project_id,policy_revision,status,attempt_count,last_failure_code
          FROM vp.relation_jobs WHERE project_id=$1 AND policy_revision IN ($2,$3) ORDER BY policy_revision`,
          [f.projectId, r1, r2],
        ),
        f.pool.query(
          `SELECT call_id::text,job_id::text,global_claim_id::text,semantic_attempt_id::text,
          provider_identity,state,output_json->>'contract' AS contract
          FROM vp.relation_provider_calls WHERE project_id=$1 ORDER BY created_at`,
          [f.projectId],
        ),
        f.pool.query(
          `SELECT decision_id::text,provider_call_id::text,policy_revision,outcome
          FROM vp.decision_receipts WHERE project_id=$1 AND policy_revision IN ($2,$3)
          ORDER BY policy_revision`,
          [f.projectId, r1, r2],
        ),
        f.pool.query(
          `SELECT epoch::text,event_kind,decision_id::text,policy_revision
          FROM vp.history_events WHERE project_id=$1 AND
          (event_kind='RELATION_POLICY_BOUND' OR decision_id IS NOT NULL) ORDER BY epoch`,
          [f.projectId],
        ),
        f.authority.query(
          `SELECT claim_id::text,relation_job_id::text,semantic_attempt_id::text,
          provider_identity,state,execution_authorized_at IS NOT NULL AS authorized
          FROM vp_global_budget.claims WHERE project_id=$1 ORDER BY claimed_at`,
          [f.projectId],
        ),
      ]);
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(
        path.join(artifactDirectory, 'actual-app-journey.json'),
        JSON.stringify(
          {
            scope: 'SYNTHETIC_ISOLATED_FAKE_NOT_SEMANTIC_QUALITY',
            projectId: f.projectId,
            policy: { initial: r1, active: r2 },
            globalAuthority: { storeId: f.storeId, authorityId: f.authorityId },
            jobs: jobs.rows,
            calls: calls.rows,
            receipts: receipts.rows,
            epochs: epochs.rows,
            authorityClaims: authorityClaims.rows,
            ask: {
              anchoredBefore: [aEvidence, bEvidence],
              anchoredAfter: (await query(question)).evidenceIds,
              directAfter: (await query('archive vault cabinets')).evidenceIds,
              historicalAnswerId: before.answerRunId,
              currentAnswerId: after.answerRunId,
              historicalCitationEvidenceIds: answerCitations(before).map((item) => item.evidenceId),
              currentCitationEvidenceIds: answerCitations(after).map((item) => item.evidenceId),
            },
            relationFakeCalls: fake.calls(),
            replay: { before: replayBefore, after: replayAfter },
            liveProviderCalls: 0,
          },
          null,
          2,
        ) + '\n',
      );
      f.assertNoLiveEgress();
    } finally {
      await f.cleanup();
    }
  },
  240_000,
);
