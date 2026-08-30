import type {
  DiscoveryScheduleRegistrationV1,
  DiscoveryScheduleRepositoryPort,
  DiscoveryScheduleV1,
} from '../../../packages/contracts/src/index.js';
import type { DiscoveryTriggerCoordinator } from './index.js';

export type DiscoveryWeeklyOccurrenceV1 = {
  readonly at: string;
  readonly key: string;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

const fail = (message: string): never => {
  throw new TypeError(message);
};

const localFormatter = (timezone: string): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return fail('Discovery schedule timezone must be a valid IANA timezone.');
  }
};

const localParts = (date: Date, formatter: Intl.DateTimeFormat): LocalParts => {
  const values = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  const part = (key: keyof LocalParts): number => {
    const value = values[key];
    if (value === undefined || !Number.isInteger(value)) {
      return fail('Discovery schedule timezone did not produce a complete local time.');
    }
    return value;
  };
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  };
};

const parseLocalTime = (value: string): { hour: number; minute: number } => {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) return fail('Discovery schedule localTime must be HH:mm.');
  return { hour: Number(value.slice(0, 2)), minute: Number(value.slice(3, 5)) };
};

const isoWeekday = (dateOnly: Date): number => {
  const day = dateOnly.getUTCDay();
  return day === 0 ? 7 : day;
};

const localDateAt = (parts: LocalParts): Date =>
  new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

const localWallMatches = (date: Date, target: LocalParts, formatter: Intl.DateTimeFormat) => {
  const actual = localParts(date, formatter);
  return (
    actual.year === target.year &&
    actual.month === target.month &&
    actual.day === target.day &&
    actual.hour === target.hour &&
    actual.minute === target.minute
  );
};

const wallTimeToUtc = (target: LocalParts, formatter: Intl.DateTimeFormat): Date => {
  const wallMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  let candidateMs = wallMs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(candidateMs), formatter);
    const formattedWallMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    candidateMs = wallMs - (formattedWallMs - candidateMs);
  }
  // Resolve a fall-back ambiguity to the earliest valid instant. A spring
  // gap has no matching instant and is rejected instead of silently moving it.
  const matches: number[] = [];
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 1) {
    const candidate = candidateMs + offsetMinutes * 60_000;
    if (localWallMatches(new Date(candidate), target, formatter)) matches.push(candidate);
  }
  if (!matches.length) return fail('Discovery schedule localTime does not exist in its timezone.');
  return new Date(Math.min(...matches));
};

const validateAfter = (after: string): number => {
  const timestamp = Date.parse(after);
  if (!Number.isFinite(timestamp)) return fail('Discovery schedule reference time is invalid.');
  return timestamp;
};

export const nextDiscoveryWeeklyOccurrenceV1 = (input: {
  readonly after: string;
  readonly timezone: string;
  readonly dayOfWeek: number;
  readonly localTime: string;
}): DiscoveryWeeklyOccurrenceV1 => {
  const afterMs = validateAfter(input.after);
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    return fail('Discovery schedule dayOfWeek must be an ISO weekday from 1 to 7.');
  }
  const time = parseLocalTime(input.localTime);
  const formatter = localFormatter(input.timezone);
  const current = localParts(new Date(afterMs), formatter);
  const currentDate = localDateAt(current);
  const daysUntil = (input.dayOfWeek - isoWeekday(currentDate) + 7) % 7;
  const candidateDate = new Date(currentDate.getTime() + daysUntil * 86_400_000);
  const target: LocalParts = {
    year: candidateDate.getUTCFullYear(),
    month: candidateDate.getUTCMonth() + 1,
    day: candidateDate.getUTCDate(),
    hour: time.hour,
    minute: time.minute,
  };
  let occurrence = wallTimeToUtc(target, formatter);
  if (occurrence.getTime() <= afterMs) {
    const followingDate = new Date(candidateDate.getTime() + 7 * 86_400_000);
    occurrence = wallTimeToUtc(
      {
        year: followingDate.getUTCFullYear(),
        month: followingDate.getUTCMonth() + 1,
        day: followingDate.getUTCDate(),
        hour: time.hour,
        minute: time.minute,
      },
      formatter,
    );
  }
  const date = localParts(occurrence, formatter);
  const dateKey = `${date.year.toString().padStart(4, '0')}-${date.month
    .toString()
    .padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`;
  return {
    at: occurrence.toISOString(),
    key: `${dateKey}T${input.localTime}@${input.timezone}`,
  };
};

