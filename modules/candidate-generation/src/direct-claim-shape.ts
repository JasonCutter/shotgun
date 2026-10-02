const collapseWhitespaceWithOffsets = (value: string, omitLineBreaks = false) => {
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;

  while (index < value.length) {
    const codePoint = String.fromCodePoint(value.codePointAt(index)!);
    const end = index + codePoint.length;
    if (omitLineBreaks && (codePoint === '\n' || codePoint === '\r')) {
      index = end;
      if (codePoint === '\r' && value[index] === '\n') index += 1;
      continue;
    }
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
 * span. PDF line wraps may split a word, so lookup also tries removing line
 * break characters while preserving every other source character. The result
 * is always the exact original source slice; it never invents claim text.
 */
export const alignDirectClaimToEvidence = (
  evidenceText: string,
  modelClaimText: string,
): string | undefined => {
  const candidate = collapseWhitespaceWithOffsets(modelClaimText.trim());
  if (!candidate.normalized) return undefined;
  if (evidenceText.includes(modelClaimText.trim())) return modelClaimText.trim();

  const matches = new Map<string, { readonly start: number; readonly end: number }>();
  for (const evidence of [
    collapseWhitespaceWithOffsets(evidenceText),
    collapseWhitespaceWithOffsets(evidenceText, true),
  ]) {
    let matchIndex = evidence.normalized.indexOf(candidate.normalized);
    while (matchIndex >= 0) {
      const sourceStart = evidence.starts[matchIndex];
      const sourceEnd = evidence.ends[matchIndex + candidate.normalized.length - 1];
      if (sourceStart !== undefined && sourceEnd !== undefined) {
        matches.set(`${sourceStart}:${sourceEnd}`, { start: sourceStart, end: sourceEnd });
      }
      matchIndex = evidence.normalized.indexOf(candidate.normalized, matchIndex + 1);
    }
  }
  if (matches.size !== 1) return undefined;
  const match = [...matches.values()][0]!;
  return evidenceText.slice(match.start, match.end);
};

const stripOuterPunctuation = (value: string) =>
  value
    .trim()
    .replace(/^[\s"'“”‘’([{]+/gu, '')
    .replace(/[\s"'“”‘’.,!?;:。！？)\]}]+$/gu, '')
    .trim();

/**
 * Returns whether a physical source line is a complete statement boundary.
 * Example lead-ins can contain an equals sign as prose (for example, "예를
 * 들어 β=1.5 ..."), so they must stay joined to the following explanation.
 */
export const physicalLineLooksComplete = (line: string): boolean => {
  const value = line.trim();
  if (!value || /[,，;:：=+*\x2f×÷^-]$/u.test(value)) return false;
  if (/[.!?。！？][\])}"'”’]*$/u.test(value)) return true;
  if (
    /(?:이다|입니다|있다|있습니다|없다|없습니다|한다|된다|않다|않습니다|있음|없음|다)$/u.test(value)
  ) {
    return true;
  }
  if (/[→⇒]\s*\S.+$/u.test(value)) return true;
  if (
    !/^(?:예를\s*들어|예컨대|예시|예:|for example\b|for instance\b)/iu.test(value) &&
    /^[^=\n]{1,80}=\s*[^=\n].+$/u.test(value)
  ) {
    return true;
  }
  return /^[^:：\n]{1,40}[:：]\s*\S.+$/u.test(value);
};

export const splitAtCompletePhysicalLines = (text: string): readonly string[] => {
  const pieces = text.split(/(\r?\n+)/u);
  const statements: string[] = [];
  let current = pieces[0] ?? '';
  for (let index = 1; index + 1 < pieces.length; index += 2) {
    const separator = pieces[index] ?? '';
    const next = pieces[index + 1] ?? '';
    if (physicalLineLooksComplete(current.split(/\r?\n/u).at(-1) ?? current)) {
      statements.push(current.trim());
      current = next;
    } else {
      current += `${separator}${next}`;
    }
  }
  statements.push(current.trim());
  return statements.filter(Boolean);
};

/**
 * Finds the complete source statement that contains an exact candidate span.
 * Newlines split statements only when the preceding physical line is complete.
 */
export const findCompleteSourceStatement = (
  sourceText: string,
  exactFragment: string,
): string | undefined => {
  const fragmentStart = sourceText.indexOf(exactFragment);
  if (fragmentStart < 0) return undefined;
  const fragmentEnd = fragmentStart + exactFragment.length;
  const boundaries = [...sourceText.matchAll(/[.!?。！？](?=\s|$|[\p{L}])|\r?\n/gu)];
  let statementStart = 0;
  let physicalLineStart = 0;

  for (const boundary of boundaries) {
    const boundaryStart = boundary.index ?? 0;
    const boundaryEnd = boundaryStart + boundary[0].length;
    const isNewline = /^\r?\n$/u.test(boundary[0]);
    const isStatementBoundary =
      !isNewline || physicalLineLooksComplete(sourceText.slice(physicalLineStart, boundaryStart));

    if (isNewline) physicalLineStart = boundaryEnd;
    if (!isStatementBoundary) continue;

    if (boundaryEnd <= fragmentStart) {
      statementStart = boundaryEnd;
      continue;
    }
    if (boundaryStart >= fragmentEnd || boundaryEnd === fragmentEnd) {
      return sourceText.slice(statementStart, boundaryEnd).trim();
    }
    // A model span crossing complete statement boundaries is kept intact for validation.
    return undefined;
  }

  return sourceText.slice(statementStart).trim();
};

/**
 * Drops only unmistakable noun/value/symbol fragments from direct-claim v7.
 * Complete equations and Korean predicate forms remain eligible.
 */
export const isClearlyIncompleteDirectClaimFragment = (claimText: string): boolean => {
  const text = stripOuterPunctuation(claimText);
  if (!text) return true;

  if (/^(?:라고|이라고)(?:\s|$)/u.test(text)) return true;
  if (/^이\s+되게\s+하는(?:\s|$)/u.test(text)) return true;

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
