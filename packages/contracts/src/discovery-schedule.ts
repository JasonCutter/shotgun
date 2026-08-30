export const DISCOVERY_SCHEDULE_SCHEMA_VERSION_V1 = '1.0.0' as const;

export const DISCOVERY_SCHEDULE_STATUSES_V1 = ['ENABLED', 'DISABLED'] as const;
export type DiscoveryScheduleStatusV1 = (typeof DISCOVERY_SCHEDULE_STATUSES_V1)[number];

export type DiscoveryScheduleV1 = {
  readonly schemaVersion: typeof DISCOVERY_SCHEDULE_SCHEMA_VERSION_V1;
  readonly projectId: string;
  readonly scheduleId: string;
  readonly scheduleRevision: string;
  readonly status: DiscoveryScheduleStatusV1;
  readonly timezone: string;
  readonly dayOfWeek: number;
  readonly localTime: string;
  readonly nextOccurrenceAt: string;
  readonly nextOccurrenceKey: string;
  readonly updatedAt: string;
};

export type DiscoveryScheduleRegistrationV1 = {
  readonly projectId: string;
  readonly scheduleId: string;
  readonly status: DiscoveryScheduleStatusV1;
  readonly timezone: string;
  readonly dayOfWeek: number;
  readonly localTime: string;
  readonly now: string;
};

export type DiscoveryDueScheduleQueryV1 = {
  readonly now: string;
  readonly limit?: number;
};

export type DiscoveryScheduleAdvanceV1 = {
  readonly projectId: string;
  readonly scheduleId: string;
  readonly expectedScheduleRevision: string;
  readonly expectedOccurrenceKey: string;
  readonly nextOccurrenceAt: string;
  readonly nextOccurrenceKey: string;
  readonly updatedAt: string;
};

export type DiscoveryScheduleRepositoryPort = {
  saveSchedule(
    schedule: DiscoveryScheduleV1,
    expectedScheduleRevision?: string,
  ): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'>;
  findSchedule(projectId: string, scheduleId: string): Promise<DiscoveryScheduleV1 | undefined>;
  listDueSchedules(input: DiscoveryDueScheduleQueryV1): Promise<readonly DiscoveryScheduleV1[]>;
  advanceOccurrence(
    input: DiscoveryScheduleAdvanceV1,
  ): Promise<'ADVANCED' | 'CONFLICT' | 'NOT_FOUND'>;
};
