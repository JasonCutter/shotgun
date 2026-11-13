import { ShotgunError } from '../../../packages/contracts/src/errors.js';
import type { SurferRowsCoreSessionPort } from '../../../packages/contracts/src/surfer-source-rows.js';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
  decodeSurferAccessContext,
  type SurferAccessContext,
} from '../../../packages/contracts/src/surfer-experiment.js';
import {
  decodeSurferArtifactRef,
  decodeSurferKnowledgeCommand,
  decodeSurferKnowledgeCapture,
  type SurferArtifactRef,
  type SurferKnowledgeArtifact,
  type SurferKnowledgeBasis,
  type SurferKnowledgeInput,
  type SurferKnowledgeSnapshot,
  type SurferKnowledgeState,
  type SurferQueryFootprint,
} from '../../../packages/contracts/src/surfer-knowledge.js';
import type {
  SurferKnowledgeLookupView,
  SurferKnowledgeRowsPort,
  SurferRowsClosure,
  SurferRowsMetadata,
} from '../../../packages/contracts/src/surfer-knowledge-rows.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  captureKnowledgeView,
  inspectKnowledgeView,
  inspectKnowledgeSnapshot,
  prepareKnowledgeTransition,
} from '../../../modules/surfer-core/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type Kind = 'INPUT' | 'ARTIFACT' | 'EPOCH' | 'SNAPSHOT' | 'COMMAND';
type Row = { revision: string; payload: unknown; digest: string };
type Receipt = SurferKnowledgeState['commands'][number];
const refOf = (a: SurferKnowledgeArtifact): SurferArtifactRef => ({
  artifactId: a.artifactId,
  revision: a.revision,
  digest: a.digest,
});
const key = (id: string, revision: number) => JSON.stringify([id, revision]);
const footprintKey = (domain: string, predicate: string) => surferDigest({ domain, predicate });
const limit = (n: number) => {
  if (n > 64) throw surferFailure('Row knowledge lookup exceeds its 64-record profile.');
};
/** Mandatory trusted-server capability, checked inside every transaction. Not a Source bridge. */
export type SurferRowsAccess = {
  readonly spaceId: string;
  readonly authorize: (client: PoolClient, spaceId: string) => Promise<SurferAccessContext>;
};

