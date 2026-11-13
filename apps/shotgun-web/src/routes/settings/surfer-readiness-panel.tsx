import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  createSurferReadinessClient,
  type SurferReadiness,
  type SurferReadinessClient,
} from '@shotgun/api-client';
const messages = {
  NOT_CONFIGURED: [
    '실행 설정 필요',
    '운영 관리자가 서퍼 실행 프로필을 등록하고 서버에 연결해야 합니다.',
  ],
  EXTERNAL_EXECUTION: [
    '별도 서버 설정 사용 중',
    '실행 프로필의 등록 상태는 운영 관리자에게 확인해 주세요.',
  ],
  PROFILE_CONNECTED: [
    '실행 프로필 연결 확인',
    '현재 AI 설정·자격·계정 등록이 고정된 실행 프로필과 일치합니다.',
  ],
  CONFIGURATION_CHANGED: [
    'AI 설정 변경 확인 필요',
    '현재 AI 설정과 실행 프로필이 다릅니다. 운영 관리자가 새 설정을 확인하고 다시 연결해야 합니다.',
  ],
  CREDENTIAL_UNAVAILABLE: [
    'AI 자격 확인 필요',
    '연결된 자격을 사용할 수 없습니다. AI 자격 설정을 확인한 뒤 실행 프로필을 다시 연결해 주세요.',
  ],
  ACCOUNT_REVIEW_REQUIRED: [
    '계정 등록 확인 필요',
    '계정 등록의 활성 상태와 유효 기간을 운영 관리자에게 확인해 주세요.',
  ],
  RUN_EXPIRED: [
    '실행 기간 만료',
    '운영 관리자가 실행 기간과 프로필을 확인하고 새 실행을 연결해야 합니다.',
  ],
  UNAVAILABLE: ['상태 확인 불가', '서버 연결과 접근 권한을 확인한 뒤 다시 조회해 주세요.'],
} as const;
/** Remounted by the parent on session/project/access/settings identity changes. */
export function SurferReadinessPanel({
  client: provided,
  processingEnabled,
}: {
  readonly client?: SurferReadinessClient;
  readonly processingEnabled: boolean;
}) {
  const client = useMemo(() => provided ?? createSurferReadinessClient(), [provided]);
  const [open, setOpen] = useState(false),
    [value, setValue] = useState<SurferReadiness | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    pending = useRef(false),
    checkButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const close = () => {
    generation.current++;
    controller.current?.abort();
    pending.current = false;
    setOpen(false);
    setValue(null);
    setBusy(false);
    setFailed(false);
    queueMicrotask(() => checkButton.current?.focus());
  };
  const inspect = async () => {
    if (pending.current) return;
    pending.current = true;
    setOpen(true);
    setValue(null);
    setFailed(false);
    setBusy(true);
    const id = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    try {
      const result = await client.inspect(abort.signal);
      if (id === generation.current) setValue(result);
    } catch {
      if (id === generation.current) setFailed(true);
    } finally {
      if (id === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="surface"
      aria-label="서퍼 실행 설정"
      style={{
        padding: '20px',
        marginBlock: '20px',
        border: '1px solid var(--line)',
        borderRadius: '12px',
      }}
    >
      <h3>서퍼 실행 설정</h3>
      <p>AI 제공자 설정과 서퍼 실행 프로필의 연결 상태를 확인합니다.</p>
      {!processingEnabled && (
        <p>이 프로젝트의 AI 자동 처리가 꺼져 있습니다. AI 자동 처리 설정을 확인해 주세요.</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button ref={checkButton} type="button" disabled={busy} onClick={() => void inspect()}>
          {busy ? '확인 중…' : open ? '새로 확인' : '실행 설정 확인'}
        </button>
        {open && (
          <button type="button" onClick={close}>
            닫기
          </button>
        )}
      </div>
      <div aria-live="polite" aria-busy={busy}>
        {value && (
          <>
            <p>
              <strong>{messages[value.state][0]}</strong>
            </p>
            <p>{messages[value.state][1]}</p>
          </>
        )}
        {failed && (
          <p role="alert">
            실행 설정을 확인하지 못했습니다. 서버 연결과 접근 권한을 확인한 뒤 다시 조회해 주세요.
          </p>
        )}
      </div>
      <p>
        이 조회는 모델을 호출하거나 실행을 시작하지 않습니다. 자료 권한과 전송 정책은 처리할 때 다시
        확인합니다.
      </p>
      <Link to="/sources">자료 처리 상태 보기</Link>
    </section>
  );
}
