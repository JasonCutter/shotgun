import type { GlobalShellView, ProductSessionView } from '@shotgun/api-client';

import { ProjectSelector } from '../session/project-selector.js';
import { GlobalTools } from '../section3/global-tools.js';

export const TopBar = ({
  session,
  shell,
}: {
  readonly session: ProductSessionView;
  readonly shell: GlobalShellView;
}) => (
  <header className="top-bar">
    <div>
      <p className="product-name">Shotgun</p>
      <p className="project-summary">
        Current project <strong>{shell.activeProject?.label ?? 'Not created'}</strong>
      </p>
    </div>
    <div className="shell-controls">
      <ProjectSelector session={session} shell={shell} />
      <GlobalTools shell={shell} />
    </div>
  </header>
);
