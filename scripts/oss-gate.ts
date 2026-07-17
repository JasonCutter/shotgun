import { readFile } from 'node:fs/promises';
import path from 'node:path';

type Decision =
  'ADOPT' | 'EXTRACT' | 'AUGMENT' | 'REFERENCE_ONLY' | 'DEFER' | 'REJECT' | 'NO_RELEVANT_OSS';

type RegistryEntry = {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly number[];
  readonly officialSource: string;
  readonly pin: {
    readonly type: string;
    readonly value: string;
    readonly package?: string;
  };
  readonly license: {
    readonly spdx: string;
    readonly status: string;
    readonly evidence: string;
  };
  readonly decision: Decision;
  readonly scope: string;
  readonly security: string;
  readonly maintenance: string;
  readonly evidence: readonly string[];
  readonly boundary: string;
  readonly replacement: string;
  readonly recheckTrigger: string;
};

type Registry = {
  readonly schemaVersion: string;
  readonly decisionValues: readonly Decision[];
  readonly entries: readonly RegistryEntry[];
};

type Lockfile = {
  readonly packages: Record<string, { readonly version?: string } | undefined>;
};

const root = process.cwd();
const requiredIds = [
  'postgresql',
  'postgresql-pg-trgm',
  'pgvector',
  'ajv',
  'gbrain',
  'lucas-llmwiki',
  'ddsyasas-llm-wiki',
  'inkeep-open-knowledge',
  'w3c-web-annotation',
  'json-pointer',
  'google-genai-sdk',
  'litellm',
  'zod',
  'langfuse',
  'jsdiff',
  'diff-match-patch',
  'tiptap',
  'yjs',
  'transactional-outbox-pattern',
  'pg-boss',
  'graphile-worker',
  'node-pg-migrate',
  'drizzle-orm',
  'kysely',
  'docling',
  'apache-tika',
  'markitdown',
  'pymupdf',
  'pdfplumber',
  'python-docx',
  'python-pptx',
  'openpyxl',
  'beautifulsoup4',
  'pillow',
  'networkx',
  'cytoscape-js',
  'mcp-typescript-sdk-stage11',
  'opa-stage11',
  'node-casbin-stage11',
  'openfga-stage11',
  'temporal-typescript-stage11',
  'octokit-stage11',
] as const;
const decisions = new Set<Decision>([
  'ADOPT',
  'EXTRACT',
  'AUGMENT',
  'REFERENCE_ONLY',
  'DEFER',
  'REJECT',
  'NO_RELEVANT_OSS',
]);
const stageReviewFiles = [
  'docs/implementation/stage-validations/stage-0-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-1-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-2-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-3-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-4-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-5-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-6-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-7-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-8-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-9-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-10-oss-integration-review.md',
  'docs/implementation/stage-validations/stage-11-oss-integration-review.md',
] as const;

const readJson = async <T>(relativePath: string): Promise<T> =>
  JSON.parse(await readFile(path.join(root, relativePath), 'utf8')) as T;

const requireText = (value: string | undefined, label: string, errors: string[]): void => {
  if (!value?.trim()) {
    errors.push(`${label} is required`);
  }
};

