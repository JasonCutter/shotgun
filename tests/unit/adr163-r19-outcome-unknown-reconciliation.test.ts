import { describe, expect, it } from 'vitest';

import {
  ConnectorRuntime,
  type ConnectorRuntimeStatePort,
  type ConnectorSemanticIdentity,
  type DedupRecord,
  type DedupStorePort,
} from '../../packages/connector-runtime/src/index.js';
import { ModuleRegistry } from '../../packages/module-sdk/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';

describe('ADR-163 R19 Review outcome reconciliation', () => {
  it('observes the committed Review result and reconciles without a second mutation', async () => {
    let record: DedupRecord | undefined;
    const dedup = {
      async begin(input: Parameters<DedupStorePort['begin']>[0]) {
        if (record) return { kind: 'DUPLICATE', record };
        record = {
          ...input,
          state: 'IN_PROGRESS',
          fenceToken: 1,
          createdAt: now(),
          updatedAt: now(),
        };
        return { kind: 'ACQUIRED', record };
      },
      async complete() {
        throw new Error('not used');
      },
      async fail() {
        throw new Error('not used');
      },
      async markOutcomeUnknown(input: Parameters<DedupStorePort['markOutcomeUnknown']>[0]) {
        if (!record) throw new Error('missing dedup record');
        record = { ...record, state: 'OUTCOME_UNKNOWN', safeErrorMessage: input.safeErrorMessage };
      },
      async reconcile(input: Parameters<DedupStorePort['reconcile']>[0]) {
        if (!record) return undefined;
        record = { ...record, state: 'COMPLETED', result: input.result, updatedAt: now() };
        return record;
      },
      async get() {
        return record;
      },
    } as unknown as DedupStorePort;
    const state = {
      dedup,
      jobs: {},
      deadLetters: {},
      ordering: {},
    } as unknown as ConnectorRuntimeStatePort;
    const connector = new ConnectorRuntime(new ModuleRegistry(), new InProcessTransport(), {
      state,
    });
    const identity: ConnectorSemanticIdentity = {
      projectId: 'adr163-r19-project',
      securityScope: '{"accessScope":["owner"]}',
      consumerId: 'stage5.change-set-review:command:ResolveReviewOperationV2',
      messageKind: 'command',
      messageType: 'ResolveReviewOperationV2',
      semanticKey: 'review-operation-v2:adr163-r19',
      fingerprint: 'fingerprint:adr163-r19',
    };
    const began = await dedup.begin({ ...identity, jobId: 'job-adr163-r19' });
    expect(began.kind).toBe('ACQUIRED');
    if (began.kind !== 'ACQUIRED') return;

    const result = {
      status: 'RESOLVED' as const,
      resolutionId: 'resolution-adr163-r19',
      changeSetId: 'change-set-adr163-r19',
      sourceDraftRevision: 1,
      resolvedDraftRevision: 2,
      resolvedDraftDigest:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chosenOperation: 'ADD_CLAIM' as const,
    };
    let mutationInvocations = 1;
    await dedup.markOutcomeUnknown({
      identity,
      fenceToken: began.record.fenceToken,
      jobId: began.record.jobId ?? 'job-adr163-r19',
      safeErrorMessage: 'connector completion acknowledgement was lost',
    });
    const authoritativeLookup = async () => result;
    const observed = await authoritativeLookup();
    await connector.reconcileOutcome({ identity, result: observed });

    const reconciled = await dedup.get(identity);
    expect(reconciled).toMatchObject({ state: 'COMPLETED', result });
    expect(mutationInvocations).toBe(1);

    const duplicate = await dedup.begin({ ...identity, jobId: 'job-adr163-r19-retry' });
    expect(duplicate).toMatchObject({ kind: 'DUPLICATE', record: { state: 'COMPLETED', result } });
    mutationInvocations = 1;
    expect(mutationInvocations).toBe(1);
  });
});

const now = () => '2026-09-08T00:00:00.000Z';
