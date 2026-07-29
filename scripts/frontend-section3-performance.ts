import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

import { startFrontendPerformanceBackend } from '../tests/performance/fixtures/frontend-performance-backend.js';
import {
  getPerformanceDatasetManifest,
  performanceDatasetDigest,
  type PerformanceDatasetKind,
  type PerformanceDatasetManifest,
} from '../tests/performance/frontend-section3-performance-seed.js';

const ARTIFACT_SEQUENCE = '260729001';
const IMPLEMENTATION_HEAD = '1eccfb380a31b65af1ecf04c58e64150ea52b563';
const BASE_URL = 'http://127.0.0.1:4173';
const ACTIVE_BACKEND_PORT = 3001;
const ZERO_BACKEND_PORT = 3002;
const STATIC_PORT = 4173;
const isSmoke = process.argv.includes('--smoke');
const shouldWriteCanonical = process.argv.includes('--write');

if (!isSmoke && !shouldWriteCanonical) {
  throw new Error('Use --write for the canonical baseline or --smoke for a reduced harness check.');
}

type DeviceProfile = {
  readonly id: 'desktop' | 'mobile';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly hasTouch: boolean;
  readonly isMobile: boolean;
  readonly cpuThrottlingRate: number;
  readonly network: {
    readonly downloadMbps: number;
    readonly uploadMbps: number;
    readonly latencyMs: number;
  };
};

const profiles: readonly DeviceProfile[] = [
  {
    id: 'desktop',
    viewport: { width: 1440, height: 900 },
    hasTouch: false,
    isMobile: false,
    cpuThrottlingRate: 4,
    network: { downloadMbps: 10, uploadMbps: 2, latencyMs: 40 },
  },
  {
    id: 'mobile',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    cpuThrottlingRate: 6,
    network: { downloadMbps: 1.6, uploadMbps: 0.75, latencyMs: 150 },
  },
];

type CacheProfile = 'cold' | 'warm';

type CacheSnapshot = {
  readonly queryCount: number;
  readonly activeQueryCount: number;
  readonly serializedBytes: number;
};

type RunMetric = {
  readonly dataset: PerformanceDatasetKind;
  readonly profile: DeviceProfile['id'];
  readonly scenario: string;
  readonly cacheProfile: CacheProfile;
  readonly ordinal: number;
  readonly attempt: number;
  readonly serverQueryMs: number | null;
  readonly projectionCompositionMs: number | null;
  readonly responseBytes: number;
  readonly networkTransferBytes: number;
  readonly networkTransferMs: number | null;
  readonly runtimeDecodeMs: number;
  readonly clientRenderMs: number;
  readonly interactionReadinessMs: number;
  readonly domNodes: number;
  readonly cacheQueryCount: number;
  readonly cacheActiveQueryCount: number;
  readonly cacheSerializedBytes: number;
  readonly browserStorageBytes: number;
  readonly jsHeapUsedBytes: number | null;
};

type FailureRecord = {
  readonly dataset: PerformanceDatasetKind;
  readonly profile: DeviceProfile['id'];
  readonly scenario: string;
  readonly cacheProfile: CacheProfile | 'warm-up';
  readonly ordinal: number;
  readonly attempt: number;
  readonly error: string;
  readonly replacementAppended: boolean;
};

type Scenario = {
  readonly id: string;
  readonly zeroProject?: boolean;
  readonly resourcePaths: readonly string[];
  run(
    page: Page,
    context: BrowserContext,
    manifest: PerformanceDatasetManifest,
    cacheProfile: CacheProfile,
  ): Promise<void>;
};

