import os from 'node:os';
import path from 'node:path';

import 'dotenv/config';

import {
  initializeSourceErasureJournal,
  sourceErasureJournalConfigFromEnvironment,
} from './source-erasure-journal.js';

const command = process.argv[2];
if (command !== 'init') {
  throw new Error('Use: npm run t3:erasure-journal:init');
}
const config = sourceErasureJournalConfigFromEnvironment();
if (!config) {
  throw new Error(
    'Set SHOTGUN_ERASURE_JOURNAL_ROOT and SHOTGUN_ERASURE_JOURNAL_HMAC_KEY before initialization.',
  );
}
const backupRoot = path.resolve(
  process.env.SHOTGUN_BACKUP_ROOT ?? path.join(os.homedir(), 'Shotgun Backups'),
);
await initializeSourceErasureJournal(config, backupRoot);
console.log('External T3 erasure journal initialized and separated from the backup root.');
