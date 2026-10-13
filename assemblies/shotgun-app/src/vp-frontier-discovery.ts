import type { VPRelationJobStorePort } from '../../../modules/vp-knowledge-ledger/src/index.js';

/** Discovery is an unpaid local projection operation. Missing/exhausted global
 * authority must pause egress without hiding or losing current membership. */
export const startVPFrontierDiscovery = (
  jobs: Pick<VPRelationJobStorePort, 'ensureCurrentFrontier'>,
  policyRevision: string,
  intervalMs = 60_000,
): (() => Promise<void>) => {
  if (!jobs.ensureCurrentFrontier || !policyRevision.trim())
    throw new Error('FRONTIER_STORE_REQUIRED');
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 300_000)
    throw new Error('Invalid Frontier discovery interval.');
  let stopped = false;
  let active: Promise<void> | undefined;
  const tick = () => {
    if (stopped || active) return;
    active = jobs.ensureCurrentFrontier!(policyRevision)
      .catch((error: unknown) => {
        console.error(
          '[vp-frontier] DISCOVERY_INCOMPLETE: current membership remains unverified',
          error,
        );
      })
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
};
