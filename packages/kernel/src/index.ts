import {
  ConnectorRuntime,
  type ConnectorRuntimeStatePort,
  type MessageTransport,
} from '../../connector-runtime/src/index.js';
import { ModuleRegistry, type ShotgunModule } from '../../module-sdk/src/index.js';

export class ShotgunKernel {
  readonly registry = new ModuleRegistry();
  readonly connector: ConnectorRuntime;

  private ready = false;

  constructor(
    transport: MessageTransport,
    options: { readonly connectorRuntimeState?: ConnectorRuntimeStatePort } = {},
  ) {
    this.connector = new ConnectorRuntime(this.registry, transport, {
      ...(options.connectorRuntimeState ? { state: options.connectorRuntimeState } : {}),
    });
  }

  register(...modules: readonly ShotgunModule[]): void {
    for (const module of modules) {
      this.registry.register(module);
    }
  }

  async start(): Promise<void> {
    await this.registry.start();
    this.ready = true;
  }

  async shutdown(): Promise<void> {
    await this.registry.shutdown();
    this.ready = false;
  }

  health() {
    return {
      status: this.ready ? ('ok' as const) : ('starting' as const),
      modules: this.registry.list().map((manifest) => manifest.id),
      capabilities: this.registry
        .list()
        .flatMap((manifest) => manifest.provides.capabilities.map((item) => item.name)),
    };
  }
}

export * from '../../connector-runtime/src/index.js';
export * from '../../contracts/src/index.js';
export * from '../../module-sdk/src/index.js';
