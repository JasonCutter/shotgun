// Adapted from lucasastorian/llmwiki at commit
// ad626a3d81be1480e35ef4e94234de8dbb27a61e (Apache-2.0).

export type TextQuote = {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
};

export type TextRange = {
  readonly start: number;
  readonly end: number;
};

export type LocateTextQuoteOptions = {
  readonly maxOccurrences?: number;
  readonly rejectAmbiguous?: boolean;
};

type NormalizedText = {
  readonly text: string;
  readonly sourceIndexes: readonly number[];
};

const normalizeWithIndexMap = (value: string): NormalizedText => {
  const output: string[] = [];
  const sourceIndexes: number[] = [];
  let inWhitespace = true;

  Array.from(value).forEach((character, index) => {
    if (character === '\u200b' || character === '\ufeff') {
      return;
    }
    if (/\s/u.test(character) || character === '\u00a0') {
      if (!inWhitespace && output.length > 0) {
        output.push(' ');
        sourceIndexes.push(index);
      }
      inWhitespace = true;
      return;
    }
    output.push(character);
    sourceIndexes.push(index);
    inWhitespace = false;
  });

  if (output.at(-1) === ' ') {
    output.pop();
    sourceIndexes.pop();
  }
  return { text: output.join(''), sourceIndexes };
};

export const normalizeAnchorText = (value: string): string => normalizeWithIndexMap(value).text;

const occurrencesOf = (
  source: readonly string[],
  exact: readonly string[],
  cap: number,
): readonly number[] => {
  const found: number[] = [];
  for (let start = 0; start <= source.length - exact.length && found.length < cap; start += 1) {
    if (exact.every((character, index) => source[start + index] === character)) {
      found.push(start);
    }
  }
  return found;
};

const contextScore = (
  source: readonly string[],
  start: number,
  length: number,
  quote: TextQuote,
  normalizeContext = true,
): number => {
  let score = 0;
  const prefix = quote.prefix
    ? Array.from(normalizeContext ? normalizeAnchorText(quote.prefix) : quote.prefix)
    : [];
  const suffix = quote.suffix
    ? Array.from(normalizeContext ? normalizeAnchorText(quote.suffix) : quote.suffix)
    : [];
  if (prefix.length > 0) {
    const before = source.slice(Math.max(0, start - Math.max(prefix.length, 32)), start).join('');
    const normalizedPrefix = prefix.join('');
    score += before.endsWith(normalizedPrefix) ? 4 : before.includes(normalizedPrefix) ? 1 : 0;
  }
  if (suffix.length > 0) {
    const after = source
      .slice(start + length, start + length + Math.max(suffix.length, 32))
      .join('');
    const normalizedSuffix = suffix.join('');
    score += after.startsWith(normalizedSuffix) ? 4 : after.includes(normalizedSuffix) ? 1 : 0;
  }
  return score;
};

const selectOccurrence = (
  source: readonly string[],
  needle: readonly string[],
  occurrences: readonly number[],
  quote: TextQuote,
  rejectAmbiguous: boolean,
  normalizeContext: boolean,
): number | undefined => {
  const ranked = occurrences
    .map((start) => ({
      start,
      score: contextScore(source, start, needle.length, quote, normalizeContext),
    }))
    .sort((left, right) => right.score - left.score || left.start - right.start);
  const best = ranked[0];
  if (!best) {
    return undefined;
  }
  if (occurrences.length > 1 && rejectAmbiguous) {
    const second = ranked[1];
    if (best.score === 0 || best.score === second?.score) {
      return undefined;
    }
  }
  return best.start;
};

export const locateTextQuote = (
  source: string,
  quote: TextQuote,
  options: LocateTextQuoteOptions = {},
): TextRange | undefined => {
  const cap = options.maxOccurrences ?? 500;
  const rejectAmbiguous = options.rejectAmbiguous ?? true;
  const sourceCharacters = Array.from(source);
  const exactCharacters = Array.from(quote.exact);
  if (exactCharacters.length === 0) {
    return undefined;
  }
  const exactOccurrences = occurrencesOf(sourceCharacters, exactCharacters, cap);
  if (exactOccurrences.length > 0) {
    const exactStart = selectOccurrence(
      sourceCharacters,
      exactCharacters,
      exactOccurrences,
      quote,
      rejectAmbiguous,
      false,
    );
    return exactStart === undefined
      ? undefined
      : { start: exactStart, end: exactStart + exactCharacters.length };
  }

  const needle = Array.from(normalizeAnchorText(quote.exact));
  if (needle.length === 0) {
    return undefined;
  }
  const normalized = normalizeWithIndexMap(source);
  const normalizedCharacters = Array.from(normalized.text);
  const occurrences = occurrencesOf(normalizedCharacters, needle, cap);
  if (occurrences.length === 0) {
    return undefined;
  }
  const normalizedStart = selectOccurrence(
    normalizedCharacters,
    needle,
    occurrences,
    quote,
    rejectAmbiguous,
    true,
  );
  if (normalizedStart === undefined) {
    return undefined;
  }
  const normalizedEnd = normalizedStart + needle.length;
  const start = normalized.sourceIndexes[normalizedStart];
  const last = normalized.sourceIndexes[normalizedEnd - 1];
  if (start === undefined || last === undefined) {
    return undefined;
  }
  return { start, end: last + 1 };
};
