import { unicodeLength, unicodeSlice } from './document-evidence.js';
import { surferDigest, surferFailure } from './surfer-learning.js';
import {
  readSurferAskThermalRecord,
  type SurferAskThermalRecord,
} from './surfer-ask-thermal-cycling.js';

export type SurferReportSpan = { start: number; end: number; quote: string };
export type SurferEnvironmentalObservation = {
  test: SurferReportSpan;
  scope: { mode: 'OPERATING' | 'NON_OPERATING'; heading: SurferReportSpan };
  exposure: { minimum: number; maximum: number; unit: 'degF'; evidence: SurferReportSpan } | null;
  outcome: SurferReportSpan | null;
  exceptions: SurferReportSpan[];
  status: 'REPORTED' | 'UNRESOLVED';
  reasons: string[];
};
export type SurferAskEnvironmentalReport = {
  source: {
    sourceId: string;
    sourceVersionId: string;
    revisionId: string;
    indexingResultId: string;
  };
  evidenceId: string;
} & (
  { observations: SurferEnvironmentalObservation[] } | { thermalRecord: SurferAskThermalRecord }
);
const keys = (value: object, expected: string) => Object.keys(value).sort().join(',') === expected;
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validSpan = (span: SurferReportSpan) =>
  span &&
  keys(span, 'end,quote,start') &&
  Number.isSafeInteger(span.start) &&
  Number.isSafeInteger(span.end) &&
  span.start >= 0 &&
  span.end <= 12_000 &&
  typeof span.quote === 'string' &&
  span.quote.length > 0 &&
  span.quote.length <= 2048 &&
  span.end - span.start === unicodeLength(span.quote);
const spans = (row: SurferEnvironmentalObservation) => [
  row.test,
  row.scope.heading,
  ...(row.outcome ? [row.outcome] : []),
  ...(row.exposure ? [row.exposure.evidence] : []),
  ...row.exceptions,
];

export function assertSurferAskEnvironmentalReports(reports: SurferAskEnvironmentalReport[]) {
  if (
    !Array.isArray(reports) ||
    !reports.length ||
    reports.length > 7 ||
    reports.filter((report) => report && typeof report === 'object' && 'observations' in report)
      .length > 3 ||
    reports.filter((report) => report && typeof report === 'object' && 'thermalRecord' in report)
      .length > 4 ||
    new Set(reports.map((r) => r?.source?.sourceId)).size !== reports.length
  )
    throw surferFailure('Invalid environmental report list.');
  for (const report of reports) {
    if (
      !report ||
      typeof report !== 'object' ||
      !id(report.evidenceId) ||
      !report.source ||
      !keys(report.source, 'indexingResultId,revisionId,sourceId,sourceVersionId') ||
      !Object.values(report.source).every(id)
    )
      throw surferFailure('Invalid environmental report evidence pin.');
    if ('thermalRecord' in report) {
      const { thermalRecord: record } = report;
      if (
        !keys(report, 'evidenceId,source,thermalRecord') ||
        !record ||
        !keys(record, 'kind,rows,scope') ||
        !['POWER', 'VISUAL'].includes(record.kind) ||
        !record.scope ||
        !keys(record.scope, 'campaign,cycles,evidence') ||
        !id(record.scope.campaign) ||
        !Number.isSafeInteger(record.scope.cycles) ||
        record.scope.cycles <= 0 ||
        !validSpan(record.scope.evidence) ||
        !Array.isArray(record.rows) ||
        !record.rows.length ||
        record.rows.length > 8 ||
        !record.rows.every((row) => row && id(row.specimen) && validSpan(row.evidence)) ||
        (record.kind === 'POWER'
          ? record.rows.some(
              (row) =>
                !keys(row, 'afterWatts,beforeWatts,evidence,specimen') ||
                !Number.isFinite(row.beforeWatts) ||
                row.beforeWatts <= 0 ||
                !Number.isFinite(row.afterWatts) ||
                row.afterWatts < 0,
            )
          : record.rows.some(
              (row) =>
                !keys(row, 'evidence,report,specimen,verdict') ||
                !id(row.report) ||
                !['PASS', 'FAIL'].includes(row.verdict),
            ))
      )
        throw surferFailure('Invalid thermal cycling evidence pin.');
      continue;
    }
    if (
      !keys(report, 'evidenceId,observations,source') ||
      !Array.isArray(report.observations) ||
      !report.observations.length ||
      report.observations.length > 8
    )
      throw surferFailure('Invalid environmental report evidence pin.');
    for (const row of report.observations) {
      if (
        !row ||
        !keys(row, 'exceptions,exposure,outcome,reasons,scope,status,test') ||
        !row.scope ||
        !keys(row.scope, 'heading,mode') ||
        !['OPERATING', 'NON_OPERATING'].includes(row.scope.mode) ||
        !Array.isArray(row.exceptions) ||
        row.exceptions.length > 8 ||
        !Array.isArray(row.reasons) ||
        row.reasons.length > 8 ||
        !row.reasons.every(id) ||
        !['REPORTED', 'UNRESOLVED'].includes(row.status) ||
        (row.status === 'REPORTED' && (!row.outcome || !row.exposure || row.reasons.length > 0)) ||
        (row.status === 'UNRESOLVED' && !row.reasons.length) ||
        (row.exceptions.length > 0 && row.exposure !== null) ||
        (row.outcome !== null && !validSpan(row.outcome)) ||
        (row.exposure !== null &&
          (!row.exposure ||
            !keys(row.exposure, 'evidence,maximum,minimum,unit') ||
            row.exposure.unit !== 'degF' ||
            !Number.isFinite(row.exposure.minimum) ||
            !Number.isFinite(row.exposure.maximum) ||
            row.exposure.minimum > row.exposure.maximum)) ||
        !spans(row).every(validSpan)
      )
        throw surferFailure('Invalid environmental observation.');
    }
  }
}

export function matchesSurferAskEnvironmentalEvidence(
  report: SurferAskEnvironmentalReport,
  evidence: { sourceId: string; sourceVersionId: string; evidenceId: string; exactQuote: string },
) {
  if (
    report.source.sourceId !== evidence.sourceId ||
    report.source.sourceVersionId !== evidence.sourceVersionId ||
    report.evidenceId !== evidence.evidenceId
  )
    return false;
  if ('thermalRecord' in report) {
    const current = readSurferAskThermalRecord(evidence.exactQuote);
    return current !== null && surferDigest(current) === surferDigest(report.thermalRecord);
  }
  return report.observations.every((row) =>
    spans(row).every(
      (span) => unicodeSlice(evidence.exactQuote, span.start, span.end) === span.quote,
    ),
  );
}
