import type { SurferAskEnvironmentalReport } from '../../../packages/contracts/src/surfer-ask-environment.js';

type Evidence = { citationRef: string; quote: string; scopeQuote: string };
type Power = Evidence & { beforeWatts: number; afterWatts: number; lossPercent: number };
type Visual = Evidence & { report: string; verdict: 'PASS' | 'FAIL' };
type ThermalGroup = {
  campaign: string;
  cycles: number;
  specimen: string;
  power: Power[];
  visual: Visual[];
};

/** Explicit prose markers can restore only issued references for pinned thermal records. */
export function thermalCyclingProseReferences(answer: string, issued: ReadonlySet<string>) {
  const groups = answer.matchAll(
    /\((E[1-9]\d{0,2}(?:\s*,\s*E[1-9]\d{0,2})*)\)|\[(E[1-9]\d{0,2}(?:\s*,\s*E[1-9]\d{0,2})*)\]/gu,
  );
  return [
    ...new Set([...groups].flatMap((group) => (group[1] ?? group[2]!).split(/\s*,\s*/u))),
  ].filter((ref) => issued.has(ref));
}

export function thermalCyclingObservationsFor(
  reports: SurferAskEnvironmentalReport[],
  citationRefFor: (evidenceId: string) => string,
) {
  const groups = new Map<string, ThermalGroup>();
  for (const report of reports) {
    if (!('thermalRecord' in report)) continue;
    const record = report.thermalRecord;
    const { campaign, cycles, evidence } = record.scope;
    const citationRef = citationRefFor(report.evidenceId);
    const groupFor = (specimen: string) => {
      const key = [campaign, cycles, specimen].join(':');
      const group = groups.get(key) ?? { campaign, cycles, specimen, power: [], visual: [] };
      groups.set(key, group);
      return group;
    };
    const cite = (quote: string) => ({ citationRef, scopeQuote: evidence.quote, quote });
    if (record.kind === 'POWER') {
      for (const { specimen, beforeWatts, afterWatts, evidence: rowEvidence } of record.rows) {
        groupFor(specimen).power.push({
          beforeWatts,
          afterWatts,
          lossPercent: ((beforeWatts - afterWatts) / beforeWatts) * 100,
          ...cite(rowEvidence.quote),
        });
      }
    } else {
      for (const { specimen, report: reportNumber, verdict, evidence: rowEvidence } of record.rows)
        groupFor(specimen).visual.push({
          report: reportNumber,
          verdict,
          ...cite(rowEvidence.quote),
        });
    }
  }
  return [...groups.values()].map(({ power, visual, ...scope }) => {
    const measurements = new Set(power.map((row) => [row.beforeWatts, row.afterWatts].join(':')));
    const verdicts = new Set(visual.map((row) => row.verdict));
    return {
      ...scope,
      power: {
        status: measurements.size > 1 ? 'CONFLICT' : power.length ? 'REPORTED' : 'UNKNOWN',
        records: power,
      },
      visualInspection: {
        status: verdicts.size > 1 ? 'CONFLICT' : (visual[0]?.verdict ?? 'UNKNOWN'),
        records: visual,
      },
    };
  });
}
