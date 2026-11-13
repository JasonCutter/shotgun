import { surferDigest, surferFailure } from '../../../packages/contracts/src/surfer-learning.js';
import {
  decodeSurferSemanticFrameProposal,
  type SurferSemanticField,
  type SurferSemanticFieldName,
  type SurferSemanticValue,
} from '../../../packages/contracts/src/surfer-cognition.js';

type Expected = {
  name: SurferSemanticFieldName;
  state: SurferSemanticField['state'];
  values?: SurferSemanticValue[];
};
type Fixture = {
  id: string;
  category: string;
  family: string;
  text: string;
  expected: Expected[];
  forbidden?: { name: SurferSemanticFieldName; value: SurferSemanticValue }[];
};
const resolved = (name: SurferSemanticFieldName, ...values: SurferSemanticValue[]): Expected => ({
  name,
  state: 'RESOLVED',
  values,
});
const missing = (name: SurferSemanticFieldName): Expected => ({ name, state: 'MISSING' });
const ambiguous = (name: SurferSemanticFieldName, ...values: SurferSemanticValue[]): Expected => ({
  name,
  state: 'AMBIGUOUS',
  values,
});
/** Authored controlled expectations, not generated from model output or a model-as-judge. */
const fixtures: Fixture[] = [
  {
    id: 'S01',
    category: 'condition-exception',
    family: 'pump-pressure',
    text: '모든 A형 펌프는 압력이 5 bar 이상일 때 점검해야 한다. 단, 시험 운전은 제외한다.',
    expected: [
      resolved('SUBJECT', 'A형 펌프'),
      resolved('CONDITIONS', '압력이 5 bar 이상'),
      resolved('EXCEPTIONS', '시험 운전'),
      resolved('DOCUMENT_ROLE', 'NORMATIVE'),
    ],
  },
  {
    id: 'S02',
    category: 'condition-exception',
    family: 'loan-documents',
    text: '신청인 R7은 재직 증명과 소득 증빙을 모두 제출한 경우에만 심사 대상이다.',
    expected: [
      resolved('SUBJECT', '신청인 R7', 'R7'),
      resolved('CONDITIONS', '재직 증명과 소득 증빙을 모두 제출'),
      resolved('POLARITY', 'POSITIVE'),
    ],
  },
  {
    id: 'S03',
    category: 'condition-exception',
    family: 'leave-emergency',
    text: '직원은 원칙적으로 휴가 3일 전에 신청해야 한다. 응급 입원인 경우 사전 신청 의무가 없다.',
    expected: [resolved('EXCEPTIONS', '응급 입원'), resolved('DOCUMENT_ROLE', 'NORMATIVE')],
    forbidden: [{ name: 'QUANTIFIER', value: 'UNCONDITIONAL_UNIVERSAL' }],
  },
  {
    id: 'S04',
    category: 'condition-exception',
    family: 'temperature-domain',
    text: '이 보증은 실내에서 10~30 °C로 사용하는 센서에만 적용된다.',
    expected: [
      resolved('SCOPE', '실내에서 10~30 °C로 사용하는 센서'),
      resolved('DOCUMENT_ROLE', 'NORMATIVE'),
    ],
    forbidden: [{ name: 'SCOPE', value: 'ALL_SENSORS' }],
  },
  {
    id: 'S05',
    category: 'negation-quantifier',
    family: 'valve-ban',
    text: 'V9 밸브는 가동 중 열면 안 된다.',
    expected: [
      resolved('SUBJECT', 'V9 밸브'),
      resolved('POLARITY', 'NEGATIVE'),
      resolved('CONDITIONS', '가동 중'),
      resolved('DOCUMENT_ROLE', 'NORMATIVE'),
    ],
  },
  {
    id: 'S06',
    category: 'negation-quantifier',
    family: 'sample-existence',
    text: '검체 중 일부는 양성 반응이었다.',
    expected: [
      resolved('QUANTIFIER', 'SOME'),
      resolved('POLARITY', 'POSITIVE'),
      resolved('DOCUMENT_ROLE', 'OBSERVATION'),
    ],
    forbidden: [{ name: 'QUANTIFIER', value: 'ALL' }],
  },
  {
    id: 'S07',
    category: 'negation-quantifier',
    family: 'approval-none',
    text: '어느 지원자도 최종 승인을 받지 못했다.',
    expected: [
      resolved('SUBJECT', '지원자'),
      resolved('QUANTIFIER', 'NONE'),
      resolved('POLARITY', 'NEGATIVE'),
    ],
  },
  {
    id: 'S08',
    category: 'negation-quantifier',
    family: 'negative-reading',
    text: '측정값은 -1 V였다.',
    expected: [
      resolved('VALUE', -1, '-1'),
      resolved('UNIT', 'V'),
      resolved('POLARITY', 'POSITIVE'),
      resolved('DOCUMENT_ROLE', 'OBSERVATION'),
    ],
  },
  {
    id: 'S09',
    category: 'time-order',
    family: 'policy-effective',
    text: '규정 P2는 2027-01-01부터 시행한다.',
    expected: [
      resolved('SUBJECT', '규정 P2', 'P2'),
      resolved('TIME', '2027-01-01'),
      resolved('DOCUMENT_ROLE', 'NORMATIVE'),
    ],
  },
  {
    id: 'S10',
    category: 'time-order',
    family: 'assembly-order',
    text: '조립 전에는 반드시 전원 차단을 완료해야 한다.',
    expected: [
      resolved('CONDITIONS', '조립 전'),
      resolved('TIME', '조립 전'),
      resolved('DOCUMENT_ROLE', 'NORMATIVE'),
    ],
  },
  {
    id: 'S11',
    category: 'time-order',
    family: 'inspection-duration',
    text: '라인 L3의 검사는 시작 후 30 min 동안 진행되었다.',
    expected: [
      resolved('SUBJECT', '라인 L3', 'L3'),
      resolved('VALUE', 30, '30'),
      resolved('UNIT', 'min'),
      resolved('TIME', '시작 후 30 min'),
    ],
  },
  {
    id: 'S12',
    category: 'time-order',
    family: 'missing-date-reference',
    text: '기준일은 기재되지 않았다. 배송은 다음 날이다.',
    expected: [missing('TIME')],
    forbidden: [{ name: 'TIME', value: '2026-10-28' }],
  },
  {
    id: 'S13',
    category: 'quantity-unit',
    family: 'mass-observation',
    text: '시료 M4의 질량은 3000 g이다.',
    expected: [
      resolved('SUBJECT', '시료 M4', 'M4'),
      resolved('VALUE', 3000, '3000'),
      resolved('UNIT', 'g'),
      resolved('DOCUMENT_ROLE', 'OBSERVATION'),
    ],
  },
  {
    id: 'S14',
    category: 'quantity-unit',
    family: 'decimal-current',
    text: '회로 C8의 전류 측정값은 0.10 A다.',
    expected: [
      resolved('VALUE', 0.1, '0.10'),
      resolved('UNIT', 'A'),
      resolved('POLARITY', 'POSITIVE'),
    ],
  },
  {
    id: 'S15',
    category: 'quantity-unit',
    family: 'unwritten-unit',
    text: '장치 D5의 설정값은 12이며 단위는 기록되지 않았다.',
    expected: [resolved('VALUE', 12, '12'), missing('UNIT')],
    forbidden: [{ name: 'UNIT', value: 'kg' }],
  },
  {
    id: 'S16',
    category: 'quantity-unit',
    family: 'locale-number',
    text: '지역 표기 규칙은 알려지지 않았다. 표의 수치는 1,234다.',
    expected: [ambiguous('VALUE', '1.234', '1234')],
    forbidden: [{ name: 'VALUE', value: 1234 }],
  },
  {
    id: 'S17',
    category: 'identity-concept',
    family: 'same-name-people',
    text: '민수는 설비팀 김민수 또는 품질팀 이민수다. 민수가 승인했다.',
    expected: [ambiguous('SUBJECT', '설비팀 김민수', '품질팀 이민수')],
  },
  {
    id: 'S18',
    category: 'identity-concept',
    family: 'defined-lot-term',
    text: '이 문서에서 로트는 같은 날 같은 라인에서 생산한 묶음을 뜻한다.',
    expected: [
      resolved('SUBJECT', '로트'),
      resolved('DOCUMENT_ROLE', 'DEFINITION'),
      resolved('SCOPE', '이 문서'),
    ],
  },
  {
    id: 'S19',
    category: 'identity-concept',
    family: 'missing-anaphor',
    text: '그 장치는 시험에 합격했다. 앞선 장치 정보는 없다.',
    expected: [missing('SUBJECT'), resolved('DOCUMENT_ROLE', 'OBSERVATION')],
  },
  {
    id: 'S20',
    category: 'identity-concept',
    family: 'organization-explicit',
    text: '품질팀의 박준은 보고서 R8을 승인했다.',
    expected: [
      resolved('SUBJECT', '품질팀의 박준', '품질팀 박준'),
      resolved('POLARITY', 'POSITIVE'),
      resolved('DOCUMENT_ROLE', 'OBSERVATION'),
    ],
  },
  {
    id: 'S21',
    category: 'structure-role',
    family: 'mandatory-limit',
    text: '관리 기준: 배출 농도는 10 ppm 이하여야 한다.',
    expected: [
      resolved('DOCUMENT_ROLE', 'NORMATIVE'),
      resolved('VALUE', 10, '10'),
      resolved('UNIT', 'ppm'),
    ],
  },
  {
    id: 'S22',
    category: 'structure-role',
    family: 'measured-limit',
    text: '측정 결과: 배출 농도는 10 ppm이었다.',
    expected: [
      resolved('DOCUMENT_ROLE', 'OBSERVATION'),
      resolved('VALUE', 10, '10'),
      resolved('UNIT', 'ppm'),
    ],
  },
  {
    id: 'S23',
    category: 'structure-role',
    family: 'worked-example',
    text: '계산 예시(실측값 아님): 유량을 2 L/s라고 가정한다.',
    expected: [
      resolved('DOCUMENT_ROLE', 'EXAMPLE'),
      resolved('VALUE', 2, '2'),
      resolved('UNIT', 'L/s'),
    ],
    forbidden: [{ name: 'DOCUMENT_ROLE', value: 'OBSERVATION' }],
  },
  {
    id: 'S24',
    category: 'structure-role',
    family: 'ambiguous-column-header',
    text: '표 머리글: 기준/결과. 셀 A1: 15 kPa. 어느 열에 속하는지는 보존되지 않았다.',
    expected: [ambiguous('DOCUMENT_ROLE', 'NORMATIVE', 'OBSERVATION')],
    forbidden: [{ name: 'DOCUMENT_ROLE', value: 'NORMATIVE' }],
  },
];

