import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requestedMode = process.argv[2] ?? 'all';
const supportedModes = new Set(['all', 'links', 'adr', 'canonical', 'drift']);

if (!supportedModes.has(requestedMode)) {
  console.error(`Unknown documentation validation mode: ${requestedMode}`);
  process.exit(2);
}

const errors: string[] = [];
const notes: string[] = [];

function absolute(relativePath: string): string {
  return path.join(root, relativePath);
}

function readText(relativePath: string): string {
  const target = absolute(relativePath);
  if (!existsSync(target)) {
    errors.push(`Missing required file: ${relativePath}`);
    return '';
  }
  return readFileSync(target, 'utf8');
}

function readJson<T>(relativePath: string): T | undefined {
  const text = readText(relativePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${String(error)}`);
    return undefined;
  }
}

function walk(relativePath: string): string[] {
  const start = absolute(relativePath);
  if (!existsSync(start)) return [];
  const results: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      if (statSync(fullPath).isDirectory()) visit(fullPath);
      else results.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  };
  visit(start);
  return results;
}

function validateLinks(): void {
  const markdownFiles = walk('docs').filter((file) => file.endsWith('.md'));
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let checked = 0;

  for (const file of markdownFiles) {
    const text = readFileSync(absolute(file), 'utf8');
    for (const match of text.matchAll(linkPattern)) {
      let target = match[1]?.trim() ?? '';
      if (!target || target.startsWith('#') || target.startsWith('mailto:')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      target = target.split('#', 1)[0]?.split('?', 1)[0]?.trim() ?? '';
      if (!target) continue;
      const titleSeparator = target.search(/\s+["']/);
      if (titleSeparator >= 0) target = target.slice(0, titleSeparator);
      try {
        target = decodeURIComponent(target);
      } catch {
        errors.push(`Invalid percent-encoding in link from ${file}: ${match[1]}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(absolute(file)), target);
      checked += 1;
      if (!existsSync(resolved)) {
        errors.push(`Broken relative link in ${file}: ${match[1]}`);
      }
    }
  }

  notes.push(`Markdown relative links checked: ${checked}`);
}

type OwnerRule = {
  start: number;
  end: number;
  kind: 'INDIVIDUAL_FILES' | 'CONSOLIDATED_PHASE_RECORD';
  path: string;
  filenamePattern?: string;
};

type AdrRegistry = {
  schemaVersion: number;
  expectedRange: { start: number; end: number; allowedGaps: number[] };
  ownerRules: OwnerRule[];
};

function validateAdrRegistry(): void {
  const registry = readJson<AdrRegistry>('docs/architecture/adr/adr-registry.json');
  if (!registry) return;

  const owners = new Map<number, string[]>();
  const addOwner = (id: number, ownerPath: string): void => {
    const existing = owners.get(id) ?? [];
    existing.push(ownerPath);
    owners.set(id, existing);
  };

  const sortedRules = [...registry.ownerRules].sort((left, right) => left.start - right.start);
  for (let index = 0; index < sortedRules.length; index += 1) {
    const rule = sortedRules[index];
    if (!rule) continue;
    if (rule.start > rule.end) errors.push(`ADR owner rule has an invalid range: ${rule.start}-${rule.end}`);
    const previous = sortedRules[index - 1];
    if (previous && rule.start <= previous.end) {
      errors.push(`ADR owner ranges overlap: ${previous.start}-${previous.end} and ${rule.start}-${rule.end}`);
    }

    if (rule.kind === 'INDIVIDUAL_FILES') {
      const files = walk(rule.path).filter((file) => /^ADR-\d{3}-.+\.md$/i.test(path.basename(file)));
      for (const file of files) {
        const match = /^ADR-(\d{3})-/i.exec(path.basename(file));
        if (!match) continue;
        const id = Number(match[1]);
        if (id >= rule.start && id <= rule.end) addOwner(id, file);
      }
    } else {
      const text = readText(rule.path);
      const headingPattern = /^#{1,6}\s+ADR-(\d{3})\b/gm;
      for (const match of text.matchAll(headingPattern)) {
        const id = Number(match[1]);
        if (id < rule.start || id > rule.end) {
          errors.push(`ADR-${String(id).padStart(3, '0')} is outside registered range for ${rule.path}`);
          continue;
        }
        addOwner(id, rule.path);
      }
    }
  }

  const allowedGaps = new Set(registry.expectedRange.allowedGaps);
  for (let id = registry.expectedRange.start; id <= registry.expectedRange.end; id += 1) {
    const matches = owners.get(id) ?? [];
    if (matches.length === 0 && !allowedGaps.has(id)) {
      errors.push(`ADR-${String(id).padStart(3, '0')} has no registered authoritative owner`);
    }
    if (matches.length > 1) {
      errors.push(`ADR-${String(id).padStart(3, '0')} has duplicate owners: ${matches.join(', ')}`);
    }
  }

  for (const gap of allowedGaps) {
    if ((owners.get(gap) ?? []).length > 0) {
      errors.push(`ADR-${String(gap).padStart(3, '0')} is registered as a gap but has an owner`);
    }
  }

  notes.push(`ADR identifiers evaluated: ${registry.expectedRange.start}-${registry.expectedRange.end}`);
}

