import { useEffect, useRef, useState } from 'react';

import type {
  SessionBoundaryReasonCode,
  SessionBoundaryView,
  SessionRecoveryAction,
} from '@shotgun/api-client';

const REASON_MESSAGES: Record<SessionBoundaryReasonCode, { title: string; description: string }> = {
  LOCAL_SESSION_ESTABLISHING: {
    title: '로컬 Session 준비 중',
    description: 'Local Owner Session 환경을 준비하는 중입니다.',
  },
  LOCAL_SESSION_READY: {
    title: 'Session 준비 완료',
    description: 'Local Owner Session이 수립되었습니다.',
  },
  LOCAL_SESSION_REESTABLISHING: {
    title: 'Session 다시 연결 중',
    description: '기존 Session 무효화 후 Local Owner Session을 다시 수립하고 있습니다.',
  },
  LOCAL_SERVER_UNAVAILABLE: {
    title: '로컬 서버에 연결할 수 없음',
    description: 'Shotgun 로컬 서버 프로세스 또는 네트워크 연결 상태를 확인해 주세요.',
  },
  LOCAL_OWNER_DISABLED: {
    title: 'Local Owner Mode가 비활성화됨',
    description: '현재 서버 설정에서 Local Owner Mode가 활성화되어 있지 않습니다.',
  },
  ORIGIN_NOT_ALLOWED: {
    title: '현재 주소에서는 Local Owner Session을 사용할 수 없음',
    description: '허용되지 않은 Origin 또는 외부 주소에서의 접근이 차단되었습니다.',
  },
  PROVISIONING_FAILED: {
    title: 'Local Owner 환경을 준비하지 못함',
    description: 'Local Owner 계정 및 기본 Project 프로비저닝에 실패했습니다.',
  },
  SESSION_REVOKED: {
    title: '기존 Session이 종료됨',
    description: '이전 Session이 만료되었거나 폐기되었습니다. 다시 연결을 시도해 주세요.',
  },
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
      // Open 시 첫 번째 실제 Interactive Element로 Focus 이동
      const firstInteractive = dialogCardRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (firstInteractive) {
        firstInteractive.focus();
      } else {
        modalHeadingRef.current?.focus();
      }
    } else if (lastActiveElementRef.current) {
      lastActiveElementRef.current.focus();
      lastActiveElementRef.current = null;
    }
  }, [activeDiagnosticModal]);

  const reasonInfo = boundary.reasonCode
    ? (REASON_MESSAGES[boundary.reasonCode] ?? {
        title: 'Session 상태 확인 필요',
        description: 'Session 상태를 다시 확인해 주세요.',
      })
    : { title: 'Session 연결 확인 중', description: 'Session 상태를 확인하는 중입니다.' };

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

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setActiveDiagnosticModal(null);
      return;
    }

    if (e.key === 'Tab' && dialogCardRef.current) {
      const focusables = Array.from(
        dialogCardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;

      const currentActive = document.activeElement as HTMLElement | null;
      const isInsideFocusables = currentActive && focusables.includes(currentActive);

      if (e.shiftKey) {
        if (
          !isInsideFocusables ||
          currentActive === first ||
          currentActive === modalHeadingRef.current ||
          currentActive === dialogCardRef.current
        ) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!isInsideFocusables || currentActive === last) {
          e.preventDefault();
          first.focus();
        }
      }
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
            {boundary.recoveryActions.map((act: SessionRecoveryAction) => (
              <button
                key={act.id}
                type="button"
                className={`button ${act.id === 'RECONNECT' ? 'button-primary' : 'button-secondary'}`}
                disabled={!act.enabled || isEstablishing}
                onClick={(e) => handleAction(act, e)}
              >
                {act.label}
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
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="diagnostic-dialog-title" ref={modalHeadingRef} tabIndex={-1}>
              {activeDiagnosticModal === 'SERVER_HELP'
                ? '로컬 서버 상태 진단'
                : '로컬 환경 설정 안내'}
            </h2>
            {activeDiagnosticModal === 'SERVER_HELP' ? (
              <div className="help-content">
                <p>실행 중인 Shotgun Backend의 HOST·PORT 환경변수를 확인하세요.</p>
                <ul>
                  <li>기본값은 HOST=127.0.0.1, PORT=3000입니다.</li>
                  <li>백엔드 서버 프로세스가 정상 실행 중인지 확인해 주세요.</li>
                  <li>API Health 엔드포인트 응답 상태 (`/api/v1/health`)</li>
                </ul>
              </div>
            ) : (
              <div className="help-content">
                <p>Local Owner Mode 설정 및 세션 환경변수를 확인해 주세요.</p>
                <ul>
                  <li>실행 중인 Shotgun Backend의 HOST·PORT 환경변수를 확인하세요.</li>
                  <li>기본값은 HOST=127.0.0.1, PORT=3000입니다.</li>
                  <li>Local Owner 계정 준비 상태를 확인해 주세요.</li>
                </ul>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => setActiveDiagnosticModal(null)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
