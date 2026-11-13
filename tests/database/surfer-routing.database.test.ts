import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import {
  PostgresSurferMeaningIntents,
  selectAutomaticMeaningInputs,
} from '../../adapters/surfer-ask-memory-postgres/src/meaning-auto.js';
import { PostgresSurferMeaningQueue } from '../../adapters/surfer-ask-memory-postgres/src/meaning-queue.js';
import { SurferMeaningQueueWorker } from '../../modules/surfer-execution/src/meaning-queue.js';
import { PostgresSurferAskMemory } from '../../adapters/surfer-ask-memory-postgres/src/index.js';
import { PostgresSurferMeaningVerification } from '../../adapters/surfer-ask-memory-postgres/src/meaning-verification.js';
import { PostgresSurferExecutionStore } from '../../adapters/surfer-execution-postgres/src/index.js';
import {
  ShotgunSurferCognitiveSource,
  ShotgunSurferSourceBridgeV2,
} from '../../adapters/surfer-shotgun-bridge/src/index.js';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import { providerFixture } from '../helpers/surfer-provider-contracts.js';
import {
  meaningWitness,
  meaningReviewWire,
  meaningReviewWireV2,
} from '../helpers/surfer-meaning-verifier-fixture.js';
import {
  SURFER_MEANING_VERIFIER_REVISION,
  SURFER_MEANING_VERIFIER_REVISION_V2,
} from '../../packages/contracts/src/surfer-meaning-verification.js';
import { SurferKnowledgeService } from '../../modules/surfer-core/src/index.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import { ruleReviewFixture } from '../helpers/surfer-rule-review-fixture.js';
import { StructuredAskAnswerProviderAdapter } from '../../adapters/ai-provider-ask/src/index.js';
import { pinSurferAskMemory } from '../../packages/contracts/src/surfer-ask-memory.js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresSurferSourceSession } from '../../adapters/surfer-shotgun-source-postgres/src/index.js';
import { PostgresSurferStorageCutover } from '../../adapters/surfer-storage-postgres/src/index.js';
import { createSurferApplicationRuntime } from '../../assemblies/shotgun-app/src/surfer-runtime.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { SurferDirectiveExtractionCodecV3 } from '../../adapters/surfer-structure-extraction/src/directive-v3.js';
import { unicodeLength } from '../../packages/contracts/src/document-evidence.js';
import { projectSurferHistory } from '../../packages/contracts/src/surfer-history.js';
import type { SurferKnowledgeState } from '../../packages/contracts/src/surfer-knowledge.js';
import type { SurferBindingStateV2 } from '../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferScopedRuleMemorySession } from '../../packages/contracts/src/surfer-rule-memory.js';
import { memoryFixture } from '../helpers/surfer-memory-fixture.js';
import {
  createSurferSourceFixture,
  migrateSurferSourceDatabase,
} from '../helpers/surfer-source-database.js';
import { buildBoundedWorker } from '../helpers/surfer-bounded-induction-fixture.js';
import { boundedSourceFixture } from '../helpers/surfer-bounded-source-fixture.js';
import { SurferBoundedRuleProofReader } from '../../adapters/surfer-document-memory/src/bounded-rule-proof.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import type { SurferAskSourceRequest } from '../../packages/contracts/src/surfer-source.js';

const target = process.env.SURFER_ISOLATED_DATABASE_URL;
let pool: Pool,
  principalId: string,
  migrationRollback = false,
  proposalMigrationRollback = false,
  meaningQueueMigrationRollback = false,
  meaningV2MigrationRollback = false;
