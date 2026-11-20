import { unicodeLength } from './document-evidence.js';
import type { SurferReportSpan } from './surfer-ask-environment.js';

type PowerRow = {
  specimen: string;
  beforeWatts: number;
  afterWatts: number;
  evidence: SurferReportSpan;
};
type InspectionRow = {
  specimen: string;
  report: string;
  verdict: 'PASS' | 'FAIL';
  evidence: SurferReportSpan;
};
export type SurferAskThermalRecord = {
  scope: { campaign: string; cycles: number; evidence: SurferReportSpan };
} & ({ kind: 'POWER'; rows: PowerRow[] } | { kind: 'VISUAL'; rows: InspectionRow[] });

const header =
  /^Thermal Cycling (Power Measurements|Visual Inspection)\r?\nCampaign: ([A-Z0-9][A-Z0-9-]{0,63})\r?\nCycles: ([1-9][0-9]{0,5})\r?\n/u;
const powerHeading = 'Specimen | Before (W) | After (W)';
const visualHeading = 'Specimen | Report | Inspection System Plan';
const powerRow =
  /^([A-Z0-9][A-Z0-9-]{0,63}) \| (\d{1,7}(?:\.\d{1,6})?) \| (\d{1,7}(?:\.\d{1,6})?)$/u;
const inspectionRow =
  /^([A-Z0-9][A-Z0-9-]{0,63}) \| ([A-Z0-9][A-Z0-9-]{0,63}) \| (Meets|Does not meet) Inspection System Plan\.$/u;

/** Decodes a bounded Source transcription, retaining exact spans for all fields. */
export function readSurferAskThermalRecord(text: string): SurferAskThermalRecord | null {
  if (text.length > 12_000) return null;
  const scopeMatch = header.exec(text);
  if (!scopeMatch) return null;
  const scopeText = scopeMatch[0].trimEnd();
  const scope = {
    campaign: scopeMatch[2]!,
    cycles: Number(scopeMatch[3]),
    evidence: { start: 0, end: unicodeLength(scopeText), quote: scopeText },
  };
  const isPower = scopeMatch[1] === 'Power Measurements';
  const heading = isPower ? powerHeading : visualHeading;
  const first = scopeMatch[0].length;
  const lines = [...text.slice(first).matchAll(/[^\r\n]+/gu)];
  if (lines[0]?.[0] !== heading || lines.length < 2 || lines.length > 9) return null;
  const power: PowerRow[] = [];
  const visual: InspectionRow[] = [];
  const specimens = new Set<string>();
  for (const line of lines.slice(1)) {
    const quote = line[0];
    const match = (isPower ? powerRow : inspectionRow).exec(quote);
    if (!match || specimens.has(match[1]!)) return null;
    const specimen = match[1]!;
    specimens.add(specimen);
    const start = unicodeLength(text.slice(0, first + line.index));
    const evidence = { start, end: start + unicodeLength(quote), quote };
    if (isPower) {
      const beforeWatts = Number(match[2]);
      if (beforeWatts <= 0) return null;
      power.push({ specimen, beforeWatts, afterWatts: Number(match[3]), evidence });
    } else {
      visual.push({
        specimen,
        report: match[2]!,
        verdict: match[3] === 'Meets' ? 'PASS' : 'FAIL',
        evidence,
      });
    }
  }
  return isPower ? { kind: 'POWER', scope, rows: power } : { kind: 'VISUAL', scope, rows: visual };
}
