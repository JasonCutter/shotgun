import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSurferMemoryClient,
  type SurferMemoryClient,
  type SurferGuidedCatalog,
  type SurferGuidedAnswer,
  type SurferGuidedQuestion,
} from '@shotgun/api-client';

const labels: Record<string, string> = {
  REQUIRED: '수행 필요',
  PROHIBITED: '수행 금지',
  PERMITTED: '허용',
  ASSERTED: '성립',
  DENIED: '성립하지 않음',
  NOT_TRIGGERED: '조건에 해당하지 않음',
  EXEMPT: '예외에 해당',
  OUTSIDE_TIME_SCOPE: '적용 기간 밖',
  UNKNOWN: '정보 부족으로 판단 보류',
  RECALLED_INTERPRETATION: '저장된 해석',
};
/** One mounted instance belongs to one session/project. No browser persistence of private memory data. */
export function SurferMemoryPanel({ client: provided }: { readonly client?: SurferMemoryClient }) {
  const client = useMemo(() => provided ?? createSurferMemoryClient(), [provided]);
  const [open, setOpen] = useState(false),
    [catalog, setCatalog] = useState<SurferGuidedCatalog | null>(null),
    [selected, setSelected] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [date, setDate] = useState(''),
    [answer, setAnswer] = useState<SurferGuidedAnswer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const invalidate = () => {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setAnswer(null);
    setError('');
  };
  const item = catalog?.items.find((i) => i.memory.artifactId === selected);
  const load = async () => {
    invalidate();
    setCatalog(null);
    setSelected('');
    setValues({});
    setDate('');
    setBusy(true);
    const id = generation.current,
      abort = new AbortController();
    controller.current = abort;
    try {
      const result = await client.catalog(abort.signal);
      if (id === generation.current) {
        setCatalog(result);
        setSelected(result.items[0]?.memory.artifactId ?? '');
      }
    } catch {
      if (id === generation.current)
        setError('기억을 확인할 수 없습니다. 권한과 원문 상태를 확인한 뒤 다시 불러오세요.');
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  const ask = async (kind: 'RECALL' | 'APPLY') => {
    if (!item || !catalog?.snapshot) return;
    invalidate();
    setBusy(true);
    const id = generation.current,
      abort = new AbortController();
    controller.current = abort;
    const observations: SurferGuidedQuestion['observations'] = [];
    for (const field of kind === 'APPLY' ? item.fields : []) {
      const value = values[field.predicateId] ?? '';
      if (!value) continue;
      if (field.type === 'NUMBER' && !/^-?(0|[1-9][0-9]*)([.][0-9]+)?$/.test(value)) {
        setError('측정값은 쉼표나 지수 표기 없이 숫자로 입력하세요.');
        setBusy(false);
        return;
      }
      observations.push({
        predicateId: field.predicateId,
        value:
          field.type === 'BOOLEAN'
            ? { type: 'BOOLEAN', value: value === 'true' }
            : { type: 'NUMBER', decimal: value, unit: field.unit },
      });
    }
    try {
      const result = await client.ask(
        {
          schemaVersion: '1.0.0',
          snapshot: catalog.snapshot,
          memory: item.memory,
          kind,
          observations,
          atDate: kind === 'APPLY' && date ? date : null,
        },
        abort.signal,
      );
      if (id === generation.current) {
        setAnswer(result);
        if (result.status === 'SOURCE_UNAVAILABLE' || result.status === 'BLOCKED') setCatalog(null);
      }
    } catch {
      if (id === generation.current) {
        setCatalog(null);
        setError(
          '기억이나 원문 상태가 바뀌었거나 질문을 처리할 수 없습니다. 기억을 다시 불러오세요.',
        );
      }
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  return (
    <section className="surfer-memory-panel" aria-label="기억으로 확인">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            invalidate();
            setCatalog(null);
            setValues({});
            setDate('');
          } else void load();
          setOpen(!open);
        }}
      >
        기억으로 확인
      </button>
      {open && (
        <div>
          <p>
            저장된 해석을 선택해 내용을 확인하거나 현재 조건에 적용합니다. 입력한 상태를 전제로 한
            참고 판단입니다.
          </p>
          <button type="button" onClick={() => void load()} disabled={busy}>
            기억 다시 불러오기
          </button>
          {busy && <p role="status">확인 중…</p>}
          {error && <p role="alert">{error}</p>}
          {catalog && (!catalog.items.length || catalog.status === 'UNAVAILABLE') && (
            <p role="status">현재 확인할 수 있는 해석 기억이 없습니다.</p>
          )}
          {item && (
            <>
              <label>
                확인할 내용
                <select
                  value={selected}
                  disabled={busy}
                  onChange={(e) => {
                    invalidate();
                    setSelected(e.target.value);
                    setValues({});
                    setDate('');
                  }}
                >
                  {catalog!.items.map((i, n) => (
                    <option key={i.memory.artifactId} value={i.memory.artifactId}>
                      {n + 1}. {i.subject} · {i.operation}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={() => void ask('RECALL')}>
                저장된 내용 보기
              </button>
              {item.applySupported ? (
                <fieldset disabled={busy}>
                  <legend>현재 조건</legend>
                  <p>
                    모르는 값은 비워 두세요. 참·거짓은 조건의 결론이 아닌 대상의 실제 상태입니다.
                  </p>
                  {item.fields.map((f) => (
                    <label key={f.predicateId}>
                      {f.quote}
                      {f.unit ? ` (단위: ${f.unit})` : ''}
                      {f.type === 'BOOLEAN' ? (
                        <select
                          aria-label={f.quote}
                          value={values[f.predicateId] ?? ''}
                          onChange={(e) => {
                            invalidate();
                            setValues({ ...values, [f.predicateId]: e.target.value });
                          }}
                        >
                          <option value="">모름</option>
                          <option value="true">참</option>
                          <option value="false">거짓</option>
                        </select>
                      ) : (
                        <input
                          aria-label={f.quote}
                          inputMode="decimal"
                          maxLength={40}
                          value={values[f.predicateId] ?? ''}
                          onChange={(e) => {
                            invalidate();
                            setValues({ ...values, [f.predicateId]: e.target.value });
                          }}
                        />
                      )}
                    </label>
                  ))}
                  {item.dateRequired && (
                    <label>
                      적용 날짜
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => {
                          invalidate();
                          setDate(e.target.value);
                        }}
                      />
                    </label>
                  )}
                  <button type="button" onClick={() => void ask('APPLY')}>
                    이 조건으로 확인
                  </button>
                </fieldset>
              ) : (
                <p>
                  현재 기억의 조건을 하나의 입력으로 적용하기 어렵습니다. 저장된 내용과 근거를
                  확인하세요.
                </p>
              )}
            </>
          )}
          {answer && (
            <div aria-live="polite">
              <h3>
                {answer.status === 'CONFLICT'
                  ? '저장된 해석이 서로 충돌합니다'
                  : answer.status === 'SOURCE_UNAVAILABLE'
                    ? '현재 원문을 확인할 수 없습니다'
                    : answer.status === 'BLOCKED'
                      ? '현재 권한으로 확인할 수 없습니다'
                      : '확인 결과'}
              </h3>
              {answer.answers.map((a, n) => (
                <article key={n}>
                  <p>
                    {labels[a.outcome] ?? '판단 보류'}
                    {a.outcome === 'RECALLED_INTERPRETATION'
                      ? ` · ${labels[a.declaredMode] ?? '해석 확인 필요'}`
                      : ''}
                  </p>
                  {a.needed.length > 0 && (
                    <p>추가 확인: {a.needed.map((v) => v.quote).join(' / ')}</p>
                  )}
                  <details>
                    <summary>원문 근거</summary>
                    {a.citations.map((c, i) => (
                      <blockquote key={i}>{c.quote}</blockquote>
                    ))}
                  </details>
                </article>
              ))}
              <p>저장된 해석은 검증된 사실이나 실행 지시가 아닙니다.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
