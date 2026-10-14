import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  createVPFullApplicationFixture,
  waitForProduct,
} from '../helpers/vp-full-application-fixture.js';
import type { AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const target = await requireTestDatabaseTarget();

const observations = (run: AskAnswerRunSnapshot) =>
  run.statements.flatMap((statement) => statement.generatedObservationReferences ?? []);
it.skipIf(!target)(
  'uses the normal application image intake/worker/Ask/read path with Fake transport and immutable historical references',
  async () => {
    let imageCalls = 0;
    const f = await createVPFullApplicationFixture({
      imageObservationFakeHttp: async (_url, init) => {
        imageCalls++;
        const payload = JSON.parse(String(init?.body));
        expect(payload.model).toBe('deepseek-flash');
        expect(JSON.stringify(payload)).toContain('data:image/');
        return new Response(
          JSON.stringify({
            id: `fake-image-${imageCalls}`,
            model: 'deepseek-flash',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    observationText: `미검증 이미지 관측 ${imageCalls} 😀. Quasar archive diagram.`,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
      answerFake: async (request) => {
        const prompt = JSON.parse(request.prompt) as {
          context: {
            kind: string;
            observationRef?: string;
            citationRef?: string;
            observationText?: string;
          }[];
        };
        const generated = prompt.context.filter(
          (item) => item.kind === 'GENERATED_IMAGE_OBSERVATION',
        );
        expect(generated.length).toBeGreaterThan(0);
        return {
          rawText: JSON.stringify({
            answer: `미검증 AI 해석: ${generated.map((item) => item.observationText).join(' ')}`,
            citations: prompt.context
              .filter((item) => item.kind === 'EVIDENCE')
              .map((item) => ({ citationRef: item.citationRef })),
            generatedObservationReferences: generated.map((item) => ({
              observationRef: item.observationRef,
            })),
            answerDisposition: 'SUPPORTED',
          }),
          providerResponseId: `fake-image-answer-${randomUUID()}`,
        };
      },
    });
    try {
      const submitImage = async (file: string, sourceId?: string) => {
        const original = await readFile('tests/fixtures/stage-8/golden.png');
        // Same pixels, different immutable source bytes: this verifies version
        // authority rather than pretending Fake captions measure visual accuracy.
        const bytes = sourceId
          ? Buffer.concat([original, Buffer.from('\nversion-two-test-fixture')])
          : original;
        const draftId = randomUUID(),
          itemId = randomUUID(),
          mediaType = 'image/png';
        const query = new URLSearchParams({
          draftId,
          itemId,
          kind: 'FILE',
          label: file,
          fileName: file,
          mediaType,
        });
        const staged = await f.request<{ receipt: { stagingReference: string } }>(
          'POST',
          `/product-api/frontend/sources/staging/bytes?${query}`,
          bytes,
        );
        const result = await f.submitStaged(draftId, [
          {
            itemId,
            kind: 'FILE',
            label: file,
            fileName: file,
            mediaType,
            stagingReference: staged.receipt.stagingReference,
            ...(sourceId ? { requestedSourceId: sourceId } : {}),
          },
        ]);
        return {
          ...result,
          bytes,
          hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        };
      };
      const a = await submitImage('golden.png');
      const progress = (
        await f.pool.query(
          'SELECT state, indexing_result_id FROM source_product.source_stage3_progress WHERE source_version_id=$1',
          [a.sourceVersionId],
        )
      ).rows[0];
      expect(progress).toMatchObject({
        state: 'IMAGE_OBSERVATION_COMPLETED',
        indexing_result_id: null,
      });
      expect(
        (
          await f.pool.query(
            'SELECT count(*)::int AS count FROM evidence.spans WHERE source_version_id=$1',
            [a.sourceVersionId],
          )
        ).rows[0]?.count,
      ).toBe(0);
      const old = await f.ask('Describe the quasar archive diagram.');
      expect(old.statements.flatMap((statement) => statement.citations)).toEqual([]);
      expect(observations(old)).toHaveLength(1);
      expect(observations(old)[0]).toMatchObject({
        sourceVersionId: a.sourceVersionId,
        sourceContentHash: a.hash,
        semanticStatus: 'UNVERIFIED',
      });
      expect(imageCalls).toBe(1);
      expect(old.capabilities).toEqual(['EXPORT']);
      const originalImage = await f.requestOriginalImage(a.sourceId, a.sourceVersionId);
      expect(originalImage.statusCode).toBe(200);
      expect(originalImage.headers['cache-control']).toBe('private, no-store');
      expect(originalImage.rawPayload).toEqual(a.bytes);
      const persisted = (
        await f.pool.query(
          'SELECT to_jsonb(s) AS stored FROM frontend_ask.statements s WHERE answer_run_id=$1 ORDER BY ordinal',
          [old.answerRunId],
        )
      ).rows;
      const b = await f.submit('The quasar archive contains 43 records.', 'B.txt');
      const mixed = await f.ask('Describe the quasar archive diagram and records.');
      expect(
        mixed.statements
          .flatMap((statement) => statement.citations)
          .some((citation) => citation.sourceVersionId === b.sourceVersionId),
      ).toBe(true);
      expect(observations(mixed)[0]?.sourceVersionId).toBe(a.sourceVersionId);
      expect((await f.getAnswer(old.answerRunId)).stale).toBe(false);
      const currentImage = await submitImage('updated.png', a.sourceId);
      const current = await f.ask('Describe the quasar archive diagram.');
      expect(observations(current).map((reference) => reference.sourceVersionId)).toEqual([
        currentImage.sourceVersionId,
      ]);
      expect(
        observations(current).some((reference) => reference.sourceVersionId === a.sourceVersionId),
      ).toBe(false);
      const historical = await f.getAnswer(old.answerRunId);
      expect(historical.stale).toBe(true);
      expect(historical.state).toBe('SUCCEEDED');
      expect(historical.statements).toEqual(old.statements);
      expect((await f.getAnswer(current.answerRunId)).stale).toBe(false);
      expect(
        (
          await f.pool.query(
            'SELECT to_jsonb(s) AS stored FROM frontend_ask.statements s WHERE answer_run_id=$1 ORDER BY ordinal',
            [old.answerRunId],
          )
        ).rows,
      ).toEqual(persisted);
      expect(imageCalls).toBe(2);
      const historicalImage = await f.requestOriginalImage(a.sourceId, a.sourceVersionId);
      expect(historicalImage.statusCode).toBe(200);
      expect(historicalImage.rawPayload).toEqual(a.bytes);
      f.assertNoLiveEgress();
    } finally {
      await f.cleanup();
    }
  },
  120_000,
);

it.skipIf(!target)(
  'waits on the same AnswerRun for image readiness and preserves an unknown image outcome without another call',
  async () => {
    let calls = 0,
      unknown = false,
      release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await createVPFullApplicationFixture({
      imageObservationFakeHttp: async () => {
        calls++;
        if (unknown) throw new Error('Authored Fake response-loss crash window');
        await held;
        return new Response(
          JSON.stringify({
            id: 'fake-held-image',
            model: 'deepseek-flash',
            choices: [
              { message: { content: '{"observationText":"Unverified quasar archive diagram."}' } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
      answerFake: async (request) => {
        const prompt = JSON.parse(request.prompt);
        return {
          rawText: JSON.stringify({
            answer: 'Unverified image interpretation only.',
            citations: [],
            generatedObservationReferences: prompt.context
              .filter((item: { kind: string }) => item.kind === 'GENERATED_IMAGE_OBSERVATION')
              .map((item: { observationRef: string }) => ({ observationRef: item.observationRef })),
            answerDisposition: 'SUPPORTED',
          }),
        };
      },
    });
    try {
      const stage = async (sourceId?: string) => {
        const original = await readFile('tests/fixtures/stage-8/golden.png');
        const bytes = sourceId
          ? Buffer.concat([original, Buffer.from('\nunknown-version-fixture')])
          : original;
        const draftId = randomUUID(),
          itemId = randomUUID();
        const query = new URLSearchParams({
          draftId,
          itemId,
          kind: 'FILE',
          label: 'held.png',
          fileName: 'held.png',
          mediaType: 'image/png',
        });
        const staged = await f.request<{ receipt: { stagingReference: string } }>(
          'POST',
          `/product-api/frontend/sources/staging/bytes?${query}`,
          bytes,
        );
        return {
          draftId,
          inputs: [
            {
              itemId,
              kind: 'FILE',
              label: 'held.png',
              fileName: 'held.png',
              mediaType: 'image/png',
              stagingReference: staged.receipt.stagingReference,
              ...(sourceId ? { requestedSourceId: sourceId } : {}),
            },
          ],
        };
      };
      const staged = await stage();
      const submission = f.submitStaged(staged.draftId, staged.inputs).then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      await waitForProduct(async () => (calls === 1 ? true : undefined), 'image Fake entered');
      const runId = await f.startAsk('Describe the quasar archive diagram.');
      const waiting = await waitForProduct(async () => {
        const snapshot = await f.getAnswer(runId);
        return snapshot.state === 'QUEUED' ? snapshot : undefined;
      }, 'image Ask waiting');
      expect(waiting.attemptNumber ?? 0).toBe(0);
      expect(f.calls.filter((call) => call.kind === 'answer')).toHaveLength(0);
      release();
      const submitted = await submission;
      if (submitted.error) throw submitted.error;
      const source = submitted.value!;
      const answer = await f.waitAnswer(runId);
      expect(answer.answerRunId).toBe(runId);
      expect(observations(answer)[0]?.sourceVersionId).toBe(source.sourceVersionId);
      unknown = true;
      const failing = await stage(source.sourceId);
      const failedRequest = await f.requestRaw(
        'POST',
        '/product-api/frontend/sources/submissions',
        f.command({
          draftId: failing.draftId,
          duplicateHandling: 'AUTOMATIC',
          inputs: failing.inputs,
        }),
      );
      expect(failedRequest.statusCode).toBe(503);
      expect(failedRequest.json()).toMatchObject({
        code: 'OUTCOME_UNKNOWN',
        category: 'OUTCOME_UNKNOWN',
        recovery: 'RESOLVE_EXISTING_OUTCOME',
      });
      const latest = (
        await f.pool.query(
          'SELECT source_version_id::text FROM asset.source_versions WHERE source_id=$1 ORDER BY version_number DESC LIMIT 1',
          [source.sourceId],
        )
      ).rows[0]!.source_version_id;
      expect(
        (
          await f.pool.query(
            'SELECT state FROM ai.image_observation_executions WHERE source_version_id=$1',
            [latest],
          )
        ).rows[0]?.state,
      ).toBe('OUTCOME_UNKNOWN');
      expect(
        (
          await f.pool.query(
            'SELECT state FROM source_product.source_stage3_progress WHERE source_version_id=$1',
            [latest],
          )
        ).rows[0]?.state,
      ).toBe('RECONCILIATION_REQUIRED');
      expect(
        (
          await f.pool.query(
            'SELECT count(*)::int AS n FROM vp.image_observations WHERE source_version_id=$1',
            [latest],
          )
        ).rows[0]?.n,
      ).toBe(0);
      expect((await f.getAnswer(runId)).stale).toBe(true);
      expect(calls).toBe(2);
      f.assertNoLiveEgress();
    } finally {
      release();
      await f.cleanup();
    }
  },
  120_000,
);
