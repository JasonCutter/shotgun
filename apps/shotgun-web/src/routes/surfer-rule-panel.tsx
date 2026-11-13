import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSurferRuleClient,
  type SurferRuleClient,
  type SurferGuidedRuleCatalog,
  type SurferGuidedRuleAnswer,
} from '@shotgun/api-client';

const states = { ACTIVE: '사용 중', QUARANTINED: '반례로 적용 보류', RETRACTED: '철회됨' };
const outcomes = {
  TRUE: '규칙의 결론이 성립합니다',
  FALSE: '규칙의 결론이 성립하지 않습니다',
  UNKNOWN: '정보 또는 검증 범위가 부족해 판단을 보류합니다',
  RECALLED: '저장된 규칙',
};
/** One instance per session/project; selections are indexes into the current authorized catalog only. */
export function SurferRulePanel({ client: provided }: { readonly client?: SurferRuleClient }) {
  const client = useMemo(() => provided ?? createSurferRuleClient(), [provided]);
  const [open, setOpen] = useState(false),
    [catalog, setCatalog] = useState<SurferGuidedRuleCatalog | null>(null),
    [selected, setSelected] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [answer, setAnswer] = useState<SurferGuidedRuleAnswer | null>(null),
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
    setBusy(true);
    const id = generation.current,
      abort = new AbortController();
    controller.current = abort;
    try {
      const c = await client.catalog(abort.signal);
      if (id === generation.current) {
        setCatalog(c);
        setSelected(c.items[0]?.memory.artifactId ?? '');
      }
    } catch {
      if (id === generation.current)
        setError('규칙을 확인할 수 없습니다. 원문과 권한 상태를 확인한 뒤 다시 불러오세요.');
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
    try {
      const result = await client.ask(
        {
          schemaVersion: '1.0.0',
          snapshot: catalog.snapshot,
          memory: item.memory,
          kind,
          values:
            kind === 'RECALL'
              ? []
              : item.fields
                  .filter((f) => values[f.name] !== undefined && values[f.name] !== '')
                  .map((f) => ({ name: f.name, valueIndex: Number(values[f.name]) })),
        },
        abort.signal,
      );
      if (id === generation.current) {
        setAnswer(result);
        if (result.status === 'BLOCKED' || result.status === 'SOURCE_UNAVAILABLE') setCatalog(null);
      }
    } catch {
      if (id === generation.current) {
        setCatalog(null);
        setValues({});
        setError(
          '규칙이나 원문 상태가 바뀌었거나 질문을 처리할 수 없습니다. 규칙을 다시 불러오세요.',
        );
      }
    } finally {
      if (id === generation.current) setBusy(false);
    }
  };
  return (
    <section className="surfer-memory-panel" aria-label="학습 규칙 확인">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            invalidate();
            setCatalog(null);
            setValues({});
          } else void load();
          setOpen(!open);
        }}
      >
        학습 규칙 확인
      </button>
      {open && (
        <div>
          <p>
            제한된 사례에서 학습해 저장한 규칙을 확인합니다. 관측된 값의 조합에 대한 참고
            판단이며,새로운 범위까지 검증됐다는 뜻은 아닙니다.
          </p>
          <button type="button" disabled={busy} onClick={() => void load()}>
            규칙 다시 불러오기
          </button>
          {busy && <p role="status">규칙 확인 중…</p>}
          {error && <p role="alert">{error}</p>}
          {catalog && (!catalog.items.length || catalog.status === 'UNAVAILABLE') && (
            <p role="status">현재 확인할 수 있는 학습 규칙이 없습니다.</p>
          )}
          {item && (
            <>
              <label>
                확인할 규칙
                <select
                  disabled={busy}
                  value={selected}
                  onChange={(e) => {
                    invalidate();
                    setSelected(e.target.value);
                    setValues({});
                  }}
                >
                  {catalog!.items.map((i, n) => (
                    <option key={i.memory.artifactId} value={i.memory.artifactId}>
                      {n + 1}. {i.description}
                    </option>
                  ))}
                </select>
              </label>
              <p>적용 상태: {states[item.state]}</p>
              <button type="button" disabled={busy} onClick={() => void ask('RECALL')}>
                규칙과 근거 보기
              </button>
              {item.applySupported ? (
                <fieldset disabled={busy}>
                  <legend>현재 관측값</legend>
                  <p>자료에서 관측한 값만 선택할 수 있습니다. 모르는 값은 비워 두세요.</p>
                  {item.fields.map((f) => (
                    <label key={f.name}>
                      {f.name}
                      {f.unit ? ` (단위: ${f.unit})` : ''}
                      <select
                        aria-label={f.name}
                        value={values[f.name] ?? ''}
                        onChange={(e) => {
                          invalidate();
                          setValues({ ...values, [f.name]: e.target.value });
                        }}
                      >
                        <option value="">모름</option>
                        {f.values.map((v, i) => (
                          <option key={i} value={String(i)}>
                            {typeof v === 'boolean' ? (v ? '참' : '거짓') : String(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button type="button" onClick={() => void ask('APPLY')}>
                    선택한 값으로 규칙 확인
                  </button>
                </fieldset>
              ) : (
                <p>
                  {item.state === 'ACTIVE'
                    ? '이 규칙의 관측값은 현재 화면에서 적용 입력을 안내할 수 없습니다.'
                    : '현재 이 규칙의 적용은 보류되어 있습니다.'}{' '}
                  규칙과 근거를 확인하세요.
                </p>
              )}
            </>
          )}
          {answer && (
            <div aria-live="polite">
              <h3>
                {answer.status === 'SOURCE_UNAVAILABLE'
                  ? '현재 원문을 확인할 수 없습니다'
                  : answer.status === 'BLOCKED'
                    ? '현재 권한으로 확인할 수 없습니다'
                    : '규칙 확인 결과'}
              </h3>
              {answer.answers.map((a, n) => (
                <article key={n}>
                  <p>{a.description}</p>
                  <p>
                    {states[a.state]} · {outcomes[a.outcome]}
                  </p>
                  {a.reasons.some((r) => r.startsWith('MISSING_PREMISE:')) && (
                    <p>
                      추가 확인:{' '}
                      {a.reasons
                        .filter((r) => r.startsWith('MISSING_PREMISE:'))
                        .map((r) => r.slice('MISSING_PREMISE:'.length))
                        .join(' / ')}
                    </p>
                  )}
                  <details>
                    <summary>규칙의 원문 근거</summary>
                    {a.citations.map((c, i) => (
                      <blockquote key={i}>{c.quote}</blockquote>
                    ))}
                  </details>
                </article>
              ))}
              <p>결과는 검증된 사실이나 실행 지시가 아닙니다.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
