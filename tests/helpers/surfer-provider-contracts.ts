import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cognitiveFixture } from './surfer-cognitive-fixture.js';
import { executionPolicy } from './surfer-execution-contracts.js';
import {
  SurferExecutionLedger,
  SurferProviderInterpreter,
} from '../../modules/surfer-execution/src/index.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import {
  SurferProviderNotSentError,
  type SurferProviderProfile,
  type SurferProviderGatewayPort,
  type SurferObservedProviderResponse,
} from '../../packages/contracts/src/surfer-provider.js';
import type { SurferExecutionStorePort } from '../../packages/contracts/src/surfer-execution.js';
import type { SurferCognitiveSourcePort } from '../../packages/contracts/src/surfer-cognition.js';

export function providerFixture(store: SurferExecutionStorePort) {
  const f = cognitiveFixture(),
    spaceId = f.basis.authority.projectId;
  const profile: SurferProviderProfile = {
    schemaVersion: '1.0.0',
    revision: 'fixture-provider-v1',
    mode: 'ISOLATED_CONTRACT',
    identity: {
      providerId: 'deepseek',
      modelId: 'fixture-only-model',
      aiConfigurationRevision: 1,
      credentialId: 'fixture-credential',
      credentialRevision: 1,
      policyContextRevision: 'fixture-policy',
      providerPolicyFingerprint: 'fixture-policy-fingerprint',
    },
    accountFingerprint: 'a'.repeat(64),
    authorityRef: 'fixture-account-authority',
    egressPolicyRevision: 'fixture-egress',
    pricingRevision: 'fixture-pricing-NOT_ACTUAL',
    currency: 'USD',
    inputMicrosPerMillion: 1000000,
    outputMicrosPerMillion: 1000000,
    inputBoundRevision: 'fixture-bound-NOT_ACTUAL_TOKENIZER',
    promptRevision: 'surfer-minimum-semantics-v1',
    allowedResponseModels: ['fixture-only-model'],
    maxInputBytes: 65536,
    maximum: {
      calls: 1,
      inputTokens: 10000,
      outputTokens: 1000,
      moneyMicros: 20000,
      elapsedMs: 1000,
    },
  };
  const policy = executionPolicy({
    executionIdentity: surferDigest(profile.identity),
    modelRevision: 'deepseek/fixture-only-model',
    egressPolicyRevision: profile.egressPolicyRevision,
    pricingRevision: profile.pricingRevision,
    allowedSpaceIds: [spaceId],
    limits: {
      calls: 10,
      inputTokens: 100000,
      outputTokens: 10000,
      moneyMicros: 200000,
      elapsedMs: 100000,
    },
    backgroundLimits: {
      calls: 5,
      inputTokens: 50000,
      outputTokens: 5000,
      moneyMicros: 100000,
      elapsedMs: 50000,
    },
  });
  const ledger = new SurferExecutionLedger(store, policy);
  const control = {
    allowSource: true,
    prepared: 0,
    sends: 0,
    settles: 0,
    discarded: 0,
    failSettleOnce: false,
    generateError: false,
    notSent: false,
    onPrepare: () => {},
    onGenerate: () => {},
  };
  const response: SurferObservedProviderResponse = {
    rawText: JSON.stringify({ fields: f.frame.fields }),
    modelVersion: profile.identity.modelId,
    providerResponseId: 'fixture-response',
    inputTokens: 4,
    outputTokens: 3,
  };
  const source: SurferCognitiveSourcePort = {
    observe: f.source.observe,
    withCurrent: async (request, basis, selections, apply) => {
      if (!control.allowSource) throw new Error('Source revoked');
      return f.source.withCurrent(request, basis, selections, apply);
    },
  };
  const gateway: SurferProviderGatewayPort = {
    prepare: async (binding) => {
      control.prepared++;
      control.onPrepare();
      return {
        inputTokensUpperBound: 100,
        inputBoundRevision: profile.inputBoundRevision,
        discard: () => {
          control.discarded++;
        },
        generate: async () => {
          if (control.notSent) throw new SurferProviderNotSentError();
          control.sends++;
          control.onGenerate();
          if (control.generateError) throw new Error('fixture uncertain send');
          return {
            response: structuredClone(response),
            receipt: {
              workloadClass: 'SURFER_COGNITION',
              mode: profile.mode,
              receiptId: 'fixture-receipt',
              authorityRef: profile.authorityRef,
              bindingDigest: surferDigest(binding),
            },
          };
        },
      };
    },
    reconcile: async () => {
      control.settles++;
      if (control.failSettleOnce) {
        control.failSettleOnce = false;
        throw new Error('fixture lost account settlement');
      }
    },
  };
  const task = {
    schemaVersion: '1.0.0' as const,
    operationId: randomUUID(),
    runId: 'fixture-run',
    stepId: 'interpret',
    attempt: 1,
    priority: 'FOREGROUND' as const,
    basis: f.basis,
    selections: [f.selection],
  };
  const interpreter = () =>
    new SurferProviderInterpreter(
      source,
      new SurferExecutionLedger(store, policy),
      gateway,
      profile,
    );
  return {
    ...f,
    store,
    source,
    profile,
    policy,
    ledger,
    control,
    response,
    gateway,
    task,
    interpreter,
  };
}

