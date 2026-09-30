import { randomUUID } from 'node:crypto';

import { createChildEvent, createCommand } from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';

import {
  FakeAIProviderAdapter,
  type FakeAIProviderStep,
} from '../../adapters/ai-provider-fake/src/index.js';
import { InMemoryEvidenceRepository } from '../../adapters/stage3-in-memory/src/index.js';
import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { ClaimCandidate, ValidationResult } from '../../packages/contracts/src/index.js';
import type {
  AIProviderAdapterPort,
  StructuredGenerationRequest,
} from '../../modules/ai-provider/src/index.js';
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

class MismatchedEvidenceRepository extends InMemoryEvidenceRepository {
  override async findManyByIds(
    projectId: string,
    sourceVersionId: string,
    revisionId: string,
    evidenceIds: readonly string[],
  ) {
    const items = await super.findManyByIds(projectId, sourceVersionId, revisionId, evidenceIds);
    return items.map((item) => ({ ...item, revisionId: randomUUID() }));
  }

  override async findById(projectId: string, evidenceId: string) {
    const item = await super.findById(projectId, evidenceId);
    return item ? { ...item, revisionId: randomUUID() } : undefined;
  }
}

const reextractCommand = (
  parent: ReturnType<typeof directTextCommand>,
  sourceVersionId: string,
  revisionId: string,
  requestId: string,
  idempotencyKey: string,
) =>
  createCommand({
    messageType: 'ReextractCandidateMaterialization',
    schemaVersion: '1.1.0',
    producerModule: 'stage4-contract-test',
    producerVersion: '1.0.0',
    idempotencyKey,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    payload: { sourceVersionId, revisionId, requestId },
  });

const resumeCommand = (
  parent: ReturnType<typeof directTextCommand>,
  sourceVersionId: string,
  requestId: string,
) =>
  createCommand({
    messageType: 'ResumeCandidateMaterialization',
    schemaVersion: '1.0.0',
    producerModule: 'stage4-contract-test',
    producerVersion: '1.0.0',
    idempotencyKey: `resume:${parent.projectId}:${sourceVersionId}`,
    projectId: parent.projectId!,
    actor: parent.actor!,
    security: parent.security!,
    payload: { sourceVersionId, requestId },
  });

