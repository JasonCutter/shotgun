import { describe, expect, it } from 'vitest';

import {
  alignDirectClaimToEvidence,
  findCompleteSourceStatement,
  isClearlyIncompleteDirectClaimFragment,
  splitAtCompletePhysicalLines,
} from '../../modules/candidate-generation/src/direct-claim-shape.js';

describe('direct claim source alignment', () => {
  it('restores the exact unique source span when only whitespace changed', () => {
    const source = 'NPV = 1,150 − 1,000 = 150만원\r\n따라서 NPV가 양수다.';

    expect(
      alignDirectClaimToEvidence(source, 'NPV = 1,150 − 1,000 = 150만원 따라서 NPV가 양수다.'),
    ).toBe(source);
  });

  it('restores PDF line wraps inserted inside Korean words without changing source text', () => {
    const source = '현금은 아직 들어오지 않\n았을 수 있다 .';

    expect(alignDirectClaimToEvidence(source, '현금은 아직 들어오지 않았을 수 있다 .')).toBe(
      source,
    );
  });

  it('refuses a soft-wrap match when it would select multiple source spans', () => {
    expect(alignDirectClaimToEvidence('한글\n문장 한글\n문장', '한글문장')).toBe(undefined);
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
  it.each([
    '토지',
    '건물',
    '기계장치',
    '100만원',
    'i f m f i',
    'β',
    '라고 연결하면 된다 .',
    '이 되게 하는 수익률이 IRR 이다 .',
  ])('drops the incomplete fragment %s', (candidate) => {
    expect(isClearlyIncompleteDirectClaimFragment(candidate)).toBe(true);
  });

  it.each([
    '수익률은 증가한다.',
    'NPV > 0이면 투자로 기업가치가 증가한다.',
    'FV = PV(1 + r)^n',
    'PV가 미래에 받을 돈을 현재 시점의 가치로 바꾼 것이다.',
    '이 식을 만족하는 r은 10% 이므로 IRR 은 10% 다 .',
  ])('keeps a proposition or complete equation: %s', (candidate) => {
    expect(isClearlyIncompleteDirectClaimFragment(candidate)).toBe(false);
  });
});

describe('source statement boundaries', () => {
  it('keeps an example lead-in joined across a continuation line', () => {
    const source =
      '예를 들어 β = 1.5라면 시장수익률이 1% 움직일 때 해당 자산수익률이 평균적으로 약 1.5%\n움직이는 경향이 있다는 의미다 .';

    expect(findCompleteSourceStatement(source, '움직이는 경향이 있다는 의미다 .')).toBe(source);
    expect(splitAtCompletePhysicalLines(source)).toEqual([source]);
  });

  it('keeps complete physical lines as boundaries', () => {
    expect(
      findCompleteSourceStatement(
        '첫 문장은 사실이다.\n둘째 문장도 사실이다.',
        '둘째 문장도 사실이다.',
      ),
    ).toBe('둘째 문장도 사실이다.');
  });
});
