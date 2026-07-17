export type RuntimeSecurityConfiguration = {
  readonly host: string;
  readonly production: boolean;
  readonly allowExternalBind: boolean;
  readonly developmentAuthEnabled: boolean;
};

const isLoopbackHost = (host: string): boolean => ['127.0.0.1', '::1', 'localhost'].includes(host);

export const assertRuntimeSecurityConfiguration = (
  configuration: RuntimeSecurityConfiguration,
): void => {
  if (!isLoopbackHost(configuration.host) && !configuration.allowExternalBind) {
    throw new Error('External bind requires ALLOW_EXTERNAL_BIND=true.');
  }
  if (
    configuration.developmentAuthEnabled &&
    (configuration.production || !isLoopbackHost(configuration.host))
  ) {
    throw new Error('Development Auth Adapter is permitted only for local loopback development.');
  }
};
