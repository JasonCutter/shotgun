import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { expect, vi } from 'vitest';
import * as application from '../../assemblies/shotgun-app/src/application.js';
import type { ShotgunApplicationHandle } from '../../assemblies/shotgun-app/src/application.js';
import type { createVPFullApplicationFixture } from '../helpers/vp-full-application-fixture.js';

type HttpInjection = {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
};

/** The existing audited fixture's requests cross a real loopback HTTP socket. */
const requestThroughHttp = (
  app: ShotgunApplicationHandle,
  input: HttpInjection,
  observe: () => void,
) =>
  new Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
    json: <T>() => T;
  }>((resolve, reject) => {
    const address = app.server.server.address();
    if (!address || typeof address === 'string')
      return reject(new Error('Artifact application has no TCP listener.'));
    const url = new URL(input.url ?? '/', `http://127.0.0.1:${address.port}`);
    if (url.hostname !== '127.0.0.1' || Number(url.port) !== address.port)
      return reject(
        new Error('Artifact HTTP transport must remain on its owned loopback listener.'),
      );
    const bytes =
      input.payload === undefined
        ? undefined
        : Buffer.isBuffer(input.payload)
          ? input.payload
          : Buffer.from(JSON.stringify(input.payload));
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.headers ?? {}))
      if (value !== undefined) headers[key] = String(value);
    if (bytes) {
      headers['content-length'] = String(bytes.length);
      headers['content-type'] ??= Buffer.isBuffer(input.payload)
        ? 'application/octet-stream'
        : 'application/json';
    }
    observe();
    const request = httpRequest(url, { method: input.method ?? 'GET', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (bytes: Buffer) => chunks.push(bytes));
      response.once('error', reject);
      response.once('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode ?? 0) >= 400)
          return reject(
            new Error(
              `Artifact HTTP ${input.method ?? 'GET'} ${url.pathname} failed (${response.statusCode}): ${body}`,
            ),
          );
        resolve({
          statusCode: response.statusCode ?? 0,
          body,
          headers: response.headers as Record<string, string | string[] | undefined>,
          json: <T>() => JSON.parse(body) as T,
        });
      });
    });
    request.setTimeout(30_000, () =>
      request.destroy(new Error('Artifact HTTP request timed out.')),
    );
    request.once('error', reject);
    request.end(bytes);
  });

export const runInstalledProductJourney = async (): Promise<void> => {
  if (process.env.VP_INSTALLED_APPLICATION_PROOF !== 'true')
    throw new Error('This fixture may run only inside the installed application proof.');
  let httpRequests = 0;
  const actualStart = application.startShotgunApplication;
  const start = vi
    .spyOn(application, 'startShotgunApplication')
    .mockImplementation(async (options) => {
      const app = await actualStart({
        ...options,
        spaDirectory: path.join(process.cwd(), 'apps/shotgun-web/dist'),
      });
      // Only the test transport is replaced. Every request traverses the actual
      // listener and routes; composition, workers and domain services are real.
      Object.defineProperty(app.server, 'inject', {
        value: (input: HttpInjection) =>
          requestThroughHttp(app, input, () => {
            httpRequests += 1;
          }),
      });
      return app;
    });
  let fixture: Awaited<ReturnType<typeof createVPFullApplicationFixture>> | undefined;
  try {
    const { createVPFullApplicationFixture, answerCitations, waitForProduct } =
      await import('../helpers/vp-full-application-fixture.js');
    fixture = await createVPFullApplicationFixture();
    const f = fixture;
    const question = 'What are the quasar archive count and access conditions?';
    const a = await f.submit('The quasar archive contains 42 records.', 'A.txt');
    const old = await f.ask(question);
    expect(
      answerCitations(old).some((citation) => citation.sourceVersionId === a.sourceVersionId),
    ).toBe(true);
    const b = await f.submit('The quasar archive is accessible only to licensed users.', 'B.txt');
    const both = await f.ask(question);
    expect(
      answerCitations(both).some((citation) => citation.sourceVersionId === a.sourceVersionId),
    ).toBe(true);
    expect(
      answerCitations(both).some((citation) => citation.sourceVersionId === b.sourceVersionId),
    ).toBe(true);
    const revised = await f.submit('The quasar archive contains 43 records.', 'A.txt', a.sourceId);
    expect(revised.sourceId).toBe(a.sourceId);
    expect(revised.sourceVersionId).not.toBe(a.sourceVersionId);
    const current = await f.ask(question);
    const citations = answerCitations(current);
    expect(citations.some((citation) => citation.sourceVersionId === revised.sourceVersionId)).toBe(
      true,
    );
    expect(citations.some((citation) => citation.sourceVersionId === b.sourceVersionId)).toBe(true);
    expect(citations.some((citation) => citation.sourceVersionId === a.sourceVersionId)).toBe(
      false,
    );
    expect(JSON.stringify(current.statements)).not.toContain('42 records');
    const historical = await f.getAnswer(old.answerRunId);
    expect(historical.stale).toBe(true);
    expect(historical.statements).toEqual(old.statements);
    expect(historical.answerRevision).toBe(old.answerRevision);
    expect(historical.capabilities).toEqual(old.capabilities);
    expect((await f.getAnswer(current.answerRunId)).stale).toBe(false);
    await waitForProduct(
      async () => (f.calls.some((call) => call.kind === 'relation') ? true : undefined),
      'installed artifact normal relation worker',
      75_000,
    );
    expect(f.calls.filter((call) => call.kind === 'answer')).toHaveLength(3);
    expect(httpRequests).toBeGreaterThan(15);
    for (const citation of citations) {
      expect(
        (
          await f.pool.query(
            'SELECT project_id, source_id::text, source_version_id::text FROM evidence.spans WHERE evidence_id=$1',
            [citation.evidenceId],
          )
        ).rows[0],
      ).toMatchObject({
        project_id: f.projectId,
        source_id: citation.sourceId,
        source_version_id: citation.sourceVersionId,
      });
    }
    const claims = (
      await f.pool.query(
        'SELECT call.global_claim_id, call.semantic_attempt_id, job.policy_revision FROM vp.relation_provider_calls call JOIN vp.relation_jobs job USING(project_id,job_id) WHERE call.project_id=$1',
        [f.projectId],
      )
    ).rows;
    expect(claims.length).toBeGreaterThan(0);
    expect(
      claims.every(
        (claim) =>
          claim.global_claim_id &&
          claim.semantic_attempt_id &&
          claim.policy_revision === 'vp-deepseek-relation-v6-evidence-context',
      ),
    ).toBe(true);
    f.assertNoLiveEgress();
    console.log(
      JSON.stringify({
        proof: 'INSTALLED_ARTIFACT_NORMAL_PRODUCT_HTTP_FAKE_ONLY',
        httpRequests,
        sourcesSubmitted: 3,
        questionsSubmitted: 3,
        askWorkerStarted: f.app.askWorkerStarted,
        fakeCalls: f.calls.reduce<Record<string, number>>((counts, call) => {
          counts[call.kind] = (counts[call.kind] ?? 0) + 1;
          return counts;
        }, {}),
        liveProviderCalls: 0,
        latestCitationsVerified: true,
        historicalAnswerImmutable: true,
        sourceRevisionUsesExplicitMaterialIdentity: true,
        realDeepSeekSemanticQualityCertified: false,
      }),
    );
  } finally {
    try {
      await fixture?.cleanup();
    } finally {
      start.mockRestore();
    }
  }
};
