import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LaunchFailure, runLaunch } from '../../scripts/launch-core.ts';
import { createDefaultLaunchDeps } from '../../scripts/launch-default-deps.ts';
import { recoverSourceKnowledgeResetsBeforeRuntime } from '../../scripts/t3-launch-recovery.ts';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number.parseInt(process.env.PORT ?? '0', 10);
let application;
let shutdownRequested = false;
let closing = false;

const sendFailure = (error) => {
  const failure =
    error instanceof LaunchFailure
      ? {
          type: 'startup-failure',
          code: error.code,
          message: error.message,
          check: error.check,
          command: error.command,
        }
      : { type: 'startup-failure', code: 'BACKEND_START_FAILED', message: String(error) };
  process.send?.(failure, () => process.exit(1));
};

const stop = (exitCode) => {
  shutdownRequested = true;
  if (!application || closing) return;
  closing = true;
  void application.close().finally(() => process.exit(exitCode));
};

process.on('message', (message) => {
  if (message?.type === 'shutdown') stop(0);
});
process.once('disconnect', () => {
  if (application) stop(1);
  else process.exit(1);
});

try {
  application = await runLaunch(
    {
      noOpen: true,
      noSignals: true,
      port,
      host: '127.0.0.1',
      spaDirectory: path.join(rootDirectory, 'apps', 'shotgun-web', 'dist'),
      rootDirectory,
      env: process.env,
      environmentProfile: 'runtime-development',
      beforeApplicationStart: async ({ databaseUrl, rootDirectory: runtimeRoot, environment }) => {
        await recoverSourceKnowledgeResetsBeforeRuntime({
          databaseUrl,
          rootDirectory: runtimeRoot,
          environment,
          log: (message) => console.log(message),
        });
      },
    },
    createDefaultLaunchDeps(),
  );
} catch (error) {
  if (!shutdownRequested && process.connected) sendFailure(error);
  else process.exit(1);
}

if (application && !shutdownRequested && process.connected) process.send?.({ type: 'ready' });
else if (application) stop(0);
