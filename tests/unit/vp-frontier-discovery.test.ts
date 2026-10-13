import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVPFrontierDiscovery } from '../../assemblies/shotgun-app/src/vp-frontier-discovery.js';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('application unpaid Frontier discovery', () => {
  it('is single-flight, uses the same fixed policy and stops before any later tick', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensureCurrentFrontier = vi.fn(() => pending);
    const stop = startVPFrontierDiscovery({ ensureCurrentFrontier }, 'v6', 1000);
    expect(ensureCurrentFrontier).toHaveBeenCalledWith('v6');
    await vi.advanceTimersByTimeAsync(5000);
    expect(ensureCurrentFrontier).toHaveBeenCalledTimes(1);
    const stopping = stop();
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ensureCurrentFrontier).toHaveBeenCalledTimes(1);
  });
  it('does not create an execution/provider fallback when discovery fails', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ensureCurrentFrontier = vi.fn(async () => {
      throw Error('FRONTIER_INTEGRITY_FAILED');
    });
    const stop = startVPFrontierDiscovery({ ensureCurrentFrontier }, 'v6', 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('DISCOVERY_INCOMPLETE'),
      expect.any(Error),
    );
    await stop();
    expect(ensureCurrentFrontier).toHaveBeenCalledTimes(1);
  });
  it('rejects absent discovery port', () => {
    expect(() => startVPFrontierDiscovery({}, 'v6')).toThrow('FRONTIER_STORE_REQUIRED');
  });
});
