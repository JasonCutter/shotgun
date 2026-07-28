import { describe, expect, it } from 'vitest';

import {
  BootstrapCliError,
  BootstrapCommandError,
  buildBootstrapPlan,
  executeBootstrap,
  parseBootstrapOptions,
} from '../../scripts/bootstrap.js';

const environment = { npm_execpath: '/tmp/npm-cli.js' };

const commandNames = (args: readonly string[]): readonly string[] =>
  buildBootstrapPlan(parseBootstrapOptions(args), environment).map((step) => step.name);

describe('bootstrap command', () => {
  it('runs install, waits for the database, migrates, and verifies by default', () => {
    expect(commandNames([])).toEqual([
      'install',
      'database-wait',
      'database-migrate',
      'database-verify',
    ]);
  });

  it('skips every database command with --skip-db', () => {
    expect(commandNames(['--skip-db'])).toEqual(['install']);
  });

  it('skips only npm install with --skip-install', () => {
    expect(commandNames(['--skip-install'])).toEqual([
      'database-wait',
      'database-migrate',
      'database-verify',
    ]);
  });

  it('uses the destructive reset only when --reset-db is explicit', () => {
    expect(commandNames(['--reset-db'])).toEqual([
      'install',
      'database-wait',
      'database-reset',
      'database-verify',
    ]);
  });

  it('rejects conflicting and unsupported options', () => {
    expect(() => parseBootstrapOptions(['--skip-db', '--reset-db'])).toThrow(BootstrapCliError);
    expect(() => parseBootstrapOptions(['--unknown'])).toThrow(BootstrapCliError);
  });

  it('stops immediately and preserves a failing child exit code', () => {
    const completed: string[] = [];

    expect(() =>
      executeBootstrap(
        [],
        (step) => {
          completed.push(step.name);
          return step.name === 'database-wait' ? 37 : 0;
        },
        environment,
      ),
    ).toThrow(expect.objectContaining<Partial<BootstrapCommandError>>({ exitCode: 37 }));

    expect(completed).toEqual(['install', 'database-wait']);
  });

  it('prints help without constructing or executing commands', () => {
    const completed: string[] = [];
    const plan = executeBootstrap(
      ['--help'],
      (step) => {
        completed.push(step.name);
        return 0;
      },
      {},
    );

    expect(plan).toEqual([]);
    expect(completed).toEqual([]);
  });
});
