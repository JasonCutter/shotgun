import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import type {
  StructuredGenerationRequest,
  StructuredGenerationResponse,
} from '../../modules/ai-provider/src/index.js';
import { buildEvidenceCandidates } from '../../modules/evidence/src/index.js';
import {
  sha256Text,
  type TransformationRevision,
  unicodeSlice,
} from '../../packages/contracts/src/index.js';
import { candidatesQuery, createStage4Harness, intakeResultQuery } from '../helpers/stage-4.js';
import { fileCommand } from '../helpers/stage-2.js';

const adapter = new LucasAugmentedPlainTextAdapter();
const productionAdapter = new PythonDocumentFormatAdapter();

const transformed = (text: string, mediaType: 'text/plain' | 'text/markdown') =>
  adapter.transform({
    sourceId: '11111111-1111-4111-8111-111111111111',
    sourceVersionId: '22222222-2222-4222-8222-222222222222',
    sourceContentHash: sha256Text(text),
    mediaType,
    text,
  });

const revisionFor = (text: string): TransformationRevision => {
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const output = adapter.transform({
    sourceId,
    sourceVersionId,
    sourceContentHash: sha256Text(text),
    mediaType: 'text/markdown',
    text,
  });
  return {
    revisionId: randomUUID(),
    projectId: 'project-a',
    sourceId,
    sourceVersionId,
    sourceContentHash: sha256Text(text),
    transformer: adapter.identity,
    ...output,
    accessScope: ['owner'],
    sensitivity: 'private',
    createdAt: '2026-09-08T00:00:00.000Z',
  };
};

describe('Issue #237 Markdown segmentation', () => {
  it('publishes the governed transformer identity for the corrected behavior', () => {
    expect(adapter.identity).toEqual({ id: 'shotgun.plain-text', version: '1.0.1' });
  });

  it('keeps Markdown ordinal prefixes attached to the meaningful sentence', () => {
    const output = transformed('1. 태양광으로 전기를 생산한다.', 'text/markdown');

    expect(output.documentIR.blocks[0]?.sentences.map((sentence) => sentence.text)).toEqual([
      '1. 태양광으로 전기를 생산한다.',
    ]);
  });

  it('keeps heading ordinal prefixes attached to the heading text', () => {
    const output = transformed('# 1. Tesla Energy란 무엇인가', 'text/markdown');

    expect(output.documentIR.blocks[0]?.sentences.map((sentence) => sentence.text)).toEqual([
      '# 1. Tesla Energy란 무엇인가',
    ]);
  });

  it('preserves normal prose boundaries for Markdown and text/plain behavior', () => {
    expect(
      transformed(
        '첫 문장이다. 둘째 문장이다.',
        'text/markdown',
      ).documentIR.blocks[0]?.sentences.map((sentence) => sentence.text),
    ).toEqual(['첫 문장이다.', '둘째 문장이다.']);
    expect(
      transformed(
        '1. 태양광으로 전기를 생산한다.',
        'text/plain',
      ).documentIR.blocks[0]?.sentences.map((sentence) => sentence.text),
    ).toEqual(['1.', '태양광으로 전기를 생산한다.']);
  });

  it('publishes the production transformer identity and delegates corrected Markdown behavior', async () => {
    expect(productionAdapter.identity).toEqual({
      id: 'shotgun.document-formats',
      version: '1.0.1',
    });

    const text = ['---', '', '## 1. Heading', '', '1. Meaningful sentence.'].join('\n');
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const output = await productionAdapter.transform({
      sourceId,
      sourceVersionId,
      sourceContentHash: sha256Text(text),
      mediaType: 'text/markdown',
      text,
    });
    const sentenceTexts = output.documentIR.blocks.flatMap((block) =>
      block.sentences.map((sentence) => sentence.text),
    );
    expect(output.documentIR.mediaType).toBe('text/markdown');
    expect(sentenceTexts).not.toContain('## 1.');
    expect(sentenceTexts).not.toContain('1.');
    expect(sentenceTexts).toContain('## 1. Heading');
    expect(sentenceTexts).toContain('1. Meaningful sentence.');

    const revision: TransformationRevision = {
      revisionId: randomUUID(),
      projectId: 'project-a',
      sourceId,
      sourceVersionId,
      sourceContentHash: sha256Text(text),
      transformer: productionAdapter.identity,
      ...output,
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: '2026-09-08T00:00:00.000Z',
    };
    const evidence = buildEvidenceCandidates(revision, adapter);
    const exactTexts = evidence.map((item) => item.quote.exact);
    expect(exactTexts).not.toContain('---');
    expect(exactTexts).not.toContain('## 1.');
    expect(exactTexts).not.toContain('1.');
    expect(exactTexts).toContain('## 1. Heading');
    expect(exactTexts).toContain('1. Meaningful sentence.');
  });

  it('preserves text/plain sentence behavior through the production adapter', async () => {
    const text = '1. Meaningful sentence.';
    const output = await productionAdapter.transform({
      sourceId: randomUUID(),
      sourceVersionId: randomUUID(),
      sourceContentHash: sha256Text(text),
      mediaType: 'text/plain',
      text,
    });

    expect(output.documentIR.blocks[0]?.sentences.map((sentence) => sentence.text)).toEqual([
      '1.',
      'Meaningful sentence.',
    ]);
  });
});

