import {
  jsonPointerEscape,
  sha256Text,
  stableJson,
  type DocumentIR,
  type SourceMap,
  type SourceMapEntry,
  type TextPositionSelector,
  type TextQuoteSelector,
  unicodeLength,
  unicodeSlice,
} from '../../../packages/contracts/src/index.js';
import type {
  PlainTextTransformerPort,
  DocumentTransformationInput,
  PlainTextTransformationOutput,
} from '../../../modules/transformation/src/index.js';
import type { EvidenceLocatorPort } from '../../../modules/evidence/src/index.js';
import { locateTextQuote } from '../../../packages/lucas-text-locator/src/index.js';

type Range = {
  readonly start: number;
  readonly end: number;
};

const CONTEXT_LENGTH = 32;
const sentenceTerminators = new Set(['.', '!', '?', '。', '！', '？']);

const paragraphRanges = (text: string): readonly Range[] => {
  const characters = Array.from(text);
  const ranges: Range[] = [];
  let lineStart = 0;
  let paragraphStart: number | undefined;
  let paragraphEnd = 0;

  while (lineStart <= characters.length) {
    let contentEnd = lineStart;
    while (
      contentEnd < characters.length &&
      characters[contentEnd] !== '\r' &&
      characters[contentEnd] !== '\n'
    ) {
      contentEnd += 1;
    }
    let nextLine = contentEnd;
    if (characters[nextLine] === '\r' && characters[nextLine + 1] === '\n') {
      nextLine += 2;
    } else if (characters[nextLine] === '\r' || characters[nextLine] === '\n') {
      nextLine += 1;
    }

    const line = characters.slice(lineStart, contentEnd).join('');
    if (line.trim().length === 0) {
      if (paragraphStart !== undefined) {
        ranges.push({ start: paragraphStart, end: paragraphEnd });
        paragraphStart = undefined;
      }
    } else {
      paragraphStart ??= lineStart;
      paragraphEnd = contentEnd;
    }

    if (nextLine >= characters.length) {
      break;
    }
    lineStart = nextLine;
  }

  if (paragraphStart !== undefined) {
    ranges.push({ start: paragraphStart, end: paragraphEnd });
  }
  return ranges;
};

const sentenceRanges = (text: string, offset: number): readonly Range[] => {
  const characters = Array.from(text);
  const ranges: Range[] = [];
  let start = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const next = characters[index + 1];
    if (!character || !sentenceTerminators.has(character)) {
      continue;
    }
    if (next !== undefined && !/\s/u.test(next)) {
      continue;
    }

    const end = index + 1;
    if (characters.slice(start, end).join('').trim().length > 0) {
      ranges.push({ start: offset + start, end: offset + end });
    }
    start = end;
    while (start < characters.length && /\s/u.test(characters[start] ?? '')) {
      start += 1;
    }
    index = start - 1;
  }

  if (characters.slice(start).join('').trim().length > 0) {
    ranges.push({ start: offset + start, end: offset + characters.length });
  }
  return ranges;
};

const selectorFor = (text: string, range: Range): TextPositionSelector => ({
  type: 'TextPositionSelector',
  start: range.start,
  end: range.end,
  unit: 'unicode-code-point',
});

const quoteFor = (text: string, range: Range): TextQuoteSelector => ({
  type: 'TextQuoteSelector',
  exact: unicodeSlice(text, range.start, range.end),
  ...(range.start > 0
    ? { prefix: unicodeSlice(text, Math.max(0, range.start - CONTEXT_LENGTH), range.start) }
    : {}),
  ...(range.end < unicodeLength(text)
    ? { suffix: unicodeSlice(text, range.end, range.end + CONTEXT_LENGTH) }
    : {}),
});

const mapEntry = (
  text: string,
  input: Pick<DocumentTransformationInput, 'sourceVersionId' | 'sourceContentHash'>,
  pointer: string,
  nodeKind: SourceMapEntry['nodeKind'],
  range: Range,
): SourceMapEntry => {
  const quote = quoteFor(text, range);
  return {
    pointer,
    nodeKind,
    sourceVersionId: input.sourceVersionId,
    sourceContentHash: input.sourceContentHash,
    origin: 'source',
    position: selectorFor(text, range),
    quote,
    exactHash: sha256Text(quote.exact),
  };
};

export class LucasAugmentedPlainTextAdapter
  implements PlainTextTransformerPort, EvidenceLocatorPort
{
  readonly identity = {
    id: 'shotgun.plain-text',
    version: '1.0.0',
  } as const;

  transform(input: DocumentTransformationInput): PlainTextTransformationOutput {
    if (input.text === undefined) {
      throw new Error('Text normalization requires extracted text.');
    }
    const text = input.text;
    const mediaType = input.mediaType;
    const blocks: DocumentIR['blocks'][number][] = [];
    const entries: SourceMapEntry[] = [
      mapEntry(text, input, '', 'document', {
        start: 0,
        end: unicodeLength(text),
      }),
    ];

    paragraphRanges(text).forEach((paragraph, blockIndex) => {
      const paragraphText = unicodeSlice(text, paragraph.start, paragraph.end);
      const sentences = sentenceRanges(paragraphText, paragraph.start).map(
        (sentence, sentenceIndex) => {
          const id = `sentence-${sentence.start}-${sentence.end}`;
          entries.push(
            mapEntry(
              text,
              input,
              `/blocks/${blockIndex}/sentences/${sentenceIndex}`,
              'sentence',
              sentence,
            ),
          );
          return {
            id,
            kind: 'sentence' as const,
            text: unicodeSlice(text, sentence.start, sentence.end),
          };
        },
      );
      const id = `paragraph-${paragraph.start}-${paragraph.end}`;
      blocks.push({
        id,
        kind: 'paragraph',
        text: paragraphText,
        sentences,
      });
      entries.push(
        mapEntry(
          text,
          input,
          `/blocks/${jsonPointerEscape(String(blockIndex))}`,
          'paragraph',
          paragraph,
        ),
      );
    });

    const documentIR: DocumentIR = {
      schemaVersion: '1.0.0',
      mediaType,
      blocks,
    };
    const sourceMap: SourceMap = {
      schemaVersion: '1.0.0',
      entries,
    };
    return {
      documentIR,
      sourceMap,
      documentHash: sha256Text(stableJson(documentIR)),
      sourceMapHash: sha256Text(stableJson(sourceMap)),
    };
  }

  locate(source: string, quote: TextQuoteSelector): TextPositionSelector | undefined {
    const located = locateTextQuote(source, quote);
    return located ? selectorFor(source, located) : undefined;
  }
}
