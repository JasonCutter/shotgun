import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_RESET_OWNER_ORDER } from '../../modules/source-knowledge-reset/src/index.js';
import {
  authoritativeIntegrityTablesForMigrations,
  VP_BACKUP_INTEGRITY_PROFILE,
} from '../../scripts/backup-restore.js';

describe('image derivatives retain existing owner reset and backup boundaries', () => {
  it('orders source progress before VP observation before AI execution before original lineage', () => {
    const order = KNOWLEDGE_RESET_OWNER_ORDER;
    expect(order.indexOf('source-product')).toBeLessThan(order.indexOf('vp-ledger'));
    expect(order.indexOf('vp-ledger')).toBeLessThan(order.indexOf('ai-output'));
    expect(order.indexOf('ai-output')).toBeLessThan(order.indexOf('transformation'));
    expect(order.indexOf('transformation')).toBeLessThan(order.indexOf('asset'));
    expect(order.filter((x) => x === 'source-product')).toHaveLength(1);
  });
  it('includes derivatives only in versioned VP backup coverage', () => {
    const migrations = ['133_vp_image_observations.sql', '134_image_observation_execution.sql'];
    expect(
      authoritativeIntegrityTablesForMigrations(migrations, VP_BACKUP_INTEGRITY_PROFILE),
    ).toEqual(expect.arrayContaining(['vp.image_observations', 'ai.image_observation_executions']));
    expect(authoritativeIntegrityTablesForMigrations(migrations, 'legacy-v1')).not.toEqual(
      expect.arrayContaining(['vp.image_observations', 'ai.image_observation_executions']),
    );
  });
  it('keeps unknown and unfinished calls as explicit purge blockers with private old routines', async () => {
    const sql = await readFile('db/migrations/137_image_observation_t3_ownership.sql', 'utf8');
    expect(sql).toContain("state NOT IN ('COMPLETED','OUTPUT_REJECTED')");
    expect(sql).toContain("CONSTRAINT='active_job_outcome_unknown'");
    expect(sql).toContain('FROM PUBLIC, shotgun_erasure_executor');
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON ai.image_observation_executions');
    expect(sql).toContain('BEFORE DELETE ON ai.image_observation_executions');
    expect(sql).toContain('BEFORE TRUNCATE ON ai.image_observation_executions');
  });
});
