import Ajv, { type AnySchemaObject, type ValidateFunction } from 'ajv';
import { satisfies, valid } from 'semver';

import { ShotgunError } from './errors.js';

export type ContractKind = 'command' | 'event' | 'query';

export type ContractDefinition = {
  readonly name: string;
  readonly version: string;
  readonly kind: ContractKind;
  readonly inputSchema: AnySchemaObject;
  readonly outputSchema?: AnySchemaObject;
};

type CompiledContract = ContractDefinition & {
  readonly validateInput: ValidateFunction;
  readonly validateOutput?: ValidateFunction;
};

const contractKey = (name: string, version: string) => `${name}@${version}`;

export class SchemaRegistry {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });
  private readonly contracts = new Map<string, CompiledContract>();

  register(definition: ContractDefinition): void {
    if (!valid(definition.version)) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Contract '${definition.name}' has an invalid semantic version.`,
        module: 'contracts',
        operation: 'register-schema',
      });
    }

    const key = contractKey(definition.name, definition.version);
    const existing = this.contracts.get(key);
    if (existing) {
      const sameDefinition =
        existing.kind === definition.kind &&
        JSON.stringify(existing.inputSchema) === JSON.stringify(definition.inputSchema) &&
        JSON.stringify(existing.outputSchema) === JSON.stringify(definition.outputSchema);
      if (!sameDefinition) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: `Contract '${key}' was registered with a different schema.`,
          module: 'contracts',
          operation: 'register-schema',
        });
      }
      return;
    }

    this.contracts.set(key, {
      ...definition,
      validateInput: this.ajv.compile(definition.inputSchema),
      validateOutput: definition.outputSchema
        ? this.ajv.compile(definition.outputSchema)
        : undefined,
    });
  }

  validateInput(name: string, version: string, payload: unknown): void {
    const contract = this.get(name, version);
    if (!contract.validateInput(payload)) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Message '${name}@${version}' does not match its input schema: ${this.ajv.errorsText(contract.validateInput.errors)}`,
        module: 'contracts',
        operation: 'validate-input',
      });
    }
  }

  validateOutput(name: string, version: string, payload: unknown): void {
    const contract = this.get(name, version);
    if (!contract.validateOutput) {
      return;
    }
    if (!contract.validateOutput(payload)) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Message '${name}@${version}' does not match its output schema: ${this.ajv.errorsText(contract.validateOutput.errors)}`,
        module: 'contracts',
        operation: 'validate-output',
      });
    }
  }

  assertSupported(name: string, range: string): void {
    const supported = [...this.contracts.values()].some(
      (contract) => contract.name === name && satisfies(contract.version, range),
    );
    if (!supported) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `No registered version of '${name}' satisfies '${range}'.`,
        module: 'contracts',
        operation: 'check-compatibility',
      });
    }
  }

  assertVersionInRange(name: string, version: string, range: string): void {
    this.get(name, version);
    if (!satisfies(version, range)) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Contract '${name}@${version}' is outside supported range '${range}'.`,
        module: 'contracts',
        operation: 'check-version-range',
      });
    }
  }

  list(): readonly ContractDefinition[] {
    return [...this.contracts.values()].map((contract) => ({
      name: contract.name,
      version: contract.version,
      kind: contract.kind,
      inputSchema: contract.inputSchema,
      outputSchema: contract.outputSchema,
    }));
  }

  private get(name: string, version: string): CompiledContract {
    const contract = this.contracts.get(contractKey(name, version));
    if (!contract) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Contract '${name}@${version}' is not registered.`,
        module: 'contracts',
        operation: 'resolve-schema',
      });
    }
    return contract;
  }
}
