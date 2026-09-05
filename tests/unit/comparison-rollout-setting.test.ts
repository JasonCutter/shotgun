import { describe, expect, it } from 'vitest';

import {
  COMPARISON_ROLLOUT_SETTING_KEY,
  deriveSettingsImpact,
} from '../../modules/settings-policy/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';

describe('WP6 rollout setting policy', () => {
  it('validates the append-only rollout setting and classifies it as high-impact confirmation', async () => {
    const repository = new InMemorySettingsRepository();
    expect(
      (
        await repository.validateSettingsDraft('shotgun', {
          [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_ACTIVE',
        })
      ).isValid,
    ).toBe(true);
    expect(
      (
        await repository.validateSettingsDraft('shotgun', {
          [COMPARISON_ROLLOUT_SETTING_KEY]: 'V3',
        })
      ).isValid,
    ).toBe(false);
    const impact = deriveSettingsImpact({ [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_SHADOW' });
    expect(impact.riskLevel).toBe('HIGH');
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.requiresReview).toBe(false);
  });

  it('persists and reads the rollout value through the existing idempotent Settings command', async () => {
    const repository = new InMemorySettingsRepository();
    const result = await repository.applySettingsCommand({
      commandId: 'command-rollout-1',
      clientRequestId: 'client-rollout-1',
      idempotencyKey: 'idem-rollout-1',
      projectId: 'shotgun',
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_SHADOW' },
      actorId: 'owner-1',
    });
    expect(result.status).toBe('APPLIED');
    expect(await repository.getProjectSettingValue('shotgun', COMPARISON_ROLLOUT_SETTING_KEY)).toBe(
      'V2_SHADOW',
    );
    const replay = await repository.applySettingsCommand({
      commandId: 'command-rollout-1',
      clientRequestId: 'client-rollout-1',
      idempotencyKey: 'idem-rollout-1',
      projectId: 'shotgun',
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_SHADOW' },
      actorId: 'owner-1',
    });
    expect(replay).toEqual(result);
  });
});
