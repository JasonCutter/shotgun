import { startShotgunApplication } from '../../../assemblies/shotgun-app/src/application.js';
import { createInterface } from 'node:readline';

const databaseUrl = process.env.SHOTGUN_C4_DATABASE_URL;
const assetRoot = process.env.SHOTGUN_C4_ASSET_ROOT;
const port = Number.parseInt(process.env.SHOTGUN_C4_PORT ?? '0', 10);

if (databaseUrl === undefined || assetRoot === undefined) {
  throw new Error('C4 child requires SHOTGUN_C4_DATABASE_URL and SHOTGUN_C4_ASSET_ROOT.');
}

let closing = false;
const application = await startShotgunApplication({
  databaseUrl,
  assetRoot,
  port,
  host: '127.0.0.1',
  stagingSecret: 'c4-test-staging-secret-012345678901234567890',
  environment: {
    ...process.env,
    NODE_ENV: 'test',
    VITEST: 'true',
  },
  noSignals: true,
  recoveryIntervalMs: false,
  actionFeedbackOutboxIntervalMs: false,
  disableAskWorker: true,
  aiDurableMaterializationRecoveryEnabled: false,
});

const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  try {
    await application.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === 'CLOSE') void close();
});

await application.listen();
const address = application.server.server.address();
if (address === null || typeof address === 'string') {
  throw new Error('C4 child did not receive a TCP listener address.');
}
process.stdout.write(`READY ${JSON.stringify({ pid: process.pid, port: address.port })}\n`);