const bridgeCall = async <T>(
  page: Page,
  method:
    | 'cacheSnapshot'
    | 'refetchGlobalShell'
    | 'refetchHome'
    | 'purgeProjectScoped'
    | 'purgeProtectedSession'
    | 'guardMaskedResource'
    | 'activeContext',
): Promise<T> =>
  page.evaluate(async (methodName) => {
    const bridge = (
      window as unknown as {
        __SHOTGUN_PERFORMANCE_BRIDGE__?: Record<string, () => unknown>;
      }
    ).__SHOTGUN_PERFORMANCE_BRIDGE__;
    if (!bridge || typeof bridge[methodName] !== 'function') {
      throw new Error(`Performance bridge method ${methodName} is unavailable.`);
    }
    return await bridge[methodName]();
  }, method) as Promise<T>;

const afterRender = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

const waitForActiveHome = async (page: Page): Promise<void> => {
  try {
    await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
  } catch (error) {
    const safeState = (await page.locator('body').innerText()).slice(0, 800);
    throw new Error(
      `Active Home did not become ready at ${new URL(page.url()).pathname}. Safe UI state: ${safeState}`,
      { cause: error },
    );
  }
  await page.locator('#attention-heading').waitFor();
  await page.waitForFunction(() =>
    Boolean(
      (
        window as unknown as {
          __SHOTGUN_PERFORMANCE_BRIDGE__?: unknown;
        }
      ).__SHOTGUN_PERFORMANCE_BRIDGE__,
    ),
  );
};

const waitForZeroProject = async (page: Page): Promise<void> => {
  await page.getByRole('heading', { name: 'Create your first Project', exact: true }).waitFor();
  await page.waitForFunction(() =>
    Boolean(
      (
        window as unknown as {
          __SHOTGUN_PERFORMANCE_BRIDGE__?: unknown;
        }
      ).__SHOTGUN_PERFORMANCE_BRIDGE__,
    ),
  );
};

const openInitialPage = async (page: Page, zeroProject: boolean): Promise<void> => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  if (zeroProject) await waitForZeroProject(page);
  else await waitForActiveHome(page);
};

const switchToOtherProject = async (page: Page): Promise<void> => {
  const selector = page.locator('#active-project');
  const current = await selector.inputValue();
  const next = current === 'shotgun' ? 'perf-project-0002' : 'shotgun';
  await selector.selectOption(next);
  await page.waitForFunction(
    (expected) =>
      (document.querySelector('#active-project') as HTMLSelectElement | null)?.value === expected,
    next,
  );
  await waitForActiveHome(page);
  await afterRender(page);
};