/** Source and oracle digests are separate. input() never returns expected values or forbidden inferences.
 * This in-process fixture facade is not a filesystem sandbox or durable held-out experiment service. */
export function createSurferSemanticSuite() {
  const data = structuredClone(fixtures),
    byId = new Map(data.map((f) => [f.id, f]));
  const manifest = {
    schemaVersion: '1.0.0',
    datasetId: 'surfer-authored-semantics-v1',
    evaluatorRevision: 'surfer.semantic-field-comparison.v1',
    sourceDigest: surferDigest(
      data.map(({ id, category, family, text }) => ({ id, category, family, text })),
    ),
    oracleDigest: surferDigest(
      data.map(({ id, expected, forbidden }) => ({ id, expected, forbidden: forbidden ?? [] })),
    ),
    count: data.length,
    checkedFieldCount: data.reduce((n, f) => n + f.expected.length, 0),
    categories: [...new Set(data.map((f) => f.category))],
    provenance: 'AUTHORED_CONTROLLED_FIXTURE_NOT_CUSTOMER_POPULATION',
    records: data.map(({ id, category, family, text }) => ({
      id,
      category,
      family,
      textDigest: surferDigest(text),
    })),
  };
  return {
    manifest: structuredClone(manifest),
    input(id: string) {
      const f = byId.get(id);
      if (!f) throw surferFailure('Unknown semantic fixture.');
      return structuredClone({
        caseId: f.id,
        category: f.category,
        text: f.text,
        textDigest: surferDigest(f.text),
      });
    },
    evaluate(input: { caseId: string; frame: unknown }[]) {
      const rows = structuredClone(input);
      if (
        new Set(rows.map((r) => r.caseId)).size !== rows.length ||
        rows.some((r) => !byId.has(r.caseId))
      )
        throw surferFailure('Duplicate or foreign semantic results.');
      const scores = data.map((f) => {
        const row = rows.find((r) => r.caseId === f.id);
        if (!row)
          return {
            caseId: f.id,
            status: 'NOT_RUN',
            fieldsPassed: 0,
            fieldsChecked: 0,
            forbiddenInferences: 0,
          };
        let fields: SurferSemanticField[];
        try {
          fields = decodeSurferSemanticFrameProposal(row.frame).fields;
          if (new Set(fields.map((x) => x.name)).size !== fields.length)
            throw new Error('duplicate');
        } catch {
          return {
            caseId: f.id,
            status: 'INVALID_OUTPUT',
            fieldsPassed: 0,
            fieldsChecked: f.expected.length,
            forbiddenInferences: 0,
          };
        }
        const values = (x: SurferSemanticField) =>
          x.state === 'RESOLVED'
            ? [x.value]
            : x.state === 'AMBIGUOUS'
              ? x.candidates.map((c) => c.value)
              : [];
        const equal = (a: SurferSemanticValue, b: SurferSemanticValue) =>
          surferDigest(a) === surferDigest(b);
        const passed = f.expected.filter((e) => {
          const actual = fields.find((x) => x.name === e.name);
          if (!actual || actual.state !== e.state) return false;
          if (!e.values) return true;
          const av = values(actual);
          return e.state === 'AMBIGUOUS'
            ? av.length === e.values.length && e.values.every((v) => av.some((a) => equal(v, a)))
            : e.values.some((v) => av.some((a) => equal(v, a)));
        }).length;
        const forbidden = (f.forbidden ?? []).filter((e) => {
          const a = fields.find((x) => x.name === e.name);
          return a?.state === 'RESOLVED' && equal(a.value, e.value);
        }).length;
        return {
          caseId: f.id,
          status: passed === f.expected.length && !forbidden ? 'MATCHED' : 'MISMATCHED',
          fieldsPassed: passed,
          fieldsChecked: f.expected.length,
          forbiddenInferences: forbidden,
        };
      });
      const executed = scores.filter((s) => s.status !== 'NOT_RUN').length,
        matched = scores.filter((s) => s.status === 'MATCHED').length;
      return {
        datasetDigest: surferDigest(manifest),
        sourceDigest: manifest.sourceDigest,
        oracleDigest: manifest.oracleDigest,
        evaluatorRevision: manifest.evaluatorRevision,
        scope: 'SCOPED_STRUCTURED_FIELD_COMPARISON_NOT_SEMANTIC_CERTIFICATION',
        plannedCases: data.length,
        executedCases: executed,
        matchedCases: matched,
        notRunCases: data.length - executed,
        matchRate: executed ? matched / executed : null,
        complete: executed === data.length,
        fieldsPassed: scores.reduce((n, s) => n + s.fieldsPassed, 0),
        fieldsChecked: scores.reduce((n, s) => n + s.fieldsChecked, 0),
        forbiddenInferences: scores.reduce((n, s) => n + s.forbiddenInferences, 0),
        scores,
      };
    },
  };
}