export function surferProviderContracts(label: string, make: () => SurferExecutionStorePort) {
  describe(label, () => {
    it('binds a generated candidate to actual anchors and server-owned execution metadata', async () => {
      const f = providerFixture(make()),
        out = await f.interpreter().interpret('allow', f.task);
      expect(out.status).toBe('CANDIDATE_NOT_SEMANTICALLY_VALIDATED');
      expect(out.frame!.producer.executionRef).toBe(out.reservationId);
      expect(out.frame!.producer.modelRevision).toBe('deepseek/fixture-only-model');
      expect(f.control.sends).toBe(1);
      const r = await f.ledger.read(out.reservationId!, f.basis.authority.projectId);
      expect(r.usage).toMatchObject({ calls: 1, inputTokens: 4, outputTokens: 3, moneyMicros: 7 });
      expect(r.state).toBe('SETTLED');
    });
    it('replays a durable result after a new owner instance without resolving or sending again', async () => {
      const f = providerFixture(make()),
        a = await f.interpreter().interpret('allow', f.task),
        b = await f.interpreter().interpret('allow', f.task);
      expect(b.frame).toEqual(a.frame);
      expect(b.replayed).toBe(true);
      expect(f.control.prepared).toBe(1);
      expect(f.control.sends).toBe(1);
    });
    it('fences concurrent owner instances to one send', async () => {
      const f = providerFixture(make());
      await Promise.all([
        f.interpreter().interpret('allow', f.task),
        f.interpreter().interpret('allow', f.task),
      ]);
      expect(f.control.sends).toBe(1);
    });
    it('cancels before prepare without account/provider use', async () => {
      const f = providerFixture(make()),
        c = new AbortController();
      c.abort();
      expect((await f.interpreter().interpret('allow', f.task, c.signal)).status).toBe('NOT_SENT');
      expect(f.control.prepared).toBe(0);
      expect((await f.ledger.snapshot()).accounted.calls).toBe(0);
    });
    it('runs Source hard guards before reservation or provider work', async () => {
      const f = providerFixture(make());
      expect((await f.interpreter().interpret('deny', f.task)).status).toBe('SOURCE_UNAVAILABLE');
      expect((await f.ledger.snapshot()).state.records).toHaveLength(0);
      expect(f.control.sends).toBe(0);
    });
    it('rechecks Source after preparation and releases only an unsent local reservation', async () => {
      const f = providerFixture(make());
      f.control.onPrepare = () => {
        f.control.allowSource = false;
      };
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('BLOCKED');
      expect(f.control.sends).toBe(0);
      expect((await f.ledger.snapshot()).state.records[0]!.state).toBe('CANCELLED_BEFORE_DISPATCH');
    });
    it('withholds a returned candidate after Source access changes while preserving incurred usage', async () => {
      const f = providerFixture(make());
      f.control.onGenerate = () => {
        f.control.allowSource = false;
      };
      const out = await f.interpreter().interpret('allow', f.task);
      expect(out.status).toBe('SOURCE_UNAVAILABLE');
      expect(out.frame).toBeNull();
      expect((await f.ledger.snapshot()).accounted.calls).toBe(1);
    });
    it('keeps uncertain sends reserved and never auto-retries them', async () => {
      const f = providerFixture(make());
      f.control.generateError = true;
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('OUTCOME_UNKNOWN');
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('OUTCOME_UNKNOWN');
      expect(f.control.sends).toBe(1);
      expect((await f.ledger.snapshot()).state.records[0]!.state).toBe('OUTCOME_UNKNOWN');
      expect((await f.ledger.snapshot()).accounted.calls).toBe(1);
    });
    it('preserves invalid raw output and actual usage without certifying a frame', async () => {
      const f = providerFixture(make());
      f.response.rawText = '{bad';
      const out = await f.interpreter().interpret('allow', f.task);
      expect(out.status).toBe('INVALID_OUTPUT');
      expect(out.frame).toBeNull();
      const r = (await f.ledger.snapshot()).state.records[0]!;
      expect(r.state).toBe('FAILED_KNOWN');
      expect(JSON.stringify(r.checkpoint)).toContain('{bad');
      expect(r.usage!.calls).toBe(1);
    });
    it('retains observed output with missing usage and holds the maximum instead of inventing zero cost', async () => {
      const f = providerFixture(make());
      f.response.inputTokens = null;
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('USAGE_UNKNOWN');
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('USAGE_UNKNOWN');
      expect(f.control.sends).toBe(1);
      expect((await f.ledger.snapshot()).accounted.inputTokens).toBe(f.profile.maximum.inputTokens);
    });
    it('recovers a durable response after account settlement acknowledgement loss without another send', async () => {
      const f = providerFixture(make());
      f.control.failSettleOnce = true;
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('OUTCOME_UNKNOWN');
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe(
        'CANDIDATE_NOT_SEMANTICALLY_VALIDATED',
      );
      expect(f.control.sends).toBe(1);
      expect(f.control.settles).toBe(2);
    });
    it('records actual overage and blocks later dispatch instead of clipping usage', async () => {
      const f = providerFixture(make());
      f.response.inputTokens = f.profile.maximum.inputTokens + 1;
      await f.interpreter().interpret('allow', f.task);
      expect((await f.ledger.snapshot()).accounted.inputTokens).toBe(
        f.profile.maximum.inputTokens + 1,
      );
      await expect(
        f.interpreter().interpret('allow', { ...f.task, operationId: randomUUID() }),
      ).rejects.toThrow('exceeded');
      expect(f.control.sends).toBe(1);
    });
    it('rejects a response model outside the frozen identity profile', async () => {
      const f = providerFixture(make());
      f.response.modelVersion = 'other-model';
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('INVALID_OUTPUT');
    });
    it('settles an authenticated no-send cancellation at zero without an unknown refund', async () => {
      const f = providerFixture(make());
      f.control.notSent = true;
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('NOT_SENT');
      expect((await f.ledger.snapshot()).accounted.calls).toBe(0);
      expect(f.control.sends).toBe(0);
    });
    it('rejects injected model producer/authority output even with valid fields', async () => {
      const f = providerFixture(make());
      f.response.rawText = JSON.stringify({
        fields: f.frame.fields,
        producer: { executionRef: 'forged' },
      });
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('INVALID_OUTPUT');
    });
    it('recovers an observed response after checkpoint COMMIT acknowledgement loss', async () => {
      const base = make();
      let lost = false;
      const wrapped: SurferExecutionStorePort = {
        transaction: async (id, apply) => {
          const value = await base.transaction(id, apply);
          if (
            !lost &&
            value &&
            typeof value === 'object' &&
            'checkpointSequence' in value &&
            value.checkpointSequence === 1
          ) {
            lost = true;
            throw new Error('lost checkpoint COMMIT ack');
          }
          return value;
        },
      };
      const f = providerFixture(wrapped);
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe('OUTCOME_UNKNOWN');
      expect((await f.interpreter().interpret('allow', f.task)).status).toBe(
        'CANDIDATE_NOT_SEMANTICALLY_VALIDATED',
      );
      expect(f.control.sends).toBe(1);
    });
  });
}
