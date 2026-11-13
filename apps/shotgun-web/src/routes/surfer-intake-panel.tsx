import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  createSurferIntakeClient,
  type SurferIntakeClient,
  type SurferIntakeStatusPage,
  type SurferIntakeStatusItem,
  type SurferIntakeCursor,
} from '@shotgun/api-client';

const recoveryHelp = {
  UNAVAILABLE: '이 작업은 여기서 재개할 수 없습니다.',
  NOT_CONFIGURED: '자동 실행이 설정되지 않았습니다.',
  CONFIGURATION_MISMATCH: '실행 설정이 달라 재개할 수 없습니다.',
  SOURCE_CHANGED: '자료가 변경되어 확인이 필요합니다.',
  WAIT_LEASE: '진행 중인 작업의 처리 시간이 남아 있습니다.',
  AVAILABLE: '저장된 작업을 이어서 처리할 수 있습니다.',
};
const stateLabel = (item: SurferIntakeStatusItem) =>
  item.state === 'BLOCKED'
    ? item.code === 'OUTCOME_UNKNOWN'
      ? '응답 확인 필요'
      : '검토 필요'
    : { READY: '처리 대기', RUNNING: '처리 중', COMPLETED: '기억 등록 완료' }[item.state];
/** Parent keys this panel by current session/project/access; no background provider or polling. */
export function SurferIntakePanel({
  client: provided,
  sourceLabels = {},
}: {
  readonly client?: SurferIntakeClient;
  readonly sourceLabels?: Readonly<Record<string, string>>;
}) {
  const client = useMemo(() => provided ?? createSurferIntakeClient(), [provided]);
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<SurferIntakeStatusPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    active = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const clear = () => {
    generation.current++;
    controller.current?.abort();
    active.current = false;
    setPage(null);
    setBusy(false);
    setError('');
    setNotice('');
  };
  const load = async (cursor: SurferIntakeCursor | null = null) => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setPage(null);
    setError('');
    setNotice('');
    const id = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    try {
      const next = await client.status(cursor, abort.signal);
      if (id === generation.current) setPage(next);
    } catch {
      if (id === generation.current)
        setError('상태를 확인할 수 없습니다. 현재 권한과 연결을 확인한 뒤 다시 조회하세요.');
    } finally {
      if (id === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  };
  const resume = async (item: SurferIntakeStatusItem) => {
    if (active.current || !page?.executionConfigured || item.recovery !== 'AVAILABLE') return;
    active.current = true;
    setPage(null);
    setBusy(true);
    setError('');
    setNotice('');
    const id = ++generation.current,
      abort = new AbortController();
    controller.current = abort;
    try {
      const result = await client.resume(
        { jobId: item.jobId, expectedRevision: item.revision },
        abort.signal,
      );
      if (id !== generation.current) return;
      setNotice(
        result.status === 'COMPLETED'
          ? '작업이 완료됐습니다.'
          : result.status === 'NOT_CONFIGURED'
            ? '실행 설정이 없어 재개하지 않았습니다.'
            : '작업에 추가 확인이 필요합니다.',
      );
      const next = await client.status(null, abort.signal);
      if (id === generation.current) setPage(next);
    } catch {
      if (id === generation.current) {
        setPage(null);
        setNotice('');
        setError('처리 결과를 확인할 수 없습니다. 다시 보내지 않고 상태를 먼저 확인하세요.');
      }
    } finally {
      if (id === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="action-card"
      style={{ overflowWrap: 'anywhere', minWidth: 0 }}
      aria-label="서퍼 기억 처리"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            clear();
            setOpen(false);
          } else {
            setOpen(true);
            void load();
          }
        }}
      >
        서퍼 처리 상태
      </button>
      {open ? (
        <div aria-busy={busy}>
          <p>
            현재 접근 가능한 자료의 기억 처리 상태입니다. 등록 완료는 내용의 정확성을 보증하지
            않습니다.
          </p>
          <button type="button" disabled={busy} onClick={() => void load()}>
            상태 다시 확인
          </button>
          {busy ? <p role="status">작업 상태를 확인하고 있습니다.</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          {page ? (
            <>
              {!page.executionConfigured ? (
                <p>
                  자동 실행이 설정되지 않았습니다. 관리자가 실행 설정을 연결해야 작업을 재개할 수
                  있습니다.
                </p>
              ) : null}
              {page.items.length === 0 ? <p>현재 조회 범위에 표시할 작업이 없습니다.</p> : null}
              <ul>
                {page.items.map((item, index) => (
                  <li key={item.jobId} aria-label={`작업 ${index + 1}`}>
                    <Link
                      to={`/sources/${encodeURIComponent(item.sourceId)}?version=${encodeURIComponent(item.sourceVersionId)}`}
                    >
                      {sourceLabels[item.sourceId] ?? '자료 보기'}
                    </Link>
                    <p>
                      {stateLabel(item)} · {new Date(item.updatedAt).toLocaleString('ko-KR')}
                    </p>
                    {item.state === 'RUNNING' ? <p>{recoveryHelp[item.recovery]}</p> : null}
                    {item.code === 'OUTCOME_UNKNOWN' ? (
                      <p>결과가 미확정인 작업은 재전송하지 않습니다.</p>
                    ) : null}
                    {item.state === 'BLOCKED' && item.code !== 'OUTCOME_UNKNOWN' ? (
                      <p>자료와 실행 상태를 확인해야 합니다. 이 작업은 자동 재전송하지 않습니다.</p>
                    ) : null}
                    {page.executionConfigured && item.recovery === 'AVAILABLE' ? (
                      <>
                        <p>재개하면 연결된 모델의 호출 비용이 발생할 수 있습니다.</p>
                        <button type="button" disabled={busy} onClick={() => void resume(item)}>
                          이어서 처리
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              {page.nextCursor ? (
                <button type="button" disabled={busy} onClick={() => void load(page.nextCursor)}>
                  다음 작업 보기
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
