import { describe, expect, it } from 'vitest';

import { GeminiAIProviderAdapter } from '../../adapters/ai-provider-gemini/src/index.js';
import type { ClaimCandidate } from '../../packages/contracts/src/index.js';
import {
  candidatesQuery,
  createStage4Harness,
  directTextCommand,
  intakeResultQuery,
} from '../helpers/stage-4.js';

const apiKey = process.env.GEMINI_API_KEY;

describe.runIf(apiKey)('Gemini Stage 4 live contract', () => {
  it('uses the real adapter and returns an exact direct-evidence candidate', async () => {
    const { kernel } = await createStage4Harness({
      aiProvider: new GeminiAIProviderAdapter({ apiKey: apiKey! }),
      aiProviderPolicy: {
        allowPrivate: false,
        allowRestricted: false,
        maxAttempts: 2,
      },
    });
    const privateCommand = directTextCommand(
      'stage4-gemini-live',
      'The synthetic test dog weighs 5 kg.',
    );
    const command = {
      ...privateCommand,
      security: {
        ...privateCommand.security!,
        sensitivity: 'public' as const,
        dataClassification: 'synthetic-test',
      },
    };

    await kernel.connector.sendCommand(command);
    const intake = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(command))
    ).result.payload;
    const candidates = (
      await kernel.connector.query<{ items: readonly ClaimCandidate[] }>(
        candidatesQuery(command, intake.sourceVersionId),
      )
    ).result.payload.items;

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.status === 'READY')).toBe(true);
    expect(candidates[0]?.providerCall.provider).toBe('google-gemini');
    expect(candidates[0]?.providerCall.model).toBe('gemini-3.5-flash');
  }, 90_000);
});
