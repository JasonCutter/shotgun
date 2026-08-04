/**
 * Minimal cytoscape type declarations. Cytoscape 3.34.0 is a declared
 * dependency of the repository; the Graph Workspace uses only the read-side
 * surface (elements, layout, event subscription, destroy). Coordinates/zoom/
 * pan are presentation-only and are never sent as authority.
 */
declare module 'cytoscape' {
  type ElementDefinition = {
    data: {
      id: string;
      label?: string;
      source?: string;
      target?: string;
      [key: string]: unknown;
    };
    classes?: string;
    position?: { x: number; y: number };
  };

  type LayoutOptions = {
    name: string;
    animate?: boolean;
    animationDuration?: number;
    [key: string]: unknown;
  };

  type EventObject = {
    target: {
      id(): string;
      data(key?: string): unknown;
      removeClass(classes: string): unknown;
      addClass(classes: string): unknown;
    };
    cy: Core;
  };

  type Collection = {
    on(event: string, handler: (event: EventObject) => void): unknown;
    addClass(classes: string): unknown;
    removeClass(classes: string): unknown;
  };

  type Core = {
    on(event: string, handler: (event: EventObject) => void): Core;
    on(event: string, selector: string, handler: (event: EventObject) => void): Core;
    removeListener(): Core;
    elements(): Collection;
    layout(options: LayoutOptions): { run(): void; stop(): void };
    destroy(): void;
    resize(): void;
    fit(): void;
  };

  function cytoscape(options: {
    container: HTMLElement;
    elements: readonly ElementDefinition[];
    style?: readonly unknown[];
    layout?: LayoutOptions;
    minZoom?: number;
    maxZoom?: number;
    wheelSensitivity?: number;
  }): Core;

  export = cytoscape;
}
