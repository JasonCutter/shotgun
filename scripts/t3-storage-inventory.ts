export type T3ExpectedStorageInventory = Readonly<{
  schemas: readonly string[];
  tables: readonly string[];
}>;

export const parseT3ExpectedTables = (register: string): T3ExpectedStorageInventory => {
  const schemas = new Set<string>();
  const tables = new Set<string>();
  for (const line of register.split(/\r?\n/u)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const schemaMatch = cells[0]?.match(/^`([^`]+)`\s*\((\d+)\)$/u);
    if (schemaMatch && cells[1]) {
      const [, schema, countText] = schemaMatch;
      schemas.add(schema!);
      const before = tables.size;
      for (const match of cells[1].matchAll(/`([^`]+)`/gu)) {
        const table = `${schema}.${match[1]}`;
        if (tables.has(table)) throw new Error(`T3 storage register duplicates table ${table}.`);
        tables.add(table);
      }
      const declaredCount = Number(countText);
      if (tables.size - before !== declaredCount) {
        throw new Error(`T3 storage register table count does not match schema ${schema}.`);
      }
      continue;
    }
    // Fully qualified names in later migration and owner maps are references
    // to the authoritative per-schema table inventory above, not new table
    // declarations. Counting them here duplicated the reset control tables.
  }
  const sortedSchemas = [...schemas].sort();
  const sortedTables = [...tables].sort();
  if (sortedSchemas.length !== schemas.size || sortedTables.length !== tables.size) {
    throw new Error('T3 storage register contains duplicate schema or table identities.');
  }
  return { schemas: sortedSchemas, tables: sortedTables };
};

export const parseT3ExpectedContentColumns = (inventory: string): readonly string[] => {
  const columns = inventory
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [column, type] = line.split('\t');
      if (!column || !type || type.includes('\t')) {
        throw new Error(`Invalid T3 content-column inventory row: ${line}`);
      }
      return `${column}\t${type}`;
    })
    .sort();
  if (new Set(columns).size !== columns.length) {
    throw new Error('T3 content-column inventory contains duplicate identities.');
  }
  return columns;
};
