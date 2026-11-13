import type {
  SurferMemoryRefreshWorkPort,
  SurferRefreshPreparedWork,
  SurferRefreshWorkReceipt,
} from '../../../packages/contracts/src/surfer-memory-refresh-work.js';
import type {
  SurferSourceSessionPortV2,
  SurferSourceSessionV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type {
  SurferDirectiveMemorySession,
  SurferDirectiveMemoryPayload,
  SurferDirectiveScenarioEvaluationPort,
} from '../../../packages/contracts/src/surfer-directive-memory.js';
import type {
  SurferArtifactRef,
  SurferKnowledgeArtifact,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeLength } from '../../../packages/contracts/src/document-evidence.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import { SurferKnowledgeService } from '../../../modules/surfer-core/src/index.js';
import {
  refreshIdentity,
  uniqueRefreshIdentity,
} from '../../../modules/surfer-core/src/refresh-identity.js';
import { SurferMemoryRefreshDiscoveryService } from '../../../modules/surfer-core/src/memory-refresh-discovery.js';
import { SurferDirectiveMemoryRefreshService } from '../../../modules/surfer-core/src/memory-refresh.js';
import { SurferDirectiveMemoryBatchRefreshService } from '../../../modules/surfer-core/src/memory-batch-refresh.js';
import { ShotgunSurferDirectiveMemorySession } from './directive-memory.js';
import { ShotgunSurferMemoryRefreshDiscoverySession } from './memory-refresh-discovery.js';
import { ShotgunSurferMemoryRefreshSession } from './memory-refresh.js';
import { ShotgunSurferMemoryBatchRefreshSession } from './memory-batch-refresh.js';

type Recipe = {
  contract: 'surfer.memory-refresh-recipe.v1';
  memory: SurferArtifactRef;
  sourceId: string;
  pointer: string;
  targetUnit: string | null;
  identity: { subject: string; operation: string };
  authorityDigest: string;
};
type Context = {
  raw: SurferSourceSessionV2;
  s: SurferDirectiveMemorySession;
  bound: SurferSourceSessionPortV2;
};
const ref = (a: SurferKnowledgeArtifact): SurferArtifactRef => ({
  artifactId: a.artifactId,
  revision: a.revision,
  digest: a.digest,
});
const recipeId = (memory: SurferArtifactRef) => 'refresh-recipe:' + surferDigest(memory).slice(7);
const preparedId = (job: SurferArtifactRef) => 'refresh-tasks:' + surferDigest(job).slice(7);
const doneId = (prepared: SurferArtifactRef) => 'refresh-done:' + surferDigest(prepared).slice(7);
// Match the account closeout's exact semantic:<runId>: workload prefix.
// Full record IDs stay SHA-256; case-label collisions fail the ledger request-digest CAS.
const workOperation = (job: SurferArtifactRef, runId: string) =>
  'semantic:' + runId + ':rw:' + surferDigest(job).slice(7, 31);
function record<T extends { contract: string }>(a: SurferKnowledgeArtifact, domain: string): T {
  const p = a.payload;
  if (a.kind !== 'EPISODE' || a.domain !== domain || !p || p.contract !== domain)
    throw surferFailure('Invalid refresh work record.');
  return structuredClone(p) as T;
}
/** Recipe guards stay inside this Source adapter; only current Source tasks cross the work Port. */
export class ShotgunSurferMemoryRefreshWork implements SurferMemoryRefreshWorkPort {
  constructor(
    private readonly sessions: SurferSourceSessionPortV2,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
  ) {}
  private tx<T>(actor: unknown, apply: (c: Context) => Promise<T>): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withSnapshotV2(request, async (raw) => {
      let active = true;
      const bound: SurferSourceSessionPortV2 = {
        withSnapshotV2: async (r, action) => {
          if (!active || surferDigest(decodeSurferSourceRequest(r)) !== surferDigest(request))
            throw surferFailure('Refresh work escaped its Source actor/transaction.');
          return action(raw);
        },
      };
      try {
        return await new ShotgunSurferDirectiveMemorySession(bound).withSession(request, (s) =>
          apply({ raw, s, bound }),
        );
      } finally {
        active = false;
      }
    });
  }
  private find(c: Context, id: string) {
    return c.raw.store.transaction(
      c.raw.snapshot.context.spaceId,
      (st) =>
        st.artifacts
          .filter((a) => a.artifactId === id)
          .sort((a, b) => b.revision - a.revision)[0] ?? null,
    );
  }
  private async put(
    c: Context,
    id: string,
    domain: string,
    payload: Record<string, unknown>,
    capture: Awaited<ReturnType<SurferDirectiveMemorySession['capture']>>,
  ) {
    const r = await c.s.commit({
      schemaVersion: '2.0.0',
      basis: capture.basis,
      command: {
        action: 'APPEND_ARTIFACT',
        operationId: id,
        expectedRevision: null,
        draft: {
          schemaVersion: '1.0.0',
          artifactId: id,
          revision: 1,
          kind: 'EPISODE',
          origin: 'EXPERIENCE',
          scope: capture.knowledgeScope,
          domain,
          createdAt: capture.basis.readWatermark.observedAt,
          observedAt: capture.basis.readWatermark.observedAt,
          producer: {
            engineRevision: domain,
            modelRevision: 'NONE_METADATA_ONLY',
            policyRevision: capture.basis.authority.policyRevision,
            executionId: surferDigest(payload),
          },
          payloadSchema: 'surfer.opaque.v1',
          payload,
          basis: capture.basis.coreBasis,
        },
      },
    });
    return { artifactId: r.commit.subjectId, revision: r.commit.revision, digest: r.commit.digest };
  }
  private async registerCurrent(actor: unknown, c: Context, memory: SurferArtifactRef) {
    const a = await c.s.readArtifact(memory);
    if (a.kind !== 'INTERPRETATION' || a.domain !== 'surfer.directive-memory.v1')
      throw surferFailure('Recipe requires a current interpretation memory.');
    const head = await this.find(c, memory.artifactId);
    if (!head || head.digest !== memory.digest)
      throw surferFailure('Recipe requires the exact memory head.');
    const p = a.payload as unknown as SurferDirectiveMemoryPayload,
      b = p.basis;
    if (
      p.contract !== 'surfer.directive-memory.v1' ||
      b.sources.length !== 1 ||
      b.dependencies.length ||
      b.queries.length ||
      b.coreBasis.artifacts.length ||
      b.coreBasis.footprints.length ||
      p.selections.length !== 1
    )
      throw surferFailure('Recipe requires one direct Source observation.');
    const selection = p.selections[0]!,
      material = (await c.raw.readMaterialV2(selection.sourceId)).material;
    const evidence = material.evidence.find((e) => e.evidenceId === selection.evidenceId);
    if (
      !evidence ||
      selection.start !== 0 ||
      selection.end !== unicodeLength(evidence.quote.exact) ||
      material.evidence.filter((e) => e.pointer === evidence.pointer).length !== 1
    )
      throw surferFailure('Automatic recipe requires a whole unique Evidence unit.');
    const identity = await c.s.source.withCurrent(actor, b, p.selections, (view) =>
      refreshIdentity(p.packet, view),
    );
    if (!uniqueRefreshIdentity(evidence.quote.exact, identity))
      throw surferFailure('Recipe identity is missing or ambiguous.');
    const value: Recipe = {
      contract: 'surfer.memory-refresh-recipe.v1',
      memory,
      sourceId: selection.sourceId,
      pointer: evidence.pointer,
      targetUnit: selection.targetUnit,
      identity,
      authorityDigest: surferDigest(b.authority),
    };
    const existing = await this.find(c, recipeId(memory));
    if (existing) {
      const stored = record<Recipe>(await c.s.readArtifact(ref(existing)), value.contract);
      if (surferDigest(stored) !== surferDigest(value))
        throw surferFailure('Recipe replay differs.');
      return { recipe: ref(existing), replayed: true };
    }
    const cap = await c.s.capture({
      schemaVersion: '2.0.0',
      sourceIds: [],
      artifacts: [memory],
      queries: [],
    });
    return {
      recipe: await this.put(c, recipeId(memory), value.contract, value, cap),
      replayed: false,
    };
  }
  register(actor: unknown, input: unknown) {
    assertSurferJson(input);
    if (!input || typeof input !== 'object' || Object.keys(input).join(',') !== 'memory')
      throw surferFailure('Invalid recipe registration.');
    const memory = decodeSurferArtifactRef((input as { memory: unknown }).memory);
    return this.tx(actor, (c) => this.registerCurrent(actor, c, memory));
  }
  private async recipe(c: Context, memory: SurferArtifactRef, expected?: SurferArtifactRef) {
    const latest = await this.find(c, recipeId(memory));
    if (
      !latest ||
      latest.revision !== 1 ||
      (expected && surferDigest(ref(latest)) !== surferDigest(expected))
    )
      throw surferFailure(
        'A current registered recipe is required; stale memories cannot be backfilled.',
      );
    const a = (
      await new SurferKnowledgeService(c.raw.store).readArtifact(
        ref(latest),
        'HISTORICAL',
        c.raw.snapshot.context,
      )
    ).artifact;
    const value = record<Recipe>(a, 'surfer.memory-refresh-recipe.v1');
    const empty = await c.s.capture({
      schemaVersion: '2.0.0',
      sourceIds: [],
      artifacts: [],
      queries: [],
    });
    const binding = await c.raw.bindingStore.transaction(c.raw.snapshot.context.spaceId, (st) => ({
      record: st.bindings.find((r) => surferDigest(r.artifact) === surferDigest(ref(a))),
      captures: st.captures,
    }));
    const b = binding.record;
    if (
      !b ||
      b.digest !== surferDigest({ artifact: ref(a), contentDigest: b.basis.contentDigest }) ||
      surferDigest(b.basis.coreBasis) !== surferDigest(a.basis) ||
      !binding.captures.some(
        (v) =>
          v.receiptDigest === surferDigest(b.basis) && surferDigest(v.basis) === v.receiptDigest,
      ) ||
      surferDigest(b.basis.authority) !== surferDigest(empty.basis.authority) ||
      b.basis.coreBasis.authorityEpoch !== empty.basis.coreBasis.authorityEpoch ||
      value.authorityDigest !== surferDigest(empty.basis.authority) ||
      surferDigest(value.memory) !== surferDigest(memory)
    )
      throw surferFailure('Historical recipe provenance/authority changed.');
    return { value, ref: ref(a) };
  }
  private async storedWork(c: Context, prepared: SurferArtifactRef) {
    const work = record<SurferRefreshPreparedWork>(
      await c.s.readArtifact(prepared),
      'surfer.memory-refresh-work.v1',
    );
    if (
      prepared.artifactId !== preparedId(work.job) ||
      work.operationId !== workOperation(work.job, work.runId) ||
      !work.targets.length ||
      work.targets.length > 8 ||
      work.targets.some(
        (t, i) =>
          t.task.operationId !== work.operationId + ':extract:' + i || t.task.runId !== work.runId,
      )
    )
      throw surferFailure('Prepared refresh identity is corrupt.');
    return work;
  }
  private async currentWork(actor: unknown, c: Context, prepared: SurferArtifactRef) {
    const work = await this.storedWork(c, prepared);
    const job = await new SurferMemoryRefreshDiscoveryService(
      new ShotgunSurferMemoryRefreshDiscoverySession(c.bound),
    ).load(actor, work.job);
    if (
      job.status !== 'CURRENT' ||
      job.planDigest !== work.planDigest ||
      job.plan.snapshot?.snapshotId !== work.expectedActiveSnapshotId ||
      surferDigest(job.plan.targets.map((t) => t.memory)) !==
        surferDigest(work.targets.map((t) => t.replaces))
    )
      throw surferFailure('Refresh preparation is no longer current.');
    for (const t of work.targets) {
      await this.recipe(c, t.replaces, t.recipe);
      await c.s.source.withCurrent(actor, t.task.basis, t.task.selections, () => null);
    }
    return { work, plan: job.plan };
  }
  prepare(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as { job: unknown; runId: string; profileDigest: string };
    if (
      !r ||
      Object.keys(r).sort().join(',') !== 'job,profileDigest,runId' ||
      typeof r.runId !== 'string' ||
      !/^[A-Za-z0-9-]{1,40}$/.test(r.runId) ||
      typeof r.profileDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(r.profileDigest)
    )
      throw surferFailure('Invalid refresh execution context.');
    const jobRef = decodeSurferArtifactRef(r.job);
    return this.tx(actor, async (c) => {
      const existing = await this.find(c, preparedId(jobRef));
      if (existing) {
        const old = await this.storedWork(c, ref(existing));
        if (old.runId !== r.runId || old.profileDigest !== r.profileDigest)
          throw surferFailure(
            'A discovery job is already bound to another immutable execution context.',
          );
        if (!(await this.find(c, doneId(ref(existing)))))
          await this.currentWork(actor, c, ref(existing));
        else await this.completedIn(c, ref(existing));
        return { prepared: ref(existing), replayed: true };
      }
      const job = await new SurferMemoryRefreshDiscoveryService(
        new ShotgunSurferMemoryRefreshDiscoverySession(c.bound),
      ).load(actor, jobRef);
      if (job.status !== 'CURRENT' || !job.plan.snapshot)
        throw surferFailure('A current discovery job is required.');
      const operationId = workOperation(jobRef, r.runId),
        targets: SurferRefreshPreparedWork['targets'] = [];
      for (const [index, target] of job.plan.targets.entries()) {
        const recipe = await this.recipe(c, target.memory);
        if (recipe.value.sourceId !== target.sourceId)
          throw surferFailure('Recipe points to another Source.');
        const material = (await c.raw.readMaterialV2(target.sourceId)).material;
        const candidates = material.evidence.filter((e) => e.pointer === recipe.value.pointer);
        if (
          material.sourceVersionId !== target.sourceVersionId ||
          material.revisionId !== target.revisionId ||
          candidates.length !== 1 ||
          !uniqueRefreshIdentity(candidates[0]!.quote.exact, recipe.value.identity)
        )
          throw surferFailure('Current Evidence scope is missing or ambiguous.');
        const selection = {
          sourceId: target.sourceId,
          evidenceId: candidates[0]!.evidenceId,
          start: 0,
          end: unicodeLength(candidates[0]!.quote.exact),
          targetUnit: recipe.value.targetUnit,
        };
        const observed = await c.s.capture({
          schemaVersion: '2.0.0',
          sourceIds: [target.sourceId],
          artifacts: [],
          queries: [],
        });
        await c.s.source.withCurrent(actor, observed.basis, [selection], () => null);
        targets.push({
          replaces: target.memory,
          recipe: recipe.ref,
          task: {
            schemaVersion: '1.0.0',
            operationId: operationId + ':extract:' + index,
            runId: r.runId,
            stepId: 'refresh-' + index,
            attempt: 1,
            priority: 'FOREGROUND',
            basis: observed.basis,
            selections: [selection],
          },
        });
      }
      const work: SurferRefreshPreparedWork = {
        contract: 'surfer.memory-refresh-work.v1',
        job: jobRef,
        planDigest: job.planDigest,
        runId: r.runId,
        profileDigest: r.profileDigest,
        operationId,
        expectedActiveSnapshotId: job.plan.snapshot.snapshotId,
        targets,
      };
      const cap = await c.s.capture({
        schemaVersion: '2.0.0',
        sourceIds: [...new Set(targets.map((t) => t.task.basis.sources[0]!.sourceId))].sort(),
        artifacts: job.plan.retained,
        queries: [],
      });
      return {
        prepared: await this.put(c, preparedId(jobRef), work.contract, work, cap),
        replayed: false,
      };
    });
  }
  read(actor: unknown, input: unknown) {
    const prepared = decodeSurferArtifactRef(input);
    return this.tx(actor, async (c) => (await this.currentWork(actor, c, prepared)).work);
  }
  private async completedIn(c: Context, prepared: SurferArtifactRef) {
    const a = await this.find(c, doneId(prepared));
    if (!a) return null;
    const p = record<SurferRefreshWorkReceipt & { contract: string }>(
      await c.s.readArtifact(ref(a)),
      'surfer.memory-refresh-completion.v1',
    );
    if (surferDigest(p.prepared) !== surferDigest(prepared))
      throw surferFailure('Refresh completion belongs to another preparation.');
    const { contract: _contract, ...receipt } = p;
    return receipt;
  }
  completed(actor: unknown, input: unknown) {
    const prepared = decodeSurferArtifactRef(input);
    return this.tx(actor, (c) => this.completedIn(c, prepared));
  }
  private async validateIn(
    actor: unknown,
    c: Context,
    prepared: SurferArtifactRef,
    frames: SurferDirectiveExtractionV2[],
  ) {
    assertSurferJson(frames);
    const current = await this.currentWork(actor, c, prepared);
    if (!Array.isArray(frames) || !frames.length || frames.length > current.work.targets.length)
      throw surferFailure('Invalid refresh response count.');
    for (const [index, frame] of frames.entries()) {
      const t = current.work.targets[index]!,
        recipe = await this.recipe(c, t.replaces, t.recipe);
      const identity = await c.s.source.withCurrent(
        actor,
        t.task.basis,
        t.task.selections,
        (view) => refreshIdentity(frame, view),
      );
      if (surferDigest(identity) !== surferDigest(recipe.value.identity))
        throw surferFailure(
          'Refresh interpretation changed the registered subject/action identity.',
        );
    }
    return current;
  }
  validate(actor: unknown, input: unknown, frames: SurferDirectiveExtractionV2[]) {
    const prepared = decodeSurferArtifactRef(input);
    return this.tx(actor, async (c) => {
      await this.validateIn(actor, c, prepared, frames);
    });
  }
  complete(actor: unknown, input: unknown) {
    assertSurferJson(input);
    const r = structuredClone(input) as {
      prepared: unknown;
      frames: SurferDirectiveExtractionV2[];
    };
    if (
      !r ||
      Object.keys(r).sort().join(',') !== 'frames,prepared' ||
      !Array.isArray(r.frames) ||
      !r.frames.length ||
      r.frames.length > 8
    )
      throw surferFailure('Invalid refresh completion.');
    const prepared = decodeSurferArtifactRef(r.prepared);
    return this.tx(actor, async (c) => {
      const prior = await this.completedIn(c, prepared);
      if (prior) {
        if (prior.framesDigest !== surferDigest(r.frames))
          throw surferFailure('Refresh completion replay packets differ.');
        return prior;
      }
      const { work, plan } = await this.validateIn(actor, c, prepared, r.frames);
      if (r.frames.length !== work.targets.length)
        throw surferFailure('Every prepared target needs a valid response.');
      const scenarios = this.scenarios;
      let result: {
        artifacts: SurferArtifactRef[];
        snapshotId: string;
        snapshotDigest: string;
        memoryCount: number;
      };
      if (work.targets.length === 1) {
        const t = work.targets[0]!,
          single = await new SurferDirectiveMemoryRefreshService(
            new ShotgunSurferMemoryRefreshSession(c.bound),
            scenarios,
          ).refresh(actor, {
            schemaVersion: '1.0.0',
            contract: 'surfer.memory-refresh.v1',
            operationId: t.task.operationId + ':remember',
            expectedActiveSnapshotId: work.expectedActiveSnapshotId,
            replaces: t.replaces,
            basis: t.task.basis,
            selections: t.task.selections,
            packet: r.frames[0],
          });
        result = { ...single, artifacts: [single.artifact] };
      } else
        result = await new SurferDirectiveMemoryBatchRefreshService(
          new ShotgunSurferMemoryBatchRefreshSession(c.bound),
          scenarios,
        ).refresh(actor, {
          schemaVersion: '1.0.0',
          contract: 'surfer.memory-batch-refresh.v1',
          operationId: work.operationId,
          expectedActiveSnapshotId: work.expectedActiveSnapshotId,
          targets: work.targets.map((t, i) => ({
            replaces: t.replaces,
            basis: t.task.basis,
            selections: t.task.selections,
            packet: r.frames[i],
          })),
        });
      const nextRecipes = [];
      for (const memory of result.artifacts)
        nextRecipes.push((await this.registerCurrent(actor, c, memory)).recipe);
      const receipt: SurferRefreshWorkReceipt = {
        prepared,
        profileDigest: work.profileDigest,
        artifacts: result.artifacts,
        snapshotId: result.snapshotId,
        snapshotDigest: result.snapshotDigest,
        memoryCount: result.memoryCount,
        nextRecipes,
        framesDigest: surferDigest(r.frames),
      };
      const cap = await c.s.capture({
        schemaVersion: '2.0.0',
        sourceIds: [],
        artifacts: [...plan.retained, ...result.artifacts].sort((a, b) =>
          a.artifactId < b.artifactId ? -1 : 1,
        ),
        queries: [],
      });
      await this.put(
        c,
        doneId(prepared),
        'surfer.memory-refresh-completion.v1',
        { contract: 'surfer.memory-refresh-completion.v1', ...receipt },
        cap,
      );
      return receipt;
    });
  }
}
