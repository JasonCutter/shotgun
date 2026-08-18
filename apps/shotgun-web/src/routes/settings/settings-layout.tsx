import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAccessibleDialog } from '../../app/use-accessible-dialog.js';

export const SettingsLayout = () => {
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
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div>
          <p
            className="eyebrow"
            style={{
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)',
            }}
          >
            Settings
          </p>
          <h1 tabIndex={-1} style={{ margin: '4px 0 8px 0', fontSize: '28px', fontWeight: 700 }}>
            Settings & Preferences
          </h1>
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
            <li>
              <NavLink
                to="/settings/ai"
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                AI
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/settings/privacy"
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Privacy
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/settings/preferences"
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Preferences
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/settings/projects"
                className={({ isActive }: { isActive: boolean }) =>
                  isActive ? 'nav-tab active' : 'nav-tab'
                }
              >
                Project
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
              background: 'var(--surface)',
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
                  background: 'var(--danger)',
                  color: '#fff',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius)',
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