describe.each(transports)('%s Stage 4 contract', (_name, createTransport) => {
  it('pins the numerical-example prompt and validates an exact stated equation', async () => {
    const fake = new FakeAIProviderAdapter([{ claimText: '1억원 = 6천만원 + 4천만원' }]);
    let request: StructuredGenerationRequest | undefined;
    const provider: AIProviderAdapterPort = {
      identity: fake.identity,
      generateStructured(input) {
        request = input;
        return fake.generateStructured(input);
      },
    };
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
    });
    const command = directTextCommand('stage4-number-example', '1억원 = 6천만원 + 4천만원.');
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;
    expect(request?.systemInstruction).toContain('Extract every distinct explicit claim');
    expect(request?.systemInstruction).toContain('one atomic claim per candidate');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      claimText: '1억원 = 6천만원 + 4천만원',
      status: 'READY',
      providerCall: { promptVersion: 'direct-claim-v5' },
    });
  });

  it('rejects a directly quoted claim with an undecodable replacement character', async () => {
    const damagedClaim = 'NPV � 0 → investment value increases';
    const expectedClaim = `${damagedClaim} when the net present value is positive.`;
    const fake = new FakeAIProviderAdapter([{ claimText: damagedClaim }]);
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: fake,
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand(
      'stage4-undecodable-npv-sign',
      `${damagedClaim} when the net present value is positive.`,
    );
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ claimText: expectedClaim, status: 'REJECTED' });
    const validation = (
      await kernel.connector.query<ValidationResult>(
        validationQuery(command, candidates[0]!.candidateId),
      )
    ).result.payload;
    expect(validation.dimensions.find((dimension) => dimension.name === 'direct-text')).toEqual(
      expect.objectContaining({
        status: 'FAIL',
        reason: 'Claim text contains an undecodable replacement character.',
      }),
    );
  });

  it('uses a durable 16K response cap for DeepSeek claim extraction', async () => {
    const fake = new FakeAIProviderAdapter([{ claimText: '1억원 = 6천만원 + 4천만원' }]);
    let request: StructuredGenerationRequest | undefined;
    const provider: AIProviderAdapterPort = {
      identity: { ...fake.identity, provider: 'deepseek' },
      generateStructured(input) {
        request = input;
        return fake.generateStructured(input);
      },
    };
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand(
      'stage4-deepseek-output-cap-v5',
      '1억원 = 6천만원 + 4천만원.',
    );
    await kernel.connector.sendCommand(command);

    expect(request?.maxOutputTokens).toBe(16_384);
  });

  it('keeps a qualified sentence intact when direct-claim-v3 returns only a fragment', async () => {
    const sourceSentence = 'The demo archive contained exactly 44 records on 2025-01-01.';
    const fake = new FakeAIProviderAdapter([{ claimText: 'exactly 44 records' }]);
    let request: StructuredGenerationRequest | undefined;
    const provider: AIProviderAdapterPort = {
      identity: fake.identity,
      generateStructured(input) {
        request = input;
        return fake.generateStructured(input);
      },
    };
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
      candidatePromptVersion: 'direct-claim-v3',
    });
    const command = directTextCommand('stage4-qualified-v3', sourceSentence);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(request?.systemInstruction).toContain('entire matching source sentence');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      claimText: sourceSentence,
      status: 'READY',
      providerCall: { promptVersion: 'direct-claim-v3' },
    });
  });

  it('keeps compact atomic claims when direct-claim-v4 retains all equation qualifiers', async () => {
    const sourceText =
      'Balance-sheet equation: 1억원 = 6천만원 + 4천만원. Operating profit is 400만원.';
    const equation = '1억원 = 6천만원 + 4천만원';
    const fake = new FakeAIProviderAdapter([{ claimText: equation }]);
    let request: StructuredGenerationRequest | undefined;
    const provider: AIProviderAdapterPort = {
      identity: fake.identity,
      generateStructured(input) {
        request = input;
        return fake.generateStructured(input);
      },
    };
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
      candidatePromptVersion: 'direct-claim-v4',
    });
    const command = directTextCommand('stage4-atomic-v4', sourceText);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(request?.systemInstruction).toContain('one atomic claim per candidate');
    expect(request?.systemInstruction).toContain('Do not copy an entire paragraph');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      claimText: equation,
      status: 'READY',
      providerCall: { promptVersion: 'direct-claim-v4' },
    });
  });

  it('restores omitted numeric and date qualifiers from the containing sentence in v5', async () => {
    const sourceSentence = 'The demo archive contained exactly 44 records on 2025-01-01.';
    const fake = new FakeAIProviderAdapter([{ claimText: 'exactly 44 records' }]);
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: fake,
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand('stage4-qualifier-v4', sourceSentence);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      claimText: sourceSentence,
      status: 'READY',
      providerCall: { promptVersion: 'direct-claim-v5' },
    });
  });

  it('splits independent claims joined inside one v5 Evidence span', async () => {
    const firstClaim = '1억원 = 6천만원 + 4천만원';
    const secondClaim = '재무상태표는 일정 기간의 흐름이 아니라 그날 현재의 상태를 보여준다';
    const sourceText = `${firstClaim} ${secondClaim}.`;
    const fake = new FakeAIProviderAdapter([{ claimText: sourceText }]);
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: fake,
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand('stage4-split-v5-evidence', sourceText);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates.map((candidate) => candidate.claimText)).toEqual([
      firstClaim,
      `${secondClaim}.`,
    ]);
    expect(candidates.every((candidate) => candidate.status === 'READY')).toBe(true);
    expect(candidates.every((candidate) => candidate.evidenceIds.length === 1)).toBe(true);
  });

  it('drops a Markdown heading without splitting a product version from its claim', async () => {
    const expectedClaim = 'Shotgun v1.2 출시일은 2026-08-01이다.';
    const sourceText = `# Release\n${expectedClaim}`;
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand('stage4-markdown-heading-v5', sourceText);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates.map((candidate) => candidate.claimText)).toEqual([expectedClaim]);
    expect(candidates[0]?.status).toBe('READY');
  });

  it('restores qualifiers from the matching local v5 statement without absorbing its neighbor', async () => {
    const equation = '1억원 = 6천만원 + 4천만원';
    const neighboringClaim = '재무상태표는 일정 기간의 흐름이 아니라 그날 현재의 상태를 보여준다';
    const sourceText = `${equation} ${neighboringClaim}.`;
    const fake = new FakeAIProviderAdapter([{ claimText: '4천만원' }]);
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: fake,
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand('stage4-local-qualifier-v5', sourceText);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates.map((candidate) => candidate.claimText)).toEqual([equation]);
    expect(candidates[0]?.claimText).not.toContain('재무상태표');
  });

  it('splits worked-example results from converter-merged follow-up explanations', async () => {
    const example =
      '예를 들어, 매출액 2,000만원, 매출원가 1,100만원, 판매비와관리비 500만원이면 영업이익은 400만원이다.';
    const explanation = '영업이익은본업에서벌어들인성과를보는중요한지표다.';
    const sourceText = `${example}${explanation}`;
    const fake = new FakeAIProviderAdapter([{ claimText: sourceText }]);
    const { kernel } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: fake,
      candidatePromptVersion: 'direct-claim-v5',
    });
    const command = directTextCommand('stage4-example-follow-up-v5', sourceText);
    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates.map((candidate) => candidate.claimText)).toEqual([example, explanation]);
  });

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
        promptVersion: 'direct-claim-v5',
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

  it('stops candidate materialization when full Evidence revalidation mismatches the pinned revision', async () => {
    const { kernel, candidateRepository } = await createStage4Harness({
      transport: createTransport(),
      evidenceRepository: new MismatchedEvidenceRepository(),
    });
    const command = directTextCommand(
      'stage4-full-evidence-revision-mismatch',
      'Milo weighs 5 kg.',
    );

    await kernel.connector.sendCommand(command);

    expect(kernel.connector.deadLetters.list()).toContainEqual(
      expect.objectContaining({
        consumerId: 'stage4.candidate-generation',
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', retryable: false }),
      }),
    );
    expect(candidateRepository.counts()).toEqual({ batches: 0, candidates: 0 });
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

  it('creates additive re-extraction epochs while preserving Resume recovery semantics', async () => {
    const provider = new FakeAIProviderAdapter();
    const { kernel, candidateRepository } = await createStage4Harness({
      transport: createTransport(),
      aiProvider: provider,
    });
    const command = directTextCommand('stage4-reextract', 'Milo weighs 5 kg.');

    await kernel.connector.sendCommand(command);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload.sourceVersionId;
    const historical = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;
    const historicalCandidateId = historical[0]!.candidateId;
    const historicalBatchId = historical[0]!.batchId;
    const activeRevisionId = candidateRepository.revisionForSourceVersion(
      command.projectId!,
      sourceVersionId,
    );
    expect(activeRevisionId).toBeTruthy();
    const historicalRequestId = `${command.projectId}:${sourceVersionId}:${activeRevisionId}:candidate-extraction:direct-claim-v2:direct-only-v1`;

    await kernel.connector.sendCommand(
      reextractCommand(command, sourceVersionId, activeRevisionId!, 'R2', 'reextract-command-r2'),
    );
    const afterR2 = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, sourceVersionId),
      )
    ).result.payload.items;
    const r2Candidates = afterR2.filter((item) => item.batchId !== historicalBatchId);

    expect(provider.calls()).toBe(2);
    expect(r2Candidates).toHaveLength(1);
    expect(r2Candidates[0]!.candidateId).not.toBe(historicalCandidateId);
    expect(r2Candidates[0]!.revisionNumber).toBe(1);
    expect(r2Candidates[0]!.status).toBe('READY');
    expect(candidateRepository.counts()).toEqual({ batches: 2, candidates: 2 });
    expect(
      kernel.connector.traces
        .list()
        .filter(
          (record) => record.messageType === 'CandidateGenerated' && record.status === 'published',
        ),
    ).toHaveLength(2);

    await kernel.connector.sendCommand(
      reextractCommand(
        command,
        sourceVersionId,
        activeRevisionId!,
        'R2',
        'reextract-command-r2-replay',
      ),
    );
    expect(provider.calls()).toBe(2);
    expect(candidateRepository.counts()).toEqual({ batches: 2, candidates: 2 });

    await kernel.connector.sendCommand(
      reextractCommand(command, sourceVersionId, activeRevisionId!, 'R3', 'reextract-command-r3'),
    );
    expect(provider.calls()).toBe(3);
    expect(candidateRepository.counts()).toEqual({ batches: 3, candidates: 3 });

    await kernel.connector.sendCommand(
      resumeCommand(command, sourceVersionId, historicalRequestId),
    );
    expect(provider.calls()).toBe(3);
    expect(candidateRepository.counts()).toEqual({ batches: 3, candidates: 3 });

    await expect(
      kernel.connector.sendCommand({
        ...reextractCommand(
          command,
          sourceVersionId,
          activeRevisionId!,
          'R4',
          'reextract-command-r4-denied',
        ),
        actor: undefined,
        security: undefined,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(provider.calls()).toBe(3);
    expect(candidateRepository.counts()).toEqual({ batches: 3, candidates: 3 });
  });
});
