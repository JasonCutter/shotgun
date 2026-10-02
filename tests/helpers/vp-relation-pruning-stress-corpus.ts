import { sha256Text, stableJson } from '../../packages/contracts/src/document-evidence.js';

type ExactRelation = 'EQUIVALENT' | 'QUALIFIES' | 'CONTRADICTS' | 'RELATED';

type RelationCase = {
  readonly caseId: string;
  readonly left: string;
  readonly right: string;
  readonly allowedChoices: readonly (ExactRelation | 'UNRESOLVED')[];
  readonly allowedDirections?: readonly ('LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT')[];
  readonly dimension: string;
  readonly rationale: string;
};

const variants = [
  {
    n: 12,
    amount: 12,
    years: 2,
    year: 2019,
    time: 5,
    city: '서울',
    facilityEn: 'library',
    facilityKo: '도서관',
    artifact: 'audit',
    service: 'upload',
    record: 'archive',
  },
  {
    n: 18,
    amount: 18,
    years: 3,
    year: 2020,
    time: 6,
    city: '부산',
    facilityEn: 'warehouse',
    facilityKo: '창고',
    artifact: 'invoice',
    service: 'search',
    record: 'source',
  },
  {
    n: 24,
    amount: 24,
    years: 4,
    year: 2021,
    time: 7,
    city: '대전',
    facilityEn: 'museum',
    facilityKo: '박물관',
    artifact: 'transaction',
    service: 'export',
    record: 'customer',
  },
  {
    n: 31,
    amount: 31,
    years: 5,
    year: 2022,
    time: 8,
    city: '인천',
    facilityEn: 'archive room',
    facilityKo: '자료실',
    artifact: 'shipment',
    service: 'session',
    record: 'contract',
  },
  {
    n: 42,
    amount: 42,
    years: 6,
    year: 2023,
    time: 9,
    city: '광주',
    facilityEn: 'research lab',
    facilityKo: '연구소',
    artifact: 'payment',
    service: 'worker',
    record: 'project',
  },
  {
    n: 57,
    amount: 57,
    years: 7,
    year: 2024,
    time: 4,
    city: '대구',
    facilityEn: 'factory',
    facilityKo: '공장',
    artifact: 'source',
    service: 'model',
    record: 'payment',
  },
  {
    n: 63,
    amount: 63,
    years: 8,
    year: 2025,
    time: 10,
    city: '울산',
    facilityEn: 'showroom',
    facilityKo: '전시장',
    artifact: 'asset',
    service: 'cache',
    record: 'audit',
  },
  {
    n: 79,
    amount: 79,
    years: 9,
    year: 2026,
    time: 11,
    city: '세종',
    facilityEn: 'records office',
    facilityKo: '기록관',
    artifact: 'job',
    service: 'API',
    record: 'transaction',
  },
] as const;

const relationCases: RelationCase[] = variants.flatMap((variant, index) => {
  const suffix = String(index + 1).padStart(2, '0');
  const nextValue = variant.n + 1;
  const nextAmount = variant.amount + 1;
  const leftNpv = `NPV가 0보다 크면 투자로 기업가치가 ${variant.n}% 증가한다.`;
  const rightNpv = `NPV가 0보다 작으면 투자로 기업가치가 ${variant.n}% 감소한다.`;
  const cases: RelationCase[] = [
    {
      caseId: `en-count-equivalent-${suffix}`,
      left: `The ${variant.artifact} archive contains exactly ${variant.n} records.`,
      right: `There are exactly ${variant.n} records in the ${variant.artifact} archive.`,
      allowedChoices: ['EQUIVALENT'],
      dimension: 'generated-english-paraphrase',
      rationale: 'Both state the same exact count for the same named archive.',
    },
    {
      caseId: `en-limit-contradiction-${suffix}`,
      left: `The ${variant.service} service allows exactly ${variant.n} requests per hour.`,
      right: `The ${variant.service} service allows exactly ${nextValue} requests per hour.`,
      allowedChoices: ['CONTRADICTS'],
      dimension: 'generated-english-numeric-conflict',
      rationale: 'The exact limits differ for the same service and time scope.',
    },
    {
      caseId: `ko-revenue-equivalent-${suffix}`,
      left: `2024년 ${variant.city} 지점의 매출은 정확히 ${variant.amount}억 원이다.`,
      right: `${variant.city} 지점은 2024년에 매출 ${variant.amount}억 원을 기록했다.`,
      allowedChoices: ['EQUIVALENT'],
      dimension: 'generated-korean-paraphrase',
      rationale: 'Branch, year, measure, and amount are identical.',
    },
    {
      caseId: `ko-revenue-contradiction-${suffix}`,
      left: `2024년 ${variant.city} 지점의 매출은 정확히 ${variant.amount}억 원이다.`,
      right: `2024년 ${variant.city} 지점의 매출은 정확히 ${nextAmount}억 원이다.`,
      allowedChoices: ['CONTRADICTS'],
      dimension: 'generated-korean-numeric-conflict',
      rationale: 'The exact revenue values conflict for the same branch and year.',
    },
    {
      caseId: `retention-qualifier-${suffix}`,
      left: `All ${variant.record} files are retained for ${variant.years} years.`,
      right: `Tax ${variant.record} files are retained for ${variant.years} years.`,
      allowedChoices: ['QUALIFIES'],
      allowedDirections: ['RIGHT_TO_LEFT'],
      dimension: 'generated-scope-qualification',
      rationale: 'The tax-file statement narrows the scope of the all-files statement.',
    },
    {
      caseId: `npv-branches-related-${suffix}`,
      left: leftNpv,
      right: rightNpv,
      allowedChoices: ['RELATED'],
      dimension: 'generated-disjoint-conditions',
      rationale: 'Opposite outcomes under disjoint NPV conditions can both be true.',
    },
    {
      caseId: `cross-language-time-equivalent-${suffix}`,
      left: `The ${variant.facilityEn} closes at ${variant.time} p.m.`,
      right: `${variant.facilityKo}는 오후 ${variant.time}시에 문을 닫는다.`,
      allowedChoices: ['EQUIVALENT'],
      dimension: 'generated-cross-language-equivalence',
      rationale: 'Both state the same facility closing time.',
    },
    {
      caseId: `different-year-cautious-${suffix}`,
      left: `Revenue was ${variant.amount} million dollars in ${variant.year}.`,
      right: `Revenue was ${variant.amount} million dollars in ${variant.year + 1}.`,
      allowedChoices: ['QUALIFIES', 'RELATED', 'UNRESOLVED'],
      dimension: 'generated-temporal-scope',
      rationale: 'Different years are distinct scopes and must not be merged as one value.',
    },
  ];
  return cases;
});

const digestPayload = {
  corpusId: 'shotgun-vp-relation-pruning-stress',
  corpusVersion: '1.0.0',
  labelReviewStatus: 'CANDIDATE' as const,
  dataClassification: 'SYNTHETIC' as const,
  cases: relationCases,
};

export const vpRelationPruningStressCorpus = {
  ...digestPayload,
  corpusDigest: sha256Text(stableJson(digestPayload)),
};
export const vpRelationPruningStressCorpusComputedDigest = sha256Text(stableJson(digestPayload));