const validateRegistration = (input: DiscoveryScheduleRegistrationV1): void => {
  if (!input.projectId.trim() || !input.scheduleId.trim())
    return fail('Schedule identity is required.');
  if (input.status !== 'ENABLED' && input.status !== 'DISABLED')
    return fail('Schedule status is invalid.');
  // Validate the timezone/time even for a disabled schedule so invalid state
  // cannot be persisted and later become enabled without reconstruction.
  parseLocalTime(input.localTime);
  localFormatter(input.timezone);
  validateAfter(input.now);
};

export type DiscoverySchedulerTickResultV1 = {
  readonly schedulesObserved: number;
  readonly jobsAccepted: number;
  readonly occurrencesAdvanced: number;
};

export class PersistentDiscoveryScheduler {
  constructor(
    private readonly schedules: DiscoveryScheduleRepositoryPort,
    private readonly coordinator: DiscoveryTriggerCoordinator,
    private readonly clock: { now(): string } = { now: () => new Date().toISOString() },
    private readonly maxCatchUp = 16,
  ) {}

  async registerSchedule(input: DiscoveryScheduleRegistrationV1): Promise<DiscoveryScheduleV1> {
    validateRegistration(input);
    const current = await this.schedules.findSchedule(input.projectId, input.scheduleId);
    const scheduleRevision = current ? String(Number(current.scheduleRevision) + 1) : '1';
    if (!/^\d+$/.test(scheduleRevision) || Number(scheduleRevision) < 1) {
      return fail('Discovery schedule revision is invalid.');
    }
    const occurrence = nextDiscoveryWeeklyOccurrenceV1({
      after: input.now,
      timezone: input.timezone,
      dayOfWeek: input.dayOfWeek,
      localTime: input.localTime,
    });
    const schedule: DiscoveryScheduleV1 = {
      schemaVersion: '1.0.0',
      projectId: input.projectId,
      scheduleId: input.scheduleId,
      scheduleRevision,
      status: input.status,
      timezone: input.timezone,
      dayOfWeek: input.dayOfWeek,
      localTime: input.localTime,
      nextOccurrenceAt: occurrence.at,
      nextOccurrenceKey: occurrence.key,
      updatedAt: input.now,
    };
    const saved = await this.schedules.saveSchedule(schedule, current?.scheduleRevision);
    if (saved === 'CONFLICT') return fail('Discovery schedule changed concurrently.');
    return schedule;
  }

  async tick(now = this.clock.now()): Promise<DiscoverySchedulerTickResultV1> {
    validateAfter(now);
    const due = await this.schedules.listDueSchedules({ now, limit: this.maxCatchUp });
    let jobsAccepted = 0;
    let occurrencesAdvanced = 0;
    for (const initial of due) {
      let current = initial;
      for (let count = 0; count < this.maxCatchUp; count += 1) {
        if (current.status !== 'ENABLED' || Date.parse(current.nextOccurrenceAt) > Date.parse(now))
          break;
        let outcome: Awaited<
          ReturnType<DiscoveryTriggerCoordinator['coordinateScheduledFullScan']>
        >;
        try {
          outcome = await this.coordinator.coordinateScheduledFullScan(current);
        } catch {
          // The occurrence remains due until a durable Job outcome is known.
          break;
        }
        if (outcome.disposition !== 'CREATED' && outcome.disposition !== 'ALREADY_EXISTS') break;
        jobsAccepted += 1;
        const next = nextDiscoveryWeeklyOccurrenceV1({
          after: current.nextOccurrenceAt,
          timezone: current.timezone,
          dayOfWeek: current.dayOfWeek,
          localTime: current.localTime,
        });
        const advanced = await this.schedules.advanceOccurrence({
          projectId: current.projectId,
          scheduleId: current.scheduleId,
          expectedScheduleRevision: current.scheduleRevision,
          expectedOccurrenceKey: current.nextOccurrenceKey,
          nextOccurrenceAt: next.at,
          nextOccurrenceKey: next.key,
          updatedAt: now,
        });
        if (advanced !== 'ADVANCED') break;
        occurrencesAdvanced += 1;
        const refreshed = await this.schedules.findSchedule(current.projectId, current.scheduleId);
        if (!refreshed) break;
        current = refreshed;
      }
    }
    return { schedulesObserved: due.length, jobsAccepted, occurrencesAdvanced };
  }
}

export const startPersistentDiscoverySchedulerWorker = (
  scheduler: PersistentDiscoveryScheduler,
  intervalMs: number,
): { stop(): Promise<void> } => {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    return fail('Discovery scheduler interval must be a positive integer.');
  }
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const run = () => {
    if (stopped) return;
    running = running.then(async () => {
      try {
        await scheduler.tick();
      } catch {
        // A failed tick must leave the occurrence due for the next tick.
      }
    });
  };
  const timer = setInterval(run, intervalMs);
  run();
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
};
