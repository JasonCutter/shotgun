import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuditShape } from '../ts6-phase-b-transaction-authority-validator.js';
import { readSource } from '../ts6-phase-b-regression-evidence-resolver.js';

const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotgun-ts6-audit-cache-'));
  roots.push(root);
  const file = path.join(root, 'adapters/fixture/src/index.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `export type OwnerPort = { run(): Promise<void> };
export class Owner implements OwnerPort {
  async run() { await withSafePostgresTransaction(pool, async () => {}); }
}
export async function dispatch(owner: OwnerPort) { await owner.run(); }
`,
  );
  return { root, file };
};
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^shotgun-ts6-audit-cache-/u);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
describe('TS6 immutable-source audit reuse', () => {
  it('returns detached audits and reuses the same source facts without trusting caller mutation', () => {
    const { root } = fixture();
    const first = buildAuditShape(root);
    expect(first.candidates).toHaveLength(1);
    const expected = structuredClone(first);
    (first as unknown as { candidates: { line: number }[] }).candidates[0]!.line = -100;
    expect(buildAuditShape(root)).toEqual(expected);
  });
  it('detects source bytes changed with preserved timestamps and file additions/removals', () => {
    const { root, file } = fixture();
    expect(buildAuditShape(root).boundaries[0]?.productionReachability.status).toBe(
      'PORT_INFERRED',
    );
    const times = fs.statSync(file);
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('await owner.run()', 'await owner.foo()'),
    );
    fs.utimesSync(file, times.atime, times.mtime);
    expect(buildAuditShape(root).boundaries[0]?.productionReachability.status).toBe(
      'TEST_ONLY_OR_DEAD',
    );
    const extra = path.join(path.dirname(file), 'extra.ts');
    fs.writeFileSync(
      extra,
      'export class Extra { async execute(){ await withSafePostgresTransaction(pool, async () => {}); } }',
    );
    expect(buildAuditShape(root).candidates).toHaveLength(2);
    fs.unlinkSync(extra);
    expect(buildAuditShape(root).candidates).toHaveLength(1);
  });
  it('keeps qualified and legacy projections separate across repository roots', () => {
    const a = fixture(),
      b = fixture();
    const qualified = buildAuditShape(a.root);
    expect(qualified.boundaries[0]?.productionReachability.status).toBe('PORT_INFERRED');
    expect(
      buildAuditShape(a.root, { legacyAuthority: true }).boundaries[0]?.productionReachability
        .status,
    ).toBe('PROVEN');
    fs.writeFileSync(
      b.file,
      'export class Other { async run(){ await withSafePostgresTransaction(pool, async () => {}); } }',
    );
    expect(buildAuditShape(b.root).boundaries[0]).toMatchObject({ symbol: 'Other', method: 'run' });
    expect(buildAuditShape(a.root)).toEqual(qualified);
  });
  it('invalidates linked TSX regression source caches without changing production scanning', () => {
    const { root } = fixture();
    const relative = 'tests/linked.test.tsx',
      file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "it('first title', () => {});");
    const expected = buildAuditShape(root);
    expect(readSource(root, relative)).toContain('first title');
    fs.writeFileSync(file, "it('other title', () => {});");
    expect(buildAuditShape(root)).toEqual(expected);
    expect(readSource(root, relative)).toContain('other title');
  });
});
