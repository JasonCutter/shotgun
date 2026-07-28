import { readFile, writeFile, rm } from 'node:fs/promises';

const path = '.github/workflows/ci.yml';
let source = await readFile(path, 'utf8');

const replaceExpected = (before, after, expectedCount = 1) => {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} CI cleanup blocks, found ${count}`);
  }
  source = source.split(before).join(after);
};

replaceExpected('permissions:\n  contents: write', 'permissions:\n  contents: read');
replaceExpected(
  `  codemod:\n    name: ADR-118 Codemod\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - name: Check out implementation branch\n        uses: actions/checkout@v4\n        with:\n          ref: agent/adr-118-typed-failure-implementation\n      - name: Set up Node.js\n        uses: actions/setup-node@v4\n        with:\n          node-version: 24\n          cache: npm\n      - name: Apply ADR-118 codemod\n        run: |\n          node scripts/adr118-codemod.mjs\n          node scripts/adr118-codemod-cleanup.mjs\n      - name: Install dependencies\n        run: npm ci\n      - name: Format changed files\n        run: npm run format:write\n      - name: Typecheck generated implementation\n        run: npm run typecheck\n      - name: Run generated contract tests\n        run: npm run test:contract\n      - name: Run generated unit tests\n        run: npm run test:unit\n      - name: Commit generated implementation\n        run: |\n          git config user.name "github-actions[bot]"\n          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"\n          git add -A\n          git diff --cached --quiet && exit 1\n          git commit -m "feat: implement ADR-118 typed failure contract"\n          git push origin HEAD:agent/adr-118-typed-failure-implementation\n\n`,
  '',
);
replaceExpected('  quality:\n    needs: codemod', '  quality:');
replaceExpected('  frontend:\n    needs: codemod', '  frontend:');
replaceExpected(
  `      - name: Check out repository\n        uses: actions/checkout@v4\n        with:\n          ref: agent/adr-118-typed-failure-implementation`,
  `      - name: Check out repository\n        uses: actions/checkout@v4`,
  2,
);
replaceExpected('    needs: [codemod, quality, frontend]', '    needs: [quality, frontend]');

await writeFile(path, source);
await rm('scripts/adr118-codemod-cleanup.mjs');
