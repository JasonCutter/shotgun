import { describe, expect, it } from 'vitest';

import {
  locateTextQuote,
  normalizeAnchorText,
} from '../../packages/lucas-text-locator/src/index.js';

describe('@shotgun/lucas-text-locator', () => {
  it('maps collapsed whitespace back to Unicode code-point offsets', () => {
    expect(locateTextQuote('alpha\n  beta 🐶', { exact: 'alpha beta 🐶' })).toEqual({
      start: 0,
      end: 14,
    });
  });

  it('preserves the full exact range including trailing line breaks', () => {
    const source = 'CodeFlow description\r\n\r\n';
    expect(locateTextQuote(source, { exact: source })).toEqual({
      start: 0,
      end: Array.from(source).length,
    });
  });

  it('uses prefix and suffix to disambiguate repeated text', () => {
    const source = 'alpha common omega. beta common delta.';
    expect(locateTextQuote(source, { exact: 'common' })).toBeUndefined();
    expect(
      locateTextQuote(source, {
        exact: 'common',
        prefix: 'beta ',
        suffix: ' delta',
      }),
    ).toEqual({ start: 25, end: 31 });
  });

  it('normalizes non-breaking and zero-width characters without guessing missing text', () => {
    expect(normalizeAnchorText(' alpha\u00a0\u200bbeta ')).toBe('alpha beta');
    expect(locateTextQuote('alpha beta', { exact: 'not present' })).toBeUndefined();
  });
});
