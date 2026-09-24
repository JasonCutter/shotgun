import fs from 'node:fs';
import path from 'node:path';

/** Refuse writes to any history artifact named by T3's immutable manifest. */
export const resolveLineageOutput = (root, argv) => {
  const outputIndex = argv.indexOf('--output');
  const inlineOutput = argv.find((arg) => arg.startsWith('--output='));
  const requested = inlineOutput?.slice('--output='.length) ?? argv[outputIndex + 1];
  if (!requested || requested.startsWith('--'))
    throw new Error('Historical lineage rebuild requires --output <scratch-file>.');

  const manifestPath = path.join(
    root,
    'artifacts/ts6-phase-b-c2-r15/t3-frozen-history-manifest.json',
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (
    manifest.schemaVersion !== 'ts6.phase-b.frozen-history.v1' ||
    manifest.status !== 'IMMUTABLE_HISTORICAL_INPUT' ||
    !Array.isArray(manifest.artifacts)
  )
    throw new Error('Cannot verify the immutable history manifest; refusing lineage output.');

  const outputPath = path.resolve(root, requested);
  const protectedPaths = new Set(
    [
      ...manifest.artifacts.map((item) => item.path),
      'artifacts/ts6-phase-b-c2-r15/golden.v8.derived.json',
      'artifacts/ts6-phase-b-c2-r15/current-authority-manifest.v8.json',
      'artifacts/ts6-phase-b-c2-r15/approved-regression-relations.v8.json',
      'artifacts/ts6-phase-b-c2-r15/t3-frozen-history-manifest.json',
    ].map((relative) => path.resolve(root, relative).toLowerCase()),
  );
  if (protectedPaths.has(outputPath.toLowerCase()))
    throw new Error(`Refusing to overwrite protected lineage artifact: ${requested}`);
  return outputPath;
};
