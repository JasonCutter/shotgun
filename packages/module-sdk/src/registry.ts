import { intersects, satisfies } from 'semver';

import { SchemaRegistry, ShotgunError } from '../../contracts/src/index.js';
import { validateManifest } from './manifest.js';
import type {
  CapabilityDefinition,
  ContractRequirement,
  RegisteredCommandHandler,
  RegisteredEventHandler,
  RegisteredQueryHandler,
  HandoffPolicy,
  ShotgunModule,
} from './types.js';

export const RUNTIME_VERSION = '1.0.0';

const routeKey = (messageType: string) => messageType;

const requirementFor = (
  requirements: readonly ContractRequirement[],
  messageType: string,
): ContractRequirement | undefined =>
  requirements.find((requirement) => requirement.name === messageType);

export class ModuleRegistry {
  readonly schemas = new SchemaRegistry();

  private readonly modules = new Map<string, ShotgunModule>();
  private readonly commandRoutes = new Map<string, RegisteredCommandHandler>();
  private readonly eventRoutes = new Map<string, RegisteredEventHandler[]>();
  private readonly queryRoutes = new Map<string, RegisteredQueryHandler>();
  private started = false;

  register(module: ShotgunModule): void {
    if (this.started) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'Modules cannot be registered after the registry has started.',
        module: 'module-registry',
        operation: 'register-module',
      });
    }
    if (this.modules.has(module.manifest.id)) {
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: `Module '${module.manifest.id}' is already registered.`,
        module: 'module-registry',
        operation: 'register-module',
      });
    }
    this.modules.set(module.manifest.id, module);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.commandRoutes.clear();
    this.eventRoutes.clear();
    this.queryRoutes.clear();

    for (const module of this.modules.values()) {
      validateManifest(module.manifest, RUNTIME_VERSION);
      for (const contract of module.contracts) {
        this.schemas.register(contract);
      }
    }

    for (const module of this.modules.values()) {
      this.validateContractCompatibility(module);
      this.registerHandlers(module);
    }
    this.validateRequiredCapabilities();
    this.validateHandoffs();

    for (const module of this.modules.values()) {
      await module.initialize?.();
    }
    this.started = true;
  }

  async shutdown(): Promise<void> {
    for (const module of [...this.modules.values()].reverse()) {
      await module.shutdown?.();
    }
    this.started = false;
  }

  list(): readonly ShotgunModule['manifest'][] {
    return [...this.modules.values()].map((module) => module.manifest);
  }

  getCommandHandler(messageType: string, version: string): RegisteredCommandHandler {
    const route = this.commandRoutes.get(routeKey(messageType));
    if (!route) {
      throw this.routeNotFound('command', messageType);
    }
    this.assertHandlerVersion(route.module.manifest.consumes.commands, messageType, version);
    return route;
  }

  getEventHandlers(messageType: string, version: string): readonly RegisteredEventHandler[] {
    const routes = this.eventRoutes.get(routeKey(messageType)) ?? [];
    for (const route of routes) {
      this.assertHandlerVersion(route.module.manifest.consumes.events, messageType, version);
    }
    return routes;
  }

  getQueryHandler(messageType: string, version: string): RegisteredQueryHandler {
    const route = this.queryRoutes.get(routeKey(messageType));
    if (!route) {
      throw this.routeNotFound('query', messageType);
    }
    this.assertHandlerVersion(route.module.manifest.provides.queries, messageType, version);
    return route;
  }

  findCapability(
    name: string,
  ): { readonly moduleId: string; readonly priority: number } | undefined {
    const providers = [...this.modules.values()]
      .flatMap((module) =>
        module.manifest.provides.capabilities
          .filter((capability) => capability.name === name)
          .map((capability) => ({
            moduleId: module.manifest.id,
            priority: capability.priority ?? 0,
          })),
      )
      .sort(
        (left, right) =>
          right.priority - left.priority || left.moduleId.localeCompare(right.moduleId),
      );
    return providers[0];
  }

  private validateContractCompatibility(module: ShotgunModule): void {
    for (const requirement of module.manifest.compatibility.contracts) {
      this.schemas.assertSupported(requirement.name, requirement.range);
    }
  }

  private registerHandlers(module: ShotgunModule): void {
    for (const handler of module.handlers.commands) {
      this.assertDeclared(
        module.manifest.consumes.commands,
        handler.messageType,
        handler.version,
        module,
      );
      if (this.commandRoutes.has(routeKey(handler.messageType))) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: `Command '${handler.messageType}' has more than one handler.`,
          module: 'module-registry',
          operation: 'build-command-routes',
        });
      }
      this.commandRoutes.set(routeKey(handler.messageType), { module, handler });
    }

    for (const handler of module.handlers.events) {
      this.assertDeclared(
        module.manifest.consumes.events,
        handler.messageType,
        handler.version,
        module,
      );
      const routes = this.eventRoutes.get(routeKey(handler.messageType)) ?? [];
      routes.push({ module, handler });
      this.eventRoutes.set(routeKey(handler.messageType), routes);
    }

    for (const handler of module.handlers.queries) {
      this.assertDeclared(
        module.manifest.provides.queries,
        handler.messageType,
        handler.version,
        module,
      );
      if (this.queryRoutes.has(routeKey(handler.messageType))) {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: `Query '${handler.messageType}' has more than one provider.`,
          module: 'module-registry',
          operation: 'build-query-routes',
        });
      }
      this.queryRoutes.set(routeKey(handler.messageType), { module, handler });
    }

    for (const produced of module.manifest.produces.events) {
      this.schemas.assertSupported(produced.name, produced.range);
    }
  }

  private validateRequiredCapabilities(): void {
    for (const module of this.modules.values()) {
      for (const capability of module.manifest.requires.capabilities) {
        if (!this.findCapability(capability)) {
          throw new ShotgunError({
            code: 'NOT_FOUND',
            safeMessage: `Module '${module.manifest.id}' requires missing capability '${capability}'.`,
            module: 'module-registry',
            operation: 'validate-assembly',
          });
        }
      }
    }
  }

  /**
   * Validate edge-level producer handoff declarations against the routes that
   * are actually registered. This intentionally does not assert that a
   * metadata authority string has persisted anything; the corresponding
   * Contract/Integration tests own that runtime proof.
   */
  private validateHandoffs(): void {
    for (const producer of this.modules.values()) {
      const { events, handoffs } = producer.manifest.produces;
      for (const produced of events) {
        const edges = handoffs.filter((handoff) => handoff.event.name === produced.name);
        if (edges.length === 0) {
          throw new ShotgunError({
            code: 'POLICY_DENIED',
            safeMessage: `Produced event '${produced.name}' in module '${producer.manifest.id}' has no handoff or intentional disposition.`,
            module: 'module-registry',
            operation: 'validate-handoff-completeness',
          });
        }
      }

      for (const handoff of handoffs) {
        this.validateHandoffEvent(producer, handoff);
        if (handoff.target.kind === 'consumer') {
          this.validateConsumerHandoff(handoff);
        }
      }
    }

    // A required handler is itself a declaration of a critical edge. Require
    // the producer manifest to say the same thing, preventing one-sided flags.
    for (const routes of this.eventRoutes.values()) {
      for (const route of routes) {
        if (route.handler.requiredForPublisherAcknowledgement !== true) continue;
        const producerRegistered = [...this.modules.values()].some((producer) =>
          producer.manifest.produces.events.some(
            (produced) => produced.name === route.handler.messageType,
          ),
        );
        // A partial assembly may include a consumer before the producer is
        // composed. Once the producer is registered, however, its handoff
        // declaration must bind this required handler (fail closed below).
        if (!producerRegistered) continue;
        const matched = [...this.modules.values()].some((producer) =>
          producer.manifest.produces.handoffs.some(
            (handoff) =>
              handoff.event.name === route.handler.messageType &&
              handoff.tags.includes('REQUIRED_ACK') &&
              handoff.target.kind === 'consumer' &&
              handoff.target.moduleId === route.module.manifest.id &&
              this.rangesIntersect(handoff.event.range, route.handler.version),
          ),
        );
        if (!matched) {
          throw new ShotgunError({
            code: 'POLICY_DENIED',
            safeMessage: `Required handler '${route.handler.messageType}' in module '${route.module.manifest.id}' has no matching REQUIRED_ACK handoff.`,
            module: 'module-registry',
            operation: 'validate-required-handoff-bidirectionality',
          });
        }
      }
    }
  }

  private validateHandoffEvent(producer: ShotgunModule, handoff: HandoffPolicy): void {
    const declared = requirementFor(producer.manifest.produces.events, handoff.event.name);
    if (!declared) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Handoff event '${handoff.event.name}' is not declared by producer module '${producer.manifest.id}'.`,
        module: 'module-registry',
        operation: 'validate-handoff-event',
      });
    }
    if (!this.rangesIntersect(declared.range, handoff.event.range)) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Handoff range '${handoff.event.range}' is incompatible with producer declaration '${declared.range}' for '${handoff.event.name}'.`,
        module: 'module-registry',
        operation: 'validate-handoff-event-version',
      });
    }
    if (handoff.tags.includes('REQUIRED_ACK') && handoff.target.kind !== 'consumer') {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: `REQUIRED_ACK handoff '${handoff.event.name}' must target a registered consumer module.`,
        module: 'module-registry',
        operation: 'validate-required-handoff-target',
      });
    }
  }

  private validateConsumerHandoff(handoff: HandoffPolicy): void {
    if (handoff.target.kind !== 'consumer') return;
    const consumer = this.modules.get(handoff.target.moduleId);
    if (!consumer) {
      // Registry validation is assembly-local. A partial assembly may stop at
      // this edge; when the target is present, all contract and handler facts
      // below are still fail-closed. The complete production assembly
      // registers every REQUIRED_ACK target and therefore binds its flag.
      return;
    }
    const consumed = requirementFor(consumer.manifest.consumes.events, handoff.event.name);
    if (!consumed || !this.rangesIntersect(consumed.range, handoff.event.range)) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Consumer module '${consumer.manifest.id}' does not consume compatible '${handoff.event.name}'.`,
        module: 'module-registry',
        operation: 'validate-handoff-consumer-contract',
      });
    }
    const routes = this.eventRoutes.get(routeKey(handoff.event.name)) ?? [];
    const route = routes.find((candidate) => candidate.module.manifest.id === consumer.manifest.id);
    if (!route) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: `Handoff '${handoff.event.name}' targets module '${consumer.manifest.id}', but no event handler route is registered.`,
        module: 'module-registry',
        operation: 'resolve-handoff-route',
      });
    }
    if (!this.rangesIntersect(handoff.event.range, route.handler.version)) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Handoff '${handoff.event.name}' targets module '${consumer.manifest.id}', but the handler version is incompatible.`,
        module: 'module-registry',
        operation: 'validate-handoff-handler-version',
      });
    }
    if (handoff.tags.includes('REQUIRED_ACK')) {
      const required = routes.some(
        (candidate) =>
          candidate.module.manifest.id === consumer.manifest.id &&
          candidate.handler.requiredForPublisherAcknowledgement === true,
      );
      if (!required) {
        throw new ShotgunError({
          code: 'POLICY_DENIED',
          safeMessage: `REQUIRED_ACK handoff '${handoff.event.name}' to '${consumer.manifest.id}' is not bound to a required publisher acknowledgement handler.`,
          module: 'module-registry',
          operation: 'validate-required-handoff-handler',
        });
      }
    } else if (
      handoff.tags.some(
        (tag) => tag === 'INTENTIONAL_BEST_EFFORT' || tag === 'INTENTIONAL_TERMINAL',
      ) &&
      routes.some(
        (candidate) =>
          candidate.module.manifest.id === consumer.manifest.id &&
          candidate.handler.requiredForPublisherAcknowledgement === true,
      )
    ) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: `Intentional handoff '${handoff.event.name}' cannot target a required consumer '${consumer.manifest.id}'.`,
        module: 'module-registry',
        operation: 'validate-intentional-handoff',
      });
    }
  }

  private rangesIntersect(left: string, right: string): boolean {
    try {
      return intersects(left, right, { includePrerelease: true });
    } catch {
      return false;
    }
  }

  private assertDeclared(
    requirements: readonly ContractRequirement[],
    messageType: string,
    version: string,
    module: ShotgunModule,
  ): void {
    const requirement = requirementFor(requirements, messageType);
    if (!requirement || !satisfies(version, requirement.range)) {
      throw new ShotgunError({
        code: 'UNSUPPORTED_SCHEMA',
        safeMessage: `Handler '${messageType}@${version}' does not match module '${module.manifest.id}' Manifest.`,
        module: 'module-registry',
        operation: 'validate-handler-manifest',
      });
    }
    this.schemas.assertVersionInRange(messageType, version, requirement.range);
  }

  private assertHandlerVersion(
    requirements: readonly ContractRequirement[],
    messageType: string,
    version: string,
  ): void {
    const requirement = requirementFor(requirements, messageType);
    if (!requirement) {
      throw this.routeNotFound('handler', messageType);
    }
    this.schemas.assertVersionInRange(messageType, version, requirement.range);
  }

  private routeNotFound(kind: string, messageType: string): ShotgunError {
    return new ShotgunError({
      code: 'NOT_FOUND',
      safeMessage: `No ${kind} route is registered for '${messageType}'.`,
      module: 'module-registry',
      operation: 'resolve-route',
    });
  }
}

export const capability = (name: string, priority = 0): CapabilityDefinition => ({
  name,
  priority,
});