const main = async (): Promise<void> => {
  const registry = await readJson<Registry>('docs/implementation/oss-source-registry.json');
  const lockfile = await readJson<Lockfile>('package-lock.json');
  const compose = await readFile(path.join(root, 'compose.yaml'), 'utf8');
  const pythonLocks = await Promise.all(
    [
      'adapters/document-format-python/requirements.lock',
      'adapters/networkx-impact-oracle/requirements.lock',
    ].map((relativePath) => readFile(path.join(root, relativePath), 'utf8')),
  );
  const pythonPins = new Map(
    pythonLocks
      .join('\n')
      .split(/\r?\n/u)
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => line.split('==', 2))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([name, version]) => [name.toLowerCase(), version]),
  );
  const errors: string[] = [];
  const byId = new Map(registry.entries.map((entry) => [entry.id, entry]));

  if (registry.schemaVersion !== '1.0.0') {
    errors.push(`unsupported registry schema version '${registry.schemaVersion}'`);
  }
  if (new Set(registry.entries.map((entry) => entry.id)).size !== registry.entries.length) {
    errors.push('registry entry ids must be unique');
  }

  for (const id of requiredIds) {
    if (!byId.has(id)) {
      errors.push(`required OSS reference '${id}' is missing`);
    }
  }

  for (const entry of registry.entries) {
    requireText(entry.name, `${entry.id}.name`, errors);
    requireText(entry.officialSource, `${entry.id}.officialSource`, errors);
    requireText(entry.pin?.type, `${entry.id}.pin.type`, errors);
    requireText(entry.pin?.value, `${entry.id}.pin.value`, errors);
    requireText(entry.license?.spdx, `${entry.id}.license.spdx`, errors);
    requireText(entry.license?.status, `${entry.id}.license.status`, errors);
    requireText(entry.license?.evidence, `${entry.id}.license.evidence`, errors);
    requireText(entry.scope, `${entry.id}.scope`, errors);
    requireText(entry.security, `${entry.id}.security`, errors);
    requireText(entry.maintenance, `${entry.id}.maintenance`, errors);
    requireText(entry.boundary, `${entry.id}.boundary`, errors);
    requireText(entry.replacement, `${entry.id}.replacement`, errors);
    requireText(entry.recheckTrigger, `${entry.id}.recheckTrigger`, errors);

    if (!decisions.has(entry.decision)) {
      errors.push(`${entry.id}.decision '${entry.decision}' is invalid`);
    }
    if (entry.stages.length === 0 || entry.stages.some((stage) => !Number.isInteger(stage))) {
      errors.push(`${entry.id}.stages must contain integer stage numbers`);
    }
    if (entry.evidence.length === 0) {
      errors.push(`${entry.id}.evidence must not be empty`);
    }
    if (['ADOPT', 'EXTRACT', 'AUGMENT'].includes(entry.decision) && !entry.pin.value.trim()) {
      errors.push(`${entry.id} requires an exact adoption pin`);
    }

    if (entry.pin.type === 'npm-lock') {
      const packageName = entry.pin.package;
      if (!packageName) {
        errors.push(`${entry.id}.pin.package is required for npm-lock`);
        continue;
      }
      const resolved = lockfile.packages[`node_modules/${packageName}`]?.version;
      if (resolved !== entry.pin.value) {
        errors.push(
          `${entry.id} registry pin '${entry.pin.value}' does not match package-lock '${resolved ?? 'missing'}'`,
        );
      }
    }
    if (entry.pin.type === 'pypi-lock') {
      const packageName = entry.pin.package;
      if (!packageName) {
        errors.push(`${entry.id}.pin.package is required for pypi-lock`);
        continue;
      }
      const resolved = pythonPins.get(packageName.toLowerCase());
      if (resolved !== entry.pin.value) {
        errors.push(
          `${entry.id} registry pin '${entry.pin.value}' does not match Python lock '${resolved ?? 'missing'}'`,
        );
      }
    }
  }

  const postgres = byId.get('postgresql');
  if (postgres && !compose.includes(`image: ${postgres.pin.value}`)) {
    errors.push('compose.yaml PostgreSQL image does not match the OSS registry digest');
  }

  for (const reviewFile of stageReviewFiles) {
    const review = await readFile(path.join(root, reviewFile), 'utf8');
    if (!review.includes('OSS Gate: **COMPLETE**')) {
      errors.push(`${reviewFile} is not marked OSS Gate COMPLETE`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`OSS Gate: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `OSS Gate passed: ${registry.entries.length} decisions, ${requiredIds.length} baseline references, Stage 0-11 reviews complete.`,
  );
};

await main();
