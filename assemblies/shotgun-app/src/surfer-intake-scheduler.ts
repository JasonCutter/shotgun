import type {
  createSurferApplicationRuntime,
  SurferDocumentExecutionOptions,
} from './surfer-runtime.js';

type CyclePort = { cycle(actor: unknown): Promise<{ status: 'EMPTY' | 'COMPLETED' | 'BLOCKED' }> };
export type SurferIntakeScheduleOptions = {
  /** Server capability resolved afresh for each cycle; null pauses this burst. */
  readonly resolveActor: () => Promise<unknown | null>;
  readonly intervalMs?: number;
  readonly maxCyclesPerTick?: number;
};
export type SurferIntakeApplicationOptions = SurferIntakeScheduleOptions & {
  readonly execution: SurferDocumentExecutionOptions;
};
export type SurferIntakeTickResult = {
  status: 'DRAINED' | 'IDLE' | 'PAUSED' | 'STOPPED';
  completed: number;
  blocked: number;
  code?: 'NO_AUTHORITY' | 'CYCLE_FAILED' | 'WORK_BLOCKED';
};

const configuration = (options: SurferIntakeScheduleOptions) => {
  const intervalMs = options.intervalMs ?? 60000,
    maxCyclesPerTick = options.maxCyclesPerTick ?? 1;
  if (
    typeof options.resolveActor !== 'function' ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1000 ||
    intervalMs > 300000 ||
    !Number.isSafeInteger(maxCyclesPerTick) ||
    maxCyclesPerTick < 1 ||
    maxCyclesPerTick > 8
  )
    throw new Error('Invalid Surfer intake schedule configuration.');
  return { intervalMs, maxCyclesPerTick, resolveActor: options.resolveActor };
};

/** Timer only: durable claims, provider deadlines and UNKNOWN remain owned by the worker. */
export function startSurferIntakeScheduler(
  worker: CyclePort,
  options: SurferIntakeScheduleOptions,
) {
  const { intervalMs, maxCyclesPerTick, resolveActor } = configuration(options);
  let stopped = false,
    active: Promise<SurferIntakeTickResult> | undefined;
  const run = async (): Promise<SurferIntakeTickResult> => {
    const result: SurferIntakeTickResult = { status: 'DRAINED', completed: 0, blocked: 0 };
    try {
      for (let i = 0; i < maxCyclesPerTick; i++) {
        if (stopped) return { ...result, status: 'STOPPED' };
        const actor = await resolveActor();
        if (stopped) return { ...result, status: 'STOPPED' };
        if (actor == null) return { ...result, status: 'PAUSED', code: 'NO_AUTHORITY' };
        const item = await worker.cycle(actor);
        if (item.status === 'EMPTY') return { ...result, status: 'IDLE' };
        if (item.status === 'BLOCKED')
          return { ...result, blocked: 1, status: 'PAUSED', code: 'WORK_BLOCKED' };
        result.completed++;
      }
      return result;
    } catch {
      return { ...result, status: 'PAUSED', code: 'CYCLE_FAILED' };
    }
  };
  // Joining an active burst never schedules another burst behind it.
  const drainOnce = (): Promise<SurferIntakeTickResult> => {
    if (stopped) return Promise.resolve({ status: 'STOPPED', completed: 0, blocked: 0 });
    if (active) return active;
    active = Promise.resolve()
      .then(run)
      .then((result) => {
        if (result.status === 'PAUSED' && result.code !== 'NO_AUTHORITY')
          console.warn(`[surfer-intake] ${result.code}; durable work retained`);
        return result;
      })
      .finally(() => {
        active = undefined;
      });
    return active;
  };
  const timer = setInterval(() => void drainOnce(), intervalMs);
  timer.unref();
  void drainOnce();
  return {
    drainOnce,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
}

/** No env default, auth bootstrap or recovery execution. Called only by trusted app assembly. */
export function startApplicationSurferIntake(
  runtime: Pick<ReturnType<typeof createSurferApplicationRuntime>, 'createIntakeWorker'>,
  options: SurferIntakeApplicationOptions | undefined,
  recoveryHarness: boolean,
) {
  if (recoveryHarness || !options) return undefined;
  configuration(options); // Reject before constructing an execution worker.
  return startSurferIntakeScheduler(runtime.createIntakeWorker(options.execution), options);
}
