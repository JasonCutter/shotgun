import type { SurferArtifactRef } from './surfer-knowledge.js';
import type { SurferMemoryRefreshDiscoveryPlan } from './surfer-memory-refresh-discovery.js';
import type { SurferRefreshWorkReceipt } from './surfer-memory-refresh-work.js';

/** Server-owned execution context, never accepted in a public trigger. */
export type SurferMemoryReconcileContext = { runId: string; profileDigest: string };
export interface SurferMemoryRefreshScanPort {
  scan(
    actor: unknown,
    input: unknown,
  ): Promise<{
    status: SurferMemoryRefreshDiscoveryPlan['status'];
    plan: SurferMemoryRefreshDiscoveryPlan;
    planDigest: string;
    job: SurferArtifactRef | null;
  }>;
}
/** The existing worker may return private execution details; the coordinator strips them. */
export interface SurferMemoryRefreshRunnerPort {
  run(
    actor: unknown,
    prepared: unknown,
  ): Promise<{
    status: 'COMPLETED' | 'INCOMPLETE';
    receipt: SurferRefreshWorkReceipt | null;
    replayed: boolean;
  }>;
}
export type SurferMemoryReconcileResult =
  | {
      status: 'EMPTY' | 'UNCHANGED' | 'BLOCKED';
      planDigest: string;
      snapshot: { snapshotId: string; digest: string } | null;
      blocked: SurferMemoryRefreshDiscoveryPlan['blocked'];
    }
  | {
      status: 'COMPLETED' | 'INCOMPLETE';
      job: SurferArtifactRef | null;
      prepared: SurferArtifactRef;
      receipt: SurferRefreshWorkReceipt | null;
      replayed: boolean;
    };
