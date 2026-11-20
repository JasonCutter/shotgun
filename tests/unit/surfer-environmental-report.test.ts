import { describe, expect, it } from 'vitest';
import { readSurferEnvironmentalReportText } from '../../modules/surfer-learning/src/environmental-report.js';
import {
  decodeSurferAskMemoryContext,
  pinSurferAskMemory,
} from '../../packages/contracts/src/surfer-ask-memory.js';
import { matchesSurferAskEnvironmentalEvidence } from '../../packages/contracts/src/surfer-ask-environment.js';
import { readSurferAskThermalRecord } from '../../packages/contracts/src/surfer-ask-thermal-cycling.js';
import { thermalCyclingObservationsFor } from '../../adapters/ai-provider-ask/src/thermal-cycling.js';

const low = 'Low Temperature Test';
const scope = '4.6.1 Non-Operating Environmental Tests';
const passed = 'The EUT successfully completed the requirements of the Low Temperature Test.';
const observed = 'The chamber temperature was lowered to -4°F and allowed to stabilize.';

const power = [
  'Thermal Cycling Power Measurements',
  'Campaign: TEST-CAMPAIGN',
  'Cycles: 50',
  'Specimen | Before (W) | After (W)',
  '5161 | 62.70 | 62.60',
].join('\n');
const visual = [
  'Thermal Cycling Visual Inspection',
  'Campaign: TEST-CAMPAIGN',
  'Cycles: 50',
  'Specimen | Report | Inspection System Plan',
  '5161 | 2318 | Does not meet Inspection System Plan.',
].join('\n');
const thermalPin = (text: string, id: string) => ({
  evidenceId: id,
  source: {
    sourceId: 'source-' + id,
    sourceVersionId: 'version-' + id,
    revisionId: 'revision-' + id,
    indexingResultId: 'index-' + id,
  },
  thermalRecord: readSurferAskThermalRecord(text)!,
});

describe('Thermal cycling observations in Ask', () => {
  it('pins exact transcribed spans and rejects altered measured values or verdicts', () => {
    const source = power.replace(/\n/g, '\r\n');
    const report = thermalPin(source, 'E1');
    const evidence = { ...report.source, evidenceId: report.evidenceId, exactQuote: source };
    const context = pinSurferAskMemory('base', null, [report]);
    expect(decodeSurferAskMemoryContext(context)).toEqual(context);
    expect(matchesSurferAskEnvironmentalEvidence(report, evidence)).toBe(true);
    expect(matchesSurferAskEnvironmentalEvidence(report, { ...evidence, exactQuote: power })).toBe(
      false,
    );
    const forged = structuredClone(report);
    if (forged.thermalRecord.kind !== 'POWER') throw new Error('Expected a power Source');
    forged.thermalRecord.rows[0]!.afterWatts = 72;
    expect(matchesSurferAskEnvironmentalEvidence(forged, evidence)).toBe(false);
    expect(readSurferAskThermalRecord(power.replace('62.70', '0'))).toBeNull();
    expect(readSurferAskThermalRecord(power + '\n5161 | 65 | 60')).toBeNull();
    expect(readSurferAskThermalRecord(visual.replace('Does not meet', 'Unverified'))).toBeNull();
  });
  it('binds inspection only to the same campaign, cycle count and specimen', () => {
    const reports = [
      thermalPin(power, 'E1'),
      thermalPin(visual.replace('50', '25'), 'E2'),
      thermalPin(visual.replace('5161', '6201'), 'E3'),
      thermalPin(visual.replace('TEST-CAMPAIGN', 'OTHER-CAMPAIGN'), 'E4'),
    ];
    expect(thermalCyclingObservationsFor(reports, (ref) => ref)).toHaveLength(4);
    expect(thermalCyclingObservationsFor(reports, (ref) => ref)[0]).toMatchObject({
      campaign: 'TEST-CAMPAIGN',
      specimen: '5161',
      cycles: 50,
      power: { status: 'REPORTED', records: [{ citationRef: 'E1' }] },
      visualInspection: { status: 'UNKNOWN', records: [] },
    });
  });
  it('retains conflicting findings and cites power and inspection independently', () => {
    const reports = [
      thermalPin(power, 'E1'),
      thermalPin(visual, 'E2'),
      thermalPin(visual.replace('Does not meet', 'Meets').replace('2318', '2317'), 'E3'),
      thermalPin(power.replace('62.60', '61.60'), 'E4'),
    ];
    const [row] = thermalCyclingObservationsFor(reports, (ref) => ref);
    expect(row).toMatchObject({
      power: { status: 'CONFLICT', records: [{ citationRef: 'E1' }, { citationRef: 'E4' }] },
      visualInspection: {
        status: 'CONFLICT',
        records: [
          { citationRef: 'E2', verdict: 'FAIL' },
          { citationRef: 'E3', verdict: 'PASS' },
        ],
      },
    });
    expect(row?.power.records[0]?.lossPercent).toBeCloseTo(0.15949, 4);
  });
});

