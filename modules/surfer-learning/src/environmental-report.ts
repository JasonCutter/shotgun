import { sha256Text, unicodeLength } from '../../../packages/contracts/src/document-evidence.js';
import type { SurferCognitiveView } from '../../../packages/contracts/src/surfer-cognition.js';
import { surferFailure } from '../../../packages/contracts/src/surfer-learning.js';

type Span = { start: number; end: number; quote: string };
type Mode = 'OPERATING' | 'NON_OPERATING';
type Observation = {
  test: Span;
  scope: { mode: Mode; heading: Span };
  exposure: { minimum: number; maximum: number; unit: 'degF'; evidence: Span } | null;
  outcome: Span | null;
  exceptions: Span[];
  status: 'REPORTED' | 'UNRESOLVED';
  reasons: string[];
};

const operatingScope =
  /^(?<section>\d+(?:\.\d+)+) (?<mode>Non-Operating|Operating) Environmental Tests(?<continued> \(Continued\))?$/iu;
const numberedHeading = /^\d+(?:\.\d+)+\s/u;
const numberedSubsection = /^(?<number>\d+(?:\.\d+)+)\s+(?<title>.+)$/u;
const subsection = /^[A-Z][\w /-]{1,100} Test$/u;
const supported = /^(?:Low Temperature|High Temperature|Temperature\/Power Variation) Test$/u;
const temperature =
  /\bchamber temperature was\s+(?:lowered|raised) to\s+(-?\d+(?:\.\d+)?)\s*°F\s+and allowed to stabilize\b/giu;
const temperatureRange =
  /\btemperature inside the chamber and the voltage supplied to the\s+hardware\s+varied from\s+(-?\d+(?:\.\d+)?)\s*°F\s+to\s+(-?\d+(?:\.\d+)?)\s*°F\b/giu;
const pass =
  /\bThe (?:EUTs?|DS200) successfully completed the requirements of the\s+((?:Low Temperature|High Temperature|Operating Environmental|Temperature\/Power Variation)\s+Test)(?: on the first\s+attempt without issue)?\./gu;
const fail =
  /\bThe (?:EUTs?|DS200) failed to meet the requirements of the\s+((?:Low Temperature|High Temperature|Temperature\/Power Variation)\s+Test)\./gu;
const qualification =
  /\b(?:anomaly\s+required\s+testing\s+to\s+be\s+repeated|second\s+attempt|anomal(?:y|ies)|repeat(?:ed|ing)?|retest(?:ed|ing)?|aborted|except(?:ion|ions)?)\b/giu;

