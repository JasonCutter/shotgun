import { useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAppRuntime } from '../../app/providers.js';
import { sessionQueryOptions } from '../../session/session-query.js';
import { ProjectSelector } from '../../session/project-selector.js';
import { useAccessibleDialog } from '../../app/use-accessible-dialog.js';

export const SettingsLayout = () => {
  const { apiClient } = useAppRuntime();
  const { data: session } = useQuery(sessionQueryOptions(apiClient));
  const [searchParams] = useSearchParams();

  const activeProjectId = session?.activeProject?.id ?? '';
  const targetProjectId = searchParams.get('targetProjectId') ?? activeProjectId;
  const resourceProjectId = searchParams.get('resourceProjectId') ?? targetProjectId;

  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const closeConfirmation = () => setConfirmModalOpen(false);
  const confirmationDialog = useAccessibleDialog({
    open: confirmModalOpen,
    onClose: closeConfirmation,
  });

  const requestConfirmation = (message: string, action: () => void) => {
    confirmationDialog.captureInvoker(
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    setConfirmMessage(message);
    setConfirmAction(() => action);
    setConfirmModalOpen(true);
  };

  const handleConfirm = () => {
    if (confirmAction) confirmAction();
    closeConfirmation();
  };

  return (
    <div
      className="settings-layout"
      style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}
    >
      <header
        className="settings-header"
        style={{
          marginBottom: '24px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--color-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <p
              className="eyebrow"
              style={{
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#64748b',
              }}
            >
              Policy Control Plane
            </p>
            <h1 tabIndex={-1} style={{ margin: '4px 0 8px 0', fontSize: '28px', fontWeight: 700 }}>
              Settings & Project Administration
            </h1>
            {session && <ProjectSelector session={session} />}
          </div>
          <div
            className="project-context-badges"
            style={{ display: 'flex', gap: '12px', fontSize: '13px' }}
          >
            <span
              className="badge active-project"
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                background: '#e0f2fe',
                color: '#0369a1',
              }}
            >
              Active Project: <strong>{activeProjectId || 'Not created'}</strong>
            </span>
            <span
              className="badge target-project"
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                background: '#f0fdf4',
                color: '#15803d',
              }}
            >
              Target Project: <strong>{targetProjectId}</strong>
            </span>
            {resourceProjectId !== targetProjectId && (
              <span
                className="badge resource-project"
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: '#fef3c7',
                  color: '#b45309',
                }}
              >
                Resource Project: <strong>{resourceProjectId}</strong>
              </span>
            )}
          </div>
        </div>

        <nav aria-label="Settings Categories" style={{ marginTop: '16px' }}>
          <ul
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {activeProjectId ? (
              <li>
                <NavLink
                  end
                  to={`/settings?targetProjectId=${targetProjectId}`}
                  className={({ isActive }: { isActive: boolean }) =>
                    isActive ? 'nav-tab active' : 'nav-tab'
                  }
                >
                  Category Index
                </NavLink>
              </li>
            ) : null}
            {activeProjectId ? (
              <li>
                <NavLink
                  to={`/settings/preferences?targetProjectId=${targetProjectId}`}
                  className={({ isActive }: { isActive: boolean }) =>
                    isActive ? 'nav-tab active' : 'nav-tab'
                  }
                >
                  Preferences
                </NavLink>
              </li>
            ) : null}
            <li>
              <NavLink
                to={`/settings/projects?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Project Admin
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/models?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Models
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/costs?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Costs & Budgets
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/privacy?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Privacy & Sensitivity
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/connectors?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Connectors
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/directives?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Directives & Priority
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/schema?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Schema Packs
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/diagnostics?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Diagnostics
              </NavLink>
            </li>
            <li>
              <NavLink
                to={`/settings/advanced?targetProjectId=${targetProjectId}`}
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Advanced
              </NavLink>
            </li>
          </ul>
        </nav>
      </header>

      <main className="settings-content">
        <Outlet context={{ requestConfirmation }} />
      </main>

      {confirmModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-confirm-dialog-title"
          ref={confirmationDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={confirmationDialog.onDialogKeyDown}
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="modal-card"
            style={{
              background: '#fff',
              padding: '24px',
              borderRadius: '8px',
              maxWidth: '480px',
              width: '100%',
            }}
          >
            <h3 id="settings-confirm-dialog-title">Confirm Action</h3>
            <p>{confirmMessage}</p>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                marginTop: '20px',
              }}
            >
              <button type="button" onClick={closeConfirmation} style={{ padding: '8px 16px' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                style={{
                  padding: '8px 16px',
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
