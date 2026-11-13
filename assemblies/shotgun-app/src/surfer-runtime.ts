import { createSurferMeaningRuntime } from './surfer-meaning-runtime.js';
import { PostgresSurferIntakeInbox } from '../../../adapters/surfer-intake-postgres/src/index.js';
import { SurferIntakeWorker } from '../../../adapters/surfer-document-memory/src/intake.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import {
  decodeSurferReadiness,
  decodeSurferReadinessQuery,
  type SurferReadinessState,
} from '../../../packages/contracts/src/surfer-readiness.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import {
  decodeSurferIntakePage,
  decodeSurferIntakeResume,
} from '../../../packages/contracts/src/surfer-intake.js';
import type { Pool } from 'pg';
import { PostgresSurferSourceSession } from '../../../adapters/surfer-shotgun-source-postgres/src/index.js';
import { ShotgunSurferRoutedMemorySession } from '../../../adapters/surfer-shotgun-bridge/src/routed-memory.js';
import { SurferDirectiveMemoryService } from '../../../modules/surfer-core/src/directive-memory.js';
import { SurferGuidedMemoryService } from '../../../modules/surfer-core/src/guided-memory.js';
import { SurferScopedRuleMemoryService } from '../../../modules/surfer-learning/src/rule-memory.js';
import { SurferGuidedRuleMemoryService } from '../../../modules/surfer-learning/src/guided-rule-memory.js';
import { ShotgunSurferDocumentWork } from '../../../adapters/surfer-shotgun-bridge/src/document-work.js';
import { SurferDocumentMemoryWorker } from '../../../adapters/surfer-document-memory/src/document-work.js';
import type {
  SurferProviderProfile,
  SurferProviderGatewayPort,
} from '../../../packages/contracts/src/surfer-provider.js';
import type { SurferExecutionLedger } from '../../../modules/surfer-execution/src/index.js';
import { SurferDirectiveScenarioEvaluatorV2 } from '../../../adapters/surfer-memory-query/src/index.js';
import type { SurferScopedRuleProofPort } from '../../../packages/contracts/src/surfer-rule-memory.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';

