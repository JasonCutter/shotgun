import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { decodeSurferArtifactRef } from '../../../packages/contracts/src/surfer-knowledge.js';
import {
  assertSurferSourceBasisV2,
  type SurferSourceBasisV2,
  type SurferBindingRecordV2,
} from '../../../packages/contracts/src/surfer-source-binding-v2.js';
import type { SurferRowsBindingPort } from '../../../packages/contracts/src/surfer-source-rows.js';
import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

/** Same Source-owned transaction. Immutable indexed rows; no aggregate State shim or transaction controls. */
export function bindSurferRowsBindings(
  client: PoolClient,
  spaceId: string,
  assertActive: () => void,
  readOnly: boolean,
): SurferRowsBindingPort {
  async function sql<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    assertActive();
    const result = await client.query<T>(text, values);
    assertActive();
    return result;
  }
  let tail: Promise<void> = Promise.resolve();
  function run<T>(write: boolean, action: () => Promise<T>): Promise<T> {
    assertActive();
    if (write && readOnly) throw surferFailure('Read-only row Source bindings cannot write.');
    const pending = tail.then(async () => {
      assertActive();
      const result = await action();
      assertActive();
      return structuredClone(result);
    });
    tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
  function basis(value: unknown): SurferSourceBasisV2 {
    assertSurferSourceBasisV2(value);
    const b = structuredClone(value);
    if (b.authority.projectId !== spaceId || b.coreBasis.spaceId !== spaceId)
      throw surferFailure('Row Source basis crosses spaces.');
    return b;
  }
  async function captureBy(column: 'content_digest' | 'receipt_digest', digest: string) {
    const row = (
      await sql<{
        payload: SurferSourceBasisV2;
        content_digest: string;
        receipt_digest: string;
      }>(
        `SELECT payload,content_digest,receipt_digest FROM surfer_rows.source_capture WHERE space_id=$1 AND ${column}=$2`,
        [spaceId, digest],
      )
    ).rows[0];
    if (!row) return undefined;
    const b = basis(row.payload);
    if (b.contentDigest !== row.content_digest || surferDigest(b) !== row.receipt_digest)
      throw surferFailure('Stored row Source capture digest mismatch.');
    return b;
  }
  return {
    captureIssued(input) {
      const b = basis(input),
        digest = surferDigest(b);
      return run(false, async () => !!(await captureBy('receipt_digest', digest)));
    },
    issueCapture(input) {
      const b = basis(input);
      return run(true, async () => {
        await sql(
          'INSERT INTO surfer_rows.source_capture VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',
          [spaceId, b.contentDigest, surferDigest(b), JSON.stringify(b)],
        );
        const existing = await captureBy('content_digest', b.contentDigest);
        if (!existing) throw surferFailure('Row Source capture insert conflict.');
        return existing;
      });
    },
    binding(refInput) {
      const ref = decodeSurferArtifactRef(refInput);
      return run(false, async () => {
        const row = (
          await sql<{ payload: SurferBindingRecordV2; digest: string }>(
            'SELECT payload,digest FROM surfer_rows.source_binding WHERE space_id=$1 AND artifact_id=$2 AND revision=$3',
            [spaceId, ref.artifactId, ref.revision],
          )
        ).rows[0];
        if (!row) return undefined;
        const r = row.payload;
        basis(r.basis);
        if (
          surferDigest(r) !== row.digest ||
          surferDigest(r.artifact) !== surferDigest(ref) ||
          r.digest !== surferDigest({ artifact: r.artifact, contentDigest: r.basis.contentDigest })
        )
          throw surferFailure('Stored row Source binding identity/digest mismatch.');
        return r;
      });
    },
    bind(input) {
      const r = structuredClone(input);
      decodeSurferArtifactRef(r.artifact);
      basis(r.basis);
      if (r.digest !== surferDigest({ artifact: r.artifact, contentDigest: r.basis.contentDigest }))
        throw surferFailure('Row Source binding content digest mismatch.');
      return run(true, async () => {
        await sql(
          'INSERT INTO surfer_rows.source_binding VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING',
          [spaceId, r.artifact.artifactId, r.artifact.revision, JSON.stringify(r), surferDigest(r)],
        );
        const existing = (
          await sql<{ digest: string }>(
            'SELECT digest FROM surfer_rows.source_binding WHERE space_id=$1 AND artifact_id=$2 AND revision=$3',
            [spaceId, r.artifact.artifactId, r.artifact.revision],
          )
        ).rows[0];
        if (existing?.digest !== surferDigest(r))
          throw surferFailure('Artifact revision has different row Source binding semantics.');
      });
    },
  };
}
