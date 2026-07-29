import { useEffect, useRef, useState } from 'react';

import type {
  SessionBoundaryReasonCode,
  SessionBoundaryView,
  SessionRecoveryAction,
} from '@shotgun/api-client';

const REASON_MESSAGES: Record<
  SessionBoundaryReasonCode,
  { readonly title: string; readonly description: string }
> = {
  LOCAL_SESSION_ESTABLISHING: {
    title: 'Preparing Local Owner Session',
    description: 'The local Session boundary is being established.',
  },
  LOCAL_SESSION_READY: {
    title: 'Session ready',
    description: 'The Local Owner Session is ready.',
  },
  LOCAL_SESSION_REESTABLISHING: {
    title: 'Reconnecting Session',
    description:
      'The prior Session is no longer valid. A new Local Owner Session is being established.',
  },
  LOCAL_SERVER_UNAVAILABLE: {
    title: 'Local server unavailable',
    description: 'Check the Shotgun backend process and local network connection.',
  },
  LOCAL_OWNER_DISABLED: {
    title: 'Local Owner Mode is disabled',
    description: 'Enable Local Owner Mode in the server configuration.',
  },
  ORIGIN_NOT_ALLOWED: {
    title: 'Local Owner Session unavailable at this address',
    description: 'The server denied this browser origin.',
  },
  PROVISIONING_FAILED: {
    title: 'Local Owner setup failed',
    description: 'The server could not provision the Local Owner environment.',
  },
  SESSION_REVOKED: {
    title: 'Session ended',
    description: 'The previous Session expired or was revoked. Reconnect to continue.',
  },
};

const ACTION_LABELS: Record<SessionRecoveryAction['id'], string> = {
  RECONNECT: 'Reconnect',
  CHECK_LOCAL_SERVER: 'Check local server status',
  CHECK_SETTINGS: 'Check settings',
};

export const SessionBoundaryScreen = ({
  boundary,
  onReconnect,
}: {
  readonly boundary: SessionBoundaryView;
  readonly onReconnect?: () => void;
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [activeDiagnosticModal, setActiveDiagnosticModal] = useState<
    'SERVER_HELP' | 'SETTINGS_HELP' | null
  >(null);
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const dialogCardRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [boundary.reasonCode]);

  useEffect(() => {
    if (activeDiagnosticModal) {
      const firstInteractive = dialogCardRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (firstInteractive ?? modalHeadingRef.current)?.focus();
    } else if (lastActiveElementRef.current) {
      lastActiveElementRef.current.focus();
      lastActiveElementRef.current = null;
    }
  }, [activeDiagnosticModal]);

  const reasonInfo = boundary.reasonCode
    ? (REASON_MESSAGES[boundary.reasonCode] ?? {
        title: 'Session status requires attention',
        description: 'Refresh the Session status.',
      })
    : {
        title: 'Checking Session',
        description: 'The Session status is being checked.',
      };
  const isEstablishing =
    boundary.sessionState === 'ESTABLISHING' || boundary.sessionState === 'REESTABLISHING';

  const handleAction = (
    action: SessionRecoveryAction,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!action.enabled) return;
    lastActiveElementRef.current = event.currentTarget;
    if (action.id === 'RECONNECT') {
      onReconnect?.();
    } else if (action.id === 'CHECK_LOCAL_SERVER') {
      setActiveDiagnosticModal('SERVER_HELP');
    } else if (action.id === 'CHECK_SETTINGS') {
      setActiveDiagnosticModal('SETTINGS_HELP');
    }
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setActiveDiagnosticModal(null);
      return;
    }
    if (event.key !== 'Tab' || !dialogCardRef.current) return;

    const focusables = Array.from(
      dialogCardRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables.at(-1);
    if (!first || !last) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (event.shiftKey && (!active || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="session-boundary-screen"
      role={isEstablishing ? 'status' : 'alert'}
      aria-live="polite"
    >
      <div className="session-boundary-card">
        <p className="eyebrow">Local Owner Boundary</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {reasonInfo.title}
        </h1>
        <p className="description">{reasonInfo.description}</p>

        {boundary.recoveryActions.length > 0 ? (
          <div className="recovery-actions" role="group" aria-label="Recovery actions">
            {boundary.recoveryActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={`button ${
                  action.id === 'RECONNECT' ? 'button-primary' : 'button-secondary'
                }`}
                disabled={!action.enabled || isEstablishing}
                onClick={(event) => handleAction(action, event)}
              >
                {ACTION_LABELS[action.id]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {activeDiagnosticModal ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diagnostic-dialog-title"
          onClick={() => setActiveDiagnosticModal(null)}
          onKeyDown={handleDialogKeyDown}
        >
          <div
            ref={dialogCardRef}
            className="modal-card"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="diagnostic-dialog-title" ref={modalHeadingRef} tabIndex={-1}>
              {activeDiagnosticModal === 'SERVER_HELP'
                ? 'Local server diagnostics'
                : 'Local environment settings'}
            </h2>
            <div className="help-content">
              <p>
                {activeDiagnosticModal === 'SERVER_HELP'
                  ? 'Verify that the Shotgun backend is running and reachable.'
                  : 'Verify the Local Owner Mode and Session configuration.'}
              </p>
              <ul>
                <li>The default backend address is 127.0.0.1:3000.</li>
                <li>Confirm that the backend process is healthy.</li>
                <li>Use the health endpoint without entering secrets.</li>
              </ul>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => setActiveDiagnosticModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
