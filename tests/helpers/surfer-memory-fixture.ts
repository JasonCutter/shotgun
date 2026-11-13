import { readFileSync } from 'node:fs';
import { cognitiveFixture } from './surfer-cognitive-fixture.js';
import { providerFixture } from './surfer-provider-contracts.js';
import { InMemorySurferExecutionStore } from '../../adapters/surfer-execution-in-memory/src/index.js';
import { SurferDirectiveExtractionCodecV3 } from '../../adapters/surfer-structure-extraction/src/directive-v3.js';
import { surferStructureMentionCatalog } from '../../adapters/surfer-structure-extraction/src/index.js';
import type {
  SurferDirectiveWire,
  SurferActionMode,
} from '../../packages/contracts/src/surfer-directive.js';
import type { SurferMemoryQuestion } from '../../packages/contracts/src/surfer-directive-memory.js';
type Case = {
  id: string;
  text: string;
  entity: string;
  operation: string;
  mode: SurferActionMode;
  condition?: { quote: string; number?: string; comparison?: 'gte' | 'lt'; value?: boolean }[];
  join?: 'ALL' | 'ANY';
  exception?: string;
  from?: string;
  to?: string;
};
export const memoryData = JSON.parse(
  readFileSync(
    new URL('../fixtures/surfer-directive-v3-fresh-evaluation-v1.json', import.meta.url),
    'utf8',
  ),
) as { cases: Case[] };
export function memoryFixture(item = memoryData.cases[0]!) {
  const f = cognitiveFixture(item.text, item.text, null),
    p = providerFixture(new InMemorySurferExecutionStore()),
    codec = new SurferDirectiveExtractionCodecV3(),
    catalog = surferStructureMentionCatalog(f.view),
    alias = (s: string) => catalog.find((m) => m.rawLiteral === s)!.alias,
    subject = alias(item.entity);
  p.profile.promptRevision = codec.revision;
  const wire: SurferDirectiveWire = {
    interpretation: {
      state: 'RESOLVED',
      action: { subject, quote: item.text, operationQuote: item.operation, mode: item.mode },
      conditions: item.condition
        ? {
            join: item.join ?? 'ALL',
            terms: item.condition.map((c) =>
              c.number
                ? {
                    type: 'NUMBER',
                    subject,
                    quote: c.quote,
                    mention: alias(c.number),
                    comparison: c.comparison!,
                  }
                : {
                    type: 'BOOLEAN',
                    subject,
                    quote: c.quote,
                    truth: c.value === false ? 'FALSE' : 'TRUE',
                  },
            ),
          }
        : null,
      direction: item.condition ? 'IF' : 'UNCONDITIONAL',
      quantifier: null,
      exception: item.exception
        ? { when: { subject, quote: item.exception, truth: 'TRUE' } }
        : null,
      subjectScope: [subject],
      time: item.from
        ? { from: alias(item.from), to: alias(item.to!), fromInclusive: true, toInclusive: true }
        : null,
      documentRole: 'NORMATIVE',
    },
  };
  const response = {
    rawText: JSON.stringify(wire),
    modelVersion: 'deepseek-flash',
    providerResponseId: 'AUTHORED_CONTRACT_NOT_MODEL',
    inputTokens: 1,
    outputTokens: 1,
  };
  const packet = codec.decode(response, f.view, 'AUTHORED_CONTRACT', p.profile)!;
  const question: SurferMemoryQuestion = {
    schemaVersion: '1.0.0',
    snapshotId: null,
    kind: 'APPLY',
    subject: item.entity,
    operation: item.operation,
    observations: [],
    atDate: null,
  };
  return { ...f, p, codec, wire, response, packet, item, question };
}
