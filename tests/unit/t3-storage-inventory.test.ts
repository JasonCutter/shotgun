import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parseT3ExpectedContentColumns,
  parseT3ExpectedTables,
} from '../../scripts/t3-storage-inventory.js';

describe('T3 frozen storage inventory', () => {
  it('is unique and covers the baseline, reset control tables, and eight VP tables', async () => {
    const register = await readFile(
      'docs/implementation/t3-storage-classification-register.md',
      'utf8',
    );
    const expected = parseT3ExpectedTables(register);
    expect(expected.schemas).toHaveLength(30);
    expect(expected.tables).toHaveLength(203);
    expect(expected.tables).toContain('vp.relation_provider_calls');
    expect(
      expected.tables.filter(
        (table) =>
          table.includes('knowledge_reset') ||
          table.startsWith('canonical.t3_reset_') ||
          table === 'project_admin.project_knowledge_epoch',
      ),
    ).toEqual([
      'canonical.knowledge_reset_events',
      'canonical.t3_reset_owner_snapshot_rows',
      'canonical.t3_reset_owner_snapshots',
      'project_admin.project_knowledge_epoch',
      'project_admin.project_knowledge_reset_requests',
    ]);
  });

  it('keeps the exact content-column inventory and additive migration non-destructive', async () => {
    const inventory = await readFile('docs/implementation/t3-content-column-inventory.tsv', 'utf8');
    const columns = parseT3ExpectedContentColumns(inventory);
    expect(columns).toHaveLength(168);
    expect(columns).toContain('vp.relation_provider_calls.output_json\tjsonb');
    expect(columns).toContain(
      'project_admin.project_knowledge_reset_requests.impact_counts\tjsonb',
    );
    expect(columns).toContain(
      'project_admin.project_knowledge_reset_requests.step_checkpoints\tjsonb',
    );

    const migration = await readFile(
      'db/migrations/078_t3_project_source_knowledge_reset.sql',
      'utf8',
    );
    expect(migration).not.toMatch(
      /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA)|ALTER\s+TABLE)\b/iu,
    );

    const resetRequestMigration = await readFile(
      'db/migrations/079_t3_preserved_configuration_fingerprint.sql',
      'utf8',
    );
    expect(resetRequestMigration).toContain('ADD COLUMN preserved_configuration_digest text');
    expect(resetRequestMigration).toContain('ADD COLUMN owner_manifest_digest text');
    expect(resetRequestMigration).not.toMatch(
      /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/iu,
    );
  });
});
