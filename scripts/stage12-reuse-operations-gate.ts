import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type GateStep = {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('npm_execpath is required to run the Stage 12.1 Reuse and Operations Gate.');
}

const npmStep = (name: string, script: string): GateStep => ({
  name,
  command: process.execPath,
  args: [npmCli, 'run', script],
});

const steps: readonly GateStep[] = [
  npmStep('standalone-packages', 'test:stage12-package'),
  {
    name: 'assembly-readiness-adapter-and-exposure-contracts',
    command: process.execPath,
    args: [
      path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      'tests/unit/health.test.ts',
      'tests/unit/runtime-security.test.ts',
      'tests/contract/document-review-assembly.contract.test.ts',
      'tests/integration/action-execution-api.test.ts',
    ],
  },
  npmStep('quality-gate', 'quality:gate'),
  npmStep('database-verify', 'db:verify'),
  npmStep('secret-scan', 'secret:scan'),
  npmStep('oss-gate', 'oss:verify'),
];

const completed: { name: string; status: 'PASS' }[] = [];
for (const step of steps) {
  console.log(`[stage12:reuse-operations-gate] START ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[stage12:reuse-operations-gate] ERROR ${step.name}: ${result.error.message}`);
    process.exitCode = 1;
    break;
  }
  if (result.status !== 0) {
    console.error(
      `[stage12:reuse-operations-gate] FAIL ${step.name}: exit ${result.status ?? 'unknown'}`,
    );
    process.exitCode = 1;
    break;
  }
  completed.push({ name: step.name, status: 'PASS' });
  console.log(`[stage12:reuse-operations-gate] PASS ${step.name}`);
}

console.log(
  JSON.stringify({
    gate: 'stage12:reuse-operations-gate',
    status: completed.length === steps.length ? 'PASS' : 'FAIL',
    completed,
    requiredSteps: steps.map((step) => step.name),
  }),
);
