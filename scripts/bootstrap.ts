import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type BootstrapOptions = {
  readonly skipDatabase: boolean;
  readonly skipInstall: boolean;
  readonly resetDatabase: boolean;
  readonly showHelp: boolean;
};

export type BootstrapCommand = {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
};

export type BootstrapCommandRunner = (command: BootstrapCommand) => number;

export class BootstrapCliError extends Error {
  readonly code = 'BOOTSTRAP_INVALID_ARGUMENTS';
  readonly exitCode = 2;
}

export class BootstrapCommandError extends Error {
  readonly code = 'BOOTSTRAP_COMMAND_FAILED';

  constructor(
    readonly commandName: string,
    readonly exitCode: number,
  ) {
    super(`Bootstrap command failed: ${commandName} (exit ${exitCode})`);
  }
}

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const bootstrapHelp = `Usage: npm run bootstrap -- [options]

Options:
  --skip-db       Skip Docker database startup, migration/reset, and verification.
  --skip-install  Skip npm ci.
  --reset-db      Destructively reset the database instead of running migrations.
  --help          Show this help.
`;

export const parseBootstrapOptions = (args: readonly string[]): BootstrapOptions => {
  const supported = new Set(['--skip-db', '--skip-install', '--reset-db', '--help']);
  const unknown = args.filter((argument) => !supported.has(argument));
  if (unknown.length > 0) {
    throw new BootstrapCliError(`Unsupported bootstrap option: ${unknown.join(', ')}`);
  }

  const skipDatabase = args.includes('--skip-db');
  const resetDatabase = args.includes('--reset-db');
  if (skipDatabase && resetDatabase) {
    throw new BootstrapCliError('--skip-db and --reset-db cannot be used together.');
  }

  return {
    skipDatabase,
    skipInstall: args.includes('--skip-install'),
    resetDatabase,
    showHelp: args.includes('--help'),
  };
};

const npmCommand = (
  name: string,
  npmCli: string,
  scriptArgs: readonly string[],
): BootstrapCommand => ({
  name,
  command: process.execPath,
  args: [npmCli, ...scriptArgs],
});

export const buildBootstrapPlan = (
  options: BootstrapOptions,
  environment: NodeJS.ProcessEnv = process.env,
): readonly BootstrapCommand[] => {
  if (options.showHelp) return [];

  const npmCli = environment.npm_execpath;
  if (!npmCli) {
    throw new BootstrapCliError(
      'npm_execpath is required. Run bootstrap through npm run bootstrap.',
    );
  }

  const commands: BootstrapCommand[] = [];
  if (!options.skipInstall) {
    commands.push(npmCommand('install', npmCli, ['ci']));
  }

  if (!options.skipDatabase) {
    commands.push({
      name: 'database-wait',
      command: 'docker',
      args: ['compose', 'up', '-d', '--wait', 'db'],
    });
    commands.push(
      options.resetDatabase
        ? npmCommand('database-reset', npmCli, ['run', 'db:reset'])
        : npmCommand('database-migrate', npmCli, ['run', 'db:migrate']),
    );
    commands.push(npmCommand('database-verify', npmCli, ['run', 'db:verify']));
  }

  return commands;
};

export const defaultBootstrapRunner: BootstrapCommandRunner = (step) => {
  console.log(`[bootstrap] START ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: rootDirectory,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[bootstrap] ERROR ${step.name}: ${result.error.message}`);
    return 1;
  }
  const exitCode = result.status ?? 1;
  if (exitCode === 0) {
    console.log(`[bootstrap] PASS ${step.name}`);
  }
  return exitCode;
};

export const executeBootstrap = (
  args: readonly string[],
  runner: BootstrapCommandRunner = defaultBootstrapRunner,
  environment: NodeJS.ProcessEnv = process.env,
): readonly BootstrapCommand[] => {
  const options = parseBootstrapOptions(args);
  if (options.showHelp) {
    console.log(bootstrapHelp);
    return [];
  }

  const plan = buildBootstrapPlan(options, environment);
  for (const step of plan) {
    const exitCode = runner(step);
    if (exitCode !== 0) {
      throw new BootstrapCommandError(step.name, exitCode);
    }
  }
  return plan;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    executeBootstrap(process.argv.slice(2));
  } catch (error) {
    if (error instanceof BootstrapCliError || error instanceof BootstrapCommandError) {
      console.error(error.message);
      process.exitCode = error.exitCode;
    } else {
      throw error;
    }
  }
}
