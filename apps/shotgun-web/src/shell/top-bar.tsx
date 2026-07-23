import type { ProductSessionView } from '@shotgun/api-client';

export const TopBar = ({ session }: { readonly session: ProductSessionView }) => (
  <header className="top-bar">
    <div>
      <p className="product-name">Shotgun</p>
      <p className="project-summary">
        Principal <strong>{session.principal.id}</strong> | 현재 Project{' '}
        <strong>{session.activeProject.id}</strong>
      </p>
    </div>
  </header>
);