export class PostgresSurferKnowledgeRows
  implements SurferKnowledgeRowsPort, SurferRowsCoreSessionPort
{
  private readonly spaceId: string;
  private readonly authorize: SurferRowsAccess['authorize'];
  constructor(
    private readonly pool: Pick<Pool, 'connect'> | null,
    access: SurferRowsAccess,
    private readonly bound?: { client: PoolClient; assertActive: () => void; readOnly: boolean },
  ) {
    if (!access.spaceId || access.spaceId.length > 256 || typeof access.authorize !== 'function')
      throw surferFailure('Explicit server Core access is required.');
    this.spaceId = access.spaceId;
    this.authorize = access.authorize;
  }
  private async sql<T extends QueryResultRow = QueryResultRow>(
    client: PoolClient,
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    this.bound?.assertActive();
    const result = await client.query<T>(text, values);
    this.bound?.assertActive();
    return result;
  }
  private tail: Promise<void> = Promise.resolve();
  private async tx<T>(
    write: boolean,
    action: (
      client: PoolClient,
      context: SurferAccessContext,
      metadata: SurferRowsMetadata,
    ) => Promise<T>,
  ): Promise<T> {
    const run = async (client: PoolClient) => {
      this.bound?.assertActive();
      if (write && this.bound?.readOnly)
        throw surferFailure('Read-only row Source session cannot write.');
      const context = decodeSurferAccessContext(await this.authorize(client, this.spaceId));
      if (context.spaceId !== this.spaceId) throw surferFailure('Row owner cannot cross spaces.');
      if (write) {
        const initial: SurferRowsMetadata = {
          contract: 'surfer.knowledge-rows.v1',
          spaceId: this.spaceId,
          sequence: 0,
          authorityEpoch: 0,
          activeSnapshotId: null,
        };
        await this.sql(
          client,
          'INSERT INTO surfer_rows.space VALUES($1,0,$2::jsonb,$3) ON CONFLICT DO NOTHING',
          [this.spaceId, JSON.stringify(initial), surferDigest(initial)],
        );
      }
      const row = (
        await this.sql<{ sequence: string; payload: SurferRowsMetadata; digest: string }>(
          client,
          `SELECT sequence::text,payload,digest FROM surfer_rows.space WHERE space_id=$1${write ? ' FOR UPDATE' : ''}`,
          [this.spaceId],
        )
      ).rows[0];
      if (!row)
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Row knowledge space is unavailable.',
          module: 'surfer.core.rows',
          operation: 'read-space',
        });
      const m = row?.payload;
      if (
        !row ||
        !m ||
        m.contract !== 'surfer.knowledge-rows.v1' ||
        m.spaceId !== this.spaceId ||
        Number(row.sequence) !== m.sequence ||
        !Number.isSafeInteger(m.sequence) ||
        !Number.isSafeInteger(m.authorityEpoch) ||
        m.authorityEpoch < 0 ||
        m.authorityEpoch > m.sequence ||
        (m.activeSnapshotId !== null && typeof m.activeSnapshotId !== 'string') ||
        surferDigest(m) !== row.digest
      )
        throw surferFailure('Row knowledge metadata identity/checksum mismatch.');
      const result = await action(client, context, m);
      surferDigest(result);
      this.bound?.assertActive();
      return structuredClone(result);
    };
    if (this.bound) {
      this.bound.assertActive();
      const pending = this.tail.then(() => run(this.bound!.client));
      this.tail = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    }
    if (!this.pool) throw surferFailure('No standalone row connection is configured.');
    return withSafePostgresTransaction(this.pool, run, {
      module: 'surfer.core.rows',
      operation: write ? 'row-write' : 'row-read',
      ...(write ? {} : { isolationLevel: 'REPEATABLE READ' as const, readOnly: true }),
    });
  }
  initialize() {
    return this.tx(true, async (_client, _context, m) => m);
  }
  async lookupInput(id: string) {
    if (!id || id.length > 256) throw surferFailure('Invalid row input ID.');
    const result = await this.tx(false, async (client, context, m) => {
      const row = await this.record(client, 'INPUT', id);
      if (!row) return null;
      const value = row.payload as SurferKnowledgeInput;
      if (
        value.inputId !== id ||
        value.revision !== Number(row.revision) ||
        value.revision > m.sequence
      )
        throw surferFailure('Row input identity mismatch.');
      const v = await this.view(client, m, { refs: [], inputIds: [id] });
      captureKnowledgeView(v, { inputIds: [id], artifacts: [], footprints: [] }, context);
      return value;
    });
    return result ?? undefined;
  }
  hasOperation(id: string) {
    return this.tx(false, async (client, _ctx, m) => {
      const v = await this.view(client, m, { refs: [], operationId: id });
      return !!v.receipt(id);
    });
  }
  currentSnapshotId() {
    return this.tx(false, async (_client, _context, metadata) => metadata.activeSnapshotId);
  }
  findCommit(id: string) {
    return this.tx(false, async (client, _ctx, m) => {
      const v = await this.view(client, m, { refs: [], operationId: id });
      return v.receipt(id)?.commit ?? null;
    });
  }
  priorCreatedAt(id: string) {
    return this.tx(false, async (client, ctx, m) => {
      const v = await this.view(client, m, { refs: [], operationId: id }),
        receipt = v.receipt(id);
      if (!receipt || receipt.commit.subjectKind !== 'ARTIFACT') return null;
      const ref = {
          artifactId: receipt.commit.subjectId,
          revision: receipt.commit.revision,
          digest: receipt.commit.digest,
        },
        loaded = await this.view(client, m, { refs: [ref] });
      const result = inspectKnowledgeView(loaded, [ref], ctx, true);
      return (
        result.artifacts.find((a) => a.artifactId === ref.artifactId && a.revision === ref.revision)
          ?.createdAt ?? null
      );
    });
  }
  /** Latest revision comes directly from the immutable indexed history, not an unverified head cache. */
  private async record(
    client: PoolClient,
    kind: Kind,
    id: string,
    revision?: number,
  ): Promise<Row | undefined> {
    const row = (
      await this.sql<Row>(
        client,
        `SELECT revision::text,payload,digest FROM surfer_rows.record WHERE space_id=$1 AND kind=$2 AND record_id=$3${revision === undefined ? ' ORDER BY surfer_rows.record.revision DESC LIMIT 1' : ' AND revision=$4'}`,
        [this.spaceId, kind, id, ...(revision === undefined ? [] : [revision])],
      )
    ).rows[0];
    if (
      row &&
      (!Number.isSafeInteger(Number(row.revision)) ||
        Number(row.revision) < 1 ||
        surferDigest(row.payload) !== row.digest)
    )
      throw surferFailure('Row knowledge record checksum/revision mismatch.');
    return row;
  }
  private async snapshot(
    client: PoolClient,
    id: string | null,
    metadata: SurferRowsMetadata,
  ): Promise<SurferKnowledgeSnapshot | undefined> {
    if (id === null) return undefined;
    const row = await this.record(client, 'SNAPSHOT', id, 1);
    if (!row) return undefined;
    const s = row.payload as SurferKnowledgeSnapshot;
    const { digest, ...body } = s;
    if (
      s.snapshotId !== id ||
      s.spaceId !== this.spaceId ||
      s.sequence > metadata.sequence ||
      surferDigest(body) !== digest
    )
      throw surferFailure('Row snapshot identity/digest mismatch.');
    return s;
  }
  private async view(
    client: PoolClient,
    m: SurferRowsMetadata,
    request: {
      refs: readonly SurferArtifactRef[];
      inputIds?: readonly string[];
      footprints?: readonly SurferQueryFootprint[];
      priorId?: string;
      operationId?: string;
      snapshotId?: string;
    },
  ): Promise<SurferKnowledgeLookupView> {
    const artifacts = new Map<string, SurferKnowledgeArtifact>(),
      heads = new Map<string, SurferArtifactRef | undefined>(),
      inputs = new Map<string, SurferKnowledgeInput | undefined>(),
      epochs = new Map<string, number>(),
      receipts = new Map<string, Receipt | undefined>(),
      snapshots = new Map<string, SurferKnowledgeSnapshot | undefined>();
    const budget: unknown[] = [];
    const retain = (x: unknown) => {
      budget.push(x);
      surferDigest(budget);
    };
    const artifactRow = (row: Row, id: string) => {
      const a = row.payload as SurferKnowledgeArtifact;
      const { digest, ...body } = a;
      if (
        a.artifactId !== id ||
        a.revision !== Number(row.revision) ||
        a.revision > m.sequence ||
        a.scope.spaceId !== this.spaceId ||
        surferDigest(body) !== digest
      )
        throw surferFailure('Row artifact identity/digest mismatch.');
      const k = key(id, a.revision);
      if (!artifacts.has(k)) {
        limit(artifacts.size + 1);
        artifacts.set(k, a);
        retain(a);
      }
      return a;
    };
    const loadHead = async (id: string) => {
      if (heads.has(id)) return heads.get(id);
      limit(heads.size + 1);
      const row = await this.record(client, 'ARTIFACT', id);
      const ref = row ? refOf(artifactRow(row, id)) : undefined;
      heads.set(id, ref);
      return ref;
    };
    const loadInput = async (id: string) => {
      if (inputs.has(id)) return;
      limit(inputs.size + 1);
      const row = await this.record(client, 'INPUT', id);
      const x = row?.payload as SurferKnowledgeInput | undefined;
      if (
        x &&
        (x.inputId !== id ||
          x.revision !== Number(row!.revision) ||
          x.revision > m.sequence ||
          x.scope.spaceId !== this.spaceId)
      )
        throw surferFailure('Row input identity mismatch.');
      inputs.set(id, x);
      if (x) retain(x);
    };
    const loadEpoch = async (domain: string, predicate: string) => {
      const k = footprintKey(domain, predicate);
      if (epochs.has(k)) return;
      limit(epochs.size + 1);
      const row = await this.record(client, 'EPOCH', k);
      const e = row?.payload as { domain: string; predicate: string; epoch: number } | undefined;
      if (
        e &&
        (e.domain !== domain ||
          e.predicate !== predicate ||
          e.epoch !== Number(row!.revision) ||
          e.epoch > m.sequence)
      )
        throw surferFailure('Row footprint identity mismatch.');
      epochs.set(k, e?.epoch ?? 0);
    };
    const loadFootprint = async (f: SurferQueryFootprint) => {
      await loadEpoch(f.domain, f.predicate);
      await loadEpoch(f.domain, '*');
      await loadEpoch('*', '*');
    };
    const visited = new Set<string>(),
      visiting = new Set<string>();
    const visit = async (ref: SurferArtifactRef, depth: number): Promise<void> => {
      if (depth > 128) throw surferFailure('Row dependency depth exceeds profile.');
      const k = key(ref.artifactId, ref.revision);
      if (visiting.has(k)) throw surferFailure('Row knowledge dependency cycle.');
      if (visited.has(k)) {
        if (artifacts.get(k)?.digest !== ref.digest)
          throw surferFailure('Row dependency digest alias mismatch.');
        return;
      }
      visiting.add(k);
      await loadHead(ref.artifactId);
      let a = artifacts.get(k);
      if (!a) {
        const row = await this.record(client, 'ARTIFACT', ref.artifactId, ref.revision);
        if (!row) throw surferFailure('Row dependency revision is missing.');
        a = artifactRow(row, ref.artifactId);
      }
      if (a.digest !== ref.digest) throw surferFailure('Row dependency reference digest mismatch.');
      for (const i of a.basis.inputs) await loadInput(i.inputId);
      for (const f of a.basis.footprints) await loadFootprint(f);
      for (const dep of a.basis.artifacts) await visit(dep, depth + 1);
      visiting.delete(k);
      visited.add(k);
    };
    limit(request.refs.length);
    limit(request.inputIds?.length ?? 0);
    limit(request.footprints?.length ?? 0);
    for (const ref of request.refs) await visit(ref, 0);
    if (request.priorId) {
      const prior = await loadHead(request.priorId);
      if (prior) await visit(prior, 0);
    }
    for (const id of request.inputIds ?? []) await loadInput(id);
    for (const f of request.footprints ?? []) await loadFootprint(f);
    if (request.operationId) {
      const row = await this.record(client, 'COMMAND', request.operationId);
      const c = row?.payload as Receipt | undefined;
      if (
        c &&
        (c.operationId !== request.operationId ||
          c.commit.operationId !== c.operationId ||
          c.commit.sequence !== Number(row!.revision) ||
          c.commit.sequence > m.sequence)
      )
        throw surferFailure('Row command receipt identity mismatch.');
      receipts.set(request.operationId, c);
    }
    if (request.snapshotId)
      snapshots.set(request.snapshotId, await this.snapshot(client, request.snapshotId, m));
    const checked = <T>(map: Map<string, T>, k: string): T => {
      if (!map.has(k)) throw surferFailure('Lookup was not loaded by the bounded row view.');
      return map.get(k)!;
    };
    return {
      ...m,
      input: (id) => checked(inputs, id),
      artifact: (ref) => checked(artifacts, key(ref.artifactId, ref.revision)),
      head: (id) => checked(heads, id),
      epoch: (d, p) => checked(epochs, footprintKey(d, p)),
      receipt: (id) => checked(receipts, id),
      snapshot: (id) => checked(snapshots, id),
    };
  }
  private async insert(
    client: PoolClient,
    kind: Kind,
    id: string,
    revision: number,
    payload: unknown,
  ) {
    await this.sql(client, 'INSERT INTO surfer_rows.record VALUES($1,$2,$3,$4,$5::jsonb,$6)', [
      this.spaceId,
      kind,
      id,
      revision,
      JSON.stringify(payload),
      surferDigest(payload),
    ]);
  }
  async execute(commandInput: unknown) {
    const c = decodeSurferKnowledgeCommand(commandInput);
    return this.tx(true, async (client, context, m) => {
      const v = await this.view(client, m, {
        refs:
          c.action === 'APPEND_ARTIFACT'
            ? c.draft.basis.artifacts
            : c.action === 'PUBLISH_SNAPSHOT'
              ? c.entries
              : [],
        inputIds:
          c.action === 'OBSERVE_INPUT'
            ? [c.input.inputId]
            : c.action === 'APPEND_ARTIFACT'
              ? c.draft.basis.inputs.map((i) => i.inputId)
              : [],
        footprints:
          c.action === 'OBSERVE_INPUT'
            ? c.affectedFootprints
            : c.action === 'APPEND_ARTIFACT'
              ? c.draft.basis.footprints
              : [],
        ...(c.action === 'APPEND_ARTIFACT' ? { priorId: c.draft.artifactId } : {}),
        operationId: c.operationId,
        ...(c.action === 'PUBLISH_SNAPSHOT' ? { snapshotId: c.snapshotId } : {}),
      });
      const oldReceipt = v.receipt(c.operationId);
      const legacyDetached =
        c.action === 'PUBLISH_SNAPSHOT' &&
        oldReceipt?.meaningDigest ===
          surferDigest({ contract: 'detached-source-binding-v2', command: c });
      const patch = prepareKnowledgeTransition(v, c, context, legacyDetached);
      if (patch.result.replayed) return patch.result;
      if (patch.input)
        await this.insert(client, 'INPUT', patch.input.inputId, patch.input.revision, patch.input);
      if (patch.artifact)
        await this.insert(
          client,
          'ARTIFACT',
          patch.artifact.artifactId,
          patch.artifact.revision,
          patch.artifact,
        );
      if (patch.snapshot)
        await this.insert(client, 'SNAPSHOT', patch.snapshot.snapshotId, 1, patch.snapshot);
      for (const e of patch.epochs)
        await this.insert(client, 'EPOCH', footprintKey(e.domain, e.predicate), e.epoch, e);
      await this.insert(
        client,
        'COMMAND',
        c.operationId,
        patch.result.commit.sequence,
        patch.command!,
      );
      const next: SurferRowsMetadata = {
        ...m,
        sequence: patch.result.commit.sequence,
        authorityEpoch: patch.authorityEpoch ?? m.authorityEpoch,
        activeSnapshotId: patch.activeSnapshotId ?? m.activeSnapshotId,
      };
      const updated = await this.sql(
        client,
        'UPDATE surfer_rows.space SET sequence=$2,payload=$3::jsonb,digest=$4 WHERE space_id=$1 AND sequence=$5',
        [this.spaceId, next.sequence, JSON.stringify(next), surferDigest(next), m.sequence],
      );
      if (updated.rowCount !== 1) throw surferFailure('Row knowledge metadata CAS conflict.');
      return patch.result;
    });
  }
  async captureBasis(requestInput: unknown): Promise<SurferKnowledgeBasis> {
    const r = decodeSurferKnowledgeCapture(requestInput);
    return this.tx(false, async (client, ctx, m) =>
      captureKnowledgeView(
        await this.view(client, m, {
          refs: r.artifacts,
          inputIds: r.inputIds,
          footprints: r.footprints,
        }),
        r,
        ctx,
      ),
    );
  }
  private async read(
    request: { artifacts: readonly SurferArtifactRef[] } | { snapshotId: string | null },
    historical = false,
  ): Promise<SurferRowsClosure> {
    surferDigest(request);
    if (
      Object.keys(request).length !== 1 ||
      (!('artifacts' in request) && !('snapshotId' in request))
    )
      throw surferFailure('Invalid row closure request.');
    const refs =
      'artifacts' in request
        ? decodeSurferKnowledgeCapture({
            inputIds: [],
            artifacts: request.artifacts,
            footprints: [],
          }).artifacts
        : null;
    const snapshotId = 'snapshotId' in request ? request.snapshotId : null;
    if (
      !refs &&
      snapshotId !== null &&
      (typeof snapshotId !== 'string' || !snapshotId.length || snapshotId.length > 256)
    )
      throw surferFailure('Invalid row snapshot identity.');
    return this.tx(false, async (client, context, m) => {
      const snapshot = refs
        ? undefined
        : await this.snapshot(client, snapshotId ?? m.activeSnapshotId, m);
      if (!refs && !snapshot)
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Row snapshot is unavailable.',
          module: 'surfer.core.rows',
          operation: 'read-snapshot',
        });
      const v = await this.view(client, m, { refs: refs ?? snapshot!.entries });
      const check = snapshot
        ? inspectKnowledgeSnapshot(v, snapshot, context)
        : inspectKnowledgeView(v, refs!, context);
      return {
        contract: 'surfer.knowledge-rows.v1',
        mode: historical ? 'HISTORICAL' : 'CURRENT_KERNEL',
        isActive: !!snapshot && snapshot.snapshotId === m.activeSnapshotId,
        sourceCurrentness: 'NOT_ASSESSED',
        artifacts: historical || !check.reasons.length ? check.artifacts : [],
        staleReasons: check.reasons,
        kernelCurrent: check.reasons.length === 0,
        snapshot: historical || !check.reasons.length ? (snapshot ?? null) : null,
      };
    });
  }
  async readClosure(
    request: { artifacts: readonly SurferArtifactRef[] } | { snapshotId: string | null },
  ) {
    return this.read(request);
  }
  /** Explicit historical access; current input authorization is never bypassed. */
  async readHistoricalArtifact(refInput: unknown) {
    const ref = decodeSurferArtifactRef(refInput);
    return this.read({ artifacts: [ref] }, true);
  }
}

/** Same outer Source transaction; no Pool facade or nested BEGIN/COMMIT. */
export function bindSurferKnowledgeRowsSession(
  client: PoolClient,
  context: SurferAccessContext,
  assertActive: () => void,
  readOnly: boolean,
): SurferRowsCoreSessionPort {
  const fixed = decodeSurferAccessContext(context);
  return new PostgresSurferKnowledgeRows(
    null,
    {
      spaceId: fixed.spaceId,
      authorize: async () => {
        assertActive();
        return fixed;
      },
    },
    { client, assertActive, readOnly },
  );
}