/** Interprets bounded plain-text report excerpts with source offsets. No learning eligibility. */
export function readSurferEnvironmentalReportText(text: string): Observation[] {
  if (typeof text !== 'string' || !text.length || text.length > 32_000)
    throw surferFailure('Expected a bounded environmental report excerpt.');
  const span = (start: number, quote: string): Span => {
    const position = unicodeLength(text.slice(0, start));
    return { start: position, end: position + unicodeLength(quote), quote };
  };
  const output: Observation[] = [];
  let scope: { section: string; mode: Mode; heading: Span } | undefined;
  let current:
    { name: string; start: number; test: Span; scope: NonNullable<typeof scope> } | undefined;

  function finish(end: number) {
    if (!current) return;
    const { name, start, test, scope } = current;
    const body = text.slice(start, end);
    const exceptions = [...body.matchAll(qualification)].map((m) => span(start + m.index, m[0]));
    const single = [...body.matchAll(temperature)];
    const ranges = [...body.matchAll(temperatureRange)];
    const measurements = [...single, ...ranges];
    const reasons: string[] = [];
    let exposure: Observation['exposure'] = null;
    if (exceptions.length) reasons.push('ATTEMPT_OR_EXCEPTION_UNRESOLVED');
    if (measurements.length !== 1)
      reasons.push(measurements.length ? 'AMBIGUOUS_EXPOSURE' : 'EXPOSURE_NOT_REPORTED');
    if (!reasons.length) {
      const m = measurements[0]!;
      const minimum = Number(m[1]);
      const maximum = Number(m[2] ?? m[1]);
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum)
        reasons.push('INVALID_EXPOSURE');
      else exposure = { minimum, maximum, unit: 'degF', evidence: span(start + m.index, m[0]) };
    }
    const outcomes = [...body.matchAll(pass), ...body.matchAll(fail)];
    const validOutcome =
      outcomes.length === 1 &&
      (outcomes[0]![1]!.replace(/\s+/g, ' ') === name ||
        (name === 'Temperature/Power Variation Test' &&
          scope.mode === 'OPERATING' &&
          outcomes[0]![1]!.replace(/\s+/g, ' ') === 'Operating Environmental Test'));
    if (!validOutcome) reasons.push('OUTCOME_NOT_BOUND_TO_TEST');
    output.push({
      test,
      scope: { mode: scope.mode, heading: scope.heading },
      exposure,
      outcome: validOutcome ? span(start + outcomes[0]!.index, outcomes[0]![0]) : null,
      exceptions,
      status: reasons.length ? 'UNRESOLVED' : 'REPORTED',
      reasons,
    });
    current = undefined;
  }

  for (const match of text.matchAll(/[^\r\n]+/gu)) {
    const line = match[0].trim();
    const start = match.index + match[0].indexOf(line);
    const found = operatingScope.exec(line)?.groups;
    if (found) {
      const mode: Mode = found.mode!.toLowerCase() === 'operating' ? 'OPERATING' : 'NON_OPERATING';
      if (found.continued && scope?.section === found.section && scope?.mode === mode) continue;
      finish(start);
      scope = { section: found.section!, mode, heading: span(start, line) };
    } else if (/^4\.0 TEST FINDINGS AND RECOMMENDATIONS \(Continued\)$/u.test(line)) {
      continue;
    } else if (numberedHeading.test(line)) {
      finish(start);
      const child = numberedSubsection.exec(line)?.groups;
      if (scope && child?.number?.startsWith(scope.section + '.')) {
        const title = child.title!;
        if (supported.test(title))
          current = {
            name: title,
            test: span(start + line.lastIndexOf(title), title),
            start: start + line.length,
            scope,
          };
      } else scope = undefined;
    } else if (subsection.test(line)) {
      finish(start);
      if (scope && supported.test(line))
        current = { name: line, test: span(start, line), start: start + line.length, scope };
    }
  }
  finish(text.length);
  return output;
}

/** Binds located assertions to the complete indexed text of one current Source. */
export function readSurferEnvironmentalSource(view: SurferCognitiveView) {
  const anchor = view.anchors[0];
  const text = view.anchors.map((item) => item.rawLiteral).join('\n');
  if (
    !anchor ||
    view.anchors.length > 16 ||
    anchor.position.start !== 0 ||
    anchor.scope.spaceId !== view.basis.authority.projectId ||
    view.anchors.some(
      (item, index) =>
        item.source.sourceId !== anchor.source.sourceId ||
        item.source.sourceVersionId !== anchor.source.sourceVersionId ||
        item.source.evidenceId !== anchor.source.evidenceId ||
        (index > 0 && item.position.start !== view.anchors[index - 1]!.position.end + 1),
    ) ||
    sha256Text(text) !== anchor.source.sourceContentHash
  )
    throw surferFailure('Environmental observations require one complete current text Source.');
  const source = {
    sourceId: anchor.source.sourceId,
    sourceVersionId: anchor.source.sourceVersionId,
    evidenceId: anchor.source.evidenceId,
    sourceContentHash: anchor.source.sourceContentHash,
  };
  return { text, source, scope: anchor.scope };
}

export function readSurferEnvironmentalReport(view: SurferCognitiveView) {
  const { text, source } = readSurferEnvironmentalSource(view);
  return readSurferEnvironmentalReportText(text).map((observation) => ({
    ...observation,
    source,
  }));
}
