import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  decodePerformanceBudget,
  evaluatePerformanceBudget,
} from '../performance/frontend-section3-performance-budget.js';

const artifactRoot = 'artifacts/performance/frontend-phase-1-section-3/260729001';
const budgetPath = 'tests/performance/frontend-section3-local-product-performance-budget-v1.0.json';

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('Frontend Section 3 approved performance budget', () => {
  it('passes the frozen 600-run baseline and records explicit non-applicable cells', async () => {
    const budget = decodePerformanceBudget(await readJson(budgetPath));
    const result = evaluatePerformanceBudget({
      budget,
      environment: (await readJson(`${artifactRoot}/environment.json`)) as Record<string, unknown>,
      seedManifest: (await readJson(`${artifactRoot}/seed-manifest.json`)) as Record<
        string,
        unknown
      >[],
      summary: (await readJson(`${artifactRoot}/summary.json`)) as never[],
      runs: (await readJson(`${artifactRoot}/raw-runs.json`)) as never[],
      failures: (await readJson(`${artifactRoot}/failures.json`)) as unknown[],
      bundle: (await readJson(`${artifactRoot}/bundle.json`)) as never[],
      budgetSha256: 'test-budget-digest',
    });

    expect(result.status).toBe('PASS');
    expect(result.recordedRuns).toBe(600);
    expect(result.violations).toEqual([]);
    expect(result.exclusions).toHaveLength(24);
  });

  it('fails closed when a measured P95, group count, or JavaScript total exceeds contract', async () => {
    const budget = decodePerformanceBudget(await readJson(budgetPath));
    const summary = (await readJson(`${artifactRoot}/summary.json`)) as Array<{
      metrics: Record<string, { p95: number | null }>;
    }>;
    const bundle = (await readJson(`${artifactRoot}/bundle.json`)) as Array<{
      name: string;
      bytes: number;
      gzipBytes: number;
    }>;
    summary[1]!.metrics.serverQueryMs!.p95 = 2.501;
    bundle.find((entry) => entry.name.endsWith('.js'))!.bytes = 640_001;

    const result = evaluatePerformanceBudget({
      budget,
      environment: (await readJson(`${artifactRoot}/environment.json`)) as Record<string, unknown>,
      seedManifest: (await readJson(`${artifactRoot}/seed-manifest.json`)) as Record<
        string,
        unknown
      >[],
      summary: summary.slice(1) as never[],
      runs: (await readJson(`${artifactRoot}/raw-runs.json`)) as never[],
      failures: [],
      bundle,
      budgetSha256: 'test-budget-digest',
    });

    expect(result.status).toBe('FAIL');
    expect(result.violations.map((violation) => violation.metric)).toEqual(
      expect.arrayContaining(['summaryGroupCount', 'serverQueryMs', 'javascriptBundle.rawBytes']),
    );
  });

  it('rejects an unapproved or differently bound budget', async () => {
    const value = (await readJson(budgetPath)) as {
      status: string;
      approval: { actor: string };
    };
    value.status = 'PROPOSED';
    value.approval.actor = 'browser';

    expect(() => decodePerformanceBudget(value)).toThrow('Performance budget must be APPROVED.');
  });
});
