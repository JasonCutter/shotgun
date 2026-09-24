import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendSourceErasureJournalRecord,
  assertBackupKnowledgeEpochsAllowed,
  initializeSourceErasureJournal,
  readSourceErasureJournal,
  SourceErasureJournalError,
  verifyBackupKnowledgeEpochBarrier,
  type SourceErasureJournalConfig,
} from '../../scripts/source-erasure-journal.js';

const roots: string[] = [];
const configFor = (root: string): SourceErasureJournalConfig => ({
  root,
  hmacKey: 'test-only-hmac-key-material-at-least-32-bytes-long',
});

const createRoots = async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-erasure-journal-'));
  roots.push(base);
  const journalRoot = path.join(base, 'journal');
  const backupRoot = path.join(base, 'backups');
  const config = configFor(journalRoot);
  await initializeSourceErasureJournal(config, backupRoot);
  return { base, journalRoot, backupRoot, config };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ADR-171 external erasure journal', () => {
  it('fsyncs a chained PREPARED/VERIFIED history without content fields', async () => {
    const { config, backupRoot, journalRoot } = await createRoots();
    const prepared = await appendSourceErasureJournalRecord({
      config,
      backupRoot,
      projectId: 'project-a',
      knowledgeEpoch: 1,
      requestId: 'reset-a',
      phase: 'PREPARED',
      now: () => new Date('2026-09-23T00:00:00.000Z'),
    });
    const verified = await appendSourceErasureJournalRecord({
      config,
      backupRoot,
      projectId: 'project-a',
      knowledgeEpoch: 1,
      requestId: 'reset-a',
      phase: 'VERIFIED',
      now: () => new Date('2026-09-23T00:01:00.000Z'),
    });

    expect(prepared.phase).toBe('PREPARED');
    expect(verified).toMatchObject({
      phase: 'VERIFIED',
      sequence: 2,
      previousHmac: prepared.hmac,
      projectId: 'project-a',
      knowledgeEpoch: 1,
      requestId: 'reset-a',
    });
    expect(await readSourceErasureJournal(config)).toEqual([prepared, verified]);
    const serialized = await readFile(
      path.join(journalRoot, 'source-erasure-journal.jsonl'),
      'utf8',
    );
    expect(serialized).not.toMatch(/filename|sourceText|prompt|quote|contentHash/iu);
  });

  it('recovers exact retries but rejects mismatched identity and invalid transitions', async () => {
    const { config, backupRoot } = await createRoots();
    const input = {
      config,
      backupRoot,
      projectId: 'project-a',
      knowledgeEpoch: 3,
      requestId: 'reset-a',
      phase: 'PREPARED' as const,
    };
    const first = await appendSourceErasureJournalRecord(input);
    await expect(appendSourceErasureJournalRecord(input)).resolves.toEqual(first);
    await expect(
      appendSourceErasureJournalRecord({
        ...input,
        projectId: 'project-b',
      }),
    ).rejects.toMatchObject({ code: 'ERASURE_JOURNAL_TRANSITION_INVALID' });
    await expect(
      appendSourceErasureJournalRecord({ ...input, requestId: 'other', phase: 'VERIFIED' }),
    ).rejects.toMatchObject({ code: 'ERASURE_JOURNAL_TRANSITION_INVALID' });
  });

  it('fails closed on HMAC tampering and incomplete append records', async () => {
    const { config, backupRoot, journalRoot } = await createRoots();
    await appendSourceErasureJournalRecord({
      config,
      backupRoot,
      projectId: 'project-a',
      knowledgeEpoch: 1,
      requestId: 'reset-a',
      phase: 'PREPARED',
    });
    const journalPath = path.join(journalRoot, 'source-erasure-journal.jsonl');
    const record = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>;
    record.projectId = 'tampered-project';
    await rm(journalPath);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(journalPath, `${JSON.stringify(record)}\n`);
    await expect(readSourceErasureJournal(config)).rejects.toBeInstanceOf(
      SourceErasureJournalError,
    );

    await rm(journalPath);
    await writeFile(journalPath, '{"partial":');
    await expect(readSourceErasureJournal(config)).rejects.toMatchObject({
      code: 'ERASURE_JOURNAL_CORRUPT',
    });
  });

  it('refuses journal roots inside or above a backup root', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-erasure-overlap-'));
    roots.push(base);
    const backupRoot = path.join(base, 'backups');
    const nestedConfig = configFor(path.join(backupRoot, '.journal'));
    await expect(initializeSourceErasureJournal(nestedConfig, backupRoot)).rejects.toMatchObject({
      code: 'ERASURE_JOURNAL_PATH_OVERLAP',
    });
    const ancestorConfig = configFor(base);
    await expect(initializeSourceErasureJournal(ancestorConfig, backupRoot)).rejects.toMatchObject({
      code: 'ERASURE_JOURNAL_PATH_OVERLAP',
    });
  });

  it('blocks older backups, incomplete resets and missing journal configuration', async () => {
    const { config, backupRoot } = await createRoots();
    await verifyBackupKnowledgeEpochBarrier({
      backupEpochs: { 'project-a': 0 },
      config,
      backupRoot,
    });
    await expect(
      verifyBackupKnowledgeEpochBarrier({
        backupEpochs: { 'project-a': 1 },
        config: null,
        backupRoot,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_KNOWLEDGE_EPOCH_STALE' });
    await expect(
      verifyBackupKnowledgeEpochBarrier({
        backupEpochs: {},
        config: null,
        backupRoot,
        journalRequired: true,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_KNOWLEDGE_EPOCH_STALE' });

    await appendSourceErasureJournalRecord({
      config,
      backupRoot,
      projectId: 'project-a',
      knowledgeEpoch: 1,
      requestId: 'reset-a',
      phase: 'PREPARED',
    });
    const preparedOnly = await readSourceErasureJournal(config);
    expect(() =>
      assertBackupKnowledgeEpochsAllowed({
        backupEpochs: { 'project-a': 1 },
        journalRecords: preparedOnly,
      }),
    ).toThrowError(/completed erasure journal transition/u);
    await expect(
      verifyBackupKnowledgeEpochBarrier({ backupEpochs: { 'project-a': 0 }, config, backupRoot }),
    ).rejects.toMatchObject({ code: 'BACKUP_KNOWLEDGE_EPOCH_STALE' });

    await appendSourceErasureJournalRecord({
      config,
      backupRoot,
      projectId: 'project-a',
      knowledgeEpoch: 1,
      requestId: 'reset-a',
      phase: 'VERIFIED',
    });
    await expect(
      verifyBackupKnowledgeEpochBarrier({ backupEpochs: { 'project-a': 0 }, config, backupRoot }),
    ).rejects.toMatchObject({ code: 'BACKUP_KNOWLEDGE_EPOCH_STALE' });
    await expect(
      verifyBackupKnowledgeEpochBarrier({ backupEpochs: { 'project-a': 1 }, config, backupRoot }),
    ).resolves.toBeUndefined();
  });

  it('rejects repeated or skipped reset epochs for a Project', async () => {
    const { config, backupRoot } = await createRoots();
    for (const [epoch, requestId] of [
      [1, 'reset-a'],
      [2, 'reset-b'],
    ] as const) {
      await appendSourceErasureJournalRecord({
        config,
        backupRoot,
        projectId: 'project-a',
        knowledgeEpoch: epoch,
        requestId,
        phase: 'PREPARED',
      });
      await appendSourceErasureJournalRecord({
        config,
        backupRoot,
        projectId: 'project-a',
        knowledgeEpoch: epoch,
        requestId,
        phase: 'VERIFIED',
      });
    }
    const records = await readSourceErasureJournal(config);
    expect(() =>
      assertBackupKnowledgeEpochsAllowed({
        backupEpochs: { 'project-a': 2 },
        journalRecords: records,
      }),
    ).not.toThrow();
    expect(() =>
      assertBackupKnowledgeEpochsAllowed({
        backupEpochs: { 'project-a': 3 },
        journalRecords: records,
      }),
    ).toThrowError(/lacks a unique verified reset record/u);
  });
});