const scenarios: readonly Scenario[] = [
  {
    id: '01-global-shell-authorized-snapshot',
    resourcePaths: ['/product-api/frontend/global-shell'],
    async run(page, _context, _manifest, cacheProfile) {
      if (cacheProfile === 'warm') {
        await bridgeCall<void>(page, 'refetchGlobalShell');
        await afterRender(page);
      }
    },
  },
  {
    id: '02-zero-project-shell',
    zeroProject: true,
    resourcePaths: ['/product-api/frontend/global-shell'],
    async run(page, _context, _manifest, cacheProfile) {
      if (cacheProfile === 'warm') {
        await bridgeCall<void>(page, 'refetchGlobalShell');
        await afterRender(page);
      }
    },
  },
  {
    id: '03-project-switch-cache-invalidation',
    resourcePaths: [
      '/api/v1/session/active-project',
      '/product-api/frontend/global-shell',
      '/product-api/frontend/home',
    ],
    async run(page) {
      await switchToOtherProject(page);
    },
  },
  {
    id: '04-home-attention-first-page',
    resourcePaths: ['/product-api/frontend/home'],
    async run(page, _context, manifest, cacheProfile) {
      if (cacheProfile === 'warm') await bridgeCall<void>(page, 'refetchHome');
      await page.waitForFunction(
        (expected) =>
          document.querySelectorAll('[aria-labelledby="attention-heading"] ol > li').length ===
          expected,
        manifest.exposedAttentionItems,
      );
      await afterRender(page);
    },
  },
  {
    id: '05-continue-working-and-browser-drafts',
    resourcePaths: ['/product-api/frontend/home'],
    async run(page, _context, manifest) {
      const active = await bridgeCall<{
        readonly projectId: string;
        readonly sessionId: string;
        readonly projectionRevision: string;
      } | null>(page, 'activeContext');
      if (!active) throw new Error('Active performance context is unavailable.');
      await page.evaluate(
        ({ activeContext, draftCount }) => {
          const drafts = Array.from({ length: draftCount }, (_, index) => ({
            draftId: `performance-draft-${String(index + 1).padStart(3, '0')}`,
            origin: 'BROWSER_DRAFT',
            label: `Browser draft ${String(index + 1).padStart(3, '0')}`,
            projectId: activeContext.projectId,
            sessionId: activeContext.sessionId,
            sensitivity: 'private',
            sourceRevision: activeContext.projectionRevision,
            expiresAt: '2099-01-01T00:00:00.000Z',
            targetRoute: { routeId: 'settings', href: '/settings' },
          }));
          sessionStorage.setItem(
            `shotgun:drafts:v1:${activeContext.projectId}:${activeContext.sessionId}`,
            JSON.stringify(drafts),
          );
        },
        { activeContext: active, draftCount: manifest.browserDrafts },
      );
      await bridgeCall<void>(page, 'refetchHome');
      await page.getByText('Browser draft 001', { exact: true }).waitFor();
      await afterRender(page);
    },
  },
  {
    id: '06-notification-summary-refresh',
    resourcePaths: ['/product-api/frontend/global-shell', '/product-api/frontend/home'],
    async run(page) {
      await bridgeCall<void>(page, 'refetchGlobalShell');
      await bridgeCall<void>(page, 'refetchHome');
      await page.locator('#operations-heading').waitFor();
      await afterRender(page);
    },
  },
  {
    id: '07-global-search-and-command-palette',
    resourcePaths: ['/product-api/frontend/search/query'],
    async run(page) {
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.locator('#global-search-query').fill('performance-query-not-published');
      await page
        .getByRole('dialog', { name: 'Search' })
        .getByRole('button', { name: 'Search', exact: true })
        .click();
      await page.locator('.search-results > li').first().waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Commands', exact: true }).click();
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
      await afterRender(page);
      await page
        .getByRole('dialog', { name: 'Command palette' })
        .getByRole('button', {
          name: 'Close',
          exact: true,
        })
        .click();
    },
  },
  {
    id: '08-route-guard-masked-decision',
    resourcePaths: ['/product-api/frontend/route-guard'],
    async run(page) {
      await bridgeCall<void>(page, 'guardMaskedResource');
      await afterRender(page);
    },
  },
  {
    id: '09-revision-cache-purge',
    resourcePaths: [
      '/api/v1/session/active-project',
      '/product-api/frontend/global-shell',
      '/product-api/frontend/home',
    ],
    async run(page) {
      await switchToOtherProject(page);
      const cache = await bridgeCall<CacheSnapshot>(page, 'cacheSnapshot');
      if (cache.queryCount === 0) throw new Error('Authorized cache did not recover after purge.');
    },
  },
  {
    id: '10-offline-degraded-transition',
    resourcePaths: [],
    async run(page, context) {
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page
        .getByRole('alert')
        .getByText(/Offline/)
        .waitFor();
      await afterRender(page);
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    },
  },
];

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const contentType = (filePath: string): string => {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
};

