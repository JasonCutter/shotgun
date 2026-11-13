import { createHash } from 'node:crypto';
import type {
  CredentialVaultPort,
  CredentialScope,
} from '../../../modules/credential-vault/src/index.js';
import {
  readSurferDeepSeekMetadata,
  SURFER_DEEPSEEK_BASELINE_POLICY,
  type SurferDeepSeekMetadata,
} from '../../ai-provider-deepseek/src/surfer-budget.js';
import type { SurferSemanticRunStorePort } from '../../../packages/contracts/src/surfer-semantic-run.js';
import {
  assertSurferJson,
  surferDigest,
  surferFailure,
} from '../../../packages/contracts/src/surfer-learning.js';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export interface SurferMetadataApprovalPort {
  verify(input: { reviewDigest: string; credentialScopeDigest: string }): Promise<{
    approvalRef: string;
    reviewDigest: string;
    credentialScopeDigest: string;
    mode: 'LIVE' | 'ISOLATED_CONTRACT';
    expiresAtMs: number;
  }>;
}
/** One approved GET, outside DB transactions. Interrupted inspection is never automatically retried.
 * Fixture transport cannot be supplied in LIVE mode. The Vault remains the sole credential owner. */
export class ShotgunSurferModelInspection {
  private readonly fetch: FetchLike;
  constructor(
    private readonly journal: SurferSemanticRunStorePort,
    private readonly vault: CredentialVaultPort,
    private readonly approval: SurferMetadataApprovalPort,
    private readonly options: {
      mode: 'LIVE' | 'ISOLATED_CONTRACT';
      reviewDigest: string;
      scope: CredentialScope;
      accountFingerprint: string;
      fetch?: FetchLike;
    },
    private readonly clock = Date.now,
  ) {
    assertSurferJson({
      mode: options.mode,
      reviewDigest: options.reviewDigest,
      scope: options.scope,
      accountFingerprint: options.accountFingerprint,
    });
    if (
      !['LIVE', 'ISOLATED_CONTRACT'].includes(options.mode) ||
      options.scope.providerId !== 'deepseek' ||
      !/^sha256:[a-f0-9]{64}$/.test(options.reviewDigest) ||
      !/^[a-f0-9]{64}$/.test(options.accountFingerprint) ||
      (options.mode === 'LIVE' && options.fetch) ||
      (options.mode === 'ISOLATED_CONTRACT' && !options.fetch)
    )
      throw surferFailure('Invalid isolated/live metadata transport.');
    this.fetch = options.fetch ?? globalThis.fetch;
    this.options = Object.freeze({
      ...options,
      scope: Object.freeze(structuredClone(options.scope)),
    });
  }
  async inspect(): Promise<{
    metadata: SurferDeepSeekMetadata;
    cached: boolean;
    mode: 'LIVE' | 'ISOLATED_CONTRACT';
  }> {
    const scope = structuredClone(this.options.scope),
      reviewDigest = this.options.reviewDigest,
      credentialScopeDigest = surferDigest(scope),
      a = await this.approval.verify({ reviewDigest, credentialScopeDigest });
    assertSurferJson(a);
    if (
      Object.keys(a).sort().join(',') !==
        'approvalRef,credentialScopeDigest,expiresAtMs,mode,reviewDigest' ||
      typeof a.approvalRef !== 'string' ||
      !a.approvalRef ||
      a.approvalRef.length > 180 ||
      a.reviewDigest !== reviewDigest ||
      a.credentialScopeDigest !== credentialScopeDigest ||
      a.mode !== this.options.mode ||
      !Number.isSafeInteger(a.expiresAtMs) ||
      !Number.isSafeInteger(this.clock()) ||
      this.clock() >= a.expiresAtMs
    )
      throw surferFailure('Metadata approval unavailable/expired.');
    const runId = 'metadata:' + reviewDigest,
      meaning = surferDigest({
        reviewDigest,
        credentialScopeDigest,
        endpoint: SURFER_DEEPSEEK_BASELINE_POLICY.metadataEndpoint,
        mode: a.mode,
      });
    const claim = await this.journal.transaction(runId, (s) => {
      if (s.specDigest && s.specDigest !== meaning)
        throw surferFailure('Metadata inspection scope changed.');
      if (s.stage === 'COMPLETED')
        return { claimed: false, metadata: s.evaluation as SurferDeepSeekMetadata };
      if (s.stage !== 'NEW')
        throw surferFailure('Metadata inspection already started/unknown; no retry authority.');
      s.specDigest = meaning;
      s.approvalRef = a.approvalRef + ':metadata';
      s.stage = 'RUNNING';
      s.owner = 'metadata-reader';
      s.sequence++;
      return { claimed: true, metadata: null };
    });
    if (!claim.claimed) {
      if (!claim.metadata) throw surferFailure('Metadata receipt unavailable.');
      return { metadata: claim.metadata, cached: true, mode: a.mode };
    }
    let metadata: SurferDeepSeekMetadata | undefined;
    try {
      const result = await this.vault.withCredential(scope, async (secret, m) => {
        if (
          m.projectId !== scope.projectId ||
          m.providerId !== scope.providerId ||
          m.credentialId !== scope.credentialId ||
          m.credentialRevision !== scope.credentialRevision ||
          m.lifecycleState !== 'active' ||
          createHash('sha256').update(secret).digest('hex') !== this.options.accountFingerprint
        )
          throw surferFailure('Pinned metadata credential unavailable.');
        const response = await this.fetch(SURFER_DEEPSEEK_BASELINE_POLICY.metadataEndpoint, {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: 'Bearer ' + Buffer.from(secret).toString('utf8'),
            Accept: 'application/json',
          },
        });
        if (!response.ok || !response.body) throw surferFailure('Model metadata HTTP unavailable.');
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.length;
            if (total > 65536) {
              await reader.cancel();
              throw surferFailure('Model metadata response too large.');
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        metadata = readSurferDeepSeekMetadata(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
          this.clock(),
        );
        return { status: 'SUCCEEDED' };
      });
      if (result.status !== 'SUCCEEDED' || !metadata)
        throw surferFailure('Metadata observation was not completed.');
      const observed = metadata;
      await this.journal.transaction(runId, (s) => {
        if (s.stage !== 'RUNNING' || s.specDigest !== meaning)
          throw surferFailure('Metadata fence changed.');
        s.stage = 'COMPLETED';
        s.evaluation = observed;
        s.sequence++;
      });
      return { metadata: observed, cached: false, mode: a.mode };
    } catch {
      await this.journal.transaction(runId, (s) => {
        if (s.stage === 'RUNNING') {
          s.stage = 'STOPPED';
          s.stopReason = 'METADATA_OUTCOME_UNAVAILABLE';
          s.sequence++;
        }
      });
      throw surferFailure(
        'Metadata inspection failed; inspect durable receipt before any new request.',
      );
    }
  }
}
