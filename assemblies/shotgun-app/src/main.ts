/**
 * Shotgun Backend entrypoint.
 *
 * The canonical production composition lives in `startShotgunApplication`
 * (LPA-WP4 D08) and is reused by the owner launcher (`scripts/launch-local.ts`).
 * This entry only starts it and waits for listen; SIGINT/SIGTERM shutdown is
 * handled idempotently by the runtime boundary (LPA-WP4 D09).
 */
import { startShotgunApplication } from './application.js';

const application = await startShotgunApplication();
await application.listen();
