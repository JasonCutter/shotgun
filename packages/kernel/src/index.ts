export type ModuleManifest = {
  readonly id: string;
  readonly version: string;
  readonly owner: string;
  readonly compatibility: {
    readonly kernel: string;
  };
  readonly dataOwnership: readonly string[];
  readonly capabilities: readonly string[];
};

export type ShotgunModule = {
  readonly manifest: ModuleManifest;
  initialize?: () => void | Promise<void>;
};

export class ModuleRegistry {
  private readonly modules = new Map<string, ShotgunModule>();

  async register(module: ShotgunModule): Promise<void> {
    if (this.modules.has(module.manifest.id)) {
      throw new Error(`Module '${module.manifest.id}' is already registered.`);
    }

    await module.initialize?.();
    this.modules.set(module.manifest.id, module);
  }

  list(): readonly ModuleManifest[] {
    return [...this.modules.values()].map((module) => module.manifest);
  }
}
