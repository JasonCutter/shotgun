import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryDiscoveryScheduleRepository } from '../../adapters/discovery-trigger-coordinator/src/index.js';

describe('AKP-4 WP3 durable manual Discovery API', () => {
  it('uses a stable request identity and returns the durable Job result', async () => {
    const app = await createApplication();
    const first = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/run',
      payload: {
        commandId: 'api-command-1',
        requestId: 'api-request-1',
        requestedScanMode: 'FULL_SCAN',
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      discovery: { disposition: 'CREATED', lifecycleState: 'WAITING_FOR_PROJECTION' },
    });
    const replay = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/run',
      payload: {
        commandId: 'api-command-1',
        requestId: 'api-request-1',
        requestedScanMode: 'FULL_SCAN',
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      discovery: { disposition: 'ALREADY_EXISTS', jobId: first.json().discovery.jobId },
    });
    await app.server.close();
  });

  it('configures one server-owned schedule authority and reconstructs updates', async () => {
    const schedules = new InMemoryDiscoveryScheduleRepository();
    const app = await createApplication({
      discoveryScheduleRepository: schedules,
      discoverySchedulerIntervalMs: false,
    });
    const created = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/schedules',
      payload: {
        scheduleId: 'weekly-main',
        status: 'ENABLED',
        timezone: 'UTC',
        dayOfWeek: 1,
        localTime: '09:00',
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      schedule: {
        projectId: 'shotgun',
        scheduleRevision: '1',
        status: 'ENABLED',
        nextOccurrenceKey: expect.stringContaining('T09:00@UTC'),
      },
    });
    const disabled = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/schedules',
      payload: {
        scheduleId: 'weekly-main',
        status: 'DISABLED',
        timezone: 'UTC',
        dayOfWeek: 1,
        localTime: '09:00',
      },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({
      schedule: { projectId: 'shotgun', scheduleRevision: '2', status: 'DISABLED' },
    });
    expect(await schedules.findSchedule('shotgun', 'weekly-main')).toEqual(
      disabled.json().schedule,
    );

    const crossProject = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/schedules',
      payload: {
        projectId: 'other-project',
        scheduleId: 'spoofed',
        status: 'ENABLED',
        timezone: 'UTC',
        dayOfWeek: 1,
        localTime: '09:00',
      },
    });
    expect(crossProject.statusCode).toBe(400);
    await app.server.close();
  });
});
