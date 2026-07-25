import type {
  ProductSessionView,
  SessionBoundaryView,
} from '../../contracts/src/frontend-entry.js';

export type { ProductSessionView, SessionBoundaryView };

export type ProductApiErrorBody = {
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
};

export type RequestOptions = {
  readonly signal?: AbortSignal;
};

export type ShotgunApiClient = {
  bootstrapLocalOwner(options?: RequestOptions): Promise<ProductSessionView>;
  getSession(options?: RequestOptions): Promise<ProductSessionView>;
  switchActiveProject(projectId: string, options?: RequestOptions): Promise<ProductSessionView>;
  logout(options?: RequestOptions): Promise<void>;
};
