import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parseT3ExpectedContentColumns,
  parseT3ExpectedTables,
} from '../../scripts/t3-storage-inventory.js';

describe('T3 current storage inventory and preserved historical baseline', () => {
  it('is unique and covers the baseline, reset control tables, VP tables, and preserved global authority', async () => {
    const register = await readFile(
      'docs/implementation/t3-storage-classification-register.md',
      'utf8',
    );
    const expected = parseT3ExpectedTables(register);
    expect(expected.schemas).toHaveLength(31);
    expect(expected.tables).toHaveLength(210);
    const currentAdditions = [
      'source_product.url_refresh_jobs',
      'vp.candidate_frontier_members',
      'vp.candidate_frontiers',
    ];
    expect(expected.tables.filter((table) => currentAdditions.includes(table))).toEqual(
      currentAdditions,
    );
    expect(expected.tables.filter((table) => !currentAdditions.includes(table))).toHaveLength(207);
    expect(register).toContain('migration 001–130의 207개 table');
    expect(register).toContain('`source_product.url_refresh_jobs`: D');
    expect(register).toContain('`vp.candidate_frontiers`와 `vp.candidate_frontier_members`: D+B');
    expect(expected.tables).toContain('vp.relation_provider_calls');
    expect(expected.tables.filter((table) => table.startsWith('vp_global_budget.'))).toEqual([
      'vp_global_budget.authority_store',
      'vp_global_budget.claims',
      'vp_global_budget.daily_usage',
      'vp_global_budget.policies',
    ]);
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
