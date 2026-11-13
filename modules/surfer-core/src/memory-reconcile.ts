import type {
  SurferMemoryReconcileContext,
  SurferMemoryReconcileResult,
  SurferMemoryRefreshRunnerPort,
  SurferMemoryRefreshScanPort,
} from '../../../packages/contracts/src/surfer-memory-reconcile.js';
import type {
  SurferMemoryRefreshWorkPort,
  SurferRefreshWorkReceipt,
} from '../../../packages/contracts/src/surfer-memory-refresh-work.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import {
  assertSurferJson,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';

function envelope(input: unknown, contract: string, keys: string) {
  assertSurferJson(input);
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).sort().join(',') !== keys ||
    (input as { schemaVersion?: unknown }).schemaVersion !== '1.0.0' ||
    (input as { contract?: unknown }).contract !== contract
  )
    throw surferFailure('Invalid memory reconciliation request.');
}
function receiptMetadata(r: SurferRefreshWorkReceipt | null): SurferRefreshWorkReceipt | null {
  if (!r) return null;
  return {
    prepared: decodeSurferArtifactRef(r.prepared),
    profileDigest: r.profileDigest,
    artifacts: r.artifacts.map(decodeSurferArtifactRef),
    snapshotId: r.snapshotId,
    snapshotDigest: r.snapshotDigest,
    memoryCount: r.memoryCount,
    nextRecipes: r.nextRecipes.map(decodeSurferArtifactRef),
    framesDigest: r.framesDigest,
  };
}

/** One bounded caller-triggered reconciliation; no timer, queue, retry, or provider policy owner. */
export class SurferMemoryReconcileService {
  private readonly context: SurferMemoryReconcileContext;
  constructor(
    private readonly discovery: SurferMemoryRefreshScanPort,
    private readonly work: Pick<SurferMemoryRefreshWorkPort, 'prepare'>,
    private readonly runner: SurferMemoryRefreshRunnerPort,
    context: SurferMemoryReconcileContext,
  ) {
    assertSurferJson(context);
    if (
      !context ||
      Object.keys(context).sort().join(',') !== 'profileDigest,runId' ||
      typeof context.runId !== 'string' ||
      !/^[A-Za-z0-9-]{1,40}$/.test(context.runId) ||
      typeof context.profileDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(context.profileDigest)
    )
      throw surferFailure('Invalid server reconciliation context.');
    this.context = structuredClone(context);
  }
  async cycle(actor: unknown, input: unknown): Promise<SurferMemoryReconcileResult> {
    envelope(input, 'surfer.memory-reconcile.v1', 'contract,schemaVersion');
    const request = decodeSurferSourceRequest(actor);
    const scan = await this.discovery.scan(structuredClone(request), {
      schemaVersion: '1.0.0',
      contract: 'surfer.memory-refresh-scan.v1',
    });
    if (scan.status !== scan.plan.status)
      throw surferFailure('Discovery reconciliation status differs.');
    if (scan.status !== 'REFRESH_REQUIRED') {
      if (scan.job) throw surferFailure('Inactive discovery unexpectedly created work.');
      return {
        status: scan.status,
        planDigest: scan.planDigest,
        snapshot: scan.plan.snapshot
          ? { snapshotId: scan.plan.snapshot.snapshotId, digest: scan.plan.snapshot.digest }
          : null,
        blocked: scan.plan.blocked.map((b) => ({
          memory: b.memory ? decodeSurferArtifactRef(b.memory) : null,
          reason: b.reason,
        })),
      };
    }
    const job = decodeSurferArtifactRef(scan.job);
    const result = await this.work.prepare(structuredClone(request), {
      job: structuredClone(job),
      ...structuredClone(this.context),
    });
    const prepared = decodeSurferArtifactRef(result.prepared);
    return { ...(await this.execute(request, prepared)), job };
  }
  async resume(actor: unknown, input: unknown): Promise<SurferMemoryReconcileResult> {
    envelope(input, 'surfer.memory-reconcile-resume.v1', 'contract,prepared,schemaVersion');
    const prepared = decodeSurferArtifactRef((input as { prepared: unknown }).prepared);
    return this.execute(decodeSurferSourceRequest(actor), prepared);
  }
  private async execute(
    request: ReturnType<typeof decodeSurferSourceRequest>,
    prepared: ReturnType<typeof decodeSurferArtifactRef>,
  ) {
    const result = await this.runner.run(structuredClone(request), structuredClone(prepared));
    if (
      (result.status === 'COMPLETED') !== (result.receipt !== null) ||
      (result.receipt && result.receipt.profileDigest !== this.context.profileDigest)
    )
      throw surferFailure('Reconciliation completion differs from its server context.');
    return {
      status: result.status,
      job: null,
      prepared,
      receipt: receiptMetadata(result.receipt),
      replayed: result.replayed,
    };
  }
}
