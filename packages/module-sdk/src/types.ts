import type {
  CommandEnvelope,
  ContractDefinition,
  EventEnvelope,
  QueryEnvelope,
  QueryResultEnvelope,
} from '../../contracts/src/index.js';

export type ContractRequirement = {
  readonly name: string;
  readonly range: string;
};

export type CapabilityDefinition = {
  readonly name: string;
  readonly priority?: number;
};

export type RequiredSecurityContext = 'actor' | 'project' | 'access_scope' | 'sensitivity';

export type ModuleManifest = {
  readonly id: string;
  readonly version: string;
  readonly owner: string;
  readonly compatibility: {
    readonly runtime: string;
    readonly contracts: readonly ContractRequirement[];
  };
  readonly deployment: {
    readonly modes: readonly ('in_process' | 'worker')[];
  };
  readonly dataOwnership: {
    readonly owns: readonly string[];
    readonly readsViaPorts: readonly string[];
    readonly directSchemaAccess: false;
  };
  readonly consumes: {
    readonly commands: readonly ContractRequirement[];
    readonly events: readonly ContractRequirement[];
  };
  readonly produces: {
    readonly events: readonly ContractRequirement[];
  };
  readonly provides: {
    readonly queries: readonly ContractRequirement[];
    readonly capabilities: readonly CapabilityDefinition[];
  };
  readonly requires: {
    readonly capabilities: readonly string[];
  };
  readonly security: {
    readonly requiredContext: readonly RequiredSecurityContext[];
    readonly defaultOnMissingContext: 'deny';
  };
  readonly approvalPolicy: {
    readonly canWriteCanonical: boolean;
    readonly canExecuteExternalAction: boolean;
  };
};

export type AssemblyAdapterSelection = {
  readonly port: string;
  readonly selected: string;
  readonly alternatives: readonly string[];
};

export type AssemblyManifest = {
  readonly id: string;
  readonly version: string;
  readonly compatibility: {
    readonly runtime: string;
  };
  readonly modules: readonly ContractRequirement[];
  readonly requiredCapabilities: readonly string[];
  readonly adapters: Readonly<Record<string, AssemblyAdapterSelection>>;
  readonly policies: {
    readonly canonicalWrite: 'disabled' | 'explicit-user-approval';
    readonly externalAction: 'disabled' | 'risk-based-approval';
    readonly missingSecurityContext: 'deny';
    readonly audioVideoAnalysis: 'disabled';
  };
};

export type PublishEventInput<TPayload> = {
  readonly messageType: string;
  readonly schemaVersion: string;
  readonly idempotencyKey: string;
  readonly payload: TPayload;
  readonly orderingKey?: string;
  readonly sequence?: number;
};

export type DispatchQueryInput<TPayload> = {
  readonly messageType: string;
  readonly schemaVersion: string;
  readonly payload: TPayload;
};

export type HandlerContext = {
  readonly moduleId: string;
  readonly attemptNumber: number;
  publish<TPayload>(input: PublishEventInput<TPayload>): Promise<void>;
  query<TPayload, TResult>(
    input: DispatchQueryInput<TPayload>,
  ): Promise<QueryResultEnvelope<TResult>>;
};

type HandlerSecurity = {
  readonly requiredAccessScopes?: readonly string[];
  readonly timeoutMs?: number;
};

export type CommandHandlerDefinition<TPayload = unknown, TResult = unknown> = HandlerSecurity & {
  readonly messageType: string;
  readonly version: string;
  handle(envelope: CommandEnvelope<TPayload>, context: HandlerContext): Promise<TResult> | TResult;
};

export type EventHandlerDefinition<TPayload = unknown> = HandlerSecurity & {
  readonly messageType: string;
  readonly version: string;
  handle(envelope: EventEnvelope<TPayload>, context: HandlerContext): Promise<void> | void;
};

export type QueryHandlerDefinition<TPayload = unknown, TResult = unknown> = HandlerSecurity & {
  readonly messageType: string;
  readonly version: string;
  handle(envelope: QueryEnvelope<TPayload>, context: HandlerContext): Promise<TResult> | TResult;
};

export type ShotgunModule = {
  readonly manifest: ModuleManifest;
  readonly contracts: readonly ContractDefinition[];
  readonly handlers: {
    readonly commands: readonly CommandHandlerDefinition[];
    readonly events: readonly EventHandlerDefinition[];
    readonly queries: readonly QueryHandlerDefinition[];
  };
  initialize?(): Promise<void> | void;
  shutdown?(): Promise<void> | void;
};

export type RegisteredCommandHandler = {
  readonly module: ShotgunModule;
  readonly handler: CommandHandlerDefinition;
};

export type RegisteredEventHandler = {
  readonly module: ShotgunModule;
  readonly handler: EventHandlerDefinition;
};

export type RegisteredQueryHandler = {
  readonly module: ShotgunModule;
  readonly handler: QueryHandlerDefinition;
};
