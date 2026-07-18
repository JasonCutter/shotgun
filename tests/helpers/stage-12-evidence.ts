import type { EvidenceLocatorPort } from '../../modules/evidence/src/index.js';
import {
  sha256Text,
  stableJson,
  type DocumentIR,
  type SecurityContext,
  type SourceMap,
  type TransformationRevision,
  unicodeLength,
} from '../../packages/contracts/src/index.js';

export const unicodeOffsetOf = (text: string, exact: string): number => {
  if (!exact) throw new Error('Evidence exact text must not be empty.');
  const index = text.indexOf(exact);
  if (index < 0) throw new Error(`Evidence exact text '${exact}' was not found in the source.`);
  return unicodeLength(text.slice(0, index));
};

export const deterministicEvidenceLocator: EvidenceLocatorPort = {
  locate(source, quote) {
    const start = unicodeOffsetOf(source, quote.exact);
    return {
      type: 'TextPositionSelector',
      start,
      end: start + unicodeLength(quote.exact),
      unit: 'unicode-code-point',
    };
  },
};

export type SentenceEvidenceFixture = {
  readonly sourceText: string;
  readonly evidenceExactText: string;
  readonly evidenceStart: number;
  readonly evidenceEnd: number;
  readonly sourceContentHash: string;
  readonly evidenceExactHash: string;
  readonly documentHash: string;
  readonly sourceMapHash: string;
  readonly revision: TransformationRevision;
};

export const createSentenceEvidenceFixture = (input: {
  readonly revisionId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceText: string;
  readonly evidenceExactText: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
}): SentenceEvidenceFixture => {
  const evidenceStart = unicodeOffsetOf(input.sourceText, input.evidenceExactText);
  const evidenceEnd = evidenceStart + unicodeLength(input.evidenceExactText);
  const sourceContentHash = sha256Text(input.sourceText);
  const evidenceExactHash = sha256Text(input.evidenceExactText);
  const documentIR: DocumentIR = {
    schemaVersion: '1.0.0',
    mediaType: 'text/plain',
    blocks: [
      {
        id: 'block:0',
        kind: 'paragraph',
        text: input.sourceText,
        sentences: [
          {
            id: 'sentence:0',
            kind: 'sentence',
            text: input.evidenceExactText,
          },
        ],
      },
    ],
  };
  const sourceMap: SourceMap = {
    schemaVersion: '1.0.0',
    entries: [
      {
        pointer: '',
        nodeKind: 'document',
        sourceVersionId: input.sourceVersionId,
        sourceContentHash,
        origin: 'source',
        position: {
          type: 'TextPositionSelector',
          start: 0,
          end: unicodeLength(input.sourceText),
          unit: 'unicode-code-point',
        },
        quote: { type: 'TextQuoteSelector', exact: input.sourceText },
        selectors: [],
        exactHash: sourceContentHash,
      },
      {
        pointer: '/blocks/0/sentences/0',
        nodeKind: 'sentence',
        sourceVersionId: input.sourceVersionId,
        sourceContentHash,
        origin: 'source',
        position: {
          type: 'TextPositionSelector',
          start: evidenceStart,
          end: evidenceEnd,
          unit: 'unicode-code-point',
        },
        quote: { type: 'TextQuoteSelector', exact: input.evidenceExactText },
        selectors: [],
        exactHash: evidenceExactHash,
      },
    ],
  };
  const documentHash = sha256Text(stableJson(documentIR));
  const sourceMapHash = sha256Text(stableJson(sourceMap));
  return {
    sourceText: input.sourceText,
    evidenceExactText: input.evidenceExactText,
    evidenceStart,
    evidenceEnd,
    sourceContentHash,
    evidenceExactHash,
    documentHash,
    sourceMapHash,
    revision: {
      revisionId: input.revisionId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      sourceVersionId: input.sourceVersionId,
      sourceContentHash,
      transformer: { id: 'security-test', version: '1.0.0' },
      documentIR,
      sourceMap,
      documentHash,
      sourceMapHash,
      accessScope: input.accessScope,
      sensitivity: input.sensitivity,
      createdAt: input.createdAt,
    },
  };
};
