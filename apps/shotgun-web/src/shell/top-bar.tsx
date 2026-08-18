import type { GlobalShellView } from '@shotgun/api-client';

import { useProductLocalization } from '../localization/product-localization.js';
import { GlobalTools } from '../section3/global-tools.js';

export const TopBar = ({ shell }: { readonly shell: GlobalShellView }) => {
  const { t } = useProductLocalization();
  return (
    <header className="top-bar">
      <div>
        <p className="product-name">Shotgun</p>
        <p className="project-summary">
          {t('shell.current_project')}{' '}
          <strong>{shell.activeProject?.label ?? t('shell.not_created')}</strong>
        </p>
      </div>
      <div className="shell-controls">
        <GlobalTools shell={shell} />
      </div>
    </header>
  );
};