type EvidenceRegistry = {
  records: Array<{ id: string; path: string; class: string }>;
};

type GeneratedRegistry = {
  artifacts: Array<{
    id: string;
    class: string;
    target: string;
    versioned: boolean;
    owner: string;
    canonicalInputs: string[];
    generator: string;
  }>;
};

function validateCanonicalRecords(): void {
  const canonical = readText('docs/CANONICAL.md');
  const manifest = readText('docs/canonical-manifest.yaml');

  if (!canonical.includes('GitHub repository `JasonCutter/shotgun`, branch `main`')) {
    errors.push('docs/CANONICAL.md does not declare GitHub main as the Canonical authority');
  }
  if (!manifest.includes('status: active') || !manifest.includes('canonical_authority: github-main')) {
    errors.push('docs/canonical-manifest.yaml does not record an active GitHub authority');
  }

  const requiredCanonicalPaths = [
    'docs/architecture/knowledge-flow/shotgun-knowledge-flow-detailed-map.md',
    'docs/architecture/frontend/README.md',
    'docs/architecture/add/README.md',
    'docs/architecture/adr/adr-registry.json',
    'docs/architecture/stage-12-1/README.md',
    'docs/engineering/evidence-registry.json',
    'docs/governance/generated-artifact-ownership.md',
    'docs/generated-artifacts.json',
  ];
  for (const requiredPath of requiredCanonicalPaths) {
    if (!existsSync(absolute(requiredPath))) errors.push(`Missing Canonical governance path: ${requiredPath}`);
  }

  const evidence = readJson<EvidenceRegistry>('docs/engineering/evidence-registry.json');
  for (const record of evidence?.records ?? []) {
    if (!record.id || !record.class || !record.path) {
      errors.push(`Invalid evidence registry entry: ${JSON.stringify(record)}`);
      continue;
    }
    if (!existsSync(absolute(record.path))) errors.push(`Evidence registry path does not exist: ${record.path}`);
  }

  const generated = readJson<GeneratedRegistry>('docs/generated-artifacts.json');
  for (const artifact of generated?.artifacts ?? []) {
    if (!artifact.id || !artifact.class || !artifact.owner || !artifact.generator) {
      errors.push(`Invalid generated-artifact entry: ${JSON.stringify(artifact)}`);
    }
    if (!Array.isArray(artifact.canonicalInputs) || artifact.canonicalInputs.length === 0) {
      errors.push(`Generated artifact has no Canonical inputs: ${artifact.id}`);
    }
    if (artifact.versioned && !existsSync(absolute(artifact.target))) {
      errors.push(`Versioned generated-artifact target does not exist: ${artifact.target}`);
    }
  }

  notes.push('Canonical, evidence and generated-artifact registries checked');
}

function validateDrift(): void {
  const manifest = readText('docs/canonical-manifest.yaml');
  const completedPhrases = [
    'export Phase 1-6 ADD documents',
    'export Frontend and Human Interaction Architecture hierarchy',
  ];
  for (const phrase of completedPhrases) {
    if (manifest.includes(`- ${phrase}`)) errors.push(`Completed migration remains unresolved in manifest: ${phrase}`);
  }

  const targetPattern = /^\s*target_path:\s*([^\n#]+)$/gm;
  for (const match of manifest.matchAll(targetPattern)) {
    const target = match[1]?.trim();
    if (target && !existsSync(absolute(target))) errors.push(`Manifest target_path does not exist: ${target}`);
  }

  const addRoot = readText('docs/architecture/add/README.md');
  if (!addRoot.includes('Authority migration — 2026-07-29')) {
    errors.push('Phase ADD root does not carry the Git authority migration boundary');
  }

  notes.push('Migration backlog and manifest target drift checked');
}

if (requestedMode === 'all' || requestedMode === 'links') validateLinks();
if (requestedMode === 'all' || requestedMode === 'adr') validateAdrRegistry();
if (requestedMode === 'all' || requestedMode === 'canonical') validateCanonicalRecords();
if (requestedMode === 'all' || requestedMode === 'drift') validateDrift();

for (const note of notes) console.log(`PASS: ${note}`);

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  console.error(`Documentation validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Documentation validation mode '${requestedMode}' passed.`);
