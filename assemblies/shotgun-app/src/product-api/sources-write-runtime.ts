import type { FrontendCommandGatewayPort } from '../../../../modules/frontend-command-gateway/src/index.js';
import type { SourcesStagingServicePort } from '../../../../modules/frontend-sources-staging/src/index.js';
import type { SourcesProductWriteServicePort } from '../../../../modules/frontend-sources-write/src/product-service.js';

export type SourcesWriteRuntime = {
  readonly commandGateway: FrontendCommandGatewayPort;
  readonly staging: SourcesStagingServicePort;
  readonly productService: SourcesProductWriteServicePort;
};

let activeRuntime: SourcesWriteRuntime | undefined;

export const configureSourcesWriteRuntime = (runtime: SourcesWriteRuntime): (() => void) => {
  if (activeRuntime && activeRuntime !== runtime) {
    throw new Error('Sources write runtime is already configured.');
  }
  activeRuntime = runtime;
  return () => {
    if (activeRuntime === runtime) activeRuntime = undefined;
  };
};

export const getSourcesWriteRuntime = (): SourcesWriteRuntime | undefined => activeRuntime;
