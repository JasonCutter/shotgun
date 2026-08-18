import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidateFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  {
    cwd: rootDirectory,
    encoding: 'utf8',
  },
)
  .split(/\r?\n/)
  .filter(Boolean);

const patterns: readonly [string, RegExp][] = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['OpenAI-style API key', /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];

const findings: string[] = [];
for (const file of candidateFiles) {
  let content: string;
  try {
    content = await readFile(path.join(rootDirectory, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      continue;
    }
    throw error;
  }
  for (const [name, pattern] of patterns) {
    if (pattern.test(content)) {
      findings.push(`${file}: ${name}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Potential secrets found:\n${findings.join('\n')}`);
}

console.log('Secret scan passed.');
