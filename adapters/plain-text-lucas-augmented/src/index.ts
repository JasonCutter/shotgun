import {
  jsonPointerEscape,
  sha256Text,
  stableJson,
  type DocumentIR,
  type SourceMap,
  type SourceMapEntry,
  type SourceSelector,
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

type ParagraphRange = Range & {
  readonly headingContext?: string;
};

const CONTEXT_LENGTH = 32;
const sentenceTerminators = new Set(['.', '!', '?', '。', '！', '？']);

const paragraphRanges = (
  text: string,
  mediaType: DocumentTransformationInput['mediaType'],
): readonly ParagraphRange[] => {
  const characters = Array.from(text);
  const ranges: ParagraphRange[] = [];
  const headings: { readonly level: number; readonly text: string }[] = [];
  let lineStart = 0;
  let paragraphStart: number | undefined;
  let paragraphEnd = 0;
  let paragraphHeadingContext: string | undefined;

  const currentHeadingContext = () =>
    headings.length ? headings.map(({ text: heading }) => heading).join(' > ') : undefined;
  const flushParagraph = () => {
    if (paragraphStart !== undefined) {
      ranges.push({
        start: paragraphStart,
        end: paragraphEnd,
        ...(paragraphHeadingContext ? { headingContext: paragraphHeadingContext } : {}),
      });
      paragraphStart = undefined;
      paragraphEnd = 0;
      paragraphHeadingContext = undefined;
    }
  };

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
      flushParagraph();
    } else if (mediaType === 'text/markdown' && /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/u.test(line)) {
      flushParagraph();
      const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/u.exec(line);
      if (heading) {
        const parentContext = currentHeadingContext();
        ranges.push({
          start: lineStart,
          end: contentEnd,
          ...(parentContext ? { headingContext: parentContext } : {}),
        });
        const level = heading[1]!.length;
        const headingText = heading[2]!.replace(/[ \t]+#+[ \t]*$/u, '').trim();
        headings.splice(0, headings.length, ...headings.filter((item) => item.level < level));
        if (headingText) headings.push({ level, text: headingText });
      }
    } else {
      if (paragraphStart === undefined) {
        paragraphStart = lineStart;
        paragraphHeadingContext = currentHeadingContext();
      }
      paragraphEnd = contentEnd;
    }

    if (nextLine >= characters.length) {
      break;
    }
    lineStart = nextLine;
  }

  flushParagraph();
  return ranges;
};

const markdownOrdinalMarker = /^(?:#{1,6}\s*)?\d+[.)]$/u;

const isCompleteNominalDirectionalLine = (value: string, followingLine: string): boolean => {
  if (
    /^(?:으로|로|에|에서|의|은|는|이|가|을|를|와|과|도|까지|부터|만|조차|처럼|보다)\s*/u.test(
      followingLine.trim(),
    )
  ) {
    return false;
  }
  return /(?:가|이|은|는|도).*(?:커지는|높아지는|낮아지는|늘어나는|줄어드는|증가하는|감소하는|상승하는|하락하는|변하는|큰|작은|높은|낮은)\s*방향$/u.test(
    value.trim(),
  );
};

const sentenceRanges = (
  text: string,
  offset: number,
  mediaType: DocumentTransformationInput['mediaType'],
): readonly Range[] => {
  const characters = Array.from(text);
  const ranges: Range[] = [];
  let start = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const next = characters[index + 1];
    if (character === '\n' || character === '\r') {
      const lineStart =
        Math.max(characters.lastIndexOf('\n', index - 1), characters.lastIndexOf('\r', index - 1)) +
        1;
      const line = characters.slice(lineStart, index).join('');
      const priorText = characters.slice(start, lineStart).join('');
      const nextLineStart = index + (character === '\r' && next === '\n' ? 2 : 1);
      const followingLine =
        characters
          .slice(nextLineStart)
          .join('')
          .split(/[\r\n]/u, 1)[0] ?? '';
      if (!priorText.trim() && isCompleteNominalDirectionalLine(line, followingLine)) {
        ranges.push({ start: offset + start, end: offset + index });
        start = index + 1;
        if (character === '\r' && next === '\n') {
          start += 1;
          index += 1;
        }
        while (start < characters.length && /\s/u.test(characters[start] ?? '')) {
          start += 1;
        }
        index = start - 1;
      }
      continue;
    }
    if (!character || !sentenceTerminators.has(character)) {
      continue;
    }
    if (next !== undefined && !/\s/u.test(next)) {
      continue;
    }

    const end = index + 1;
    if (mediaType === 'text/markdown') {
      const lineStart =
        Math.max(characters.lastIndexOf('\n', index - 1), characters.lastIndexOf('\r', index - 1)) +
        1;
      const linePrefix = characters.slice(lineStart, end).join('').trim();
      if (markdownOrdinalMarker.test(linePrefix)) {
        continue;
      }
    }
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
  selectors: readonly SourceSelector[] = [],
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
    ...(selectors.length ? { selectors } : {}),
    exactHash: sha256Text(quote.exact),
  };
};

export class LucasAugmentedPlainTextAdapter
  implements PlainTextTransformerPort, EvidenceLocatorPort
{
  readonly identity = {
    id: 'shotgun.plain-text',
    version: '1.0.3',
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

    paragraphRanges(text, mediaType).forEach((paragraph, blockIndex) => {
      const paragraphText = unicodeSlice(text, paragraph.start, paragraph.end);
      const selectors: readonly SourceSelector[] = paragraph.headingContext
        ? [{ type: 'MarkdownHeadingContext', value: paragraph.headingContext }]
        : [];
      const sentences = sentenceRanges(paragraphText, paragraph.start, mediaType).map(
        (sentence, sentenceIndex) => {
          const id = `sentence-${sentence.start}-${sentence.end}`;
          entries.push(
            mapEntry(
              text,
              input,
              `/blocks/${blockIndex}/sentences/${sentenceIndex}`,
              'sentence',
              sentence,
              selectors,
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
          selectors,
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
