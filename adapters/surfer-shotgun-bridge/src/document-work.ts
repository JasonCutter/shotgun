import type {
  SurferRoutedSourceSessionsPort,
  SurferRoutedSourceSession,
} from '../../../packages/contracts/src/surfer-source-rows.js';
import type { SurferScopedRuleMemorySession } from '../../../packages/contracts/src/surfer-rule-memory.js';
import type {
  SurferDocumentWorkPort,
  SurferDocumentPreparation,
  SurferIndexedDocumentPreparation,
  SurferDocumentPreparedWork,
  SurferDocumentWorkReceipt,
} from '../../../packages/contracts/src/surfer-document-work.js';
import type {
  SurferKnowledgeArtifact,
  SurferArtifactRef,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import { decodeSurferSourceRequest } from '../../../packages/contracts/src/surfer-source.js';
import { readSurferBindingStateV2 } from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferDirectiveExtractionV2 } from '../../../packages/contracts/src/surfer-directive-v2.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';
import { unicodeLength } from '../../../packages/contracts/src/document-evidence.js';
import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import { SurferDirectiveMemoryCollectionService } from '../../../modules/surfer-core/src/directive-memory-collection.js';
import type { SurferDirectiveScenarioEvaluationPort } from '../../../packages/contracts/src/surfer-directive-memory.js';
import { ShotgunSurferRoutedMemorySession } from './routed-memory.js';
const stale = (): never => {
  throw new ShotgunError({
    code: 'STALE_VERSION',
    safeMessage: 'Prepared document context changed.',
    module: 'surfer.bridge',
    operation: 'document-work',
  });
};
const workDomain = 'surfer.document-work.v1',
  doneDomain = 'surfer.document-done.v1';