const readRequestBody = async (request: IncomingMessage): Promise<Buffer | undefined> => {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const forward = async (
  request: IncomingMessage,
  response: ServerResponse,
  backendPort: number,
): Promise<void> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === 'content-length' || name === 'connection') continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const targetOrigin = `http://127.0.0.1:${backendPort}`;
  headers.set('host', `127.0.0.1:${backendPort}`);
  if (headers.has('origin')) headers.set('origin', targetOrigin);
  if (headers.has('referer')) {
    headers.set('referer', `${targetOrigin}${new URL(headers.get('referer')!).pathname}`);
  }
  const body = await readRequestBody(request);
  const upstream = await fetch(`${targetOrigin}${request.url ?? '/'}`, {
    method: request.method,
    headers,
    ...(body && body.byteLength > 0 ? { body: body.toString('utf8') } : {}),
    redirect: 'manual',
  });
  const payload = Buffer.from(await upstream.arrayBuffer());
  for (const [name, value] of upstream.headers) {
    if (
      name === 'content-length' ||
      name === 'content-encoding' ||
      name === 'transfer-encoding' ||
      name === 'set-cookie'
    ) {
      continue;
    }
    response.setHeader(name, value);
  }
  const setCookies = upstream.headers.getSetCookie();
  if (setCookies.length > 0) response.setHeader('set-cookie', setCookies);
  response.statusCode = upstream.status;
  response.setHeader('content-length', payload.byteLength);
  response.end(payload);
};