export type SurferDocumentExecutionOptions = {
  runId: string;
  profile: SurferProviderProfile;
  ledger: SurferExecutionLedger;
  gateway: SurferProviderGatewayPort;
  ensureCurrent?: (actor: unknown) => Promise<void>;
  inspectReadiness?: (actor: unknown) => Promise<SurferReadinessState>;
};
/** No migration, scheduler, provider dispatch or auth bootstrap occurs during construction. */
export function createSurferApplicationRuntime(
  pool: Pool,
  execution?: SurferDocumentExecutionOptions,
  meaningExecution?: SurferDocumentExecutionOptions,
  meaningLaunchScope?: { notBeforeMs: number; principalId: string },
) {
  const rawSessions = new PostgresSurferSourceSession(pool),
    sessions = new ShotgunSurferRoutedMemorySession(rawSessions),
    directive = new SurferDirectiveMemoryService(
      sessions,
      new SurferDirectiveScenarioEvaluatorV2(),
    ),
    rules = new SurferScopedRuleMemoryService(sessions),
    guided = new SurferGuidedMemoryService(sessions, new SurferDirectiveScenarioEvaluatorV2()),
    guidedRules = new SurferGuidedRuleMemoryService(sessions);
  const inbox = new PostgresSurferIntakeInbox(pool);
  const createDocumentWorker = (options: SurferDocumentExecutionOptions) => {
    const profile = structuredClone(options.profile);
    return new SurferDocumentMemoryWorker(
      new ShotgunSurferDocumentWork(rawSessions, new SurferDirectiveScenarioEvaluatorV2(), {
        runId: options.runId,
        profileDigest: surferDigest(profile),
      }),
      {
        observe: (actor, input) =>
          sessions.withSession(actor, (s) => s.source.observe(actor, input)),
        withCurrent: (actor, basis, selections, fn) =>
          sessions.withReadSession(actor, (s) =>
            s.source.withCurrent(actor, basis, selections, fn),
          ),
      },
      options.ledger,
      options.gateway,
      profile,
    );
  };
  const createIntakeWorker = (options: SurferDocumentExecutionOptions) => {
    const ensureCurrent = options.ensureCurrent;
    return new SurferIntakeWorker(
      inbox,
      createDocumentWorker(options),
      async (actor) => {
        await ensureCurrent?.(actor);
        return rawSessions.withRoutedSnapshot(
          decodeSurferSourceRequest(actor),
          'WRITE',
          async (raw) => {
            if (!raw.session.snapshot.canSynchronize)
              throw new ShotgunError({
                code: 'POLICY_DENIED',
                safeMessage: 'Intake execution requires current owner authority.',
                module: 'surfer.application',
                operation: 'intake-cycle',
              });
            return {
              projectId: raw.session.snapshot.projectId,
              principalId: raw.session.snapshot.principalId,
            };
          },
        );
      },
      {
        runId: options.runId,
        profileDigest: surferDigest(options.profile),
        leaseMs: Math.max(30000, options.ledger.policy.unitMaxMs + 30000),
      },
    );
  };
  const fixed = execution
    ? { ...execution, profile: structuredClone(execution.profile) }
    : undefined;
  const worker = fixed ? createIntakeWorker(fixed) : undefined;
  const owner = (actor: unknown) =>
    rawSessions.withMetadataSnapshot(decodeSurferSourceRequest(actor), async (snapshot) => {
      if (!snapshot.canSynchronize)
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: 'Intake operations require current owner authority.',
          module: 'surfer.application',
          operation: 'intake-status',
        });
      return snapshot;
    });
  const meaningReviews = createSurferMeaningRuntime(
    pool,
    {
      observe: (actor, input) => sessions.withSession(actor, (s) => s.source.observe(actor, input)),
      withCurrent: (actor, basis, selections, fn) =>
        sessions.withReadSession(actor, (s) => s.source.withCurrent(actor, basis, selections, fn)),
    },
    owner,
    meaningExecution,
    meaningLaunchScope?.notBeforeMs,
  );
  return {
    meaningReviews,
    sessions,
    executionReadiness: async (actor: unknown, input: unknown) => {
      decodeSurferReadinessQuery(input);
      const before = await owner(actor);
      const binding = fixed?.ledger.policy.allowedSpaceIds.includes(before.projectId)
        ? fixed
        : meaningLaunchScope?.principalId === before.principalId &&
            meaningExecution?.ledger.policy.allowedSpaceIds.includes(before.projectId)
          ? meaningExecution
          : undefined;
      let state: SurferReadinessState = !binding
        ? 'NOT_CONFIGURED'
        : !binding.inspectReadiness
          ? 'EXTERNAL_EXECUTION'
          : 'UNAVAILABLE';
      if (binding?.inspectReadiness)
        try {
          state = await binding.inspectReadiness(actor);
        } catch {
          state = 'UNAVAILABLE';
        }
      const after = await owner(actor);
      if (before.digest !== after.digest)
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'Execution settings access changed during inspection.',
          module: 'surfer.application',
          operation: 'execution-readiness',
        });
      return decodeSurferReadiness({ schemaVersion: '1.0.0', state });
    },
    directive,
    catalog: (actor: unknown) => guided.catalog(actor),
    guidedAsk: (actor: unknown, input: unknown) => guided.ask(actor, input),
    ruleCatalog: (actor: unknown) => guidedRules.catalog(actor),
    guidedRuleAsk: (actor: unknown, input: unknown) => guidedRules.ask(actor, input),
    createDocumentWorker,
    onSourceIndexed: (input: unknown) => inbox.enqueue(input),
    createIntakeWorker,
    intakeStatus: async (actor: unknown, input: unknown) => {
      const query = decodeSurferIntakePage(input),
        before = await owner(actor);
      await fixed?.ensureCurrent?.(actor);
      const rows = await inbox.list(
        before.projectId,
        before.heads.map((h) => h.sourceId),
        query.cursor,
      );
      const after = await owner(actor);
      if (before.digest !== after.digest)
        throw new ShotgunError({
          code: 'STALE_VERSION',
          safeMessage: 'Intake access changed during metadata inspection.',
          module: 'surfer.application',
          operation: 'intake-status',
        });
      const page = rows.slice(0, 20),
        last = page.at(-1);
      return {
        executionConfigured: !!fixed,
        items: page.map((r) => {
          const head = before.heads.find((h) => h.sourceId === r.source_id);
          const recovery =
            r.state !== 'RUNNING'
              ? 'UNAVAILABLE'
              : !fixed
                ? 'NOT_CONFIGURED'
                : r.principal_id !== before.principalId ||
                    r.run_id !== fixed.runId ||
                    r.profile_digest !== surferDigest(fixed.profile)
                  ? 'CONFIGURATION_MISMATCH'
                  : head?.sourceVersionId !== r.source_version_id ||
                      head.revisionId !== r.revision_id ||
                      head.readiness !== 'INDEXED'
                    ? 'SOURCE_CHANGED'
                    : !r.expired
                      ? 'WAIT_LEASE'
                      : 'AVAILABLE';
          return {
            jobId: r.job_id,
            sourceId: r.source_id,
            sourceVersionId: r.source_version_id,
            revisionId: r.revision_id,
            revision: r.revision,
            state: r.state,
            code: r.safe_code,
            updatedAt: r.updated_at.toISOString(),
            recovery,
          };
        }),
        nextCursor:
          rows.length > 20 && last
            ? { jobId: last.job_id, createdAt: last.cursor_created_at }
            : null,
      };
    },
    resumeIntake: async (actor: unknown, input: unknown) => {
      const target = decodeSurferIntakeResume(input);
      await owner(actor);
      if (!worker) return { status: 'NOT_CONFIGURED' as const };
      const result = await worker.cycle(actor, target);
      // Public operation never returns the internal receipt/prepared reference.
      return {
        status: result.status,
        ...(result.status === 'BLOCKED' ? { code: result.code } : {}),
        ...(result.status !== 'EMPTY' ? { jobId: result.jobId } : {}),
      };
    },
    createLearningWorker: (proofs: SurferScopedRuleProofPort) =>
      new SurferScopedRuleMemoryService(sessions, proofs),
    ask: async (actor: unknown, input: unknown) => {
      assertSurferJson(input);
      const r = structuredClone(input) as { kind: string; question: unknown };
      if (
        !r ||
        Object.keys(r).sort().join(',') !== 'kind,question' ||
        !['DIRECTIVE', 'RULE'].includes(r.kind)
      )
        throw surferFailure('Expected a typed memory question.');
      return r.kind === 'DIRECTIVE'
        ? directive.ask(actor, r.question)
        : rules.ask(actor, r.question);
    },
  };
}