type Context = {
  s: SurferScopedRuleMemorySession;
  raw: SurferRoutedSourceSession;
  actor: ReturnType<typeof decodeSurferSourceRequest>;
};
const doneId = (ref: SurferArtifactRef) => 'doc-done:' + surferDigest(ref).slice(7);
function payload<T>(a: SurferKnowledgeArtifact, domain: string): T {
  if (
    a.kind !== 'EPISODE' ||
    a.domain !== domain ||
    a.payload?.contract !== domain ||
    a.revision !== 1
  )
    throw surferFailure('Invalid document work artifact.');
  return structuredClone(a.payload) as T;
}
/** Uses the selected Source/Core transaction; no nested connection or partial aggregate. */
export class ShotgunSurferDocumentWork implements SurferDocumentWorkPort {
  private readonly context: { runId: string; profileDigest: string };
  constructor(
    private readonly sessions: SurferRoutedSourceSessionsPort,
    private readonly scenarios: SurferDirectiveScenarioEvaluationPort,
    context: { runId: string; profileDigest: string },
  ) {
    assertSurferJson(context);
    if (
      !context ||
      Object.keys(context).sort().join(',') !== 'profileDigest,runId' ||
      !/^[A-Za-z0-9-]{1,40}$/.test(context.runId) ||
      !/^sha256:[a-f0-9]{64}$/.test(context.profileDigest)
    )
      throw surferFailure('Invalid document server context.');
    this.context = structuredClone(context);
  }
  private tx<T>(
    actor: unknown,
    intent: 'READ' | 'WRITE',
    fn: (c: Context) => Promise<T>,
  ): Promise<T> {
    const request = decodeSurferSourceRequest(actor);
    return this.sessions.withRoutedSnapshot(request, intent, async (raw) => {
      let active = true;
      const bound: SurferRoutedSourceSessionsPort = {
        withRoutedSnapshot: async (r, mode, apply) => {
          if (
            !active ||
            surferDigest(r) !== surferDigest(request) ||
            (intent === 'READ' && mode === 'WRITE')
          )
            throw surferFailure('Document work escaped its Source transaction.');
          return apply(raw);
        },
      };
      const memory = new ShotgunSurferRoutedMemorySession(bound);
      try {
        return await (intent === 'READ'
          ? memory.withReadSession(request, (s) => fn({ s, raw, actor: request }))
          : memory.withSession(request, (s) => fn({ s, raw, actor: request })));
      } finally {
        active = false;
      }
    });
  }
  private async active(c: Context) {
    return c.raw.profile === 'ROWS'
      ? c.raw.session.core.currentSnapshotId()
      : readSurferBindingStateV2(
          c.raw.session.bindingStore,
          c.actor.projectId,
          (st) => st.activeSnapshotId,
        );
  }
  private async checkCollection(c: Context, expected: string | null) {
    if ((await this.active(c)) !== expected) return stale();
    if (expected) {
      const read = await c.s.read(expected);
      if (read.status !== 'CURRENT' || !read.result.isActive) return stale();
      if (
        read.result.artifacts.some(
          (a) => a.kind !== 'INTERPRETATION' || a.domain !== 'surfer.directive-memory.v1',
        ) ||
        read.result.artifacts.length >= 16
      )
        throw surferFailure('Document work cannot replace unrelated or full memory collections.');
    }
  }
  private async put(
    c: Context,
    id: string,
    domain: string,
    p: Record<string, unknown>,
    capture: Awaited<ReturnType<SurferScopedRuleMemorySession['capture']>>,
  ) {
    const result = await c.s.commit({
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
            executionId: surferDigest(p),
          },
          payloadSchema: 'surfer.opaque.v1',
          payload: p,
          basis: capture.basis.coreBasis,
        },
      },
    });
    return {
      artifactId: result.commit.subjectId,
      revision: result.commit.revision,
      digest: result.commit.digest,
    };
  }
  private async work(c: Context, input: unknown) {
    const ref = decodeSurferArtifactRef(input),
      a = await c.s.readArtifact(ref),
      p = payload<SurferDocumentPreparedWork>(a, workDomain);
    if (
      !/^doc-work:[a-f0-9]{64}$/.test(ref.artifactId) ||
      Object.keys(p).sort().join(',') !==
        'command,contract,profileDigest,requestDigest,runId,task' ||
      !/^sha256:[a-f0-9]{64}$/.test(p.requestDigest) ||
      p.profileDigest !== this.context.profileDigest ||
      p.runId !== this.context.runId ||
      p.task.runId !== p.runId ||
      p.task.operationId !== 'semantic:' + p.runId + ':dw:' + ref.artifactId.slice(-64, -40) ||
      p.command.memoryId !== 'doc-memory:' + ref.artifactId.slice(-64) ||
      p.command.expectedRevision !== null
    )
      throw surferFailure('Prepared document profile or identity differs.');
    return { ref, p };
  }
  prepare(actor: unknown, input: unknown) {
    return this.prepareCurrent(actor, input, false);
  }
  prepareIndexed(actor: unknown, input: unknown) {
    return this.prepareCurrent(actor, input, true);
  }
  private async prepareCurrent(actor: unknown, input: unknown, indexed: boolean) {
    assertSurferJson(input);
    const r = input as SurferDocumentPreparation & SurferIndexedDocumentPreparation;
    if (
      !r ||
      Object.keys(r).sort().join(',') !==
        (indexed
          ? 'requestId,revisionId,schemaVersion,sourceId,sourceVersionId'
          : 'expectedActiveSnapshotId,requestId,schemaVersion,sourceId') ||
      r.schemaVersion !== '1.0.0' ||
      typeof r.requestId !== 'string' ||
      !/^[A-Za-z0-9-]{1,64}$/.test(r.requestId) ||
      typeof r.sourceId !== 'string' ||
      !r.sourceId.length ||
      r.sourceId.length > 256 ||
      (indexed &&
        (!/^[a-f0-9-]{36}$/.test(r.sourceVersionId) || !/^[a-f0-9-]{36}$/.test(r.revisionId))) ||
      (!indexed &&
        r.expectedActiveSnapshotId !== null &&
        (typeof r.expectedActiveSnapshotId !== 'string' ||
          !r.expectedActiveSnapshotId.length ||
          r.expectedActiveSnapshotId.length > 256))
    )
      throw surferFailure('Invalid document preparation.');
    return this.tx(actor, 'WRITE', async (c) => {
      const key = surferDigest({ projectId: c.actor.projectId, requestId: r.requestId }).slice(7),
        id = 'doc-work:' + key,
        prior = await c.s.findCommit(id);
      if (prior) {
        const ref = { artifactId: prior.subjectId, revision: prior.revision, digest: prior.digest },
          old = await this.work(c, ref);
        if (old.p.requestDigest !== surferDigest(r))
          throw surferFailure('Document request identity was reused.');
        return { prepared: ref, replayed: true };
      }
      const material = (await c.raw.session.readMaterialV2(r.sourceId)).material,
        roots = material.evidence.filter((e) => e.pointer === '');
      if (
        indexed &&
        (material.sourceVersionId !== r.sourceVersionId || material.revisionId !== r.revisionId)
      )
        return stale();
      if (
        roots.length !== 1 ||
        roots[0]!.evidenceId !== material.rootEvidenceId ||
        unicodeLength(roots[0]!.quote.exact) < 1 ||
        unicodeLength(roots[0]!.quote.exact) > 2048
      )
        throw surferFailure(
          'Document preparation requires one complete root of1..2048 characters.',
        );
      const selection = {
          sourceId: r.sourceId,
          evidenceId: roots[0]!.evidenceId,
          start: 0,
          end: unicodeLength(roots[0]!.quote.exact),
          targetUnit: null,
        },
        view = await c.s.source.observe(c.actor, {
          schemaVersion: '1.0.0',
          selections: [selection],
        });
      const expectedActiveSnapshotId = indexed ? await this.active(c) : r.expectedActiveSnapshotId;
      await this.checkCollection(c, expectedActiveSnapshotId);
      const p: SurferDocumentPreparedWork = {
          contract: workDomain,
          requestDigest: surferDigest(r),
          ...this.context,
          task: {
            schemaVersion: '1.0.0',
            runId: this.context.runId,
            operationId: 'semantic:' + this.context.runId + ':dw:' + key.slice(0, 24),
            stepId: 'interpret',
            attempt: 1,
            priority: 'FOREGROUND',
            basis: view.basis,
            selections: [selection],
          },
          command: {
            memoryId: 'doc-memory:' + key,
            expectedRevision: null,
            expectedActiveSnapshotId,
          },
        },
        cap = await c.s.capture({
          schemaVersion: '2.0.0',
          sourceIds: [r.sourceId],
          artifacts: [],
          queries: [{ kind: 'EXPLICIT_SOURCE_SET', sourceIds: [r.sourceId] }],
        });
      return {
        prepared: await this.put(c, id, workDomain, p as unknown as Record<string, unknown>, cap),
        replayed: false,
      };
    });
  }
  read(actor: unknown, input: unknown) {
    return this.tx(actor, 'WRITE', async (c) => {
      const { p } = await this.work(c, input);
      await this.checkCollection(c, p.command.expectedActiveSnapshotId);
      return p;
    });
  }
  completed(actor: unknown, input: unknown) {
    return this.tx(actor, 'READ', async (c) => {
      const { ref, p } = await this.work(c, input),
        prior = await c.s.findCommit(doneId(ref));
      if (!prior) return null;
      const done = payload<SurferDocumentWorkReceipt>(
        await c.s.readArtifact({
          artifactId: prior.subjectId,
          revision: prior.revision,
          digest: prior.digest,
        }),
        doneDomain,
      );
      if (
        surferDigest(done.prepared) !== surferDigest(ref) ||
        done.profileDigest !== p.profileDigest
      )
        throw surferFailure('Document completion differs from its preparation.');
      return done;
    });
  }
  complete(actor: unknown, input: { prepared: unknown; frame: SurferDirectiveExtractionV2 }) {
    return this.tx(actor, 'WRITE', async (c) => {
      const { ref, p } = await this.work(c, input.prepared);
      await this.checkCollection(c, p.command.expectedActiveSnapshotId);
      const memories = new SurferDirectiveMemoryCollectionService(
          { withSession: (_a, fn) => fn(c.s) },
          this.scenarios,
        ),
        m = await memories.remember(c.actor, {
          schemaVersion: '1.0.0',
          contract: 'surfer.directive-memory.v1',
          ...p.command,
          operationId: p.task.operationId + ':remember',
          basis: p.task.basis,
          selections: p.task.selections,
          packet: input.frame,
        });
      const done: SurferDocumentWorkReceipt = {
          contract: doneDomain,
          prepared: ref,
          profileDigest: p.profileDigest,
          artifact: m.artifact,
          snapshotId: m.snapshotId,
          snapshotDigest: m.snapshotDigest,
          memoryCount: m.memoryCount,
          frameDigest: surferDigest(input.frame),
        },
        cap = await c.s.capture({
          schemaVersion: '2.0.0',
          sourceIds: [],
          artifacts: [ref, m.artifact],
          queries: [],
        });
      await this.put(c, doneId(ref), doneDomain, done as unknown as Record<string, unknown>, cap);
      return done;
    });
  }
}