describe('Scoped environmental report interpretation', () => {
  it('inherits the numbered parent across report pages and binds the named first-attempt outcome', () => {
    const header = '4.4.2 Operating Environmental Tests';
    const title = 'Temperature/Power Variation Test';
    const [item] = readSurferEnvironmentalReportText(
      [
        header,
        '4.4.2.1 ' + title,
        'The temperature inside the chamber and the voltage supplied to the hardware',
        'varied from 50°F to 95°F and from 105 VAC to 129 VAC.',
        '4.0 TEST FINDINGS AND RECOMMENDATIONS (Continued)',
        header + ' (Continued)',
        'The DS200 successfully completed the requirements of the ' + title + ' on the first',
        'attempt without issue.',
      ].join('\n'),
    );
    expect(item).toMatchObject({
      scope: { mode: 'OPERATING' },
      exposure: { minimum: 50, maximum: 95, unit: 'degF' },
      status: 'REPORTED',
      test: { quote: title },
    });
  });
  it('binds Ask observations to exact selected Evidence without changing legacy pins', () => {
    const exactQuote = [scope, low, observed, passed].join('\n');
    const evidence = {
      sourceId: 'source',
      sourceVersionId: 'version',
      evidenceId: 'evidence',
      exactQuote,
    };
    const report = {
      evidenceId: evidence.evidenceId,
      source: {
        sourceId: evidence.sourceId,
        sourceVersionId: evidence.sourceVersionId,
        revisionId: 'revision',
        indexingResultId: 'index',
      },
      observations: readSurferEnvironmentalReportText(exactQuote),
    };
    const legacy = pinSurferAskMemory('base', null);
    expect(decodeSurferAskMemoryContext(legacy)).toEqual(legacy);
    expect(legacy).not.toHaveProperty('environmentalReports');
    const current = pinSurferAskMemory('base', null, [report]);
    expect(current.digest).not.toBe(legacy.digest);
    expect(matchesSurferAskEnvironmentalEvidence(report, evidence)).toBe(true);
    expect(
      matchesSurferAskEnvironmentalEvidence(report, { ...evidence, exactQuote: 'x' + exactQuote }),
    ).toBe(false);
    expect(decodeSurferAskMemoryContext(current)).toEqual(current);
    expect(() =>
      decodeSurferAskMemoryContext({
        ...current,
        environmentalReports: [
          {
            ...report,
            observations: report.observations.map((o) => ({
              ...o,
              exposure: { ...o.exposure!, maximum: 15 },
            })),
          },
        ],
      }),
    ).toThrow('context digest changed');
  });
  it('keeps exact Unicode offsets for scope, exposure and outcome', () => {
    const input = ['🧪 Report', scope, low, observed, passed].join('\n');
    const [row] = readSurferEnvironmentalReportText(input);
    expect(row).toMatchObject({
      scope: { mode: 'NON_OPERATING' },
      exposure: { minimum: -4, maximum: -4 },
      status: 'REPORTED',
    });
    for (const span of [row!.scope.heading, row!.test, row!.outcome!, row!.exposure!.evidence])
      expect(Array.from(input).slice(span.start, span.end).join('')).toBe(span.quote);
  });
  it('does not convert a specification threshold to an observed exposure', () => {
    const [row] = readSurferEnvironmentalReportText(
      [scope, low, 'The minimum temperature shall be -4°F.', passed].join('\n'),
    );
    expect(row).toMatchObject({
      exposure: null,
      status: 'UNRESOLVED',
      reasons: ['EXPOSURE_NOT_REPORTED'],
    });
  });
  it('stops at a different test heading', () => {
    const [row] = readSurferEnvironmentalReportText(
      [scope, low, observed, 'Humidity Test', passed].join('\n'),
    );
    expect(row).toMatchObject({
      outcome: null,
      status: 'UNRESOLVED',
      reasons: ['OUTCOME_NOT_BOUND_TO_TEST'],
    });
  });
  it('does not inherit a sibling operating section', () => {
    const [row] = readSurferEnvironmentalReportText(
      [scope, low, observed, '4.6.2 Operating Environmental Tests', passed].join('\n'),
    );
    expect(row).toMatchObject({ outcome: null, status: 'UNRESOLVED' });
  });
  it('preserves the report outcome but withholds exposure when a retest intervenes', () => {
    const [row] = readSurferEnvironmentalReportText(
      [
        scope,
        low,
        observed,
        'This anomaly required testing to be repeated.',
        '4.0 TEST FINDINGS AND RECOMMENDATIONS (Continued)',
        scope + ' (Continued)',
        'Upon completion of the second attempt the EUT was removed.',
        passed,
      ].join('\n'),
    );
    expect(row).toMatchObject({
      exposure: null,
      outcome: { quote: passed },
      status: 'UNRESOLVED',
      reasons: ['ATTEMPT_OR_EXCEPTION_UNRESOLVED'],
    });
    expect(row?.exceptions).toHaveLength(2);
  });
  it('withholds conflicting exposure or outcome passages', () => {
    const [row] = readSurferEnvironmentalReportText(
      [
        scope,
        low,
        observed,
        observed.replace('-4', '-6'),
        passed,
        passed.replace(low, 'High Temperature Test'),
      ].join('\n'),
    );
    expect(row).toMatchObject({
      exposure: null,
      outcome: null,
      status: 'UNRESOLVED',
      reasons: ['AMBIGUOUS_EXPOSURE', 'OUTCOME_NOT_BOUND_TO_TEST'],
    });
  });
});
