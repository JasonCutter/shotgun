import { describe, expect, it } from 'vitest';

import {
  alignDirectClaimToEvidence,
  isClearlyIncompleteDirectClaimFragment,
} from '../../modules/candidate-generation/src/direct-claim-shape.js';

describe('direct claim source alignment', () => {
  it('restores the exact unique source span when only whitespace changed', () => {
    const source = 'NPV = 1,150 − 1,000 = 150만원\r\n따라서 NPV가 양수다.';

    expect(
      alignDirectClaimToEvidence(source, 'NPV = 1,150 − 1,000 = 150만원 따라서 NPV가 양수다.'),
    ).toBe(source);
  });

  it('leaves repeated or text-altered provider output unaligned', () => {
    expect(
      alignDirectClaimToEvidence(
        '현금흐름은  증가한다. 현금흐름은  증가한다.',
        '현금흐름은 증가한다.',
      ),
    ).toBe(undefined);
    expect(alignDirectClaimToEvidence('수익률은 10%다.', '수익률은 12%다.')).toBe(undefined);
  });
});

describe('direct claim shape guard', () => {
  it.each(['토지', '건물', '기계장치', '100만원', 'i f m f i', 'β'])(
    'drops the incomplete fragment %s',
    (candidate) => {
      expect(isClearlyIncompleteDirectClaimFragment(candidate)).toBe(true);
    },
  );

  it.each([
    '수익률은 증가한다.',
    'NPV > 0이면 투자로 기업가치가 증가한다.',
    'FV = PV(1 + r)^n',
    'PV가 미래에 받을 돈을 현재 시점의 가치로 바꾼 것이다.',
  ])('keeps a proposition or complete equation: %s', (candidate) => {
    expect(isClearlyIncompleteDirectClaimFragment(candidate)).toBe(false);
  });
});