describe('Issue #237 Markdown Evidence eligibility', () => {
  it('excludes structural-only Markdown spans while preserving exact meaningful spans and root', () => {
    const text = [
      '# Tesla Energy',
      '',
      '---',
      '',
      '1.',
      '',
      '2)',
      '',
      '#',
      '',
      '##',
      '',
      '-',
      '',
      '*',
      '',
      '+',
      '',
      '___',
      '',
      '***',
      '',
      '# 1.',
      '',
      '태양광으로 전기를 생산한다. 배터리가 저장한다.',
    ].join('\n');
    const revision = revisionFor(text);
    const evidence = buildEvidenceCandidates(revision, adapter);
    const exactTexts = evidence.map((item) => item.quote.exact);

    expect(exactTexts).toContain(text);
    expect(exactTexts).toContain('# Tesla Energy');
    expect(exactTexts).toContain('태양광으로 전기를 생산한다.');
    expect(exactTexts).toContain('배터리가 저장한다.');
    expect(exactTexts).toContain('태양광으로 전기를 생산한다. 배터리가 저장한다.');
    for (const structural of ['---', '1.', '2)', '#', '##', '-', '*', '+', '___', '***', '# 1.']) {
      expect(exactTexts).not.toContain(structural);
    }
    for (const item of evidence) {
      expect(unicodeSlice(text, item.position.start, item.position.end)).toBe(item.quote.exact);
      expect(item.exactHash).toBe(sha256Text(item.quote.exact));
    }
  });
});

class RecordingFakeAIProvider extends FakeAIProviderAdapter {
  readonly prompts: string[] = [];

  override async generateStructured(
    request: StructuredGenerationRequest,
  ): Promise<StructuredGenerationResponse> {
    this.prompts.push(request.prompt);
    return super.generateStructured(request);
  }
}

describe('Issue #237 Stage 3 to Stage 4 path', () => {
  it('sends meaningful Markdown sentence Evidence to candidate generation without structural tokens', async () => {
    const provider = new RecordingFakeAIProvider();
    const { kernel } = await createStage4Harness({ aiProvider: provider });
    const text = [
      '# Tesla Energy',
      '',
      '---',
      '',
      '1. 태양광으로 전기를 생산한다.',
      '',
      '일반 문장입니다. 두 번째 문장입니다.',
    ].join('\n');
    const command = fileCommand(
      'issue-237-stage4',
      'issue-237-fixture.md',
      'text/markdown',
      new TextEncoder().encode(text),
    );

    await kernel.connector.sendCommand(command);

    const intake = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const candidates = (
      await kernel.connector.query<{ items: readonly { claimText: string }[] }>(
        candidatesQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items;
    const prompt = JSON.parse(provider.prompts[0] ?? '{}') as {
      readonly evidence?: readonly { readonly text: string }[];
    };
    const inputTexts = (prompt.evidence ?? []).map((item) => item.text);

    expect(provider.prompts).toHaveLength(1);
    expect(inputTexts).toContain('1. 태양광으로 전기를 생산한다.');
    expect(inputTexts).toContain('일반 문장입니다.');
    expect(inputTexts).toContain('두 번째 문장입니다.');
    expect(inputTexts).not.toContain('---');
    expect(inputTexts).not.toContain('# 1.');
    expect(candidates.map((candidate) => candidate.claimText)).not.toContain('---');
  });
});
