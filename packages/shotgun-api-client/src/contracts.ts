export type ProductSessionView = {
  readonly apiVersion: '1.0.0';
  readonly principal: {
    readonly id: string;
    readonly actor: {
      readonly type: 'user' | 'service';
      readonly id: string;
    };
    readonly authenticationMethod: 'session' | 'development';
  };
  readonly activeProject: { readonly id: string };
  readonly accessibleProjects: readonly {
    readonly id: string;
    readonly isOwner: boolean;
  }[];
  readonly session: { readonly expiresAt: string | null };
};

export type ProductApiErrorBody = {
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
};

export type LoginRequest = {
  readonly accountId: string;
  readonly password: string;
  readonly projectId: string;
};

export type RequestOptions = {
  readonly signal?: AbortSignal;
};

export type ShotgunApiClient = {
  login(input: LoginRequest, options?: RequestOptions): Promise<ProductSessionView>;
  bootstrapLocalOwner(options?: RequestOptions): Promise<ProductSessionView>;
  getSession(options?: RequestOptions): Promise<ProductSessionView>;
  switchActiveProject(projectId: string, options?: RequestOptions): Promise<ProductSessionView>;
  logout(options?: RequestOptions): Promise<void>;
};
