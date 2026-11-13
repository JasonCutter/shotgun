import type { Pool } from 'pg';
import {
  PostgresSurferMeaningIntents,
  selectAutomaticMeaningInputs,
  assertAutomaticMeaningView,
} from '../../../adapters/surfer-ask-memory-postgres/src/meaning-auto.js';
import { PostgresSurferMeaningQueue } from '../../../adapters/surfer-ask-memory-postgres/src/meaning-queue.js';
import { PostgresSurferMeaningVerification } from '../../../adapters/surfer-ask-memory-postgres/src/meaning-verification.js';
import { SurferMeaningQueueWorker } from '../../../modules/surfer-execution/src/meaning-queue.js';
import {
  decodeSurferMeaningQueueInput,
  type SurferMeaningQueueIdentity,
} from '../../../packages/contracts/src/surfer-meaning-queue.js';
import { isSurferMeaningVerifierRevision } from '../../../packages/contracts/src/surfer-meaning-verification.js';
import type { SurferCognitiveSourcePort } from '../../../packages/contracts/src/surfer-cognition.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import type { SurferDocumentExecutionOptions } from './surfer-runtime.js';
import {
  startSurferIntakeScheduler,
  type SurferIntakeScheduleOptions,
} from './surfer-intake-scheduler.js';
export type SurferMeaningApplicationOptions = SurferIntakeScheduleOptions & {
  execution: SurferDocumentExecutionOptions;
};
type Owner = { projectId: string; principalId: string; digest: string };
/** Fixed preparations and one bounded review worker inside the existing Surfer host. */
export function createSurferMeaningRuntime(
  pool: Pool,
  source: SurferCognitiveSourcePort,
  owner: (actor: unknown) => Promise<Owner>,
  execution?: SurferDocumentExecutionOptions,
  questionNotBeforeMs?: number,
) {
  const queue = new PostgresSurferMeaningQueue(pool);
  const intents = new PostgresSurferMeaningIntents(pool);
  const bind = (options: SurferDocumentExecutionOptions) => {
    const profile = structuredClone(options.profile),
      context = {
        runId: options.runId,
        profileDigest: surferDigest(profile),
        leaseMs: Math.max(30000, options.ledger.policy.unitMaxMs + 30000),
      },
      ensureCurrent = options.ensureCurrent;
    if (!isSurferMeaningVerifierRevision(profile.promptRevision))
      throw surferFailure('A fixed meaning review profile is required.');
    const authorized = async (actor: unknown) => {
      await ensureCurrent?.(actor);
      const a = await owner(actor);
      if (!options.ledger.policy.allowedSpaceIds.includes(a.projectId))
        throw surferFailure('Meaning review project is outside the fixed run.');
      return a;
    };
    const guarded: SurferCognitiveSourcePort = {
      observe: async (a, s) => {
        const before = await authorized(a),
          result = await source.observe(a, s),
          after = await authorized(a);
        if (before.digest !== after.digest)
          throw surferFailure('Meaning source authority changed.');
        return result;
      },
      withCurrent: async (a, b, s, fn) => {
        const before = await authorized(a),
          result = await source.withCurrent(a, b, s, fn),
          after = await authorized(a);
        if (before.digest !== after.digest)
          throw surferFailure('Meaning source authority changed.');
        return result;
      },
    };
    const verifier = new PostgresSurferMeaningVerification(
        pool,
        guarded,
        options.ledger,
        options.gateway,
        profile,
        questionNotBeforeMs === undefined ? undefined : authorized,
      ),
      authorize = async (actor: unknown) => {
        const a = await authorized(actor);
        return { projectId: a.projectId, principalId: a.principalId };
      };
    const worker = new SurferMeaningQueueWorker(queue, verifier, authorize, context);
    const enqueue = async (
      actor: unknown,
      request: ReturnType<typeof decodeSurferMeaningQueueInput>,
      passages?: Extract<
        ReturnType<typeof selectAutomaticMeaningInputs>,
        { code: 'READY' }
      >['passages'],
    ) => {
      const before = await authorized(actor),
        identity = { projectId: before.projectId, principalId: before.principalId, ...context };
      const prior = await queue.inspect(identity, request);
      if (prior) return { status: 'ENQUEUED' as const, ...prior, replayed: true };
      const work = await verifier.prepare(actor, request.reference, request.selections),
        after = await authorized(actor);
      if (before.digest !== after.digest) throw surferFailure('Meaning enqueue authority changed.');
      if (passages)
        await guarded.withCurrent(actor, work.basis, work.selections, (v) =>
          assertAutomaticMeaningView(v, passages),
        );
      return { status: 'ENQUEUED' as const, ...(await queue.enqueue(identity, work)) };
    };
    const registerPending = async (actor: unknown) => {
      const before = await authorized(actor),
        identity: SurferMeaningQueueIdentity = {
          projectId: before.projectId,
          principalId: before.principalId,
          ...context,
        };
      const saved = await intents.pending(identity, questionNotBeforeMs);
      if (!saved) return;
      const selected = selectAutomaticMeaningInputs(saved);
      if (selected.code !== 'READY') {
        await intents.delivered(identity, saved.attemptId, selected.code, []);
        return;
      }
      // A new Source version or changed classification must never be silently selected.
      try {
        const view = await guarded.observe(actor, {
          schemaVersion: '1.0.0',
          selections: selected.inputs[0]!.selections,
        });
        assertAutomaticMeaningView(view, selected.passages);
      } catch {
        const after = await authorized(actor);
        if (before.digest !== after.digest)
          throw surferFailure('Automatic meaning authority changed.');
        await intents.delivered(identity, saved.attemptId, 'SOURCE_UNAVAILABLE', []);
        return;
      }
      const jobs: string[] = [];
      for (const { reference, selections } of selected.inputs)
        jobs.push((await enqueue(actor, { reference, selections }, selected.passages)).jobId);
      const after = await authorized(actor);
      if (before.digest !== after.digest)
        throw surferFailure('Automatic meaning authority changed.');
      await intents.delivered(identity, saved.attemptId, 'ENQUEUED', jobs);
    };
    return {
      worker,
      verifier,
      authorized,
      context,
      enqueue,
      registerPending,
      cycle: async (actor: unknown) => {
        await registerPending(actor);
        return worker.cycle(actor);
      },
    };
  };
  const fixed = execution ? bind(execution) : undefined;
  return {
    createWorker: (options: SurferDocumentExecutionOptions) => bind(options),
    cycle: (actor: unknown) =>
      fixed ? fixed.cycle(actor) : Promise.resolve({ status: 'NOT_CONFIGURED' as const }),
    enqueue: async (actor: unknown, input: unknown) => {
      const request = decodeSurferMeaningQueueInput(input);
      await owner(actor);
      if (!fixed) return { status: 'NOT_CONFIGURED' as const };
      return fixed.enqueue(actor, request);
    },
  };
}
export function startApplicationSurferMeaning(
  runtime: {
    meaningReviews: {
      createWorker: (execution: SurferDocumentExecutionOptions) => {
        cycle: (actor: unknown) => Promise<{ status: 'EMPTY' | 'COMPLETED' | 'BLOCKED' }>;
      };
    };
  },
  options: SurferMeaningApplicationOptions | undefined,
  recovery: boolean,
) {
  if (recovery || !options) return undefined;
  return startSurferIntakeScheduler(
    runtime.meaningReviews.createWorker(options.execution),
    options,
  );
}
