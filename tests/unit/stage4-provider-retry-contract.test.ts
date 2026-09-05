import { describe, expect, it } from 'vitest';

import { InMemoryAIProviderCallRepository } from '../../adapters/stage4-in-memory/src/index.js';
import type { AIProviderExecutionRecord } from '../../modules/ai-provider/src/index.js';

const record = (requestId: string, maxAttempts = 2): AIProviderExecutionRecord => ({
  callId: `call-${requestId}`,
  requestId,
  projectId: 'stage4-retry-contract',
  sourceVersionId: 'source-1',
  provider: 'fake',
  model: 'fake-model',
  promptVersion: 'direct-claim-v1',
  policyVersion: 'direct-only-v1',
  schemaName: 'ClaimCandidateBatch.v1',
  dataClassification: 'private',
  accessScope: ['owner'],
  sensitivity: 'private',
  inputEvidenceIds: ['evidence-1'],
  inputSnapshotDigest: `snapshot-${requestId}`,
  requestDigest: `request-${requestId}`,
  state: 'REQUESTED',
  status: 'failed',
  maxAttempts,
  attempts: [],
  createdAt: new Date().toISOString(),
});

describe('Stage 4 provider retry authorization', () => {
  it('does not reclaim a terminal failure when attempt budget remains', async () => {
    const repository = new InMemoryAIProviderCallRepository();
    const requestId = 'terminal-request';
    await repository.ensure(record(requestId));
    const first = await repository.claimNextAttempt('stage4-retry-contract', requestId);
    expect(first).toBeDefined();

    await repository.failAttempt(
      'stage4-retry-contract',
      requestId,
      first!.attempt.attemptId,
      'CONFIGURATION_REQUIRED',
    );

    expect(await repository.claimNextAttempt('stage4-retry-contract', requestId)).toBeUndefined();
    expect(
      (await repository.findByRequestId('stage4-retry-contract', requestId))?.attempts,
    ).toHaveLength(1);
  });

  it('preserves retryable failure reclaim semantics and request identity', async () => {
    const repository = new InMemoryAIProviderCallRepository();
    const requestId = 'retryable-request';
    await repository.ensure(record(requestId));
    const first = await repository.claimNextAttempt('stage4-retry-contract', requestId);
    expect(first).toBeDefined();

    await repository.failAttempt(
      'stage4-retry-contract',
      requestId,
      first!.attempt.attemptId,
      'TIMEOUT',
    );

    const second = await repository.claimNextAttempt('stage4-retry-contract', requestId);
    expect(second).toBeDefined();
    expect(second!.attempt.attemptNumber).toBe(2);
    expect(second!.record.requestId).toBe(requestId);
    expect(second!.record.callId).toBe(`call-${requestId}`);
  });

  it('does not reclaim a retryable failure after the durable attempt budget is exhausted', async () => {
    const repository = new InMemoryAIProviderCallRepository();
    const requestId = 'retryable-budget-exhausted';
    await repository.ensure(record(requestId, 1));
    const first = await repository.claimNextAttempt('stage4-retry-contract', requestId);
    expect(first).toBeDefined();

    await repository.failAttempt(
      'stage4-retry-contract',
      requestId,
      first!.attempt.attemptId,
      'TIMEOUT',
    );

    expect(await repository.claimNextAttempt('stage4-retry-contract', requestId)).toBeUndefined();
  });

  it('keeps outcome-unknown attempts non-recallable', async () => {
    const repository = new InMemoryAIProviderCallRepository();
    const requestId = 'outcome-unknown';
    await repository.ensure(record(requestId));
    const first = await repository.claimNextAttempt('stage4-retry-contract', requestId);
    expect(first).toBeDefined();

    await repository.markAttemptOutcomeUnknown(
      'stage4-retry-contract',
      requestId,
      first!.attempt.attemptId,
    );

    expect(await repository.claimNextAttempt('stage4-retry-contract', requestId)).toBeUndefined();
  });
});
