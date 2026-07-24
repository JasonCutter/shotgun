import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['apps', 'packages', 'modules', 'adapters', 'assemblies'];
const importExpression = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;

const toPosix = (value: string) => value.split(path.sep).join('/');

const collectTypeScriptFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath);
      }
      return entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        ? [entryPath]
        : [];
    }),
  );

  return nested.flat();
};

const resolveRelativeImport = (file: string, imported: string): string | undefined => {
  if (!imported.startsWith('.')) {
    return undefined;
  }
  return toPosix(path.relative(rootDirectory, path.resolve(path.dirname(file), imported)));
};

const moduleName = (relativePath: string): string | undefined => {
  const match = /^modules\/([^/]+)\//.exec(relativePath);
  return match?.[1];
};

const packageName = (relativePath: string): string | undefined => {
  const match = /^packages\/([^/]+)\//.exec(relativePath);
  return match?.[1];
};

const allowedPackageDependencies: Readonly<Record<string, readonly string[]>> = {
  contracts: [],
  'quality-evaluation': ['contracts'],
  authentication: ['contracts'],
  'module-sdk': ['contracts'],
  'job-runtime': ['contracts'],
  observability: ['contracts'],
  policy: ['contracts', 'module-sdk'],
  'connector-runtime': ['contracts', 'job-runtime', 'module-sdk', 'observability', 'policy'],
  kernel: ['connector-runtime', 'contracts', 'module-sdk'],
  'shotgun-api-client': ['contracts'],
};

export const findArchitectureViolations = async (): Promise<string[]> => {
  const files = (
    await Promise.all(
      sourceRoots.map((sourceRoot) => collectTypeScriptFiles(path.join(rootDirectory, sourceRoot))),
    )
  ).flat();
  const violations: string[] = [];

  for (const file of files) {
    const relativeFile = toPosix(path.relative(rootDirectory, file));
    const sourceModule = moduleName(relativeFile);
    const sourcePackage = packageName(relativeFile);
    const isFrontendApp = relativeFile.startsWith('apps/shotgun-web/');
    const isFrontendClient = relativeFile.startsWith('packages/shotgun-api-client/');
    const source = await readFile(file, 'utf8');

    for (const match of source.matchAll(importExpression)) {
      const imported = match[1] ?? match[2];
      if (!imported) {
        continue;
      }

      if (sourceModule && ['pg', '@prisma/client', 'drizzle-orm'].includes(imported)) {
        violations.push(`${relativeFile} imports database infrastructure package '${imported}'.`);
      }
      if (sourceModule && ['@google/genai', 'openai', '@anthropic-ai/sdk'].includes(imported)) {
        violations.push(`${relativeFile} imports provider SDK '${imported}'.`);
      }
      if (
        (isFrontendApp || isFrontendClient) &&
        ['pg', 'fastify', '@google/genai', 'openai', '@anthropic-ai/sdk'].includes(imported)
      ) {
        violations.push(`${relativeFile} imports forbidden frontend dependency '${imported}'.`);
      }
      if (
        isFrontendApp &&
        imported.startsWith('@shotgun/') &&
        !['@shotgun/api-client', '@shotgun/contracts'].includes(imported)
      ) {
        violations.push(`${relativeFile} imports forbidden Shotgun package '${imported}'.`);
      }

      if (
        isFrontendApp &&
        source.includes('LogoutButton') &&
        relativeFile.includes('settings-page')
      ) {
        violations.push(`${relativeFile} imports LogoutButton component in Local Owner mode.`);
      }

      if (
        (isFrontendApp || isFrontendClient) &&
        /x-(project-id|actor-id|principal-id)/i.test(source)
      ) {
        violations.push(`${relativeFile} contains prohibited legacy authority header.`);
      }

      const resolved = resolveRelativeImport(file, imported);
      if (!resolved) {
        continue;
      }

      const importedModule = moduleName(resolved);
      const importedPackage = packageName(resolved);
      if (
        (isFrontendApp || isFrontendClient) &&
        /^(modules|adapters|assemblies|packages\/(kernel|authentication))\//.test(resolved)
      ) {
        violations.push(`${relativeFile} crosses the frontend boundary through '${resolved}'.`);
      }
      if (sourceModule && resolved.startsWith('adapters/')) {
        violations.push(`${relativeFile} imports adapter code '${resolved}'.`);
      }
      if (sourceModule && importedModule && importedModule !== sourceModule) {
        violations.push(`${relativeFile} imports another domain module '${resolved}'.`);
      }
      if (
        relativeFile.startsWith('packages/kernel/') &&
        /^(modules|adapters|assemblies)\//.test(resolved)
      ) {
        violations.push(`${relativeFile} imports implementation code '${resolved}'.`);
      }
      if (
        sourcePackage &&
        importedPackage &&
        sourcePackage !== importedPackage &&
        !(allowedPackageDependencies[sourcePackage] ?? []).includes(importedPackage)
      ) {
        violations.push(`${relativeFile} imports disallowed package '${importedPackage}'.`);
      }
    }
  }

  const moduleDirectories = await readdir(path.join(rootDirectory, 'modules'), {
    withFileTypes: true,
  });
  const canonicalWriters: string[] = [];
  for (const directory of moduleDirectories.filter((entry) => entry.isDirectory())) {
    const manifestPath = path.join(
      rootDirectory,
      'modules',
      directory.name,
      'module-manifest.json',
    );
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        readonly id?: string;
        readonly approvalPolicy?: { readonly canWriteCanonical?: boolean };
      };
      if (manifest.approvalPolicy?.canWriteCanonical) {
        canonicalWriters.push(manifest.id ?? directory.name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  if (canonicalWriters.length !== 1 || canonicalWriters[0] !== 'stage6.canonical-knowledge') {
    violations.push(
      `Canonical write authority must belong only to 'stage6.canonical-knowledge'; found ${canonicalWriters.join(', ') || 'none'}.`,
    );
  }

  return violations;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await findArchitectureViolations();
  if (violations.length > 0) {
    throw new Error(`Architecture boundary violations:\n${violations.join('\n')}`);
  }
  console.log('Architecture boundaries verified.');
}