describe.skipIf(!target)('Surfer app storage dispatcher and memory operations', () => {
  beforeAll(async () => {
    const u = new URL(target!);
    if (
      u.hostname !== '127.0.0.1' ||
      u.username !== 'surfer_test' ||
      u.pathname !== '/shotgun_test_surfer'
    )
      throw new Error('Disposable database only');
    const databaseUrl = await requireTestDatabaseTarget({
      environment: { ...process.env, TEST_DATABASE_URL: target },
    });
    pool = new Pool({ connectionString: databaseUrl, max: 5, statement_timeout: 15000 });
    await migrateSurferSourceDatabase(pool, '157_surfer_account_bootstrap.sql');
    const migration = await readFile(
        new URL('../../db/migrations/158_surfer_ask_memory_context.sql', import.meta.url),
        'utf8',
      ),
      client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration);
      expect(
        (await client.query("SELECT to_regclass('frontend_ask.surfer_memory_context') AS t"))
          .rows[0].t,
      ).not.toBeNull();
      await client.query('ROLLBACK');
      migrationRollback =
        (await client.query("SELECT to_regclass('frontend_ask.surfer_memory_context') AS t"))
          .rows[0].t === null;
      await client.query('BEGIN');
      await client.query(migration);
      await client.query('INSERT INTO runtime.schema_migrations(name) VALUES ($1)', [
        '158_surfer_ask_memory_context.sql',
      ]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const proposalSql = await readFile(
        new URL('../../db/migrations/159_surfer_ask_meaning_proposals.sql', import.meta.url),
        'utf8',
      ),
      c159 = await pool.connect();
    try {
      await c159.query('BEGIN');
      await c159.query(proposalSql);
      expect(
        (await c159.query("SELECT to_regclass('frontend_ask.surfer_meaning_proposals') AS t"))
          .rows[0].t,
      ).not.toBeNull();
      await c159.query('ROLLBACK');
      proposalMigrationRollback =
        (await c159.query("SELECT to_regclass('frontend_ask.surfer_meaning_proposals') AS t"))
          .rows[0].t === null;
      await c159.query('BEGIN');
      await c159.query(proposalSql);
      await c159.query('INSERT INTO runtime.schema_migrations(name) VALUES($1)', [
        '159_surfer_ask_meaning_proposals.sql',
      ]);
      await c159.query('COMMIT');
    } finally {
      c159.release();
    }
    const queueSql = await readFile(
        new URL('../../db/migrations/160_surfer_meaning_queue.sql', import.meta.url),
        'utf8',
      ),
      c160 = await pool.connect();
    try {
      await c160.query('BEGIN');
      await c160.query(queueSql);
      expect(
        (await c160.query("SELECT to_regclass('surfer_meaning.job') AS t")).rows[0].t,
      ).not.toBeNull();
      await c160.query('ROLLBACK');
      meaningQueueMigrationRollback =
        (await c160.query("SELECT to_regclass('surfer_meaning.job') AS t")).rows[0].t === null;
      await c160.query('BEGIN');
      await c160.query(queueSql);
      await c160.query('INSERT INTO runtime.schema_migrations(name) VALUES($1)', [
        '160_surfer_meaning_queue.sql',
      ]);
      await c160.query('COMMIT');
    } finally {
      c160.release();
    }
    const c161 = await pool.connect(),
      autoSql = await readFile(
        new URL('../../db/migrations/161_surfer_meaning_auto.sql', import.meta.url),
        'utf8',
      );
    try {
      await c161.query('BEGIN');
      await c161.query(autoSql);
      await c161.query('ROLLBACK');
      expect(
        (await c161.query("SELECT to_regclass('surfer_meaning.intent') t")).rows[0].t,
      ).toBeNull();
      await c161.query('BEGIN');
      await c161.query(autoSql);
      await c161.query(
        "INSERT INTO runtime.schema_migrations(name) VALUES('161_surfer_meaning_auto.sql')",
      );
      await c161.query('COMMIT');
    } finally {
      c161.release();
    }
    await pool.query(await readFile('db/migrations/162_surfer_root_renewal.sql', 'utf8'));
    await pool.query(
      "INSERT INTO runtime.schema_migrations(name) VALUES('162_surfer_root_renewal.sql')",
    );
    const c163 = await pool.connect(),
      sql163 = await readFile('db/migrations/163_surfer_meaning_review_v2.sql', 'utf8');
    try {
      const before = (
        await c163.query(
          "SELECT pg_get_functiondef('surfer_meaning.guard_job()'::regprocedure) AS def",
        )
      ).rows[0].def;
      await c163.query('BEGIN');
      await c163.query(sql163);
      expect(
        (
          await c163.query(
            "SELECT pg_get_functiondef('surfer_meaning.guard_job()'::regprocedure) AS def",
          )
        ).rows[0].def,
      ).toContain('surfer.meaning-cross-review.v2');
      await c163.query('ROLLBACK');
      meaningV2MigrationRollback =
        (
          await c163.query(
            "SELECT pg_get_functiondef('surfer_meaning.guard_job()'::regprocedure) AS def",
          )
        ).rows[0].def === before;
      await c163.query('BEGIN');
      await c163.query(sql163);
      await c163.query(
        "INSERT INTO runtime.schema_migrations(name) VALUES('163_surfer_meaning_review_v2.sql')",
      );
      await c163.query('COMMIT');
    } finally {
      c163.release();
    }
    const promptMigration = await pool.connect();
    try {
      const definition = async () =>
        (
          await promptMigration.query(
            "SELECT pg_get_functiondef('surfer_meaning.guard_job()'::regprocedure) AS def",
          )
        ).rows[0].def;
      for (const [file, version] of [
        ['164_surfer_meaning_review_prompt_v3.sql', 'v3'],
        ['165_surfer_meaning_review_prompt_v4.sql', 'v4'],
        ['166_surfer_meaning_review_prompt_v5.sql', 'v5'],
        ['167_surfer_meaning_review_prompt_v6.sql', 'v6'],
        ['168_surfer_meaning_review_prompt_v7.sql', 'v7'],
        ['169_surfer_meaning_review_prompt_v8.sql', 'v8'],
        ['170_surfer_meaning_review_prompt_v9.sql', 'v9'],
        ['171_surfer_meaning_review_prompt_v10.sql', 'v10'],
        ['172_surfer_meaning_review_prompt_v11.sql', 'v11'],
        ['173_surfer_meaning_review_prompt_v12.sql', 'v12'],
      ] as const) {
        const ddl = await readFile('db/migrations/' + file, 'utf8');
        const before = await definition();
        await promptMigration.query('BEGIN');
        await promptMigration.query(ddl);
        expect(await definition()).toContain('surfer-meaning-cross-review-' + version);
        expect(await definition()).toContain('surfer-meaning-cross-review-v3');
        await promptMigration.query('ROLLBACK');
        expect(await definition()).toBe(before);
        await promptMigration.query('BEGIN');
        await promptMigration.query(ddl);
        await promptMigration.query('INSERT INTO runtime.schema_migrations(name) VALUES($1)', [
          file,
        ]);
        await promptMigration.query('COMMIT');
      }
    } finally {
      promptMigration.release();
    }
    principalId = (
      await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
        accountId: `routing-${randomUUID()}`,
      })
    ).principalId;
    buildBoundedWorker();
    await mkdir('.data/surfer-routing-postgres', { recursive: true });
  }, 60000);
  afterAll(async () => {
    await pool?.end();
  });
  it('rolls back migration158 DDL and upgrades157 with immutable runtime journal grants', async () => {
    expect(migrationRollback).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT has_table_privilege('shotgun_runtime','frontend_ask.surfer_memory_context','SELECT') AS r, has_table_privilege('shotgun_runtime','frontend_ask.surfer_memory_context','INSERT') AS i, has_table_privilege('shotgun_runtime','frontend_ask.surfer_memory_context','UPDATE') AS u, has_table_privilege('shotgun_runtime','frontend_ask.surfer_memory_context','DELETE') AS d",
        )
      ).rows[0],
    ).toEqual({ r: true, i: true, u: false, d: false });
  });
  async function setup(nativeRows = false) {
    const f = memoryFixture(),
      actual = await createSurferSourceFixture(pool, principalId),
      stored = await actual.source('😀 ' + f.item.text),
      sessions = new PostgresSurferSourceSession(pool),
      runtime = createSurferApplicationRuntime(pool);
    if (nativeRows)
      await sessions.withRowsSnapshot(actual.request, 'WRITE', (s) => s.core.initialize());
    const material = await sessions.withSnapshotV2(
        actual.request,
        async (s) => (await s.readMaterialV2(stored.sourceId)).material,
      ),
      root = material.evidence.find((e) => e.pointer === '')!,
      selection = {
        sourceId: stored.sourceId,
        evidenceId: root.evidenceId,
        start: 0,
        end: unicodeLength(root.quote.exact),
        targetUnit: null,
      };
    const view = await runtime.sessions.withSession(actual.request, (s) =>
        s.source.observe(actual.request, { schemaVersion: '1.0.0', selections: [selection] }),
      ),
      wire = structuredClone(f.wire);
    if (wire.interpretation.state === 'RESOLVED')
      wire.interpretation.action.quote = '😀 ' + f.item.text;
    const packet = new SurferDirectiveExtractionCodecV3().decode(
      { ...f.response, rawText: JSON.stringify(wire) },
      view,
      'AUTHORED_ROUTING_CONTRACT',
      f.p.profile,
    )!;
    const remember = {
        schemaVersion: '1.0.0',
        contract: 'surfer.directive-memory.v1',
        memoryId: 'memory:' + randomUUID(),
        operationId: 'remember:' + randomUUID(),
        expectedRevision: null,
        expectedActiveSnapshotId: null,
        basis: view.basis,
        selections: [selection],
        packet,
      },
      question = {
        ...f.question,
        observations: [
          { predicateId: 'measure1', value: { type: 'NUMBER', decimal: '39', unit: '°C' } },
        ],
      };
    await runtime.directive.remember(actual.request, remember);
    return { f, actual, stored, runtime, remember, question };
  }
  type F = Awaited<ReturnType<typeof setup>>;
  const input = (f: F) => ({ kind: 'DIRECTIVE', question: f.question });
  function manager(projectId: string) {
    return new PostgresSurferStorageCutover(pool, {
      spaceId: projectId,
      authorize: async (c, s) => {
        if (
          !(
            await c.query(
              'SELECT 1 FROM auth.project_memberships WHERE principal_id=$1 AND project_id=$2 AND is_owner',
              [principalId, s],
            )
          ).rowCount
        )
          throw Error('admin denied');
      },
    });
  }
  async function startMigration(projectId: string) {
    const k = (
        await pool.query<{ payload: SurferKnowledgeState }>(
          'SELECT payload FROM surfer_knowledge.space_state WHERE space_id=$1',
          [projectId],
        )
      ).rows[0]!.payload,
      b = (
        await pool.query<{ payload: SurferBindingStateV2 }>(
          'SELECT payload FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1',
          [projectId],
        )
      ).rows[0]!.payload;
    return manager(projectId).begin(projectSurferHistory(k, b).manifest.pins);
  }
  async function migrate(projectId: string) {
    const m = manager(projectId);
    let g = await startMigration(projectId);
    while (g.cursor < g.total) g = await m.copyBatch(g.generationId, g.cursor, 16);
    g = await m.seal(g.generationId);
    return m.activate(g.generationId, g.routeRevision);
  }
  async function claimAsk(
    f: {
      actual: F['actual'];
      stored: F['stored'];
      remember: { selections: readonly { evidenceId: string }[] };
    },
    question = 'Check the current remembered temperature rule.',
    extraSelections: { sourceId: string; sourceVersionId: string; evidenceIds: string[] }[] = [],
  ) {
    const projectId = f.actual.projectId,
      accessRevision = projectId + ':owner',
      workspace = new PostgresAskWorkspaceProjection(pool),
      coordinator = new AskCommandCoordinator(
        new PostgresFrontendCommandGateway(pool),
        new PostgresAskConversationRepository(pool),
        workspace,
        new PostgresAskSourceSelectionValidator(pool),
        { enqueue: async () => {} },
      ),
      project = {
        id: projectId,
        label: 'Ask read fixture',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
      submission = await coordinator.submitQuestion({
        principalId,
        sessionId: f.actual.session.sessionId,
        activeProject: project,
        accessibleProjects: [project],
        accessRevision,
        policyContextRevision: '1',
        executionAuthorities: {
          [projectId]: {
            projectId,
            accessRevision,
            policyContextRevision: '1',
            accessScope: ['owner'],
            sensitivityClearance: 'private',
          },
        },
        request: {
          schemaVersion: '1.0.0',
          clientRequestId: randomUUID(),
          idempotencyKey: randomUUID(),
          question,
          mode: 'SOURCE_EXPLORATION',
          sourceSelections: [
            {
              sourceId: f.stored.sourceId,
              sourceVersionId: f.stored.sourceVersionId,
              evidenceIds: [f.remember.selections[0]!.evidenceId],
            },
            ...extraSelections,
          ],
        },
      }),
      workerId = 'surfer-ask-' + randomUUID(),
      repository = new PostgresAskAnswerExecutionRepository(
        pool,
        workspace,
        {
          resolve: async () => undefined,
        },
        undefined,
        undefined,
        undefined,
        (client, input) => new PostgresSurferAskMemory(pool).assertPublication(client, input),
      ),
      claimed = await repository.claimInitial(
        {
          principalId,
          projectId,
          accessRevision,
          policyContextRevision: '1',
          accessScope: ['owner'],
          sensitivityClearance: 'private',
        },
        submission.answerRun.answerRunId,
        workerId,
      );
    expect(claimed).toBeDefined();
    const actor: SurferAskSourceRequest = {
      projectId,
      ask: {
        answerRunId: submission.answerRun.answerRunId,
        attemptId: claimed!.attempt.attemptId,
        leaseOwner: workerId,
      },
    };
    const scope = {
      principalId,
      projectId,
      accessRevision,
      policyContextRevision: '1',
      accessScope: ['owner'],
      sensitivityClearance: 'private' as const,
    };
    return { actor, scope, claimed: claimed!, repository };
  }
  async function askActor(f: Parameters<typeof claimAsk>[0]) {
    return (await claimAsk(f)).actor;
  }
  async function learned() {
    return ruleReviewFixture(
      pool,
      principalId,
      '.data/surfer-routing-postgres/ask-rule-' + randomUUID(),
    );
  }
  const scenarioLines = (f: Awaited<ReturnType<typeof learned>>) =>
    '이 조건에서 학습한 규칙을 적용해줘.\n' +
    Object.entries(f.development.cases[0]!.features)
      .map(([k, v]) => `${k}=${JSON.stringify(v.value)}${v.unit ? ' ' + v.unit : ''}`)
      .join('\n');
  const claimRule = (f: Awaited<ReturnType<typeof learned>>, question = scenarioLines(f)) =>
    claimAsk(
      { actual: f.actual, stored: f.stored, remember: { selections: f.task.selections } },
      question,
    );
  it.each([false, true])(
    'uses the validated scoped RULE in the actual Ask provider and publication with row storage=%s',
    async (rows) => {
      const f = await learned();
      if (rows) await migrate(f.actual.projectId);
      const c = await claimRule(f),
        port = new PostgresSurferAskMemory(pool),
        p = await port.prepare(c.scope, c.claimed);
      expect(p.revision).toBe('surfer.ask-memory.v3');
      expect(p.packet?.rules).toHaveLength(1);
      expect(p.packet!.rules![0]).toMatchObject({
        state: 'ACTIVE',
        outcome: 'TRUE',
        qualification: { status: 'SCOPE_VALIDATED' },
      });
      const replay = await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed);
      expect(replay).toEqual(p);
      let prompt = '';
      const provider = new StructuredAskAnswerProviderAdapter(
        {
          identity: {
            provider: 'fake',
            model: 'fake',
            adapterVersion: '1',
            dataPolicyVersion: 'test',
          },
          generateStructured: async (input) => {
            prompt = input.prompt;
            return {
              rawText: JSON.stringify({
                answer: '한정 조건에서 TRUE입니다.',
                citations: [{ citationRef: 'E1' }],
              }),
            };
          },
        },
        { allowPrivate: true, allowRestricted: false, dataPolicyVersion: 'isolated-fake-provider' },
      );
      const output = await provider.execute({
        answerRunId: c.actor.ask.answerRunId,
        question: c.claimed.context.snapshot.question,
        mode: 'SOURCE_EXPLORATION',
        context: c.claimed.context.context,
        resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        queryPlanRevision: c.claimed.context.queryPlanRevision,
        dataPolicyVersion: 'test',
        effectiveProviderPolicy: { eligible: true, policyFingerprint: 'test' },
        signal: new AbortController().signal,
        onPartial: async () => {},
        surferMemory: p,
      });
      expect(JSON.parse(prompt).interpretationMemory.learnedRules[0].outcome).toBe('TRUE');
      expect(prompt).not.toContain(f.reader.proofId);
      const completed = await c.repository.complete({
        provider: output.provider,
        scope: c.scope,
        answerRunId: c.actor.ask.answerRunId,
        attemptNumber: c.claimed.attempt.attemptNumber,
        answer: output.answer,
        citations: output.citations.map((x) => ({
          citationId: randomUUID(),
          ...c.claimed.context.evidence.find((e) => e.evidenceId === x.evidenceId)!,
        })),
        workerId: c.actor.ask.leaseOwner,
        resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        queryPlanRevision: c.claimed.context.queryPlanRevision,
      });
      expect(completed.state).toBe('SUCCEEDED');
    },
  );
  it.each(['missing', 'wrong-unit', 'unseen'])(
    'keeps unsupported rule scenario UNKNOWN in the pinned ordinary Ask: %s',
    async (kind) => {
      const f = await learned();
      let q = scenarioLines(f);
      if (kind === 'missing') q = '이 규칙을 지금 적용해줘.';
      if (kind === 'wrong-unit') q = q.replace(' Cel', ' °C');
      if (kind === 'unseen') q = q.replace(/temperature=[^\n]+/, 'temperature=99999 Cel');
      const c = await claimRule(f, q),
        p = await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed);
      expect(p.packet?.rules?.[0]?.outcome).toBe('UNKNOWN');
      expect(p.packet!.rules![0]!.reasons.length).toBeGreaterThan(0);
    },
  );
  it('invalidates the pinned rule generation on a review and carries quarantine or withdrawal as UNKNOWN', async () => {
    const f = await learned(),
      c = await claimRule(f),
      port = new PostgresSurferAskMemory(pool),
      pin = await port.prepare(c.scope, c.claimed);
    const ground = await f.ground(f.observation()),
      reviewed = await f.review.review(f.actual.request, f.command(ground));
    await expect(port.validate(c.scope, c.claimed, pin)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const next = await claimRule(f),
      p = await port.prepare(next.scope, next.claimed);
    expect(p.packet).toBeNull();
    const withReview = await claimAsk(
      { actual: f.actual, stored: f.stored, remember: { selections: f.task.selections } },
      scenarioLines(f),
      [
        {
          sourceId: ground.stored.sourceId,
          sourceVersionId: ground.stored.sourceVersionId,
          evidenceIds: [ground.selections[0]!.evidenceId],
        },
      ],
    );
    const quarantined = await port.prepare(withReview.scope, withReview.claimed);
    expect(quarantined.packet?.rules?.[0]).toMatchObject({
      state: 'QUARANTINED',
      outcome: 'UNKNOWN',
    });
    const result = await f.memory.ask(f.actual.request, f.question);
    expect(result.answers[0]?.state).toBe('QUARANTINED');
    const withdrawal = await f.ground(f.observation());
    await f.review.review(f.actual.request, {
      ...f.command(withdrawal, reviewed),
      operationId: 'retract:' + randomUUID(),
      action: 'RETRACT',
    });
    expect((await f.memory.ask(f.actual.request, f.question)).answers[0]?.state).toBe('RETRACTED');
    const afterWithdrawal = await claimAsk(
      { actual: f.actual, stored: f.stored, remember: { selections: f.task.selections } },
      scenarioLines(f),
      [ground, withdrawal].map((g) => ({
        sourceId: g.stored.sourceId,
        sourceVersionId: g.stored.sourceVersionId,
        evidenceIds: [g.selections[0]!.evidenceId],
      })),
    );
    expect(
      (await port.prepare(afterWithdrawal.scope, afterWithdrawal.claimed)).packet?.rules?.[0],
    ).toMatchObject({ state: 'RETRACTED', outcome: 'UNKNOWN' });
  });
  it('preserves historical v1 absence without retrofilling a newly available RULE', async () => {
    const f = await learned(),
      c = await claimRule(f),
      p = pinSurferAskMemory(c.claimed.context.resolvedContextDigest, null);
    await pool.query(
      'INSERT INTO frontend_ask.surfer_memory_context(attempt_id,answer_run_id,project_id,attempt_number,base_context_digest,context,digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        c.actor.ask.attemptId,
        c.actor.ask.answerRunId,
        c.scope.projectId,
        c.claimed.attempt.attemptNumber,
        p.baseContextDigest,
        p,
        p.digest,
      ],
    );
    expect(await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed)).toEqual(p);
    await c.repository.fail({
      scope: c.scope,
      answerRunId: c.actor.ask.answerRunId,
      attemptNumber: c.claimed.attempt.attemptNumber,
      state: 'FAILED',
      failure: { code: 'TIMEOUT', message: 'fixture', retryable: true, outcomeUnknown: false },
      workerId: c.actor.ask.leaseOwner,
    });
    const retry = await c.repository.retryAndClaim({
      scope: c.scope,
      answerRunId: c.actor.ask.answerRunId,
      mode: 'SAME_CONTEXT',
      workerId: 'retry-' + randomUUID(),
    });
    expect(await new PostgresSurferAskMemory(pool).prepare(c.scope, retry!)).toEqual(p);
  });
  const scenarioSentence = (f: Awaited<ReturnType<typeof learned>>) =>
    '😀\n' +
    Object.entries(f.development.cases[0]!.features)
      .map(([name, v]) => `${name}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`)
      .join('이고 ') +
    '입니다. 이 조건을 판단해줘.';
  it('rolls back migration159 DDL and upgrades158 with proposal read/insert only', async () => {
    expect(proposalMigrationRollback).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT has_table_privilege('shotgun_runtime','frontend_ask.surfer_meaning_proposals','SELECT') AS r,has_table_privilege('shotgun_runtime','frontend_ask.surfer_meaning_proposals','INSERT') AS i,has_table_privilege('shotgun_runtime','frontend_ask.surfer_meaning_proposals','UPDATE') AS u,has_table_privilege('shotgun_runtime','frontend_ask.surfer_meaning_proposals','DELETE') AS d",
        )
      ).rows[0],
    ).toEqual({ r: true, i: true, u: false, d: false });
  });
  async function proposalFixture(
    rows = false,
    typed = false,
    scopeKind?: string,
    automaticWitness = false,
  ) {
    const f = await learned(),
      prose =
        scopeKind && !scopeKind.startsWith('typed-')
          ? '😀 장치A에서는 2026년 가동 중이면 온도는 temperature를 뜻하며, 정비 중에는 제외한다.'
          : typed
            ? `${f.development.cases[0]!.domain} 분야에서 온도는 temperature와 같은 NUMBER 값이며 단위는 Cel이다.`
            : '이 문서에서 온도는 temperature를 가리킨다.',
      stored = await f.actual.source(prose);
    if (rows) await migrate(f.actual.projectId);
    const material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(stored.sourceId)).material,
      ),
      question = scenarioSentence(f).replace('temperature', '온도');
    const witness = automaticWitness ? await f.actual.source(meaningWitness) : undefined;
    const wm = witness
      ? await new PostgresSurferSourceSession(pool).withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(witness.sourceId)).material,
        )
      : undefined;
    const c = await claimAsk(
        { actual: f.actual, stored: f.stored, remember: { selections: f.task.selections } },
        question,
        [
          {
            sourceId: stored.sourceId,
            sourceVersionId: stored.sourceVersionId,
            evidenceIds: [material.rootEvidenceId],
          },
          ...(witness && wm
            ? [
                {
                  sourceId: witness.sourceId,
                  sourceVersionId: witness.sourceVersionId,
                  evidenceIds: [wm.rootEvidenceId],
                },
              ]
            : []),
        ],
      ),
      port = new PostgresSurferAskMemory(pool),
      context = await port.prepare(c.scope, c.claimed);
    const evidenceRef =
      'E' + (c.claimed.context.evidence.findIndex((e) => e.sourceId === stored.sourceId) + 1);
    const wire = {
      state: 'PROPOSED',
      reason: 'possible prose mapping',
      semanticScopes: [],
      candidates: [
        {
          ruleRef: 'R1',
          field: 'temperature',
          label: '온도',
          evidenceRef,
          sourceQuote: prose,
          questionQuote: '온도',
          scope: 'UNVERIFIED',
        },
      ],
    };
    if (scopeKind)
      Object.assign(wire, {
        semanticScopes: [
          {
            candidateIndex: 0,
            relation: scopeKind === 'typed-distinct' ? 'DISTINCT' : 'EQUIVALENT',
            documentRole: scopeKind === 'typed-observation' ? 'OBSERVATION' : 'DEFINITION',
            facets: {
              subject: scopeKind?.startsWith('typed-')
                ? scopeKind === 'typed-subject'
                  ? f.development.cases[0]!.domain
                  : scopeKind === 'typed-invalid'
                    ? '없는 범위'
                    : null
                : scopeKind === 'invalid'
                  ? '다른 장치'
                  : scopeKind === 'unrepresentable'
                    ? '\u0000'
                    : '장치A',
              time: scopeKind?.startsWith('typed-') ? null : '2026년',
              condition: scopeKind?.startsWith('typed-') ? null : '가동 중이면',
              exception: scopeKind?.startsWith('typed-') ? null : '정비 중에는 제외한다',
            },
          },
        ],
      });
    const provider = new StructuredAskAnswerProviderAdapter(
      {
        identity: {
          provider: 'fake',
          model: 'fake',
          adapterVersion: '1',
          dataPolicyVersion: 'test',
        },
        generateStructured: async () => ({
          rawText: JSON.stringify({
            answer: '전제가 미검증되어 규칙은 UNKNOWN입니다.',
            citations: [{ citationRef: evidenceRef }],
            meaningDiscovery: wire,
          }),
        }),
      },
      { allowPrivate: true, allowRestricted: false, dataPolicyVersion: 'test' },
    );
    const output = await provider.execute({
      answerRunId: c.actor.ask.answerRunId,
      question,
      mode: 'SOURCE_EXPLORATION',
      context: c.claimed.context.context,
      resolvedContextDigest: c.claimed.context.resolvedContextDigest,
      queryPlanRevision: c.claimed.context.queryPlanRevision,
      dataPolicyVersion: 'test',
      effectiveProviderPolicy: { eligible: true, policyFingerprint: 'test' },
      signal: new AbortController().signal,
      onPartial: async () => {},
      surferMemory: context,
    });
    const completeInput = {
      scope: c.scope,
      answerRunId: c.actor.ask.answerRunId,
      attemptNumber: c.claimed.attempt.attemptNumber,
      answer: output.answer,
      citations: output.citations.map((x) => ({
        citationId: randomUUID(),
        ...c.claimed.context.evidence.find((e) => e.evidenceId === x.evidenceId)!,
      })),
      provider: output.provider,
      meaningProposal: output.meaningProposal,
      workerId: c.actor.ask.leaseOwner,
      resolvedContextDigest: c.claimed.context.resolvedContextDigest,
      queryPlanRevision: c.claimed.context.queryPlanRevision,
    };
    return { f, stored, c, port, context, output, completeInput };
  }
  async function reviewClaim(
    p: Awaited<ReturnType<typeof proposalFixture>>,
    witness?: Awaited<ReturnType<typeof p.f.actual.source>>,
  ) {
    const sources = [p.stored, ...(witness ? [witness] : [])],
      selections = [];
    for (const stored of sources) {
      const m = await new PostgresSurferSourceSession(pool).withSnapshotV2(
        p.f.actual.request,
        async (s) => (await s.readMaterialV2(stored.sourceId)).material,
      );
      selections.push({
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        evidenceIds: [m.rootEvidenceId],
      });
    }
    return claimAsk(
      { actual: p.f.actual, stored: p.f.stored, remember: { selections: p.f.task.selections } },
      p.c.claimed.context.snapshot.question,
      selections,
    );
  }
  const witnessText = (p: Awaited<ReturnType<typeof proposalFixture>>, relation = '같은') =>
    `${p.f.development.cases[0]!.domain} 분야에서 온도는 temperature와 ${relation} NUMBER 값을 가리키며 단위는 Cel이다.`;
  async function verifierFixture(copy = false, witnessText = meaningWitness, v2 = false) {
    const p = await proposalFixture(false, false, 'valid');
    await p.c.repository.complete(p.completeInput);
    const origin = p.c.claimed.context.evidence.find((e) => e.sourceId === p.stored.sourceId)!,
      witness = await p.f.actual.source(copy ? origin.exactQuote : witnessText);
    const material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
      p.f.actual.request,
      async (s) => (await s.readMaterialV2(witness.sourceId)).material,
    );
    const text = material.evidence.find((e) => e.evidenceId === material.rootEvidenceId)!.quote
      .exact;
    const selections = [
      {
        sourceId: origin.sourceId,
        evidenceId: origin.evidenceId,
        start: 0,
        end: unicodeLength(origin.exactQuote),
        targetUnit: null,
      },
      {
        sourceId: witness.sourceId,
        evidenceId: material.rootEvidenceId,
        start: 0,
        end: unicodeLength(text),
        targetUnit: null,
      },
    ];
    const source = new ShotgunSurferCognitiveSource(
        new ShotgunSurferSourceBridgeV2(new PostgresSurferSourceSession(pool)),
      ),
      f = providerFixture(new PostgresSurferExecutionStore(pool)),
      profile = {
        ...f.profile,
        promptRevision: v2 ? SURFER_MEANING_VERIFIER_REVISION_V2 : SURFER_MEANING_VERIFIER_REVISION,
      },
      policy = { ...f.policy, allowedSpaceIds: [p.f.actual.projectId] },
      ledger = new SurferExecutionLedger(new PostgresSurferExecutionStore(pool), policy),
      service = new PostgresSurferMeaningVerification(pool, source, ledger, f.gateway, profile),
      reference = { attemptId: p.c.actor.ask.attemptId, candidateIndex: 0 };
    f.response.rawText = JSON.stringify(
      v2
        ? meaningReviewWireV2(origin.exactQuote, text)
        : meaningReviewWire(origin.exactQuote, text),
    );
    const { basis: _, selections: __, ...task } = f.task;
    return { p, witness, source, f, profile, policy, ledger, service, reference, selections, task };
  }
  it('binds v2 preparation to its profile and preserves its result/checkpoint across a new DB connection', async () => {
    const x = await verifierFixture(false, meaningWitness, true);
    const work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections);
    const out = await x.service.verify(x.p.f.actual.request, work, x.task);
    expect(out.frame!.revision).toBe('surfer.meaning-cross-review.v2');
    expect(out.frame!.assessment).toBe('MODEL_UNRESOLVED');
    expect(out.frame!.findings.typeAssessment).toBe('UNRESOLVED');
    const other = new Pool({ connectionString: target, max: 2 });
    try {
      const ledger = new SurferExecutionLedger(new PostgresSurferExecutionStore(other), x.policy);
      const service = new PostgresSurferMeaningVerification(
        other,
        x.source,
        ledger,
        x.f.gateway,
        x.profile,
      );
      expect((await service.verify(x.p.f.actual.request, work, x.task)).frame).toEqual(out.frame);
      const oldProfile = { ...x.profile, promptRevision: SURFER_MEANING_VERIFIER_REVISION };
      const oldService = new PostgresSurferMeaningVerification(
        other,
        x.source,
        ledger,
        x.f.gateway,
        oldProfile,
      );
      expect(await oldService.verify(x.p.f.actual.request, work, x.task)).toMatchObject({
        status: 'SOURCE_UNAVAILABLE',
        frame: null,
      });
      expect(x.f.control.sends).toBe(1);
    } finally {
      await other.end();
    }
  });
  it('rolls back migration163 trigger replacement and preserves runtime queue/history grants', async () => {
    expect(meaningV2MigrationRollback).toBe(true);
    const p = (
      await pool.query(
        "SELECT has_table_privilege('shotgun_runtime','surfer_meaning.job','SELECT') r,has_table_privilege('shotgun_runtime','surfer_meaning.job','UPDATE') u,has_table_privilege('shotgun_runtime','surfer_meaning.job','DELETE') d,has_table_privilege('shotgun_runtime','surfer_meaning.transition','INSERT') i",
      )
    ).rows[0];
    expect(p).toEqual({ r: true, u: true, d: false, i: false });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE shotgun_runtime');
      await expect(
        c.query(await readFile('db/migrations/163_surfer_meaning_review_v2.sql', 'utf8')),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  it('durably stores v2 limits and rejects unknown revisions, mismatched prompt and adopting receipts', async () => {
    const x = await verifierFixture(false, meaningWitness, true);
    const work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections);
    const identity = {
      projectId: x.p.f.actual.projectId,
      principalId,
      runId: x.task.runId,
      profileDigest: surferDigest(x.profile),
      leaseMs: 60000,
    };
    const queue = new PostgresSurferMeaningQueue(pool);
    await queue.enqueue(identity, work);
    const claim = (await queue.claim(identity))!;
    const out = await x.service.verify(x.p.f.actual.request, work, {
      ...x.task,
      operationId: claim.jobId,
    });
    expect(out.frame!.revision).toBe('surfer.meaning-cross-review.v2');
    for (const kind of [
      'revision',
      'prompt',
      'limits',
      'type-citations',
      'adopt',
      'legacy-scoped',
      'positive-scoped',
      'legacy-table-scope',
      'positive-table-scope',
      'missing-table-rows',
      'v6-operating-clause',
      'positive-operating-clause',
      'reported-counter-on-v8',
      'v9-semantic-counter-different-scope',
      'v9-counter-count-mismatch',
      'v10-unestablished-semantic-counter',
    ]) {
      const f = structuredClone(out.frame!) as unknown as Record<string, unknown>;
      if (kind === 'revision') f.revision = 'surfer.meaning-cross-review.v9';
      if (kind === 'prompt')
        (f.producer as { promptRevision: string }).promptRevision =
          SURFER_MEANING_VERIFIER_REVISION;
      if (kind === 'limits') delete f.interpretationLimits;
      if (kind === 'type-citations')
        (f.findings as { typeCitations: unknown }).typeCitations = 'bad';
      if (kind === 'adopt') f.effect = 'ADOPT_KNOWLEDGE';
      if (kind === 'legacy-scoped' || kind === 'positive-scoped') {
        f.scopedDatumComparison = { observations: [{}, {}] };
        f.interpretationLimits = ['DISTINCT_STATION_DATUM_SCOPES'];
        f.assessment = 'MODEL_SUPPORTED_UNVERIFIED';
        if (kind === 'positive-scoped')
          (f.producer as { promptRevision: string }).promptRevision =
            'surfer-meaning-cross-review-v5';
      }
      if (kind.endsWith('table-scope') || kind === 'missing-table-rows') {
        f.scopeEvidence = { state: 'DIFFERENT_SCOPE', basis: 'EXACT_TABLE_ROWS', quotes: [{}, {}] };
        f.interpretationLimits = ['DISTINCT_TABLE_ROW_SCOPES'];
        f.assessment =
          kind === 'positive-table-scope' ? 'MODEL_SUPPORTED_UNVERIFIED' : 'MODEL_UNRESOLVED';
        if (kind !== 'legacy-table-scope')
          (f.producer as { promptRevision: string }).promptRevision =
            'surfer-meaning-cross-review-v6';
        if (kind !== 'missing-table-rows')
          f.scopedTableObservations = [{ rowCitation: {} }, { rowCitation: {} }];
      }
      if (kind.endsWith('operating-clause')) {
        f.scopeEvidence = {
          state: 'DIFFERENT_SCOPE',
          basis: 'EXACT_OPERATING_CLAUSES',
          quotes: [{ sourceId: 'one' }, { sourceId: 'two' }],
        };
        f.interpretationLimits = ['OPERATING_PHASE_FROM_SOURCE'];
        f.assessment =
          kind === 'positive-operating-clause' ? 'MODEL_SUPPORTED_UNVERIFIED' : 'MODEL_UNRESOLVED';
        (f.producer as { promptRevision: string }).promptRevision =
          kind === 'v6-operating-clause'
            ? 'surfer-meaning-cross-review-v6'
            : 'surfer-meaning-cross-review-v7';
      }
      if (kind.startsWith('v9-') || kind === 'reported-counter-on-v8') {
        (f.producer as { promptRevision: string }).promptRevision =
          kind === 'reported-counter-on-v8'
            ? 'surfer-meaning-cross-review-v8'
            : 'surfer-meaning-cross-review-v9';
        f.scopeEvidence = { state: 'DIFFERENT_SCOPE', basis: 'MODEL_CITATIONS', quotes: [{}, {}] };
        f.assessment = 'MODEL_UNRESOLVED';
        (f.findings as { counterKinds: string[] }).counterKinds = [
          kind === 'v9-semantic-counter-different-scope'
            ? 'SEMANTIC_CONTRADICTION'
            : 'SCOPE_LIMITATION',
        ];
        if (kind !== 'v9-semantic-counter-different-scope')
          f.reportedCounterKinds =
            kind === 'v9-counter-count-mismatch'
              ? ['SEMANTIC_CONTRADICTION', 'SEMANTIC_CONTRADICTION']
              : ['SEMANTIC_CONTRADICTION'];
      }
      if (kind === 'v10-unestablished-semantic-counter') {
        (f.producer as { promptRevision: string }).promptRevision =
          'surfer-meaning-cross-review-v10';
        f.scopeEvidence = { state: 'NOT_ESTABLISHED', basis: 'MODEL_CITATIONS', quotes: [] };
        f.assessment = 'MODEL_UNRESOLVED';
        (f.findings as { counterKinds: string[] }).counterKinds = ['SEMANTIC_CONTRADICTION'];
      }
      const { digest: _, ...body } = f;
      f.digest = surferDigest(body);
      await expect(queue.complete(claim, f as never)).rejects.toBeDefined();
    }
    await queue.complete(claim, out.frame!);
    expect((await queue.enqueue(identity, work)).state).toBe('COMPLETED');
    expect(
      (await pool.query('SELECT result FROM surfer_meaning.job WHERE job_id=$1', [claim.jobId]))
        .rows[0].result,
    ).toEqual(out.frame);
    expect(x.f.control.sends).toBe(1);
  });
  it('captures completion intents atomically, excludes RULE training Source and registers one automatic review', async () => {
    const p = await proposalFixture(false, false, 'valid', true);
    expect(
      (
        await pool.query('SELECT * FROM surfer_meaning.intent WHERE attempt_id=$1', [
          p.c.actor.ask.attemptId,
        ])
      ).rows,
    ).toHaveLength(0);
    await p.c.repository.complete(p.completeInput);
    const f = providerFixture(new PostgresSurferExecutionStore(pool)),
      profile = { ...f.profile, promptRevision: SURFER_MEANING_VERIFIER_REVISION },
      policy = { ...f.policy, allowedSpaceIds: [p.f.actual.projectId] },
      execution = {
        runId: 'auto-review',
        profile,
        ledger: new SurferExecutionLedger(new PostgresSurferExecutionStore(pool), policy),
        gateway: f.gateway,
      };
    f.response.rawText = JSON.stringify(meaningReviewWire());
    const runtime = createSurferApplicationRuntime(pool, undefined, execution);
    expect((await runtime.meaningReviews.cycle(p.f.actual.request)).status).toBe('COMPLETED');
    expect(f.control.sends).toBe(1);
    const jobs = (
      await pool.query('SELECT work,result FROM surfer_meaning.job WHERE proposal_attempt_id=$1', [
        p.c.actor.ask.attemptId,
      ])
    ).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].work.selections).toHaveLength(2);
    expect(
      jobs[0].work.selections.some((x: { sourceId: string }) => x.sourceId === p.f.stored.sourceId),
    ).toBe(false);
    expect(jobs[0].result.effect).toBe('NO_RULE_OR_KNOWLEDGE_CHANGE');
    expect((await runtime.meaningReviews.cycle(p.f.actual.request)).status).toBe('EMPTY');
    expect(f.control.sends).toBe(1);
    const other = new PostgresSurferMeaningIntents(pool),
      identity = {
        projectId: p.f.actual.projectId,
        principalId,
        runId: 'different-run',
        profileDigest: surferDigest(profile),
        leaseMs: 30000,
      };
    const saved = await other.pending(identity);
    expect(saved).not.toBeNull();
    expect(selectAutomaticMeaningInputs(saved!).code).toBe('READY');
    await pool.query('DELETE FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
      p.c.actor.ask.answerRunId,
    ]);
    expect(
      (
        await pool.query('SELECT * FROM surfer_meaning.intent_delivery WHERE attempt_id=$1', [
          p.c.actor.ask.attemptId,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it('does not register a failed completion and does not treat RULE proof as a separate witness', async () => {
    const p = await proposalFixture(false, false, 'valid');
    await pool.query(
      "CREATE FUNCTION surfer_meaning.test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated late completion rollback'; END $$; CREATE TRIGGER zz_test_late_failure AFTER UPDATE OF state ON frontend_ask.answer_runs FOR EACH ROW WHEN (NEW.state='SUCCEEDED') EXECUTE FUNCTION surfer_meaning.test_late_failure()",
    );
    try {
      await expect(p.c.repository.complete(p.completeInput)).rejects.toThrow();
    } finally {
      await pool.query(
        'DROP TRIGGER zz_test_late_failure ON frontend_ask.answer_runs; DROP FUNCTION surfer_meaning.test_late_failure()',
      );
    }
    expect(
      (
        await pool.query('SELECT * FROM surfer_meaning.intent WHERE attempt_id=$1', [
          p.c.actor.ask.attemptId,
        ])
      ).rows,
    ).toHaveLength(0);
    await p.c.repository.complete(p.completeInput);
    const i = {
        projectId: p.f.actual.projectId,
        principalId,
        runId: 'auto-skip',
        profileDigest: surferDigest('profile'),
        leaseMs: 30000,
      },
      store = new PostgresSurferMeaningIntents(pool),
      saved = await store.pending(i);
    expect(saved).not.toBeNull();
    expect(selectAutomaticMeaningInputs(saved!).code).toBe('NO_SEPARATE_EVIDENCE');
    await store.delivered(i, p.c.actor.ask.attemptId, 'NO_SEPARATE_EVIDENCE', []);
    expect(await store.pending(i)).toBeNull();
  });
  it('restricts automatic intent grants and rejects forged delivery job references', async () => {
    const p = await proposalFixture(false, false, 'valid');
    await p.c.repository.complete(p.completeInput);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE shotgun_runtime');
      await expect(
        c.query('INSERT INTO surfer_meaning.intent SELECT * FROM surfer_meaning.intent LIMIT 1'),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      await expect(
        pool.query('UPDATE surfer_meaning.intent SET principal_id=$2 WHERE attempt_id=$1', [
          p.c.actor.ask.attemptId,
          'forged',
        ]),
      ).rejects.toThrow();
      await expect(
        pool.query(
          "INSERT INTO surfer_meaning.intent_delivery(attempt_id,run_id,profile_digest,code,job_ids) VALUES($1,'forged',$2,'ENQUEUED',ARRAY['absent'])",
          [p.c.actor.ask.attemptId, surferDigest('p')],
        ),
      ).rejects.toThrow();
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  async function queuedFixture(leaseMs = 30000) {
    const x = await verifierFixture(),
      work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections),
      identity = {
        projectId: x.p.f.actual.projectId,
        principalId,
        runId: x.task.runId,
        profileDigest: surferDigest(x.profile),
        leaseMs,
      },
      queue = new PostgresSurferMeaningQueue(pool),
      queued = await queue.enqueue(identity, work),
      worker = (q = queue, service = x.service) =>
        new SurferMeaningQueueWorker(
          q,
          service,
          async () => ({ projectId: identity.projectId, principalId }),
          { runId: identity.runId, profileDigest: identity.profileDigest, leaseMs },
        );
    return { ...x, work, identity, queue, queued, worker };
  }
  function queueFault(mode: 'enqueue-ack' | 'complete-ack' | 'complete-rollback') {
    let armed = true;
    return new PostgresSurferMeaningQueue(
      new Proxy(pool, {
        get(t, k) {
          if (k === 'connect')
            return async () => {
              const c = await t.connect();
              let changed = false;
              return new Proxy(c, {
                get(q, p) {
                  if (p === 'query')
                    return async (...args: unknown[]) => {
                      const sql = String(args[0]),
                        values = args[1] as unknown[] | undefined,
                        mutate =
                          mode === 'enqueue-ack'
                            ? sql.startsWith('INSERT INTO surfer_meaning.job')
                            : sql.startsWith('UPDATE surfer_meaning.job') &&
                              values?.[4] === 'COMPLETED';
                      const result = await Reflect.apply(q.query, q, args);
                      if (mutate) changed = true;
                      if (
                        armed &&
                        changed &&
                        ((mode === 'complete-rollback' && mutate) ||
                          (mode !== 'complete-rollback' && sql === 'COMMIT'))
                      ) {
                        armed = false;
                        throw Error('queue ack/rollback fixture');
                      }
                      return result;
                    };
                  const v = Reflect.get(q, p);
                  return typeof v === 'function' ? v.bind(q) : v;
                },
              });
            };
          const v = Reflect.get(t, k);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      }),
    );
  }
  it('rolls back migration160 and enforces runtime queue/history grants and immutable pins', async () => {
    expect(meaningQueueMigrationRollback).toBe(true);
    const x = await queuedFixture();
    const u = new URL(target!);
    u.searchParams.set('options', '-c role=shotgun_runtime');
    const other = new Pool({ connectionString: u.href, max: 2 });
    try {
      const q = new PostgresSurferMeaningQueue(other),
        again = await q.enqueue(x.identity, x.work);
      expect(again.replayed).toBe(true);
      const claim = await q.claim(x.identity);
      expect(claim).not.toBeNull();
      await expect(
        other.query(
          "UPDATE surfer_meaning.job SET run_id='changed',revision=revision+1 WHERE job_id=$1",
          [x.queued.jobId],
        ),
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        other.query('DELETE FROM surfer_meaning.job WHERE job_id=$1', [x.queued.jobId]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        other.query("UPDATE surfer_meaning.transition SET payload='{}'::jsonb WHERE job_id=$1", [
          x.queued.jobId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await q.block(claim!, 'INCOMPLETE');
      expect(
        (await q.inspect(x.identity, { reference: x.reference, selections: x.selections }))!.state,
      ).toBe('BLOCKED');
    } finally {
      await other.end();
    }
  });
  it('deduplicates enqueue without replacing the original preparation or reactivating completed work', async () => {
    const x = await queuedFixture(),
      queue: PostgresSurferMeaningQueue = x.queue,
      otherWork = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections),
      out = await Promise.all([
        queue.enqueue(x.identity, otherWork),
        queue.enqueue(x.identity, x.work),
      ]);
    expect(out.every((x) => x.replayed)).toBe(true);
    expect(
      (await pool.query('SELECT work FROM surfer_meaning.job WHERE job_id=$1', [x.queued.jobId]))
        .rows[0].work,
    ).toEqual(x.work);
    const cycles = await Promise.all([
      x.worker().cycle(x.p.f.actual.request),
      x.worker().cycle(x.p.f.actual.request),
    ]);
    expect(cycles.map((r) => r.status).sort()).toEqual(['COMPLETED', 'EMPTY']);
    expect(x.f.control.sends).toBe(1);
    expect((await queue.enqueue(x.identity, x.work)).state).toBe('COMPLETED');
    expect((await x.worker().cycle(x.p.f.actual.request)).status).toBe('EMPTY');
  });
  it('uses DB expiry and token CAS while preserving run/profile/principal pins', async () => {
    const x = await queuedFixture(1000),
      first = await x.queue.claim(x.identity);
    expect(await x.queue.claim(x.identity)).toBeNull();
    for (const i of [
      { ...x.identity, runId: 'other' },
      { ...x.identity, principalId: randomUUID() },
      { ...x.identity, profileDigest: surferDigest('other') },
    ])
      expect(await x.queue.claim(i)).toBeNull();
    await pool.query('SELECT pg_sleep(1.05)');
    const next = await x.queue.claim(x.identity);
    expect(next!.token).not.toBe(first!.token);
    await expect(x.queue.block(first!, 'INCOMPLETE')).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await x.queue.block(next!, 'INCOMPLETE');
  });
  it.each(['enqueue-ack', 'complete-ack'] as const)(
    'recovers an exact durable %s without additional dispatch or transition',
    async (mode) => {
      const x = await verifierFixture(),
        work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections),
        identity = {
          projectId: x.p.f.actual.projectId,
          principalId,
          runId: x.task.runId,
          profileDigest: surferDigest(x.profile),
          leaseMs: 30000,
        },
        queue = queueFault(mode),
        queued = await queue.enqueue(identity, work),
        worker = new SurferMeaningQueueWorker(
          queue,
          x.service,
          async () => ({ projectId: identity.projectId, principalId }),
          { runId: identity.runId, profileDigest: identity.profileDigest, leaseMs: 30000 },
        );
      expect((await worker.cycle(x.p.f.actual.request)).status).toBe('COMPLETED');
      expect(x.f.control.sends).toBe(1);
      expect(
        (
          await pool.query(
            'SELECT count(*)::integer AS n FROM surfer_meaning.transition WHERE job_id=$1',
            [queued.jobId],
          )
        ).rows[0].n,
      ).toBe(3);
      expect((await queue.enqueue(identity, work)).replayed).toBe(true);
    },
  );
  it('rolls back final queue ack and resumes the stored preparation/checkpoint through a new runtime-role connection', async () => {
    const x = await queuedFixture(5000);
    await expect(
      x.worker(queueFault('complete-rollback')).cycle(x.p.f.actual.request),
    ).rejects.toBeDefined();
    expect(x.f.control.sends).toBe(1);
    expect(
      (
        await pool.query('SELECT state,work FROM surfer_meaning.job WHERE job_id=$1', [
          x.queued.jobId,
        ])
      ).rows[0],
    ).toEqual({ state: 'RUNNING', work: x.work });
    await pool.query('SELECT pg_sleep(5.05)');
    const u = new URL(target!);
    u.searchParams.set('options', '-c role=shotgun_runtime');
    const other = new Pool({ connectionString: u.href, max: 3 }),
      serverLedger = new Pool({ connectionString: target, max: 2 });
    try {
      await expect(
        other.query('SELECT budget_id FROM surfer_execution.budget_state LIMIT 1'),
      ).rejects.toMatchObject({ code: '42501' });
      const source = new ShotgunSurferCognitiveSource(
          new ShotgunSurferSourceBridgeV2(new PostgresSurferSourceSession(other)),
        ),
        service = new PostgresSurferMeaningVerification(
          other,
          source,
          new SurferExecutionLedger(new PostgresSurferExecutionStore(serverLedger), x.policy),
          x.f.gateway,
          x.profile,
        ),
        worker = x.worker(new PostgresSurferMeaningQueue(other), service);
      expect((await worker.cycle(x.p.f.actual.request)).status).toBe('COMPLETED');
      expect(x.f.control.sends).toBe(1);
    } finally {
      await other.end();
      await serverLedger.end();
    }
  });
  it.each(['unknown', 'usage', 'invalid'] as const)(
    'retains blocked %s work after enqueue replay and restart without resend',
    async (kind) => {
      const x = await queuedFixture();
      if (kind === 'unknown') x.f.control.generateError = true;
      if (kind === 'usage') x.f.response.inputTokens = null;
      if (kind === 'invalid') x.f.response.rawText = 'bad';
      expect((await x.worker().cycle(x.p.f.actual.request)).status).toBe('BLOCKED');
      expect((await x.queue.enqueue(x.identity, x.work)).state).toBe('BLOCKED');
      expect((await x.worker().cycle(x.p.f.actual.request)).status).toBe('EMPTY');
      expect(x.f.control.sends).toBe(1);
    },
  );
  it.each(['source', 'parent'] as const)(
    'prevents stale queued review after %s changes',
    async (kind) => {
      const x = await queuedFixture();
      if (kind === 'source') await x.p.f.actual.source('changed', { sourceId: x.witness.sourceId });
      else
        await pool.query('DELETE FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
          x.p.c.actor.ask.answerRunId,
        ]);
      expect((await x.worker().cycle(x.p.f.actual.request)).status).toBe(
        kind === 'source' ? 'BLOCKED' : 'EMPTY',
      );
      expect(x.f.control.sends).toBe(0);
      if (kind === 'parent') {
        expect(
          (
            await pool.query(
              'SELECT count(*)::integer AS n FROM surfer_meaning.job WHERE job_id=$1',
              [x.queued.jobId],
            )
          ).rows[0].n,
        ).toBe(0);
        const history = (
          await pool.query('SELECT payload FROM surfer_meaning.transition WHERE job_id=$1', [
            x.queued.jobId,
          ])
        ).rows;
        expect(history).toHaveLength(1);
        expect(JSON.stringify(history)).not.toContain(x.work.candidate.sourceSpan.quote);
      }
    },
  );
  it('reviews saved ordinary prose in a separate durable execution and replays through new DB connections without adopting a rule', async () => {
    const x = await verifierFixture(),
      work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections),
      before = await x.p.f.memory.ask(x.p.f.actual.request, x.p.f.question);
    let prompt = '';
    const base = x.f.gateway.prepare;
    x.f.gateway.prepare = async (binding, generation) => {
      expect(binding.sensitivity).toBe('private');
      prompt = generation.prompt;
      const result = await base(binding, generation);
      const generate = result.generate;
      result.generate = async (signal) => {
        const q = await pool.query(
          "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
        );
        expect(q.rows[0].n).toBe(0);
        return generate(signal);
      };
      return result;
    };
    const out = await x.service.verify(x.p.f.actual.request, work, x.task);
    expect(out.status).toBe('CANDIDATE_NOT_SEMANTICALLY_VALIDATED');
    expect(out.frame).toMatchObject({
      assessment: 'MODEL_SUPPORTED_UNVERIFIED',
      effect: 'NO_RULE_OR_KNOWLEDGE_CHANGE',
      semanticAssessment: 'MODEL_REVIEW_NOT_TRUTH_VALIDATED',
    });
    expect(prompt).not.toContain(x.reference.attemptId);
    expect(prompt).not.toContain(work.proposal.receiptDigest);
    expect(prompt).not.toContain('semanticScopes');
    const other = new Pool({ connectionString: target, max: 2 });
    try {
      const src = new ShotgunSurferCognitiveSource(
          new ShotgunSurferSourceBridgeV2(new PostgresSurferSourceSession(other)),
        ),
        next = new PostgresSurferMeaningVerification(
          other,
          src,
          new SurferExecutionLedger(new PostgresSurferExecutionStore(other), x.policy),
          x.f.gateway,
          x.profile,
        );
      const replay = await next.verify(
        x.p.f.actual.request,
        JSON.parse(JSON.stringify(work)),
        x.task,
      );
      expect(replay.frame).toEqual(out.frame);
      expect(x.f.control.sends).toBe(1);
    } finally {
      await other.end();
    }
    const after = await x.p.f.memory.ask(x.p.f.actual.request, x.p.f.question);
    expect(after.answers).toEqual(before.answers);
    const later = await reviewClaim(x.p, x.witness),
      context = await x.p.port.prepare(later.scope, later.claimed);
    expect(context.packet!.rules![0]!.outcome).toBe('UNKNOWN');
  });
  it.each(['copy', 'partial-origin', 'foreign-candidate', 'wrong-index'] as const)(
    'blocks invalid independent review preparation before sending: %s',
    async (kind) => {
      const x = await verifierFixture(kind === 'copy'),
        selections = structuredClone(x.selections),
        reference = { ...x.reference };
      if (kind === 'partial-origin') selections[0]!.end = 3;
      if (kind === 'foreign-candidate') {
        const other = await verifierFixture();
        reference.attemptId = other.reference.attemptId;
      }
      if (kind === 'wrong-index') reference.candidateIndex = 7;
      await expect(
        x.service.prepare(x.p.f.actual.request, reference, selections),
      ).rejects.toBeDefined();
      expect(x.f.control.sends).toBe(0);
    },
  );
  it.each(['changed-source', 'erased-parent', 'revoked-author'] as const)(
    'withholds prepared review after %s without sending',
    async (kind) => {
      const x = await verifierFixture(),
        work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections);
      if (kind === 'changed-source')
        await x.p.f.actual.source('new version', { sourceId: x.witness.sourceId });
      if (kind === 'erased-parent')
        await pool.query('DELETE FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
          x.p.c.actor.ask.answerRunId,
        ]);
      if (kind === 'revoked-author')
        await pool.query(
          'DELETE FROM auth.project_memberships WHERE project_id=$1 AND principal_id=$2',
          [x.p.f.actual.projectId, principalId],
        );
      const out = await x.service.verify(x.p.f.actual.request, work, x.task);
      expect(out.status).toBe('SOURCE_UNAVAILABLE');
      expect(out.frame).toBeNull();
      expect(x.f.control.sends).toBe(0);
    },
  );
  it('preserves a counter review and both original scope facets without updating the original proposal', async () => {
    const negative = '정비 시에는 적용하지 않는다.',
      x = await verifierFixture(false, negative),
      work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections),
      wire = meaningReviewWire(
        x.p.c.claimed.context.evidence.find((e) => e.sourceId === x.p.stored.sourceId)!.exactQuote,
        negative,
      );
    wire.relation = 'DISTINCT';
    wire.counter = [{ passageRef: 'P2', quote: negative }];
    x.f.response.rawText = JSON.stringify(wire);
    const out = await x.service.verify(x.p.f.actual.request, work, x.task);
    expect(out.frame!.assessment).toBe('MODEL_CONTRADICTED_UNVERIFIED');
    expect(out.frame!.findings.facets.exception.state).toBe('STATED');
    expect(
      (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [x.reference.attemptId],
        )
      ).rows[0].receipt,
    ).toEqual(x.p.output.meaningProposal);
  });
  it('recovers review checkpoint settlement and keeps uncertain review sends fenced', async () => {
    const x = await verifierFixture(),
      work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections);
    x.f.control.failSettleOnce = true;
    expect((await x.service.verify(x.p.f.actual.request, work, x.task)).status).toBe(
      'OUTCOME_UNKNOWN',
    );
    expect((await x.service.verify(x.p.f.actual.request, work, x.task)).frame!.effect).toBe(
      'NO_RULE_OR_KNOWLEDGE_CHANGE',
    );
    expect(x.f.control.sends).toBe(1);
    const y = await verifierFixture(),
      other = await y.service.prepare(y.p.f.actual.request, y.reference, y.selections);
    y.f.control.generateError = true;
    expect((await y.service.verify(y.p.f.actual.request, other, y.task)).status).toBe(
      'OUTCOME_UNKNOWN',
    );
    expect((await y.service.verify(y.p.f.actual.request, other, y.task)).status).toBe(
      'OUTCOME_UNKNOWN',
    );
    expect(y.f.control.sends).toBe(1);
  });
  it('settles observed review usage but withholds the frame after Source changes during dispatch', async () => {
    const x = await verifierFixture(),
      work = await x.service.prepare(x.p.f.actual.request, x.reference, x.selections),
      base = x.f.gateway.prepare;
    x.f.gateway.prepare = async (...args) => {
      const p = await base(...args),
        generate = p.generate;
      p.generate = async (signal) => {
        await x.p.f.actual.source('changed while reviewing', { sourceId: x.witness.sourceId });
        return generate(signal);
      };
      return p;
    };
    const out = await x.service.verify(x.p.f.actual.request, work, x.task);
    expect(out.status).toBe('SOURCE_UNAVAILABLE');
    expect(out.frame).toBeNull();
    expect(x.f.control.sends).toBe(1);
    expect((await x.ledger.snapshot()).accounted.calls).toBe(1);
  });
  it.each([false, true])(
    'persists ordinary-prose scope frames with the final answer and exact replay in rows=%s',
    async (rows) => {
      const p = await proposalFixture(rows, false, 'valid');
      expect(p.context.revision).toBe('surfer.ask-memory.v7');
      expect(p.output.meaningProposal!.semanticScopes!.frames[0]!.facets.subject?.quote).toBe(
        '장치A',
      );
      expect(p.context.packet!.rules![0]!.outcome).toBe('UNKNOWN');
      expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
      expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
      const stored = (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].receipt;
      expect(stored).toEqual(p.output.meaningProposal);
      expect(stored.semanticScopes.assessment).toBe('ANCHORED_SCOPES_UNVERIFIED');
      expect(stored.semanticAssessment).toBe('NOT_EVALUATED');
    },
  );
  it('preserves the answer and candidate while rejecting an unanchored scope facet', async () => {
    const p = await proposalFixture(false, false, 'invalid');
    expect(p.output.meaningProposal!.assessment).toBe('ANCHORED_CANDIDATES_UNVERIFIED');
    expect(p.output.meaningProposal!.semanticScopes!.assessment).toBe('EVIDENCE_REJECTED');
    expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
    expect(
      (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].receipt,
    ).toEqual(p.output.meaningProposal);
    const badUnicode = await proposalFixture(false, false, 'unrepresentable');
    expect(badUnicode.output.meaningProposal!.wire).toBeNull();
    expect(badUnicode.output.meaningProposal!.assessment).toBe('INVALID_OUTPUT');
    expect((await badUnicode.c.repository.complete(badUnicode.completeInput)).state).toBe(
      'SUCCEEDED',
    );
  });
  it('rejects digest-repaired semantic scope tampering without persisting answer or receipt', async () => {
    const p = await proposalFixture(false, false, 'valid'),
      input = structuredClone(p.completeInput),
      { digest: _, ...body } = input.meaningProposal!;
    body.semanticScopes!.frames[0]!.relation = 'DISTINCT';
    input.meaningProposal = { ...body, digest: surferDigest(body) };
    await expect(p.c.repository.complete(input)).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.statements WHERE answer_run_id=$1',
          [p.c.actor.ask.answerRunId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('rejects a changed Source behind a semantic scope frame without rewriting the pinned context', async () => {
    const p = await proposalFixture(false, false, 'valid');
    await p.f.actual.source('장치와 범위가 변경되었다.', { sourceId: p.stored.sourceId });
    await expect(p.port.validate(p.c.scope, p.c.claimed, p.context)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    await expect(p.c.repository.complete(p.completeInput)).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it.each([false, true])(
    'uses a stored proposal only after separate current Source corroboration with rows=%s',
    async (rows) => {
      const p = await proposalFixture(rows, true);
      await p.c.repository.complete(p.completeInput);
      const witness = await p.f.actual.source(witnessText(p)),
        c = await reviewClaim(p, witness),
        context = await p.port.prepare(c.scope, c.claimed);
      expect(context.revision).toBe('surfer.ask-memory.v9');
      expect(context.packet!.rules![0]!.outcome).toBe('TRUE');
      expect(context.packet!.rules![0]!.grounding!.reviews![0]!.assessment).toBe(
        'SOURCE_CORROBORATED_DECLARATION_ONLY',
      );
      expect(context.packet!.rules![0]!.premises).toHaveLength(3);
      await new PostgresSurferAskMemory(pool).validate(c.scope, c.claimed, context);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await p.port.assertPublication(client, {
          scope: c.scope,
          answerRunId: c.actor.ask.answerRunId,
          attemptId: c.actor.ask.attemptId,
          workerId: c.actor.ask.leaseOwner,
          resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(
        (
          await pool.query(
            'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [p.c.actor.ask.attemptId],
          )
        ).rows[0].receipt,
      ).toEqual(p.output.meaningProposal);
    },
  );
  it.each(['single', 'duplicate', 'negative', 'unsupported'])(
    'keeps the stored proposal UNKNOWN with %s evidence',
    async (kind) => {
      const p = await proposalFixture(false, true);
      await p.c.repository.complete(p.completeInput);
      const witness =
          kind === 'single'
            ? undefined
            : await p.f.actual.source(
                kind === 'duplicate'
                  ? p.c.claimed.context.evidence.find((e) => e.sourceId === p.stored.sourceId)!
                      .exactQuote
                  : kind === 'negative'
                    ? witnessText(p, '다른')
                    : '온도는 temperature가 아니다.',
              ),
        c = await reviewClaim(p, witness),
        context = await p.port.prepare(c.scope, c.claimed);
      expect(context.revision).toBe('surfer.ask-memory.v9');
      expect(context.packet!.rules![0]!.outcome).toBe('UNKNOWN');
      expect(context.packet!.rules![0]!.grounding!.reviews![0]!.assessment).toBe(
        kind === 'negative'
          ? 'CONTRADICTED'
          : kind === 'unsupported'
            ? 'UNSUPPORTED'
            : 'INSUFFICIENT_EVIDENCE',
      );
    },
  );
  it.each([
    'typed-equivalent',
    'typed-distinct',
    'typed-subject',
    'typed-observation',
    'typed-invalid',
    'valid',
  ])('reviews the saved scope and current independent declarations: %s', async (kind) => {
    const p = await proposalFixture(false, true, kind);
    await p.c.repository.complete(p.completeInput);
    const witness = await p.f.actual.source(witnessText(p)),
      c = await reviewClaim(p, witness),
      context = await p.port.prepare(c.scope, c.claimed),
      rule = context.packet!.rules![0]!,
      r = rule.grounding!.reviews![0]!;
    expect(context.revision).toBe('surfer.ask-memory.v9');
    expect(r.revision).toBe('surfer.ask-meaning-review.v3');
    expect(rule.outcome).toBe(kind === 'typed-equivalent' ? 'TRUE' : 'UNKNOWN');
    expect(r.assessment).toBe(
      kind === 'typed-equivalent' ? 'SOURCE_CORROBORATED_DECLARATION_ONLY' : 'UNSUPPORTED',
    );
    await p.port.validate(c.scope, c.claimed, context);
    expect(await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed)).toEqual(context);
    if (r.revision !== 'surfer.ask-meaning-review.v3') throw Error('v3');
    expect(r.scope.frame?.relation).toBe(
      kind === 'typed-distinct' ? 'DISTINCT' : kind === 'typed-invalid' ? undefined : 'EQUIVALENT',
    );
    if (kind === 'typed-distinct') {
      const changed = structuredClone(context);
      const cr = changed.packet!.rules![0]!.grounding!.reviews![0]!;
      if (cr.revision !== 'surfer.ask-meaning-review.v3') throw Error('v3');
      cr.scope.frame!.relation = 'EQUIVALENT';
      const { digest: _, ...reviewBody } = cr;
      cr.digest = surferDigest(reviewBody);
      const { digest: __, ...body } = changed;
      changed.digest = surferDigest(body);
      await expect(p.port.validate(c.scope, c.claimed, changed)).rejects.toMatchObject({
        code: 'STALE_VERSION',
      });
    }
  });
  it('stops an in-flight adopted mapping when its witness changes, and new negative evidence blocks a later question', async () => {
    const p = await proposalFixture(false, true);
    await p.c.repository.complete(p.completeInput);
    const witness = await p.f.actual.source(witnessText(p)),
      c = await reviewClaim(p, witness),
      context = await p.port.prepare(c.scope, c.claimed);
    expect(context.packet!.rules![0]!.outcome).toBe('TRUE');
    const changed = await p.f.actual.source(witnessText(p, '다른'), { sourceId: witness.sourceId });
    await expect(p.port.validate(c.scope, c.claimed, context)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const later = await reviewClaim(p, changed),
      current = await p.port.prepare(later.scope, later.claimed);
    expect(current.packet!.rules![0]!.outcome).toBe('UNKNOWN');
    expect(current.packet!.rules![0]!.grounding!.reviews![0]!.assessment).toBe('CONTRADICTED');
  });
  it('rejects publication after the parent-authorized erasure of a referenced proposal', async () => {
    const p = await proposalFixture(false, true);
    await p.c.repository.complete(p.completeInput);
    const witness = await p.f.actual.source(witnessText(p)),
      c = await reviewClaim(p, witness),
      context = await p.port.prepare(c.scope, c.claimed);
    await pool.query('DELETE FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
      p.c.actor.ask.answerRunId,
    ]);
    await expect(p.port.validate(c.scope, c.claimed, context)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        p.port.assertPublication(client, {
          scope: c.scope,
          answerRunId: c.actor.ask.answerRunId,
          attemptId: c.actor.ask.attemptId,
          workerId: c.actor.ask.leaseOwner,
          resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        }),
      ).rejects.toMatchObject({ code: 'STALE_VERSION' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
  it('preserves historical v5 SAME_CONTEXT UNKNOWN after a separate proposal becomes usable', async () => {
    const p = await proposalFixture(false, true),
      witness = await p.f.actual.source(witnessText(p)),
      probe = await reviewClaim(p, witness),
      current = await p.port.prepare(probe.scope, probe.claimed),
      old = await reviewClaim(p, witness),
      packet = structuredClone(current.packet!);
    packet.discovery = {
      revision: 'surfer.ask-meaning-discovery.v1',
      evidence: packet.discovery!.evidence,
    };
    const oldContext = pinSurferAskMemory(old.claimed.context.resolvedContextDigest, packet);
    await pool.query(
      'INSERT INTO frontend_ask.surfer_memory_context(attempt_id,answer_run_id,project_id,attempt_number,base_context_digest,context,digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        old.actor.ask.attemptId,
        old.actor.ask.answerRunId,
        old.scope.projectId,
        old.claimed.attempt.attemptNumber,
        oldContext.baseContextDigest,
        oldContext,
        oldContext.digest,
      ],
    );
    expect(await p.port.prepare(old.scope, old.claimed)).toEqual(oldContext);
    expect(oldContext.revision).toBe('surfer.ask-memory.v5');
    await old.repository.fail({
      scope: old.scope,
      answerRunId: old.actor.ask.answerRunId,
      attemptNumber: old.claimed.attempt.attemptNumber,
      state: 'FAILED',
      failure: { code: 'TIMEOUT', message: 'fixture', retryable: true, outcomeUnknown: false },
      workerId: old.actor.ask.leaseOwner,
    });
    await p.c.repository.complete(p.completeInput);
    const retry = await old.repository.retryAndClaim({
      scope: old.scope,
      answerRunId: old.actor.ask.answerRunId,
      mode: 'SAME_CONTEXT',
      workerId: 'retry-' + randomUUID(),
    });
    expect(await p.port.prepare(old.scope, retry!)).toEqual(oldContext);
    const fresh = await reviewClaim(p, witness);
    expect((await p.port.prepare(fresh.scope, fresh.claimed)).packet!.rules![0]!.outcome).toBe(
      'TRUE',
    );
  });
  it.each([false, true])(
    'atomically publishes a Source-anchored unverified proposal and replays completion with rows=%s',
    async (rows) => {
      const p = await proposalFixture(rows),
        before = await new PostgresSurferSourceSession(pool).withRoutedSnapshot(
          p.f.actual.request,
          'READ',
          async (s) => s.profile,
        );
      expect(p.context.revision).toBe('surfer.ask-memory.v7');
      expect(p.context.packet!.rules![0]!.outcome).toBe('UNKNOWN');
      expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
      const receipt = (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].receipt;
      expect(receipt).toEqual(p.output.meaningProposal);
      expect(receipt.candidates[0].assessment).toBe('ANCHORED_UNVERIFIED');
      expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [p.c.actor.ask.attemptId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        await new PostgresSurferSourceSession(pool).withRoutedSnapshot(
          p.f.actual.request,
          'READ',
          async (s) => s.profile,
        ),
      ).toBe(before);
    },
  );
  it('rolls back the inserted proposal if the publication transaction fails afterward', async () => {
    const p = await proposalFixture(),
      client = await pool.connect();
    try {
      await client.query('BEGIN');
      await p.port.assertPublication(client, {
        scope: p.c.scope,
        answerRunId: p.c.actor.ask.answerRunId,
        attemptId: p.c.actor.ask.attemptId,
        workerId: p.c.actor.ask.leaseOwner,
        resolvedContextDigest: p.completeInput.resolvedContextDigest,
        provider: p.output.provider,
        meaningProposal: p.output.meaningProposal,
      });
      expect(
        (
          await client.query(
            'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [p.c.actor.ask.attemptId],
          )
        ).rows[0].n,
      ).toBe(1);
      await expect(client.query('SELECT 1/0')).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
  });
  it.each(['source', 'receipt', 'producer', 'missing'])(
    'rejects changed %s before either final answer or proposal is written',
    async (kind) => {
      const p = await proposalFixture(),
        input = structuredClone(p.completeInput);
      if (kind === 'source')
        await p.f.actual.source('changed definition', { sourceId: p.stored.sourceId });
      if (kind === 'receipt') {
        const { digest: _, ...body } = input.meaningProposal!;
        body.candidates[0]!.label = 'forged';
        input.meaningProposal = { ...body, digest: surferDigest(body) };
      }
      if (kind === 'producer') input.provider = { provider: 'foreign', model: 'foreign' };
      if (kind === 'missing') delete input.meaningProposal;
      await expect(p.c.repository.complete(input)).rejects.toThrow();
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [p.c.actor.ask.attemptId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.statements WHERE answer_run_id=$1',
            [p.c.actor.ask.answerRunId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it('retains runtime immutability and parent-authorized Ask erasure of proposal receipts', async () => {
    const p = await proposalFixture();
    const runtimeUrl = new URL(target!);
    runtimeUrl.searchParams.set('options', '-c role=shotgun_runtime');
    const runtimePool = new Pool({ connectionString: runtimeUrl.href, max: 3 });
    try {
      await new PostgresAskAnswerExecutionRepository(
        runtimePool,
        new PostgresAskWorkspaceProjection(runtimePool),
        { resolve: async () => undefined },
        undefined,
        undefined,
        undefined,
        (c, i) => new PostgresSurferAskMemory(runtimePool).assertPublication(c, i),
      ).complete(p.completeInput);
      expect(
        (
          await runtimePool.query(
            'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [p.c.actor.ask.attemptId],
          )
        ).rows[0].receipt,
      ).toEqual(p.output.meaningProposal);
    } finally {
      await runtimePool.end();
    }
    const client = await pool.connect();
    try {
      for (const sql of [
        'UPDATE frontend_ask.surfer_meaning_proposals SET digest=digest WHERE attempt_id=$1',
        'DELETE FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
      ]) {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE shotgun_runtime');
        await expect(client.query(sql, [p.c.actor.ask.attemptId])).rejects.toMatchObject({
          code: '42501',
        });
        await client.query('ROLLBACK');
      }
      await expect(
        client.query(
          'UPDATE frontend_ask.surfer_meaning_proposals SET digest=digest WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
    }
    await pool.query('DELETE FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
      p.c.actor.ask.answerRunId,
    ]);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('rolls back a failed proposal INSERT together with final answer and permits exact completion afterward', async () => {
    const p = await proposalFixture();
    const other = await claimRule(p.f);
    await expect(
      pool.query(
        'INSERT INTO frontend_ask.surfer_meaning_proposals(attempt_id,answer_run_id,project_id,context_digest,receipt,digest) VALUES($1,$2,$3,$4,$5,$6)',
        [
          p.c.actor.ask.attemptId,
          other.actor.ask.answerRunId,
          p.c.scope.projectId,
          p.context.digest,
          p.output.meaningProposal,
          p.output.meaningProposal!.digest,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        'INSERT INTO frontend_ask.surfer_meaning_proposals(attempt_id,answer_run_id,project_id,context_digest,receipt,digest) VALUES($1,$2,$3,$4,$5,$6)',
        [
          p.c.actor.ask.attemptId,
          p.c.actor.ask.answerRunId,
          p.c.scope.projectId,
          surferDigest('foreign context'),
          p.output.meaningProposal,
          p.output.meaningProposal!.digest,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await pool.query(
      "CREATE FUNCTION frontend_ask.test_proposal_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'proposal failed'; END $$; CREATE TRIGGER test_proposal_fail BEFORE INSERT ON frontend_ask.surfer_meaning_proposals FOR EACH ROW EXECUTE FUNCTION frontend_ask.test_proposal_fail()",
    );
    try {
      await expect(p.c.repository.complete(p.completeInput)).rejects.toThrow();
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.statements WHERE answer_run_id=$1',
            [p.c.actor.ask.answerRunId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
            [p.c.actor.ask.attemptId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(
        'DROP TRIGGER test_proposal_fail ON frontend_ask.surfer_meaning_proposals; DROP FUNCTION frontend_ask.test_proposal_fail()',
      );
    }
    expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
  });
  it('preserves committed answer and proposal across lost completion COMMIT acknowledgement without model replay', async () => {
    const p = await proposalFixture();
    let inserted = false,
      lost = false;
    const tracked = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const c = await t.connect();
            return new Proxy(c, {
              get(q, key) {
                if (key === 'query')
                  return async (...args: unknown[]) => {
                    const result = await Reflect.apply(q.query, q, args);
                    if (
                      String(args[0]).includes('INSERT INTO frontend_ask.surfer_meaning_proposals')
                    )
                      inserted = true;
                    if (String(args[0]) === 'COMMIT' && inserted && !lost) {
                      lost = true;
                      throw Error('completion ack lost');
                    }
                    return result;
                  };
                const v = Reflect.get(q, key);
                return typeof v === 'function' ? v.bind(q) : v;
              },
            });
          };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const repository = new PostgresAskAnswerExecutionRepository(
      tracked,
      new PostgresAskWorkspaceProjection(tracked),
      { resolve: async () => undefined },
      undefined,
      undefined,
      undefined,
      (c, i) => new PostgresSurferAskMemory(pool).assertPublication(c, i),
    );
    await expect(repository.complete(p.completeInput)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(lost).toBe(true);
    expect((await p.c.repository.complete(p.completeInput)).state).toBe('SUCCEEDED');
    expect(
      (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE attempt_id=$1',
          [p.c.actor.ask.attemptId],
        )
      ).rows[0].receipt,
    ).toEqual(p.output.meaningProposal);
  });
  async function meaningFixture(kind = 'supported') {
    const f = await learned(),
      labels: Record<string, string> = {
        temperature: '온도',
        humidity: '습도',
        materialGrade: '재료등급',
      },
      lexicon = {
        contract: 'surfer.rule-field-lexicon.v1',
        domain: f.development.cases[0]!.domain,
        subject: kind === 'subject' ? 'Device A' : null,
        time: kind === 'time' ? 'Yesterday' : null,
        fields: Object.entries(f.development.cases[0]!.features).map(([name, v]) => ({
          name,
          type:
            typeof v.value === 'number'
              ? 'NUMBER'
              : typeof v.value === 'boolean'
                ? 'BOOLEAN'
                : 'TEXT',
          unit: kind === 'unit' && name === 'temperature' ? '°C' : (v.unit ?? null),
          aliases: [labels[name]!],
        })),
      },
      stored = await f.actual.source(JSON.stringify(lexicon)),
      material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(stored.sourceId)).material,
      ),
      selection = {
        sourceId: stored.sourceId,
        sourceVersionId: stored.sourceVersionId,
        evidenceIds: [material.rootEvidenceId],
      },
      question =
        Object.entries(f.development.cases[0]!.features)
          .map(([name, v]) => `${labels[name]}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`)
          .join('이고 ') + '입니다. 이 조건을 판단해줘.';
    const claim = () =>
      claimAsk(
        { actual: f.actual, stored: f.stored, remember: { selections: f.task.selections } },
        question,
        [selection],
      );
    return { f, lexicon, stored, selection, question, claim };
  }
  it.each([false, true])(
    'pins current Source-defined Korean meanings and replays exact RULE bindings with rows=%s',
    async (rows) => {
      const m = await meaningFixture();
      if (rows) await migrate(m.f.actual.projectId);
      const c = await m.claim(),
        port = new PostgresSurferAskMemory(pool),
        p = await port.prepare(c.scope, c.claimed);
      expect(p.revision).toBe('surfer.ask-memory.v4');
      expect(p.packet!.rules![0]!.outcome).toBe('TRUE');
      expect(p.packet!.rules![0]!.grounding!.aliases).toHaveLength(3);
      expect(p.packet!.sources.some((s) => s.sourceId === m.stored.sourceId)).toBe(true);
      expect(
        p.packet!.rules![0]!.citations.some((s) => s.evidenceId === m.selection.evidenceIds[0]),
      ).toBe(true);
      expect(await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed)).toEqual(p);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await port.assertPublication(client, {
          scope: c.scope,
          answerRunId: c.actor.ask.answerRunId,
          attemptId: c.actor.ask.attemptId,
          workerId: c.actor.ask.leaseOwner,
          resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  );
  it.each(['subject', 'time', 'unit'])(
    'keeps unsupported Source meaning %s UNKNOWN in an actual Ask',
    async (kind) => {
      const m = await meaningFixture(kind),
        c = await m.claim(),
        p = await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed);
      expect(p.revision).toBe('surfer.ask-memory.v7');
      expect(p.packet!.rules![0]!.outcome).toBe('UNKNOWN');
      expect(p.packet!.rules![0]!.reasons).toContain('UNSUPPORTED_FIELD_MEANING:temperature');
    },
  );
  it('rejects a changed meaning Source at validation and publication without rewriting the immutable pin', async () => {
    const m = await meaningFixture(),
      c = await m.claim(),
      port = new PostgresSurferAskMemory(pool),
      p = await port.prepare(c.scope, c.claimed);
    await m.f.actual.source(JSON.stringify({ ...m.lexicon, subject: 'changed scope' }), {
      sourceId: m.stored.sourceId,
    });
    await expect(port.validate(c.scope, c.claimed, p)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        port.assertPublication(client, {
          scope: c.scope,
          answerRunId: c.actor.ask.answerRunId,
          attemptId: c.actor.ask.attemptId,
          workerId: c.actor.ask.leaseOwner,
          resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        }),
      ).rejects.toMatchObject({ code: 'STALE_VERSION' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query(
          'SELECT context FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1',
          [c.actor.ask.attemptId],
        )
      ).rows[0].context,
    ).toEqual(p);
  });
  it('does not read a definition outside the Ask Evidence subset to repair a missing field meaning', async () => {
    const m = await meaningFixture(),
      c = await claimRule(m.f, m.question),
      p = await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed);
    expect(p.revision).toBe('surfer.ask-memory.v7');
    expect(p.packet!.rules![0]!.outcome).toBe('UNKNOWN');
    expect(p.packet!.sources.some((s) => s.sourceId === m.stored.sourceId)).toBe(false);
  });
  it('replays historical v3 alias UNKNOWN on SAME_CONTEXT while a new v4 request uses its Source definition', async () => {
    const m = await meaningFixture(),
      c = await m.claim(),
      port = new PostgresSurferAskMemory(pool),
      current = await port.prepare(c.scope, c.claimed),
      old = await m.claim(),
      packet = structuredClone(current.packet!),
      rule = packet.rules![0]!;
    packet.sources = packet.sources.filter((s) => s.sourceId !== m.stored.sourceId);
    rule.citations = rule.citations.filter((s) => s.sourceId !== m.stored.sourceId);
    rule.grounding = {
      revision: 'surfer.ask-declared-field-clauses.v1',
      questionDigest: surferDigest(m.question),
      bindings: [],
    };
    rule.premises = [];
    rule.outcome = 'UNKNOWN';
    rule.reasons = rule.fields.map((f) => 'MISSING_PREMISE:' + f.name);
    const v3 = pinSurferAskMemory(old.claimed.context.resolvedContextDigest, packet);
    await pool.query(
      'INSERT INTO frontend_ask.surfer_memory_context(attempt_id,answer_run_id,project_id,attempt_number,base_context_digest,context,digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        old.actor.ask.attemptId,
        old.actor.ask.answerRunId,
        old.scope.projectId,
        old.claimed.attempt.attemptNumber,
        v3.baseContextDigest,
        v3,
        v3.digest,
      ],
    );
    expect(await port.prepare(old.scope, old.claimed)).toEqual(v3);
    await old.repository.fail({
      scope: old.scope,
      answerRunId: old.actor.ask.answerRunId,
      attemptNumber: old.claimed.attempt.attemptNumber,
      state: 'FAILED',
      failure: { code: 'TIMEOUT', message: 'fixture', retryable: true, outcomeUnknown: false },
      workerId: old.actor.ask.leaseOwner,
    });
    const retry = await old.repository.retryAndClaim({
      scope: old.scope,
      answerRunId: old.actor.ask.answerRunId,
      mode: 'SAME_CONTEXT',
      workerId: 'retry-' + randomUUID(),
    });
    expect(await port.prepare(old.scope, retry!)).toEqual(v3);
    expect(current.packet!.rules![0]!.outcome).toBe('TRUE');
  });
  it.each([false, true])(
    'grounds declared-field sentence spans in a real Ask and replays after connection loss with rows=%s',
    async (rows) => {
      const f = await learned();
      if (rows) await migrate(f.actual.projectId);
      const question = scenarioSentence(f),
        c = await claimRule(f, question),
        port = new PostgresSurferAskMemory(pool),
        p = await port.prepare(c.scope, c.claimed);
      expect(p.revision).toBe('surfer.ask-memory.v3');
      expect(p.packet!.rules![0]!.outcome).toBe('TRUE');
      expect(p.packet!.rules![0]!.grounding!.bindings.map((b) => b.syntax)).toEqual([
        'DECLARED_FIELD_CLAUSE',
        'DECLARED_FIELD_CLAUSE',
        'DECLARED_FIELD_CLAUSE',
      ]);
      expect(await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed)).toEqual(p);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await port.assertPublication(client, {
          scope: c.scope,
          answerRunId: c.actor.ask.answerRunId,
          attemptId: c.actor.ask.attemptId,
          workerId: c.actor.ask.leaseOwner,
          resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  );
  it.each(['alias', 'ambiguous', 'negated'])(
    'keeps unsupported sentence meanings UNKNOWN in the actual Ask: %s',
    async (kind) => {
      const f = await learned();
      let q = scenarioSentence(f);
      if (kind === 'alias') q = q.replace('temperature', '온도');
      if (kind === 'ambiguous') q += ' temperature는 999 Cel.';
      if (kind === 'negated') q += ' 이 값은 사실이 아니다.';
      const c = await claimRule(f, q),
        p = await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed);
      expect(p.packet!.rules![0]!.outcome).toBe('UNKNOWN');
      expect(p.packet!.rules![0]!.reasons.length).toBeGreaterThan(0);
      expect(p.packet!.rules![0]!.grounding!.bindings.some((b) => b.name === 'temperature')).toBe(
        false,
      );
    },
  );
  it('replays historical v2 sentence UNKNOWN on SAME_CONTEXT without silently upgrading to v3', async () => {
    const f = await learned(),
      q = scenarioSentence(f),
      c = await claimRule(f, q),
      port = new PostgresSurferAskMemory(pool),
      v3 = await port.prepare(c.scope, c.claimed);
    // A second attempt models an immutable v2 pin produced by the previous explicit-only reader.
    const oldClaim = await claimRule(f, q),
      oldPacket = structuredClone(v3.packet!),
      rule = oldPacket.rules![0]!;
    delete rule.grounding;
    rule.premises = [];
    rule.outcome = 'UNKNOWN';
    rule.reasons = rule.fields.map((f) => 'MISSING_PREMISE:' + f.name);
    const v2 = pinSurferAskMemory(oldClaim.claimed.context.resolvedContextDigest, oldPacket);
    await pool.query(
      'INSERT INTO frontend_ask.surfer_memory_context(attempt_id,answer_run_id,project_id,attempt_number,base_context_digest,context,digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        oldClaim.actor.ask.attemptId,
        oldClaim.actor.ask.answerRunId,
        oldClaim.scope.projectId,
        oldClaim.claimed.attempt.attemptNumber,
        v2.baseContextDigest,
        v2,
        v2.digest,
      ],
    );
    expect(await port.prepare(oldClaim.scope, oldClaim.claimed)).toEqual(v2);
    await oldClaim.repository.fail({
      scope: oldClaim.scope,
      answerRunId: oldClaim.actor.ask.answerRunId,
      attemptNumber: oldClaim.claimed.attempt.attemptNumber,
      state: 'FAILED',
      failure: { code: 'TIMEOUT', message: 'fixture', retryable: true, outcomeUnknown: false },
      workerId: oldClaim.actor.ask.leaseOwner,
    });
    const retry = await oldClaim.repository.retryAndClaim({
      scope: oldClaim.scope,
      answerRunId: oldClaim.actor.ask.answerRunId,
      mode: 'SAME_CONTEXT',
      workerId: 'retry-' + randomUUID(),
    });
    expect(await port.prepare(oldClaim.scope, retry!)).toEqual(v2);
    expect(v3.packet!.rules![0]!.outcome).toBe('TRUE');
  });
  it('pins and reuses an immutable Evidence-subset interpretation context for the actual Ask attempt in both storage profiles', async () => {
    const f = await setup(),
      c = await claimAsk(f),
      port = new PostgresSurferAskMemory(pool),
      p = await port.prepare(c.scope, c.claimed);
    expect(p.packet?.items).toHaveLength(1);
    expect(p.packet?.storage).toBe('LEGACY');
    expect(p.baseContextDigest).toBe(c.claimed.context.resolvedContextDigest);
    expect((await port.prepare(c.scope, c.claimed)).digest).toBe(p.digest);
    await migrate(f.actual.projectId);
    await expect(port.validate(c.scope, c.claimed, p)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const next = await claimAsk(f),
      rows = await port.prepare(next.scope, next.claimed);
    expect(rows.packet?.storage).toBe('ROWS');
    expect(rows.packet?.items[0]?.memory).toEqual(p.packet?.items[0]?.memory);
  });
  it('rejects stale Source before provider use and inside the publication transaction', async () => {
    const f = await setup(),
      c = await claimAsk(f),
      port = new PostgresSurferAskMemory(pool),
      p = await port.prepare(c.scope, c.claimed);
    await f.actual.source('The document was revised.', { sourceId: f.stored.sourceId });
    await expect(port.validate(c.scope, c.claimed, p)).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        port.assertPublication(client, {
          scope: c.scope,
          answerRunId: c.actor.ask.answerRunId,
          attemptId: c.actor.ask.attemptId,
          workerId: c.actor.ask.leaseOwner,
          resolvedContextDigest: c.claimed.context.resolvedContextDigest,
        }),
      ).rejects.toMatchObject({ code: 'STALE_VERSION' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
  it('copies the same memory pin for SAME_CONTEXT retry and never adds current memory to an unpinned historical attempt', async () => {
    for (const legacy of [false, true]) {
      const f = await setup(),
        c = await claimAsk(f),
        port = new PostgresSurferAskMemory(pool),
        p = legacy ? null : await port.prepare(c.scope, c.claimed);
      await c.repository.fail({
        scope: c.scope,
        answerRunId: c.actor.ask.answerRunId,
        attemptNumber: c.claimed.attempt.attemptNumber,
        state: 'FAILED',
        failure: { code: 'TIMEOUT', message: 'fixture', retryable: true, outcomeUnknown: false },
        workerId: c.actor.ask.leaseOwner,
      });
      const retry = await c.repository.retryAndClaim({
        scope: c.scope,
        answerRunId: c.actor.ask.answerRunId,
        mode: 'SAME_CONTEXT',
        workerId: 'retry-' + randomUUID(),
      });
      expect(retry).toBeDefined();
      const reused = await port.prepare(c.scope, retry!);
      if (legacy) expect(reused.packet).toBeNull();
      else expect(reused.digest).toBe(p!.digest);
    }
  });
  it('rechecks kernel currentness at publication when an authority input changes without changing the active snapshot', async () => {
    for (const rows of [false, true]) {
      const f = await setup(rows),
        c = await claimAsk(f),
        port = new PostgresSurferAskMemory(pool);
      const p = await port.prepare(c.scope, c.claimed);
      await port.validate(c.scope, c.claimed, p);
      const source = new PostgresSurferSourceSession(pool);
      const command = {
        action: 'OBSERVE_INPUT' as const,
        operationId: randomUUID(),
        expectedRevision: null,
        input: {
          inputId: randomUUID(),
          revision: 1,
          kind: 'POLICY' as const,
          scope: {
            spaceId: f.actual.projectId,
            accessScope: ['owner'],
            sensitivity: 'private' as const,
          },
          contentDigest: surferDigest('changed policy'),
          retired: false,
          observedAt: new Date().toISOString(),
          witnesses: [],
        },
        affectedFootprints: [{ domain: 'surfer.ask.test-policy', predicate: '*' }],
      };
      if (rows)
        await source.withRowsSnapshot(f.actual.request, 'WRITE', (s) => s.core.execute(command));
      else
        await source.withSnapshotV2(f.actual.request, (s) =>
          new SurferKnowledgeService(s.store).execute(command, s.snapshot.context),
        );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          port.assertPublication(client, {
            scope: c.scope,
            answerRunId: c.actor.ask.answerRunId,
            attemptId: c.actor.ask.attemptId,
            workerId: c.actor.ask.leaseOwner,
            resolvedContextDigest: c.claimed.context.resolvedContextDigest,
          }),
        ).rejects.toMatchObject({ code: 'STALE_VERSION' });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  });
  it('preserves a committed pin across lost COMMIT acknowledgement without creating a second record', async () => {
    const f = await setup(),
      c = await claimAsk(f);
    let fail = true,
      inserted = false;
    const tracked = new Proxy(pool, {
        get(t, k) {
          if (k === 'connect')
            return async () => {
              const client = await t.connect();
              return new Proxy(client, {
                get(q, p) {
                  if (p === 'query')
                    return async (...args: unknown[]) => {
                      const result = await Reflect.apply(q.query, q, args);
                      if (
                        String(args[0]).includes('INSERT INTO frontend_ask.surfer_memory_context')
                      )
                        inserted = true;
                      if (String(args[0]) === 'COMMIT' && fail && inserted) {
                        fail = false;
                        throw Error('ack lost');
                      }
                      return result;
                    };
                  const v = Reflect.get(q, p);
                  return typeof v === 'function' ? v.bind(q) : v;
                },
              });
            };
          const v = Reflect.get(t, k);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      }),
      port = new PostgresSurferAskMemory(tracked);
    await expect(port.prepare(c.scope, c.claimed)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    const replay = await new PostgresSurferAskMemory(pool).prepare(c.scope, c.claimed);
    expect(replay.packet?.items).toHaveLength(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1',
          [c.actor.ask.attemptId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('rolls back failed pin insertion and forbids runtime UPDATE or DELETE of an existing pin', async () => {
    const f = await setup(),
      c = await claimAsk(f),
      port = new PostgresSurferAskMemory(pool);
    await pool.query(
      "CREATE FUNCTION frontend_ask.test_pin_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pin failed'; END $$; CREATE TRIGGER test_pin_fail BEFORE INSERT ON frontend_ask.surfer_memory_context FOR EACH ROW EXECUTE FUNCTION frontend_ask.test_pin_fail()",
    );
    try {
      await expect(port.prepare(c.scope, c.claimed)).rejects.toThrow();
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1',
            [c.actor.ask.attemptId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(
        'DROP TRIGGER test_pin_fail ON frontend_ask.surfer_memory_context; DROP FUNCTION frontend_ask.test_pin_fail()',
      );
    }
    const url = new URL(target!);
    url.searchParams.set('options', '-c role=shotgun_runtime');
    const runtime = new Pool({ connectionString: url.href, max: 2 });
    try {
      expect(
        (await new PostgresSurferAskMemory(runtime).prepare(c.scope, c.claimed)).packet?.items,
      ).toHaveLength(1);
      await expect(
        runtime.query(
          'UPDATE frontend_ask.surfer_memory_context SET digest=digest WHERE attempt_id=$1',
          [c.actor.ask.attemptId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('DELETE FROM frontend_ask.surfer_memory_context WHERE attempt_id=$1', [
          c.actor.ask.attemptId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtime.end();
    }
  });
  it('reads actual remembered context for a real accepted and claimed Ask in legacy and row storage without a session token', async () => {
    const f = await setup(),
      actor = await askActor(f),
      before = await f.runtime.ask(actor, input(f));
    expect(before).toMatchObject({
      status: 'ANSWER',
      modelCalls: 0,
      answers: [{ outcome: 'REQUIRED' }],
    });
    expect(JSON.stringify(actor)).not.toContain(f.actual.request.sessionToken);
    await migrate(f.actual.projectId);
    expect(await createSurferApplicationRuntime(pool).ask(actor, input(f))).toMatchObject({
      status: 'ANSWER',
      modelCalls: 0,
      answers: [{ outcome: 'REQUIRED' }],
    });
    await writeFile(
      '.data/surfer-routing-postgres/ask-read.json',
      JSON.stringify({
        realAskCommand: true,
        realClaimedAttempt: true,
        currentAuthor: true,
        legacyAndRows: true,
        sessionTokenStored: false,
        providerCalls: 0,
        modelCalls: 0,
        naturalAnswerIntegration: false,
        wholeEngine: false,
      }),
    );
  });
  it('rejects forged run project attempt and lease identities without returning context', async () => {
    const f = await setup(),
      a = await askActor(f),
      s = new PostgresSurferSourceSession(pool);
    for (const actor of [
      { ...a, projectId: 'other' },
      { ...a, ask: { ...a.ask, answerRunId: 'other' } },
      { ...a, ask: { ...a.ask, attemptId: 'other' } },
      { ...a, ask: { ...a.ask, leaseOwner: 'other' } },
    ])
      await expect(s.withMetadataSnapshot(actor, async (x) => x)).rejects.toMatchObject({
        code: 'POLICY_DENIED',
      });
  });
  it('blocks expired cancelled terminal and superseded attempts using database time', async () => {
    const f = await setup(),
      a = await askActor(f),
      s = new PostgresSurferSourceSession(pool),
      read = () => s.withMetadataSnapshot(a, async (x) => x);
    await pool.query(
      "UPDATE frontend_ask.answer_run_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE attempt_id=$1",
      [a.ask.attemptId],
    );
    await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await pool.query(
      "UPDATE frontend_ask.answer_run_attempts SET lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE attempt_id=$1",
      [a.ask.attemptId],
    );
    for (const state of ['CANCEL_REQUESTED', 'SUCCEEDED', 'OUTCOME_UNKNOWN']) {
      await pool.query('UPDATE frontend_ask.answer_runs SET state=$2 WHERE answer_run_id=$1', [
        a.ask.answerRunId,
        state,
      ]);
      await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    }
    await pool.query(
      "UPDATE frontend_ask.answer_runs SET state='RUNNING',attempt_number=attempt_number+1 WHERE answer_run_id=$1",
      [a.ask.answerRunId],
    );
    await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
  it('revalidates current principal membership clearance expiry project reset and policy', async () => {
    const f = await setup(),
      a = await askActor(f),
      s = new PostgresSurferSourceSession(pool),
      read = () => s.withMetadataSnapshot(a, async (x) => x);
    await pool.query("UPDATE auth.principals SET status='disabled' WHERE principal_id=$1", [
      principalId,
    ]);
    await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await pool.query("UPDATE auth.principals SET status='active' WHERE principal_id=$1", [
      principalId,
    ]);
    for (const clause of [
      "scopes=ARRAY['reader']::text[]",
      "sensitivity_clearance='public'",
      "expires_at=clock_timestamp()-interval '1 second'",
    ]) {
      await pool.query('UPDATE auth.project_memberships SET ' + clause + ' WHERE project_id=$1', [
        a.projectId,
      ]);
      await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
      await pool.query(
        "UPDATE auth.project_memberships SET scopes=ARRAY['owner']::text[],sensitivity_clearance='private',expires_at=NULL WHERE project_id=$1",
        [a.projectId],
      );
    }
    await pool.query("UPDATE project_admin.projects SET status='ARCHIVED' WHERE id=$1", [
      a.projectId,
    ]);
    await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await pool.query("UPDATE project_admin.projects SET status='ACTIVE' WHERE id=$1", [
      a.projectId,
    ]);
    await pool.query(
      "UPDATE frontend_ask.answer_runs SET policy_context_revision='999' WHERE answer_run_id=$1",
      [a.ask.answerRunId],
    );
    await expect(read()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
  it('does not grant owner write capture observation or worker authority to an Ask read actor', async () => {
    const f = await setup(),
      a = await askActor(f),
      s = new PostgresSurferSourceSession(pool);
    expect((await s.withMetadataSnapshot(a, async (x) => x)).canSynchronize).toBe(false);
    await expect(s.withSnapshotV2(a, async () => null)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(s.withRowsSnapshot(a, 'WRITE', async () => null)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(f.runtime.directive.remember(a, f.remember)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(
      f.runtime.sessions.withReadSession(a, (s) =>
        s.source.observe(a, { schemaVersion: '1.0.0', selections: f.remember.selections }),
      ),
    ).rejects.toThrow('Read-only');
  });
  it('rejects fresh lease cancellation and membership changes committed during the Source callback', async () => {
    const f = await setup(),
      a = await askActor(f),
      s = new PostgresSurferSourceSession(pool);
    await expect(
      s.withMetadataSnapshot(a, async (snapshot) => {
        await pool.query(
          "UPDATE frontend_ask.answer_runs SET state='CANCEL_REQUESTED' WHERE answer_run_id=$1",
          [a.ask.answerRunId],
        );
        return snapshot;
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await pool.query("UPDATE frontend_ask.answer_runs SET state='RUNNING' WHERE answer_run_id=$1", [
      a.ask.answerRunId,
    ]);
    await expect(
      s.withMetadataSnapshot(a, async (snapshot) => {
        await pool.query(
          "UPDATE auth.project_memberships SET scopes=ARRAY['reader']::text[] WHERE project_id=$1",
          [a.projectId],
        );
        return snapshot;
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
  it('allows a valid heartbeat extension and still returns the same read-only actor principal', async () => {
    const f = await setup(),
      a = await askActor(f),
      s = new PostgresSurferSourceSession(pool);
    expect(
      (
        await s.withMetadataSnapshot(a, async (snapshot) => {
          await pool.query(
            "UPDATE frontend_ask.answer_run_attempts SET lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE attempt_id=$1",
            [a.ask.attemptId],
          );
          return snapshot;
        })
      ).principalId,
    ).toBe(principalId);
  });
  it('keeps absent legacy memory uninitialized with actual READ ONLY no mutations and no row locks', async () => {
    const actual = await createSurferSourceFixture(pool, principalId),
      stored = await actual.source('This fresh source has no remembered interpretation.'),
      material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
        actual.request,
        async (s) => (await s.readMaterialV2(stored.sourceId)).material,
      ),
      a = await askActor({
        actual,
        stored,
        remember: { selections: [{ evidenceId: material.rootEvidenceId }] },
      });
    let readOnly = false,
      mutations = 0,
      locks = 0;
    const tracked = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const c = await t.connect();
            return new Proxy(c, {
              get(client, p) {
                if (p === 'query')
                  return (...args: unknown[]) => {
                    const sql = String(args[0]);
                    if (/^BEGIN.*READ ONLY/.test(sql)) readOnly = true;
                    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) mutations++;
                    if (/FOR (?:NO KEY )?UPDATE/i.test(sql)) locks++;
                    return Reflect.apply(client.query, client, args);
                  };
                const value = Reflect.get(client, p);
                return typeof value === 'function' ? value.bind(client) : value;
              },
            });
          };
        const value = Reflect.get(t, k);
        return typeof value === 'function' ? value.bind(t) : value;
      },
    });
    expect(
      await createSurferApplicationRuntime(tracked).sessions.withReadSession(a, (s) =>
        s.read(null),
      ),
    ).toMatchObject({ status: 'UNAVAILABLE' });
    expect(readOnly).toBe(true);
    expect(mutations).toBe(0);
    expect(locks).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM surfer_knowledge.space_state WHERE space_id=$1',
          [a.projectId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM surfer_knowledge.source_binding_v2 WHERE space_id=$1',
          [a.projectId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('reads through the actual runtime DB role and expires the returned Source facade after its callback', async () => {
    const f = await setup(),
      a = await askActor(f),
      url = new URL(target!);
    url.searchParams.set('options', '-c role=shotgun_runtime');
    const runtimePool = new Pool({ connectionString: url.href, max: 2 }),
      s = new PostgresSurferSourceSession(runtimePool);
    let escaped!: { readContentProofV2(id: string): Promise<string> };
    try {
      await s.withRoutedSnapshot(a, 'READ', async (r) => {
        escaped = r.session;
        expect(r.session.snapshot.canSynchronize).toBe(false);
        expect(await r.session.readContentProofV2(f.stored.sourceId)).toMatch(/^sha256:/);
      });
      await expect(escaped.readContentProofV2(f.stored.sourceId)).rejects.toThrow('expired');
    } finally {
      await runtimePool.end();
    }
  });
  it('uses legacy by default and preserves typed answers after cutover without caller profile selection', async () => {
    const f = await setup(),
      before = await f.runtime.ask(f.actual.request, input(f));
    expect(before).toMatchObject({
      status: 'ANSWER',
      answers: [{ outcome: 'REQUIRED' }],
      modelCalls: 0,
    });
    const g = await migrate(f.actual.projectId),
      after = await createSurferApplicationRuntime(pool).ask(f.actual.request, input(f));
    await writeFile(
      '.data/surfer-routing-postgres/answers.json',
      JSON.stringify({ before, after }, null, 2),
    );
    const oldAnswer = before as Record<string, unknown>,
      newAnswer = after as Record<string, unknown>;
    const { readReceipt: oldReceipt, ...oldResult } = oldAnswer;
    const { readReceipt: newReceipt, ...newResult } = newAnswer;
    expect(newResult).toEqual(oldResult);
    const { observedAt: oldTime, ...oldProof } = oldReceipt as Record<string, unknown>;
    const {
      observedAt: newTime,
      storageProfile,
      ...newProof
    } = newReceipt as Record<string, unknown>;
    expect(newProof).toEqual(oldProof);
    expect(storageProfile).toBe('surfer.source-rows.v1');
    expect(Date.parse(String(newTime))).toBeGreaterThanOrEqual(Date.parse(String(oldTime)));
    expect(g.routeMode).toBe('ROWS');
    expect((await f.runtime.directive.remember(f.actual.request, f.remember)).replayed).toBe(true);
  });
  it('runs row Ask in actual READ ONLY mode and performs no SQL mutations', async () => {
    const f = await setup(true);
    let readOnly = false,
      mutations = 0;
    const tracked = new Proxy(pool, {
      get(t, k) {
        if (k === 'connect')
          return async () => {
            const client = await t.connect();
            return new Proxy(client, {
              get(c, p) {
                if (p === 'query')
                  return (...a: unknown[]) =>
                    Reflect.apply(c.query, c, a).then(async (r: unknown) => {
                      const sql = String(a[0]);
                      if (sql === 'SET TRANSACTION READ ONLY')
                        readOnly =
                          (await c.query('SHOW transaction_read_only')).rows[0]!
                            .transaction_read_only === 'on';
                      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) mutations++;
                      return r;
                    });
                const v = Reflect.get(c, p);
                return typeof v === 'function' ? v.bind(c) : v;
              },
            });
          };
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    expect(
      await createSurferApplicationRuntime(tracked).ask(f.actual.request, input(f)),
    ).toMatchObject({ status: 'ANSWER', modelCalls: 0 });
    expect(readOnly).toBe(true);
    expect(mutations).toBe(0);
  });
  it('refuses COPYING without fallback and allows only reads after suspension', async () => {
    const f = await setup(),
      m = manager(f.actual.projectId);
    let g = await startMigration(f.actual.projectId);
    await expect(f.runtime.ask(f.actual.request, input(f))).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expect(f.runtime.directive.remember(f.actual.request, f.remember)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    while (g.cursor < g.total) g = await m.copyBatch(g.generationId, g.cursor, 16);
    g = await m.seal(g.generationId);
    g = await m.activate(g.generationId, g.routeRevision);
    await m.suspend(g.generationId, g.routeRevision);
    expect(await f.runtime.ask(f.actual.request, input(f))).toMatchObject({ status: 'ANSWER' });
    await expect(f.runtime.directive.remember(f.actual.request, f.remember)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
  });
  it('does not downgrade routes on concurrent changes and expires routed actor capabilities', async () => {
    const f = await setup(true);
    let escaped: SurferScopedRuleMemorySession | undefined;
    await f.runtime.sessions.withReadSession(f.actual.request, async (s) => {
      escaped = s;
      expect(() =>
        s.capture({ schemaVersion: '2.0.0', sourceIds: [], artifacts: [], queries: [] }),
      ).toThrow(/Read-only/);
    });
    expect(() => escaped!.read(null)).toThrow(/escaped/);
    await expect(
      f.runtime.sessions.withReadSession({ ...f.actual.request, projectId: 'foreign' }, (s) =>
        s.read(null),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await f.actual.source('new Source', { sourceId: f.stored.sourceId });
    expect(await f.runtime.ask(f.actual.request, input(f))).toMatchObject({
      status: 'SOURCE_UNAVAILABLE',
      answers: [],
    });
  });
  it('supports current member row reads while refusing worker writes without ownership', async () => {
    const f = await setup(true);
    await pool.query(
      'UPDATE auth.project_memberships SET is_owner=false WHERE principal_id=$1 AND project_id=$2',
      [principalId, f.actual.projectId],
    );
    expect(await f.runtime.ask(f.actual.request, input(f))).toMatchObject({ status: 'ANSWER' });
    await expect(f.runtime.directive.remember(f.actual.request, f.remember)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
  it('uses minimum runtime grants and prevents runtime control/stage mutation', async () => {
    const f = await setup(true),
      restricted = new Proxy(pool, {
        get(t, k) {
          if (k === 'connect')
            return async () => {
              const c = await t.connect();
              return new Proxy(c, {
                get(client, p) {
                  if (p === 'query')
                    return (...a: unknown[]) =>
                      Reflect.apply(client.query, client, a).then(async (r: unknown) => {
                        if (String(a[0]).startsWith('BEGIN'))
                          await client.query('SET LOCAL ROLE shotgun_runtime');
                        return r;
                      });
                  const v = Reflect.get(client, p);
                  return typeof v === 'function' ? v.bind(client) : v;
                },
              });
            };
          const v = Reflect.get(t, k);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    const runtime = createSurferApplicationRuntime(restricted);
    expect(await runtime.ask(f.actual.request, input(f))).toMatchObject({ status: 'ANSWER' });
    expect((await runtime.directive.remember(f.actual.request, f.remember)).replayed).toBe(true);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE shotgun_runtime');
      await expect(
        c.query("UPDATE surfer_rows.route SET mode='LEGACY' WHERE space_id=$1", [
          f.actual.projectId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE shotgun_runtime');
      await expect(c.query('SELECT * FROM surfer_rows.stage')).rejects.toMatchObject({
        code: '42501',
      });
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  it('serves authenticated app Ask across route changes and rejects CSRF/actor/profile injection', async () => {
    const f = await setup(),
      app = await createApplication({
        authRepository: new PostgresAuthRepository(pool),
        surferRuntime: f.runtime,
      });
    const send = (
      payload: unknown = input(f),
      headers: Record<string, string> = {
        cookie: `shotgun_session=${f.actual.session.sessionToken}`,
        'x-csrf-token': f.actual.session.csrfToken,
      },
    ) =>
      app.server.inject({
        method: 'POST',
        url: '/api/v1/surfer/memory/ask',
        headers,
        payload: payload as Record<string, unknown>,
      });
    try {
      expect((await send()).statusCode).toBe(200);
      expect((await send()).json()).toMatchObject({ status: 'ANSWER' });
      await migrate(f.actual.projectId);
      expect((await send()).json()).toMatchObject({ status: 'ANSWER' });
      expect((await send(input(f), {})).statusCode).not.toBe(200);
      expect(
        (await send(input(f), { cookie: `shotgun_session=${f.actual.session.sessionToken}` }))
          .statusCode,
      ).not.toBe(200);
      expect(
        (await send({ ...input(f), actor: { projectId: 'foreign' }, profile: 'LEGACY' }))
          .statusCode,
      ).not.toBe(200);
      expect(
        (
          await app.server.inject({
            method: 'POST',
            url: '/api/v1/surfer/memory/remember',
            payload: {},
          })
        ).statusCode,
      ).not.toBe(200);
    } finally {
      await app.server.close();
    }
  });
  it('consumes a completed server-owned local proof on the routed learning worker and asks after restart', async () => {
    const root = '.data/surfer-routing-postgres/proof-' + randomUUID(),
      f = await boundedSourceFixture(pool, principalId, root);
    let trial;
    try {
      trial = await f.trial().run(f.actual.request, f.task);
    } finally {
      f.proposer.close();
    }
    expect(trial.evaluation?.receipt.status).toBe('SCOPE_VALIDATED');
    const proof = new SurferBoundedRuleProofReader(
      {
        task: f.task,
        development: f.development,
        descriptor: await f.corpus.evaluation.describe(f.context),
      },
      f.ledger,
      f.experiments,
    );
    await migrate(f.actual.projectId);
    const runtime = createSurferApplicationRuntime(pool),
      worker = runtime.createLearningWorker(proof),
      command = {
        schemaVersion: '1.0.0',
        contract: 'surfer.scoped-rule-memory.v1',
        operationId: 'learn:' + randomUUID(),
        memoryId: 'rule:' + randomUUID(),
        proofId: proof.proofId,
        expectedRevision: null,
        expectedActiveSnapshotId: null,
      };
    await worker.remember(f.actual.request, command);
    const question = {
        schemaVersion: '1.0.0',
        contract: 'surfer.scoped-rule-question.v1',
        snapshotId: null,
        memoryId: command.memoryId,
        kind: 'APPLY',
        features: structuredClone(f.development.cases[0]!.features),
      },
      answer = await createSurferApplicationRuntime(pool).ask(f.actual.request, {
        kind: 'RULE',
        question,
      });
    expect(answer).toMatchObject({
      status: 'ANSWER',
      modelCalls: 0,
      semanticAssessment: 'NOT_EVALUATED',
      execution: 'ADVISORY_NOT_ACTION',
    });
    expect((await worker.remember(f.actual.request, command)).replayed).toBe(true);
    const g = await manager(f.actual.projectId).inspect(
      (
        await pool.query<{ generation_id: string }>(
          'SELECT generation_id FROM surfer_rows.route WHERE space_id=$1',
          [f.actual.projectId],
        )
      ).rows[0]!.generation_id,
    );
    await manager(f.actual.projectId).suspend(g.generationId, g.routeRevision);
    expect(await runtime.ask(f.actual.request, { kind: 'RULE', question })).toMatchObject({
      status: 'ANSWER',
    });
    await expect(worker.remember(f.actual.request, command)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await writeFile(
      '.data/surfer-routing-postgres/worker.json',
      JSON.stringify({
        completedLocalProofConsumed: true,
        routedRemember: true,
        restartAsk: true,
        modelCalls: 0,
        advisoryNotAction: true,
        readAfterSuspension: true,
        writeAfterSuspensionBlocked: true,
        newIndependentLearningScore: false,
      }),
    );
  });
});
