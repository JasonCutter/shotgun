import { describe, expect, it, vi } from 'vitest';

import {
  markAcceptedCommandOutcomeUnknown,
  rejectAcceptedCommand,
} from '../../assemblies/shotgun-app/src/product-api/frontend-command-route.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';
import type { FrontendCommandGatewayPort } from '../../modules/frontend-command-gateway/src/index.js';

const error = (code: 'OUTCOME_UNKNOWN' | 'CONFLICT') =>
  new ShotgunError({
    code,
    safeMessage: code === 'OUTCOME_UNKNOWN' ? 'Commit acknowledgement was lost.' : 'Conflict.',
    module: 'test',
    operation: 'route-test',
  });

const gatewayStub = (overrides: Partial<FrontendCommandGatewayPort> = {}) =>
  ({
    accept: vi.fn(),
    lockAcceptedForExecution: vi.fn(),
    completeInTransaction: vi.fn(),
    complete: vi.fn(),
    reject: vi.fn().mockResolvedValue({}),
    markOutcomeUnknown: vi.fn().mockResolvedValue({}),
    findByClientRequestId: vi.fn(),
    ...overrides,
  }) as unknown as FrontendCommandGatewayPort;

describe('frontend command route outcome translation', () => {
  it('marks OUTCOME_UNKNOWN without rejecting the accepted command', async () => {
    const gateway = gatewayStub();

    await expect(
      markAcceptedCommandOutcomeUnknown(gateway, 'command-1', error('OUTCOME_UNKNOWN')),
    ).resolves.toBe(true);

    expect(gateway.markOutcomeUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'command-1',
        message: 'Commit acknowledgement was lost.',
      }),
    );
    expect(gateway.reject).not.toHaveBeenCalled();
  });

  it('leaves deterministic failures on the existing rejection path', async () => {
    const gateway = gatewayStub();

    await expect(
      markAcceptedCommandOutcomeUnknown(gateway, 'command-2', error('CONFLICT')),
    ).resolves.toBe(false);
    await rejectAcceptedCommand(gateway, 'command-2', error('CONFLICT'));

    expect(gateway.markOutcomeUnknown).not.toHaveBeenCalled();
    expect(gateway.reject).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'command-2', code: 'CONFLICT' }),
    );
  });

  it('does not convert an unknown outcome to rejection if ambiguity recording fails', async () => {
    const gateway = gatewayStub({
      markOutcomeUnknown: vi.fn().mockRejectedValue(new Error('gateway unavailable')),
    });

    await expect(
      markAcceptedCommandOutcomeUnknown(gateway, 'command-3', error('OUTCOME_UNKNOWN')),
    ).resolves.toBe(true);

    expect(gateway.reject).not.toHaveBeenCalled();
  });
});
