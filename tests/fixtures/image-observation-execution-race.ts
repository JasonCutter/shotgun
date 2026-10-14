import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresImageObservationExecutionRepository } from '../../adapters/image-observation-execution-postgres/src/index.js';
import {
  executeImageObservation,
  type ImageObservationExecutionInput,
} from '../../modules/image-observation-execution/src/index.js';
import { fakeNativeImageExecutor } from '../helpers/image-observation-execution-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  !databaseUrl ||
  !/^shotgun_test_iso_/u.test(new URL(databaseUrl).pathname.slice(1)) ||
  process.env.DEEPSEEK_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.VP_GLOBAL_DATABASE_URL
)
  throw Error('Image race fixture requires an isolated test database and no live credentials');
const pool = createPostgresPool(databaseUrl);
process.on('message', (raw: unknown) => {
  void (async () => {
    const message = raw as {
      type: string;
      input: Omit<ImageObservationExecutionInput, 'imageBytes'> & { imageBytes: number[] };
      crashAfterEgress?: boolean;
    };
    if (message.type !== 'execute') throw Error('Invalid isolated race instruction');
    const input = { ...message.input, imageBytes: Uint8Array.from(message.input.imageBytes) };
    const repository = new PostgresImageObservationExecutionRepository(pool);
    const captured = fakeNativeImageExecutor(async (init) => {
      const record = await repository.read(input.projectId, input.requestId);
      await pool.query(
        'INSERT INTO public.fake_image_egress(call_id,request_body) VALUES ($1,$2)',
        [record!.callId, String(init.body)],
      );
      if (message.crashAfterEgress) process.exit(17);
    });
    const result = await executeImageObservation(input, {
      runtimeProfile: 'runtime-test',
      repository,
      resolver: { resolve: async () => captured },
    });
    await pool.end();
    process.send?.(
      { type: 'result', callId: result.callId, attemptId: result.attemptId, state: result.state },
      () => process.exit(0),
    );
  })().catch(async (error: unknown) => {
    await pool.end();
    process.send?.(
      { type: 'failure', message: error instanceof Error ? error.message : String(error) },
      () => process.exit(1),
    );
  });
});
process.send?.({ type: 'ready' });
