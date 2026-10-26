import { Outlet } from 'react-router';
import type { GlobalShellView } from '@shotgun/api-client';
import { RouteFocus } from '../app/route-focus.js';
import { OwnerCommandPalette } from '../commands/owner-command-palette.js';
import { useProductLocalization } from '../localization/product-localization.js';
import { AskShellConversationPane, AskShellGlobalComposer } from '../routes/ask-workspace.js';
import type { OwnerCommandController } from '../section3/global-tools.js';
import { InstrumentPanel } from './instrument-panel.js';
import { PrimaryNavigation } from './primary-navigation.js';

/** Historical approved-knowledge UI remains available outside the VP product. */
export const LegacyShell = ({
  shell,
  controller,
  offline,
}: {
  readonly shell: GlobalShellView;
  readonly controller: OwnerCommandController;
  readonly offline: boolean;
}) => {
  const { t } = useProductLocalization();
  const commandMode = controller.commandMode ?? {
    open: false,
    initialQuery: '',
    resetQuerySignal: 0,
    invoker: null,
  };
  return (
    <div className="pc-global-shell">
      <div className="pc-global-shell__instrument" data-global-shell-region="instrument">
        <InstrumentPanel shell={shell} controller={controller} />
      </div>
      {offline ? (
        <div className="global-banner global-banner-critical" role="alert">
          {t('shell.offline')}
        </div>
      ) : shell.leadingWarning ? (
        <div
          className={`global-banner global-banner-${shell.leadingWarning.severity.toLowerCase()}`}
          role={shell.leadingWarning.severity === 'CRITICAL' ? 'alert' : 'status'}
        >
          {shell.leadingWarning.message}
          {shell.leadingWarning.additionalCount > 0
            ? ` (${shell.leadingWarning.additionalCount} ${t('shell.additional_states')})`
            : ''}
        </div>
      ) : null}
      <div className="pc-global-shell__tree" data-global-shell-region="tree">
        <PrimaryNavigation navigation={shell.navigation} controller={controller} />
      </div>
      <main
        id="main-content"
        className="pc-global-shell__center"
        data-global-shell-region="center"
        tabIndex={-1}
      >
        <RouteFocus />
        <Outlet context={{ shell }} />
        <OwnerCommandPalette
          open={commandMode.open}
          presentation="CENTER"
          commands={controller.commands}
          initialQuery={commandMode.initialQuery}
          resetQuerySignal={commandMode.resetQuerySignal}
          invoker={commandMode.invoker}
          onClose={controller.closeCommandMode ?? (() => undefined)}
          onSelect={(command) => controller.executeCommand(command, commandMode.invoker)}
        />
      </main>
      <div className="pc-global-shell__conversation" data-global-shell-region="conversation">
        <AskShellConversationPane />
      </div>
      <div className="pc-global-shell__composer" data-global-shell-region="composer">
        <AskShellGlobalComposer />
      </div>
    </div>
  );
};