const startProductionProxy = async (
  repositoryRoot: string,
): Promise<{ close(): Promise<void> }> => {
  const distRoot = path.resolve(repositoryRoot, 'apps/shotgun-web/dist');
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', BASE_URL);
      if (
        requestUrl.pathname.startsWith('/api/') ||
        requestUrl.pathname.startsWith('/product-api/') ||
        requestUrl.pathname === '/health'
      ) {
        const zeroProject = (request.headers.cookie ?? '')
          .split(';')
          .some((part) => part.trim() === 'shotgun_perf_backend=zero');
        await forward(request, response, zeroProject ? ZERO_BACKEND_PORT : ACTIVE_BACKEND_PORT);
        return;
      }
      const requested =
        requestUrl.pathname === '/'
          ? 'index.html'
          : decodeURIComponent(requestUrl.pathname.slice(1));
      const candidate = path.resolve(distRoot, requested);
      const safeCandidate = candidate.startsWith(`${distRoot}${path.sep}`) ? candidate : '';
      let filePath = safeCandidate;
      try {
        if (!filePath || !(await stat(filePath)).isFile())
          filePath = path.join(distRoot, 'index.html');
      } catch {
        filePath = path.join(distRoot, 'index.html');
      }
      const payload = await readFile(filePath);
      response.statusCode = 200;
      response.setHeader('content-type', contentType(filePath));
      response.setHeader(
        'cache-control',
        filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      );
      response.setHeader('content-length', payload.byteLength);
      response.end(payload);
    } catch (error) {
      response.statusCode = 502;
      response.end(error instanceof Error ? error.message : 'Proxy failure');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(STATIC_PORT, '127.0.0.1', resolve);
  });
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const runRequiredCommand = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  const executable =
    process.platform === 'win32'
      ? (process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe')
      : command;
  const executableArguments =
    process.platform === 'win32' ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args;
  const result = spawnSync(executable, executableArguments, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status}: ${
        result.error?.message ?? 'no spawn error'
      }.`,
    );
  }
};

const createConfiguredPage = async (
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  profile: DeviceProfile,
  cacheProfile: CacheProfile,
  zeroProject: boolean,
): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: profile.viewport,
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
    serviceWorkers: 'block',
  });
  if (zeroProject) {
    await context.addCookies([
      {
        name: 'shotgun_perf_backend',
        value: 'zero',
        url: BASE_URL,
        sameSite: 'Strict',
      },
    ]);
  }
  await context.addInitScript(() => {
    (
      globalThis as typeof globalThis & {
        __SHOTGUN_PERFORMANCE_METRICS__?: boolean;
      }
    ).__SHOTGUN_PERFORMANCE_METRICS__ = true;
  });
  const page = await context.newPage();
  if (isSmoke) {
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[browser-console] ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      console.error(
        `[request-failed] ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ''}`,
      );
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.error(`[response-${response.status()}] ${new URL(response.url()).pathname}`);
      }
    });
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: cacheProfile === 'cold' });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.network.latencyMs,
    downloadThroughput: (profile.network.downloadMbps * 1024 * 1024) / 8,
    uploadThroughput: (profile.network.uploadMbps * 1024 * 1024) / 8,
    connectionType: profile.id === 'mobile' ? 'cellular3g' : 'wifi',
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottlingRate });
  return { context, page, cdp };
};

const collectMetric = async (
  page: Page,
  cdp: CDPSession,
  scenario: Scenario,
  startedAt: number,
  endedAt: number,
): Promise<
  Omit<RunMetric, 'dataset' | 'profile' | 'scenario' | 'cacheProfile' | 'ordinal' | 'attempt'>
> => {
  const browserMetrics = await page.evaluate(
    ({ start, end, resourcePaths }) => {
      const resources = (
        performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      ).filter(
        (entry) =>
          entry.startTime >= start &&
          resourcePaths.some((resourcePath) => new URL(entry.name).pathname === resourcePath),
      );
      const serverDurations = resources.flatMap((entry) =>
        entry.serverTiming.map((metric) => ({ name: metric.name, duration: metric.duration })),
      );
      const decodeDuration = performance
        .getEntriesByType('measure')
        .filter((entry) => entry.startTime >= start && entry.name.startsWith('shotgun:decode:'))
        .reduce((total, entry) => total + entry.duration, 0);
      const lastResponseEnd =
        resources.length === 0 ? start : Math.max(...resources.map((entry) => entry.responseEnd));
      const firstRequestStart =
        resources.length === 0 ? null : Math.min(...resources.map((entry) => entry.startTime));
      const memory = (
        performance as Performance & {
          memory?: { readonly usedJSHeapSize: number };
        }
      ).memory;
      const storageBytes = [localStorage, sessionStorage].reduce((total, storage) => {
        let bytes = total;
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index) ?? '';
          bytes += new TextEncoder().encode(key).byteLength;
          bytes += new TextEncoder().encode(storage.getItem(key) ?? '').byteLength;
        }
        return bytes;
      }, 0);
      return {
        serverQueryMs:
          serverDurations.filter((metric) => metric.name === 'query').length === 0
            ? null
            : serverDurations
                .filter((metric) => metric.name === 'query')
                .reduce((total, metric) => total + metric.duration, 0),
        projectionCompositionMs:
          serverDurations.filter((metric) => metric.name === 'projection').length === 0
            ? null
            : serverDurations
                .filter((metric) => metric.name === 'projection')
                .reduce((total, metric) => total + metric.duration, 0),
        responseBytes: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
        networkTransferBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
        networkTransferMs:
          firstRequestStart === null
            ? null
            : Math.max(...resources.map((entry) => entry.responseEnd)) - firstRequestStart,
        runtimeDecodeMs: decodeDuration,
        clientRenderMs: Math.max(0, end - lastResponseEnd),
        interactionReadinessMs: Math.max(0, end - start),
        domNodes: document.querySelectorAll('*').length,
        browserStorageBytes: storageBytes,
        browserHeapBytes: memory?.usedJSHeapSize ?? null,
      };
    },
    { start: startedAt, end: endedAt, resourcePaths: scenario.resourcePaths },
  );
  const cache = await bridgeCall<CacheSnapshot>(page, 'cacheSnapshot');
  const cdpMetrics = (await cdp.send('Performance.getMetrics')) as {
    metrics: readonly { readonly name: string; readonly value: number }[];
  };
  const cdpHeap = cdpMetrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
  return {
    serverQueryMs: browserMetrics.serverQueryMs,
    projectionCompositionMs: browserMetrics.projectionCompositionMs,
    responseBytes: browserMetrics.responseBytes,
    networkTransferBytes: browserMetrics.networkTransferBytes,
    networkTransferMs: browserMetrics.networkTransferMs,
    runtimeDecodeMs: browserMetrics.runtimeDecodeMs,
    clientRenderMs: browserMetrics.clientRenderMs,
    interactionReadinessMs: browserMetrics.interactionReadinessMs,
    domNodes: browserMetrics.domNodes,
    cacheQueryCount: cache.queryCount,
    cacheActiveQueryCount: cache.activeQueryCount,
    cacheSerializedBytes: cache.serializedBytes,
    browserStorageBytes: browserMetrics.browserStorageBytes,
    jsHeapUsedBytes: cdpHeap ?? browserMetrics.browserHeapBytes,
  };
};

const runIteration = async (
  page: Page,
  context: BrowserContext,
  cdp: CDPSession,
  scenario: Scenario,
  manifest: PerformanceDatasetManifest,
  cacheProfile: CacheProfile,
): Promise<
  Omit<RunMetric, 'dataset' | 'profile' | 'scenario' | 'cacheProfile' | 'ordinal' | 'attempt'>
> => {
  let startedAt = 0;
  if (cacheProfile === 'cold') {
    await page.evaluate(() => {
      performance.clearResourceTimings();
      performance.clearMeasures();
    });
    await openInitialPage(page, Boolean(scenario.zeroProject));
  } else {
    startedAt = await page.evaluate(() => {
      performance.clearResourceTimings();
      performance.clearMeasures();
      return performance.now();
    });
  }
  await scenario.run(page, context, manifest, cacheProfile);
  const endedAt = await page.evaluate(() => performance.now());
  return collectMetric(page, cdp, scenario, startedAt, endedAt);
};

const summarizeNumbers = (values: readonly number[]) => {
  if (values.length === 0) return { validRuns: 0, median: null, p95: null, values: [] };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return {
    validRuns: sorted.length,
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    values: sorted,
  };
};

const summarizeRuns = (runs: readonly RunMetric[]) => {
  const metricNames = [
    'serverQueryMs',
    'projectionCompositionMs',
    'responseBytes',
    'networkTransferBytes',
    'networkTransferMs',
    'runtimeDecodeMs',
    'clientRenderMs',
    'interactionReadinessMs',
    'domNodes',
    'cacheQueryCount',
    'cacheActiveQueryCount',
    'cacheSerializedBytes',
    'browserStorageBytes',
    'jsHeapUsedBytes',
  ] as const;
  const groups = new Map<string, RunMetric[]>();
  for (const run of runs) {
    const key = [run.dataset, run.profile, run.scenario, run.cacheProfile].join('|');
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.entries()].map(([key, groupedRuns]) => {
    const [dataset, profile, scenario, cacheProfile] = key.split('|');
    return {
      dataset,
      profile,
      scenario,
      cacheProfile,
      metrics: Object.fromEntries(
        metricNames.map((metric) => [
          metric,
          summarizeNumbers(
            groupedRuns.flatMap((run) =>
              typeof run[metric] === 'number' ? [run[metric] as number] : [],
            ),
          ),
        ]),
      ),
    };
  });
};

const bundleInventory = async (repositoryRoot: string) => {
  const assetsRoot = path.join(repositoryRoot, 'apps/shotgun-web/dist/assets');
  const entries = await readdir(assetsRoot);
  return Promise.all(
    entries.sort().map(async (name) => {
      const payload = await readFile(path.join(assetsRoot, name));
      return { name, bytes: payload.byteLength, sha256: sha256(payload) };
    }),
  );
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sanitizeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/performance-query-not-published/gi, '[REDACTED_QUERY]')
    .replace(/shotgun_session=[^;\s]+/gi, 'shotgun_session=[REDACTED]');
};

const npmVersion = (): string => {
  const fromUserAgent = process.env.npm_config_user_agent?.match(/\bnpm\/([^\s]+)/)?.[1];
  if (fromUserAgent) return fromUserAgent;
  if (process.platform === 'win32') {
    return execFileSync(
      process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd --version'],
      {
        encoding: 'utf8',
      },
    ).trim();
  }
  return execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
};

const main = async (): Promise<void> => {
  const repositoryRoot = process.cwd();
  if (shouldWriteCanonical) {
    runRequiredCommand('npm.cmd', ['run', 'db:reset']);
  }
  runRequiredCommand('npm.cmd', ['run', 'frontend:build'], {
    ...process.env,
    VITE_E2E_TEST_BRIDGE: 'true',
  });

  const outputRoot = shouldWriteCanonical
    ? path.join(
        repositoryRoot,
        'artifacts/performance/frontend-phase-1-section-3',
        ARTIFACT_SEQUENCE,
      )
    : path.join(repositoryRoot, '.tmp-performance-smoke');
  await mkdir(outputRoot, { recursive: true });

  const selectedDatasets: readonly PerformanceDatasetKind[] = isSmoke
    ? ['representative']
    : ['representative', 'stress'];
  const selectedProfiles = isSmoke ? profiles.slice(0, 1) : profiles;
  const selectedScenarios = isSmoke ? scenarios.slice(0, 2) : scenarios;
  const warmupCount = isSmoke ? 0 : 3;
  const coldCount = isSmoke ? 1 : 5;
  const warmCount = isSmoke ? 1 : 10;
  const failures: FailureRecord[] = [];
  const runs: RunMetric[] = [];
  const browser = await chromium.launch({ headless: true });
  const browserVersion = browser.version();

  try {
    for (const datasetKind of selectedDatasets) {
      const manifest = getPerformanceDatasetManifest(datasetKind);
      const activeBackend = await startFrontendPerformanceBackend(manifest, {
        port: ACTIVE_BACKEND_PORT,
      });
      const zeroBackend = await startFrontendPerformanceBackend(manifest, {
        port: ZERO_BACKEND_PORT,
        zeroProject: true,
      });
      const proxy = await startProductionProxy(repositoryRoot);
      try {
        for (const profile of selectedProfiles) {
          for (const scenario of selectedScenarios) {
            for (let ordinal = 1; ordinal <= warmupCount; ordinal += 1) {
              let succeeded = false;
              for (let attempt = 1; attempt <= 2 && !succeeded; attempt += 1) {
                const configured = await createConfiguredPage(
                  browser,
                  profile,
                  'cold',
                  Boolean(scenario.zeroProject),
                );
                try {
                  await runIteration(
                    configured.page,
                    configured.context,
                    configured.cdp,
                    scenario,
                    manifest,
                    'cold',
                  );
                  succeeded = true;
                } catch (error) {
                  failures.push({
                    dataset: datasetKind,
                    profile: profile.id,
                    scenario: scenario.id,
                    cacheProfile: 'warm-up',
                    ordinal,
                    attempt,
                    error: sanitizeError(error),
                    replacementAppended: attempt < 2,
                  });
                  if (attempt === 2) throw error;
                } finally {
                  await configured.context.close();
                }
              }
            }

            for (let ordinal = 1; ordinal <= coldCount; ordinal += 1) {
              let succeeded = false;
              for (let attempt = 1; attempt <= 2 && !succeeded; attempt += 1) {
                const configured = await createConfiguredPage(
                  browser,
                  profile,
                  'cold',
                  Boolean(scenario.zeroProject),
                );
                try {
                  const metric = await runIteration(
                    configured.page,
                    configured.context,
                    configured.cdp,
                    scenario,
                    manifest,
                    'cold',
                  );
                  runs.push({
                    dataset: datasetKind,
                    profile: profile.id,
                    scenario: scenario.id,
                    cacheProfile: 'cold',
                    ordinal,
                    attempt,
                    ...metric,
                  });
                  succeeded = true;
                } catch (error) {
                  failures.push({
                    dataset: datasetKind,
                    profile: profile.id,
                    scenario: scenario.id,
                    cacheProfile: 'cold',
                    ordinal,
                    attempt,
                    error: sanitizeError(error),
                    replacementAppended: attempt < 2,
                  });
                  if (attempt === 2) throw error;
                } finally {
                  await configured.context.close();
                }
              }
            }

            const warm = await createConfiguredPage(
              browser,
              profile,
              'warm',
              Boolean(scenario.zeroProject),
            );
            try {
              await openInitialPage(warm.page, Boolean(scenario.zeroProject));
              for (let ordinal = 1; ordinal <= warmCount; ordinal += 1) {
                let succeeded = false;
                for (let attempt = 1; attempt <= 2 && !succeeded; attempt += 1) {
                  try {
                    const metric = await runIteration(
                      warm.page,
                      warm.context,
                      warm.cdp,
                      scenario,
                      manifest,
                      'warm',
                    );
                    runs.push({
                      dataset: datasetKind,
                      profile: profile.id,
                      scenario: scenario.id,
                      cacheProfile: 'warm',
                      ordinal,
                      attempt,
                      ...metric,
                    });
                    succeeded = true;
                  } catch (error) {
                    failures.push({
                      dataset: datasetKind,
                      profile: profile.id,
                      scenario: scenario.id,
                      cacheProfile: 'warm',
                      ordinal,
                      attempt,
                      error: sanitizeError(error),
                      replacementAppended: attempt < 2,
                    });
                    if (attempt === 2) throw error;
                  }
                }
              }
            } finally {
              await warm.context.close();
            }
          }
        }
      } finally {
        await proxy.close();
        await zeroBackend.close();
        await activeBackend.close();
      }
    }
  } finally {
    await browser.close();
  }

  const environment = {
    schemaVersion: '1.0.0',
    implementationHead: IMPLEMENTATION_HEAD,
    measurementHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim(),
    node: process.version,
    npm: npmVersion(),
    playwright: '1.61.1',
    browser: `Chromium ${browserVersion}`,
    headless: true,
    buildMode: 'production Vite bundle with E2E performance bridge',
    databaseState: shouldWriteCanonical
      ? 'reset through migration 019 before measurement'
      : 'smoke run did not reset database',
    profiles: selectedProfiles,
    warmupCount,
    coldCount,
    warmCount,
    statistics: 'median and nearest-rank P95; no statistical outlier removal',
    command: shouldWriteCanonical
      ? 'npm run frontend:performance:baseline'
      : 'tsx scripts/frontend-section3-performance.ts --smoke',
  };
  const seedManifest = selectedDatasets.map((kind) => {
    const manifest = getPerformanceDatasetManifest(kind);
    return { ...manifest, sha256: performanceDatasetDigest(manifest) };
  });
  const summary = summarizeRuns(runs);
  const bundle = await bundleInventory(repositoryRoot);

  await writeJson(path.join(outputRoot, 'environment.json'), environment);
  await writeJson(path.join(outputRoot, 'seed-manifest.json'), seedManifest);
  await writeJson(path.join(outputRoot, 'raw-runs.json'), runs);
  await writeJson(path.join(outputRoot, 'summary.json'), summary);
  await writeJson(path.join(outputRoot, 'failures.json'), failures);
  await writeJson(path.join(outputRoot, 'bundle.json'), bundle);

  const artifactFiles = [
    'environment.json',
    'seed-manifest.json',
    'raw-runs.json',
    'summary.json',
    'failures.json',
    'bundle.json',
  ];
  const fileDigests = await Promise.all(
    artifactFiles.map(async (name) => {
      const payload = await readFile(path.join(outputRoot, name));
      return { name, bytes: payload.byteLength, sha256: sha256(payload) };
    }),
  );
  const aggregateSha256 = sha256(
    fileDigests.map((file) => `${file.name}:${file.sha256}`).join('\n'),
  );
  await writeJson(path.join(outputRoot, 'artifact-manifest.json'), {
    schemaVersion: '1.0.0',
    aggregateSha256,
    files: fileDigests,
  });

  console.log(
    JSON.stringify({
      status: 'PASS',
      mode: shouldWriteCanonical ? 'canonical' : 'smoke',
      outputRoot,
      runs: runs.length,
      failures: failures.length,
      aggregateSha256,
    }),
  );
};

await main();
