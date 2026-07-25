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

  useEffect(() => {
    headingRef.current?.focus();
  }, [boundary.reasonCode]);

  useEffect(() => {
    if (activeDiagnosticModal) {
      modalHeadingRef.current?.focus();
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

  const handleAction = (action: SessionRecoveryAction) => {
    if (!action.enabled) return;
    if (action.id === 'RECONNECT') {
      onReconnect?.();
    } else if (action.id === 'CHECK_LOCAL_SERVER') {
      setActiveDiagnosticModal('SERVER_HELP');
    } else if (action.id === 'CHECK_SETTINGS') {
      setActiveDiagnosticModal('SETTINGS_HELP');
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
                onClick={() => handleAction(act)}
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
          onKeyDown={(e) => {
            if (e.key === 'Escape') setActiveDiagnosticModal(null);
          }}
        >
          <div className="modal-card" tabIndex={-1}>
            <h2 id="diagnostic-dialog-title" ref={modalHeadingRef} tabIndex={-1}>
              {activeDiagnosticModal === 'SERVER_HELP'
                ? '로컬 서버 상태 진단'
                : '로컬 환경 설정 안내'}
            </h2>
            {activeDiagnosticModal === 'SERVER_HELP' ? (
              <div className="help-content">
                <p>Shotgun 백엔드 서버 프로세스가 정상 실행 중인지 확인해 주세요.</p>
                <ul>
                  <li>서버 프로세스 실행 상태 (`npm run dev` 또는 백엔드 서비스)</li>
                  <li>엔드포인트 통신 가능 여부 (기본 API 엔드포인트 `/api/v1/health`)</li>
                  <li>방화벽 및 로컬 포트 바인딩 상태</li>
                </ul>
              </div>
            ) : (
              <div className="help-content">
                <p>Local Owner Mode 설정 및 세션 환경변수를 확인해 주세요.</p>
                <ul>
                  <li>설정 파일 위치: `config/shotgun.config.json` 또는 환경변수 설정</li>
                  <li>`SHOTGUN_LOCAL_OWNER_ENABLED=true` 설정 여부</li>
                  <li>허용된 Origin (`http://127.0.0.1:*`, `http://localhost:*`) 접근 여부</li>
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
