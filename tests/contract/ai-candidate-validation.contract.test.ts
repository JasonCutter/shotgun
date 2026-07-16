import { randomUUID } from 'node:crypto';

import { createChildEvent } from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';

import {
  FakeAIProviderAdapter,
  type FakeAIProviderStep,
} from '../../adapters/ai-provider-fake/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { ClaimCandidate, ValidationResult } from '../../packages/contracts/src/index.js';
import {
  candidatesQuery,
  createStage4Harness,
  directTextCommand,
  intakeResultQuery,
  validationQuery,
} from '../helpers/stage-4.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

describe.each(transports)('%s Stage 4 contract', (_name, createTransport) => {
  it('creates only evidence-backed READY candidates with provider provenance', async () => {
    const { kernel } = await createStage4Harness({ transport: createTransport() });
    const command = directTextCommand(
      'stage4-direct',
      'Milo weighs 5 kg. Milo is seven years old.',
    );

    await kernel.connector.sendCommand(command);
    const intake = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.status === 'READY')).toBe(true);
    expect(candidates[0]).toMatchObject({
      revisionNumber: 1,
      evidenceMode: 'DIRECT_EVIDENCE',
      extractionProfile: 'direct-only',
      providerCall: {
        provider: 'fake',
        promptVersion: 'direct-claim-v1',
        policyVersion: 'direct-only-v1',
        structuredOutputValid: true,
        cost: { status: 'unavailable' },
      },
    });
    const validation = (
      await kernel.connector.query<ValidationResult>(
        validationQuery(command, candidates[0]!.candidateId),
      )
    ).result.payload;
    expect(validation.status).toBe('READY');
    expect(validation.dimensions).toContainEqual({
      name: 'semantic',
      status: 'NOT_RUN',
      reason: 'Semantic inference validation is disabled in the direct-only MVP profile.',
    });
  });

  it('rejects unsupported inference instead of making it READY', async () => {
    const provider = new FakeAIProviderAdapter([{ claimText: 'Milo is healthy.' }]);
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
    });
    const command = directTextCommand('stage4-inference', 'Milo weighs 5 kg.');

    await kernel.connector.sendCommand(command);
    const intake = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const candidate = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items[0]!;
    const validation = (
      await kernel.connector.query<ValidationResult>(
        validationQuery(command, candidate.candidateId),
      )
    ).result.payload;

    expect(candidate.status).toBe('REJECTED');
    expect(validation.status).toBe('REJECTED');
    expect(validation.dimensions).toContainEqual({
      name: 'direct-text',
      status: 'FAIL',
      reason: 'Claim text is not an exact contiguous substring of the evidence.',
    });
  });

  it('records a schema failure and retries structured output', async () => {
    const steps: readonly FakeAIProviderStep[] = [{ rawText: '{"candidates":[{"bad":true}]}' }];
    const provider = new FakeAIProviderAdapter(steps);
    const { kernel, aiProviderRepository } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
    });
    const command = directTextCommand('stage4-retry', 'Milo weighs 5 kg.');

    await kernel.connector.sendCommand(command);
    const record = aiProviderRepository.list()[0]!;

    expect(provider.calls()).toBe(2);
    expect(record.status).toBe('succeeded');
    expect(record.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
    expect(record.attempts[0]?.errorCode).toBe('VALIDATION_ERROR');
  });

  it('maps retryable provider failures without losing attempt provenance', async () => {
    const provider = new FakeAIProviderAdapter([{ errorCode: 'RATE_LIMITED' }]);
    const { kernel, aiProviderRepository } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
    });
    const command = directTextCommand('stage4-provider-retry', 'Milo weighs 5 kg.');

    await kernel.connector.sendCommand(command);
    const record = aiProviderRepository.list()[0]!;

    expect(record.attempts.map((attempt) => attempt.errorCode)).toEqual([
      'RATE_LIMITED',
      undefined,
    ]);
    expect(record.status).toBe('succeeded');
  });

  it('blocks private evidence when the selected provider data policy is not approved', async () => {
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProviderPolicy: {
        allowPrivate: false,
        allowRestricted: false,
        maxAttempts: 2,
      },
    });
    const command = directTextCommand('stage4-private-policy', 'Private personal fact.');

    await kernel.connector.sendCommand(command);

    expect(kernel.connector.deadLetters.list()).toContainEqual(
      expect.objectContaining({
        consumerId: 'stage4.candidate-generation',
        error: expect.objectContaining({ code: 'POLICY_DENIED' }),
      }),
    );
  });

  it('reuses the persisted batch when EvidenceIndexed is replayed', async () => {
    const provider = new FakeAIProviderAdapter();
    const { kernel, candidateRepository, validationRepository } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
    });
    const command = directTextCommand('stage4-idempotent', 'Milo weighs 5 kg.');
    await kernel.connector.sendCommand(command);
    const intake = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;

    await kernel.connector.publishEvent(
      createChildEvent(command, {
        messageType: 'EvidenceIndexed',
        schemaVersion: '1.0.0',
        producerModule: 'stage4-contract-test',
        producerVersion: '1.0.0',
        idempotencyKey: `manual-stage4-replay:${intake.sourceVersionId}`,
        payload: {
          revisionId: randomUUID(),
          sourceVersionId: intake.sourceVersionId,
          evidenceCount: 1,
          reusedCount: 1,
        },
      }),
    );

    expect(provider.calls()).toBe(1);
    expect(candidateRepository.counts()).toEqual({ batches: 1, candidates: 1 });
    expect(validationRepository.count()).toBe(1);
  });
});
