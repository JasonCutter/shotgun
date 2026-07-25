import { describe, it, expect } from 'vitest';
import type { SettingsSnapshot } from '../../packages/contracts/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';

describe('Settings Policy and Draft Controller Logic', () => {
  const repo = new InMemorySettingsRepository();

  it('fetches initial settings snapshot for project', async () => {
    const snapshot: SettingsSnapshot = await repo.getSettingsSnapshot('shotgun');
    expect(snapshot.targetProjectId).toBe('shotgun');
    expect(snapshot.settingsRevision).toBe(1);
    expect(snapshot.categories).toHaveLength(5);
    expect(snapshot.settings).toHaveLength(4);
  });

  it('validates settings draft and catches negative limits', async () => {
    const validRes = await repo.validateSettingsDraft('shotgun', {
      'costs.monthlyHardLimitUsd': 100,
    });
    expect(validRes.isValid).toBe(true);

    const invalidRes = await repo.validateSettingsDraft('shotgun', {
      'costs.monthlyHardLimitUsd': -50,
    });
    expect(invalidRes.isValid).toBe(false);
    expect(invalidRes.errors).toHaveLength(1);
    expect(invalidRes.errors[0]?.key).toBe('costs.monthlyHardLimitUsd');
  });

  it('applies command and increments revision monotonically', async () => {
    const result = await repo.applySettingsCommand({
      commandId: 'cmd-1',
      clientRequestId: 'client-req-1',
      idempotencyKey: 'idem-1',
      projectId: 'shotgun',
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { 'general.locale': 'en-US' },
      actorId: 'principal-a',
    });

    expect(result.status).toBe('APPLIED');
    expect(result.appliedRevision).toBe(2);

    const updatedSnapshot = await repo.getSettingsSnapshot('shotgun');
    expect(updatedSnapshot.settingsRevision).toBe(2);
  });

  it('detects idempotency key reuse with mismatching clientRequestId', async () => {
    await expect(
      repo.applySettingsCommand({
        commandId: 'cmd-2',
        clientRequestId: 'different-client-req',
        idempotencyKey: 'idem-1',
        projectId: 'shotgun',
        expectedSettingsRevision: 2,
        observedPolicyContextRevision: 1,
        settings: { 'general.locale': 'en-US' },
        actorId: 'principal-a',
      }),
    ).rejects.toThrow('Idempotency key');
  });

  it('rejects stale application when expectedRevision conflicts', async () => {
    await expect(
      repo.applySettingsCommand({
        commandId: 'cmd-3',
        clientRequestId: 'client-req-3',
        idempotencyKey: 'idem-3',
        projectId: 'shotgun',
        expectedSettingsRevision: 1, // Current is 2
        observedPolicyContextRevision: 1,
        settings: { 'general.locale': 'ko-KR' },
        actorId: 'principal-a',
      }),
    ).rejects.toThrow('Expected revision');
  });
});
