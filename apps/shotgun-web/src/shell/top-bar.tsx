import type { GlobalShellView } from '@shotgun/api-client';

import { GlobalTools } from '../section3/global-tools.js';

export const TopBar = ({ shell }: { readonly shell: GlobalShellView }) => (
  <header className="top-bar">
    <div>
      <p className="product-name">Shotgun</p>
      <p className="project-summary">
        Current project <strong>{shell.activeProject?.label ?? 'Not created'}</strong>
      </p>
    </div>
    <div className="shell-controls">
      <GlobalTools shell={shell} />
    </div>
  </header>
);
