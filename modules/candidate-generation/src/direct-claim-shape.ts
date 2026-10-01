const collapseWhitespaceWithOffsets = (value: string) => {
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;

  while (index < value.length) {
    const codePoint = String.fromCodePoint(value.codePointAt(index)!);
    const end = index + codePoint.length;
    if (/\s/u.test(codePoint)) {
      let whitespaceEnd = end;
      while (whitespaceEnd < value.length) {
        const next = String.fromCodePoint(value.codePointAt(whitespaceEnd)!);
        if (!/\s/u.test(next)) break;
        whitespaceEnd += next.length;
      }
      if (normalized.length > 0) {
        normalized += ' ';
        starts.push(index);
        ends.push(whitespaceEnd);
      }
      index = whitespaceEnd;
      continue;
    }

    normalized += codePoint;
    for (let offset = 0; offset < codePoint.length; offset += 1) {
      starts.push(index);
      ends.push(end);
    }
    index = end;
  }

  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { normalized, starts, ends };
};

/**
 * Rebinds whitespace-only model formatting changes to a unique exact source
 * span. It never invents or normalizes claim characters in the returned text.
 */
export const alignDirectClaimToEvidence = (
  evidenceText: string,
  modelClaimText: string,
): string | undefined => {
  const candidate = collapseWhitespaceWithOffsets(modelClaimText.trim());
  if (!candidate.normalized) return undefined;
  if (evidenceText.includes(modelClaimText.trim())) return modelClaimText.trim();

  const evidence = collapseWhitespaceWithOffsets(evidenceText);
  const matchIndex = evidence.normalized.indexOf(candidate.normalized);
  if (matchIndex < 0 || evidence.normalized.indexOf(candidate.normalized, matchIndex + 1) >= 0) {
    return undefined;
  }

  const sourceStart = evidence.starts[matchIndex];
  const sourceEnd = evidence.ends[matchIndex + candidate.normalized.length - 1];
  if (sourceStart === undefined || sourceEnd === undefined) return undefined;
  return evidenceText.slice(sourceStart, sourceEnd);
};

const stripOuterPunctuation = (value: string) =>
  value
    .trim()
    .replace(/^[\s"'“”‘’([{]+/gu, '')
    .replace(/[\s"'“”‘’.,!?;:。！？)\]}]+$/gu, '')
    .trim();

/**
 * Drops only unmistakable noun/value/symbol fragments from direct-claim v7.
 * Complete equations and Korean predicate forms remain eligible.
 */
export const isClearlyIncompleteDirectClaimFragment = (claimText: string): boolean => {
  const text = stripOuterPunctuation(claimText);
  if (!text) return true;

  if (/^(?:[\p{L}\p{N}_]+\s+)*[\p{L}\p{N}_]+$/u.test(text)) {
    const tokens = text.split(/\s+/u);
    if (tokens.length > 1 && tokens.every((token) => /^[a-z]$/iu.test(token))) return true;
    if (tokens.length === 1) {
      const token = tokens[0]!;
      if (/^\d+(?:[.,]\d+)*(?:%|％|원|배|개|명|년|월|일)?$/u.test(token)) return true;
      if (!/[가-힣]/u.test(token)) return true;
      if (!/(?:다|임|음|함|됨|있다|없다|아니다)$/u.test(token)) return true;
    }
  }

  return false;
};
