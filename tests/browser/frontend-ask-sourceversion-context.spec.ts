import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { tsImport } from 'tsx/esm/api';

type CrossPhaseBackend = {
  startFrontendCrossPhaseBackend(): Promise<{ close(): Promise<void> }>;
};

const BASE = 'http://127.0.0.1:3002';

test('Direct Text SourceVersion executes SOURCE_EXPLORATION without selected Evidence', async () => {
  const fixture = (await tsImport(
    './fixtures/frontend-cross-phase-backend.ts',
    import.meta.url,
  )) as CrossPhaseBackend;
  const backend = await fixture.startFrontendCrossPhaseBackend();

  try {
    const bootstrap = await fetch(`${BASE}/api/v1/session/local-bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(bootstrap.ok).toBe(true);
    const sessionCookie = /shotgun_session=([^;]+)/.exec(
      bootstrap.headers.get('set-cookie') ?? '',
    )?.[1];
    expect(sessionCookie).toBeTruthy();
    const cookie = `shotgun_session=${sessionCookie}`;
    const csrfResponse = await fetch(`${BASE}/api/v1/security/csrf`, { headers: { cookie } });
    const csrfToken = ((await csrfResponse.json()) as { csrfToken?: string }).csrfToken;
    expect(csrfToken).toBeTruthy();

    const mutate = async (path: string, payload?: unknown, rawBody?: string) => {
      const response = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          cookie,
          'x-csrf-token': csrfToken as string,
          'content-type': rawBody === undefined ? 'application/json' : 'application/octet-stream',
        },
        body: rawBody ?? JSON.stringify(payload),
      });
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.ok, JSON.stringify(body)).toBe(true);
      return body;
    };
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetch(`${BASE}${path}`, { headers: { cookie } });
      const body = (await response.json()) as T;
      expect(response.ok, JSON.stringify(body)).toBe(true);
      return body;
    };
    const requestId = () => randomUUID();
    const projectId = `source-context-${randomUUID()}`;
    const command = (commandType: string, activeProjectId: string, payload: unknown) => ({
      envelopeVersion: '1.0.0',
      commandType,
      commandSchemaVersion: '1.0.0',
      clientRequestId: requestId(),
      idempotencyKey: requestId(),
      projectContext: {
        activeProjectId,
        targetProjectId: activeProjectId,
        resourceProjectId: activeProjectId,
      },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [],
      clientIssuedAt: new Date().toISOString(),
      payload,
    });

    await mutate(
      '/api/v1/projects',
      command('project.create.v1', 'shotgun', {
        newProjectId: projectId,
        name: 'SourceVersion Context',
        description: 'Targeted SourceVersion-ready Ask verification',
      }),
    );
    await mutate('/api/v1/session/active-project', { projectId });

    const sourceText =
      '2026-08-11 Shotgun local execution completed. The first project was JasonNote.';
    const draftId = `draft-${randomUUID()}`;
    const itemId = `item-${randomUUID()}`;
    const stageQuery = new URLSearchParams({
      draftId,
      itemId,
      kind: 'DIRECT_TEXT',
      label: 'JasonNote first memo',
      mediaType: 'text/plain',
    });
    const staged = await mutate(
      `/product-api/frontend/sources/staging/bytes?${stageQuery}`,
      undefined,
      sourceText,
    );
    const stagingReference = (staged as { receipt?: { stagingReference?: string } }).receipt
      ?.stagingReference;
    expect(stagingReference).toBeTruthy();
    const submitted = await mutate(
      '/product-api/frontend/sources/submissions',
      command('sources.intake.submit.v1', projectId, {
        draftId,
        inputs: [
          {
            itemId,
            kind: 'DIRECT_TEXT',
            label: 'JasonNote first memo',
            stagingReference,
          },
        ],
      }),
    );
    const submissionId = (submitted as { submission?: { submissionId?: string } }).submission
      ?.submissionId;
    expect(submissionId).toBeTruthy();
    let submissionState = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const view = await get<{ submission?: { state?: string } }>(
        `/product-api/frontend/sources/submissions/${submissionId}`,
      );
      submissionState = view.submission?.state ?? '';
      if (submissionState === 'SUCCEEDED') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(submissionState).toBe('SUCCEEDED');

    const library = await mutate('/product-api/frontend/sources/query', {
      schemaVersion: '1.0.0',
      filters: {},
      sort: 'UPDATED_DESC',
      limit: 20,
    });
    const source = (
      library as {
        page?: {
          items?: { sourceId?: string; selectedSourceVersionId?: string; askUsageState?: string }[];
        };
      }
    ).page?.items?.[0];
    expect(source?.askUsageState).toBe('SOURCE_VERSION_READY');
    expect(source?.sourceId).toBeTruthy();
    expect(source?.selectedSourceVersionId).toBeTruthy();

    const asked = await mutate('/product-api/frontend/ask/questions', {
      schemaVersion: '1.0.0',
      clientRequestId: requestId(),
      idempotencyKey: requestId(),
      question: 'When was Shotgun first run, and what was the first project?',
      mode: 'SOURCE_EXPLORATION',
      sourceSelections: [
        {
          sourceId: source?.sourceId,
          sourceVersionId: source?.selectedSourceVersionId,
          evidenceIds: [],
        },
      ],
    });
    const answerRunId = (asked as { submission?: { answerRun?: { answerRunId?: string } } })
      .submission?.answerRun?.answerRunId;
    expect(answerRunId).toBeTruthy();

    let completed:
      | {
          state?: string;
          statements?: { text?: string; citations?: unknown[] }[];
          provider?: { provider?: string };
        }
      | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const view = await get<{
        answerRun?: {
          state?: string;
          statements?: { text?: string; citations?: unknown[] }[];
          provider?: { provider?: string };
        };
      }>(`/product-api/frontend/ask/answer-runs/${answerRunId}`);
      completed = view.answerRun;
      if (['SUCCEEDED', 'FAILED'].includes(completed?.state ?? '')) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(completed?.state).toBe('SUCCEEDED');
    expect(completed?.provider?.provider).toBe('fake');
    expect(completed?.statements?.[0]?.text).toContain(sourceText);
    expect(completed?.statements?.[0]?.citations).toEqual([]);
  } finally {
    await backend.close();
  }
});
