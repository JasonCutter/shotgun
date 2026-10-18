# VP 최종 종료 증거 매트릭스 — 2026-10-18

**로컬 판정: `LOCAL_CORRECTION_VERIFIED / CANONICAL_AND_FINAL_INSTALLED_LIVE_PENDING`.** 기존 증거 대조와 최소 보정의 격리 회귀, 운영 읽기 전용 감사 결과를 기록한다. 이번 작업의 실제 AI 호출·운영 변경은0이다. `main@9717186c6543fe71bf5155ec374ff24b1a234c3a`(tree `5601e570a64018d5f283e6cf42623baa084fe085`)와 운영 schema140을 기준으로 한다. 이 문서·보정 코드·후속 증거는 아직 Git Canonical에 게시되지 않았다. 최종 `VP_FINAL_ACCEPTANCE_COMPLETE`는 선언하지 않는다.

## 적용 판정 규칙

- [ADR-172](../../architecture/adr/ADR-172-vp-autonomous-knowledge-authority.md)의 자료 투입·질문 두 동작, 단일 VP Ledger 권위, 원문·SourceVersion·Evidence·권한·결정 영수증·재생 및 Action 승인 경계를 유지한다. [ADR-173](../../architecture/adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)의 제품 결과와 평가 인증을 구분한다.
- 2026-10-16 승인된 [DoD §제품 인수와 의미 인증 범위](../definition-of-done.md#2026-10-16-사용자-승인--제품-인수와-의미-인증-범위) 및 [정책 §5](../../architecture/add/vp05-evaluation-trust/relation-negative-and-acceptance-policy-draft.md#5-승인된-인간-인증과-제품-인수-범위-분리)에 따라 Gold 0/인증 precision·recall·calibration N/A **자체**는 제품 인수 자동 blocker가 아니다. 후보 라벨·AI 합의·confidence·Fake 통과를 인간 인증으로 올리지 않는다. 실제 제품/안전/적용 품질 결함은 blocker다.
- [전체 실행 지시](./execution-directive.md)의 과거 개발 STOP은 후속 개발 승인으로 대체되었다. 당시 `HOLD`, `OFF`, `PENDING`은 그 시점의 이력으로 남기되, 아래 최신 증거와 대조한다. v6 및 선택 확률 0.9 gate가 정상 운영 정책이며 새 negative는 Fake 전용 격리 정책이다.

## Gate별 현재 증거

| Gate                                      | 충족 증거와 정확한 범위                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 종료 판정 / 남은 한계                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VP-01·02 / VP-0                           | Ledger 단일 writer, 현재·과거 SourceVersion/Ask 및 증분·전체 재생성 동등성은 [기존 tracker](../vp-completion-tracker.md)와 [통합 보고](./report.md)의 회귀·실제품 증거. ADR/Module/OSS 소유권 계약과 기존 승인형 Canonical 분리.                                                                                                                                                                                                                                                                                                                                         | 기존 PASS 재사용. 이번에 재실행하지 않음.                                                                                                                                                                                                                            |
| VP-03 / VP-1·2                            | Canonical PR393 이후 Windows 실제 Git blob 881개 설치·정상 launcher·격리 PostgreSQL/Fake A v1→B→A v2, 질문3, HTTP54/Fake7, 재시작·인용 최신성·사용자 선택/검토0. 과거 실제 DeepSeek A/B/수정본과 PDF 다중 자료는 [tracker](../vp-completion-tracker.md)에 별도 기록.                                                                                                                                                                                                                                                                                                     | 제품 두 동작과 버전 경계 **PASS, 증거 조합**. 최신 운영 설치본에서 새 A/B/수정본 전체를 실모델로 한 번에 실행한 증거는 없음.                                                                                                                                         |
| VP-04·08 / VP-4 자료·최신성               | 기존 형식별 변환/Golden·원문 bytes/locator, PDF/Office/HTML·URL 갱신/만료 경계, 파일10 MiB와 URL1 MiB, 이미지 실제 격리 1회+Ask 1회는 [통합 보고](./report.md), [이미지 인수](./isolated-image-live-acceptance-2026-10-15.md), [tracker](../vp-completion-tracker.md)에 범위별 기록.                                                                                                                                                                                                                                                                                     | 지원 형식/선택 사례 PASS. PDF replacement glyph/수식 fidelity, 이미지 생성 관측의 `UNVERIFIED`, 미지원 audio/video, inline PDF preview 한계를 공개. 전체 문서 의미 recall·정확도 인증은 N/A.                                                                         |
| VP-05 / VP-3 평가·판단                    | A1/A2/A3 versioned 검증과 분모·warrant·방향·raw/adoption 분리. 실제 제공자 응답9/9 저장 귀속, 승인10회 상한의 가능한 UNKNOWN1 보존. 사용자 제공 청구 export의 일별 9건/6,916 tokens 및 통화별 보고 비용 대조 PASS([증거 대조](./acceptance-evidence-closure-2026-10-16.md), [청구 보완](./remaining-gates-review-2026-10-16.md)). 실제 운영 UI→Ask→DeepSeek `deepseek-flash` 1회가 200%, 현재 Evidence/page2 인용으로 성공([운영 인수](C:/dev/artifacts/vp-full-completion-2026-10-12/operating-ai-activation-20261017/report.md)).                                      | 실제 제품 질문의 좁은 의미 결과·예산 안전 **PASS**. 인증 reference0, 모집단 precision/recall/critical recall/calibration 및 Frontier semantic recall N/A. 건별 invoice 귀속과 엄밀 adapter latency 미검증; 일별 비용 PASS와 구분. 새 Gold·모델 비교·v11 활성화 없음. |
| VP-06·07 복구/운영                        | ACK loss/UNKNOWN/중복·재시도 음성, isolated PG kill/restart 및 backup/restore 회귀는 [통합 보고](./report.md). 운영 migration131–140은 fresh backup/lock/동일 DB·authority와 기존 row hash readback 후 PASS([운영 DDL](C:/dev/artifacts/vp-full-completion-2026-10-12/operating-worker-off-ddl-resume-20261017/report.md)). 기존 아이콘 실제 Windows 재부팅 후 READY, DB/자산/권위·저장 답변/인용 보존([재부팅](C:/dev/artifacts/vp-full-completion-2026-10-12/windows-final-acceptance-20261017/report.md)).                                                            | 적용 범위 PASS. OS 부팅만으로 앱 자동 실행을 인증한 것은 아님; 로그인 후 아이콘 실행. 운영 product rollback은 실시하지 않았고 격리 복원/rollback 증거와 운영 전환 이력을 구분.                                                                                       |
| VP-09 Product/Security                    | 격리 정상 앱의 budget exhaustion·UNRESOLVED에서도 직접 원문 Ask 성공, private 비노출([부분 관계 인수](./partial-relation-product-acceptance-2026-10-17.md)). Negative Ledger→현재 view/Ask는 격리 Fake에서 과거 positive 철회·직접 검색·replay PASS([negative 제품](./negative-ledger-product-2026-10-17.md)). 실제 운영 Ask는 source/version/evidence/page 연결 PASS.                                                                                                                                                                                                   | 두 동작·접근·인용 경계 PASS. Pair 상태 UI는 승인 범위 밖. 새 negative 운영/live 의미는 미활성·미검증이며 v6 결과를 negative로 소급 분류하지 않음.                                                                                                                    |
| VP-10 / 공통 Module·Flow·Architecture·OSS | [통합 결정](./integration-decisions.md), [Role Matrix](../../architecture/module-architecture/open-source-role-matrix.md): PostgreSQL16/pg 및 고정 변환 부품은 Port 뒤, gbrain/ddsyasas/OpenKnowledge는 `REFERENCE_ONLY`, lucas locator `EXTRACT`/HTML `AUGMENT`. Source/Evidence/VP Ledger/Action 의미는 Shotgun 소유. PR393 exact tree 및 사후 CI 38995892095 Quality·Frontend·Required Gates SUCCESS; 단위·계약·PG·TS6와 별도 migration/replay/security 검증을 재사용([PR393 packet](C:/dev/artifacts/vp-full-completion-2026-10-12/pr393-merge-20261017/report.md)). | 적용 runtime/adapter 변경의 계약·OSS 판정 PASS. 문서상 구형 Stage STOP과 최신 증거가 혼재하므로 이 종료 매트릭스와 tracker/plan의 현재 상태를 함께 Canonical 게시해야 함.                                                                                            |
| VP-11 / Product·Release                   | main9717186c/tree5601…과 운영 checkout 동일, schema140, Windows 아이콘·실제 재부팅 PASS. 이후 별도 승인으로 standing7 ON/전역 권위 연결, 정상 UI→실제 Ask 1회 PASS. 2026-10-18 승인된 추가 관계841/841은 `DECIDED`183/`UNRESOLVED`658, 미처리·UNKNOWN·reservation·중복0. 기본 일일100 유지·한시 allowance CLOSED, 앱 아이콘1회 복원/health200, 복원 후 호출0([최신 복원](C:/dev/artifacts/vp-full-completion-2026-10-12/app-restore-after-bounded-841-20261018/completion-report.md)).                                                                                   | 설치·활성화·지정 backlog 처리 PASS. 658 보류는 의미 확정도 처리 누락도 아님. 독립 Desktop Distribution은 DEFER. 최종 종료 선언/문서의 별도 Git 게시가 남음.                                                                                                          |

### 2026-10-18 최신 운영 읽기 전용 감사

[운영 read-only audit](C:/dev/artifacts/vp-full-completion-2026-10-12/vp-final-closure-20261018/operating-readonly-audit.json)는 `main@9717186c`의 기존 owner PID6856·ready 앱을 확인했다. 실제 DB를 쓰거나 provider를 호출하지 않고 product/authority의 감사 전후 snapshot 동일성을 확인했다. 독립 replay는 `matches=true`, `historyValid=true`, `sourceProcessingComplete=true`, `candidateMaterializationComplete=true`, `relationQueueSettled=true`, `relationQueueComplete=true`다. 현재 주장105·관계280은 재계산 값과 일치하고 epoch435의 history checks는 모두 true다. Frontier 후보1,132개는 생성·membership·실행이 완료됐으며 pending/failed/unknown은 각각0이다. 같은 전역 권위의 2026-10-18 counter941, 기본100, 한시 allowance CLOSED, reservation0과 보호 파일79개·stash·다른 worktree 보존도 확인했다. 이 수치는 **현재 원장·Frontier의 실행/재생 완결성**이며 인증된 의미 정밀도·재현율 또는 658개 UNRESOLVED의 의미 확정을 뜻하지 않는다.

## 남은 종료 판단

1. **VP-11의 단일 설치 실모델 여정은 `NOT_RUN`; `VP_FINAL_ACCEPTANCE_COMPLETE`는 선언하지 않는다.** [VP 구현계획 §7](../vp-vampire-implementation-plan.md#7-검증-시나리오와-출시-기준)과 [tracker VP-11](../vp-completion-tracker.md)의 문구는 *최종 main 설치 아이콘에서 빈 공간→A/B/수정본→실제 AI 질문*을 요구한다. 현재 증거는 동일 main의 설치 Fake 전체 여정, 과거 격리 실제 DeepSeek A/B/수정본, 운영 설치 아이콘의 기존 자료 실제 Ask 1회를 **조합**한다. 이를 한 운영 여정으로 수행했다고 주장하거나 Gate를 조용히 재정의하지 않는다. 완료된 841건 승인으로 추가 AI 호출을 시작하지 않는다. 검증된 최종 diff의 Canonical 게시 후, 별도 유효한 인가·예산·격리 범위를 고정한 bounded 설치본 A/B/수정본 실모델 인수 증거가 필요하다. 그전까지 VP-03/11/Product Gate는 열린다.
2. **과거 예산 대기 metadata 결함은 `LOCAL_FIXED_NOT_DEPLOYED`.** 원래 841 controller `STOP`은 성공한 한 `COMPLETED` job에 과거 `RELATION_BUDGET_PAUSED:EXHAUSTED` 코드가 남아 감사기가 현재 실패로 오인한 결과다. [원본 보고](C:/dev/artifacts/vp-full-completion-2026-10-12/bounded-budget-841-20261018/report.md)의 STOP을 삭제하지 않는다. 새 운영 읽기 전용 감사의 기존 권위 `readDecisionOutcome()`은 이 metadata에 의존하지 않고 그 job을 `COMPLETED`로 판정했다. Source/Evidence/Ask·결정 영수증은 보존됐고 운영 행을 수정하지 않았다. 개발 worktree에서는 `completeDecision`의 두 SQL 성공 갱신만 `next_attempt_at`·`last_failure_code`를 지우도록 보정했다. 수정 전 대상 PG 회귀는 실패했고, 수정 후 boundary 13/13과 receipt 권위 대조가 통과했다. 아래 최종 로컬 Gate도 통과했다. Canonical 게시·운영 배포 전이므로 기존 운영 행이 이미 정정됐다고 주장하지 않는다.
3. **잔여 실행 순서:** 검증된 코드·테스트·이 종료 문서의 exact diff를 별도 push/PR 승인·exact-head CI·merge 승인으로 Canonical 게시한다 → [최소 설치본 실모델 종료 절차](./final-installed-live-acceptance-plan-2026-10-18.md)에 따라 위 1번의 단일 여정을 별도 승인/예산 아래 수행한다 → VP-03/11/Product 및 전체 종료를 판정하고 보고를 게시한다. 새 인프라·모델/정책 연구·대량 재실험은 필요하지 않다. 로컬 `e46803fc…`의 예산 대기/보류 제품 인수 테스트·fixture·문서는 이번 보정과 함께 선별 재사용한다. 별도 한시 예산 commit `a32eb121…`은 독립 보존하며 이 제품 변경에 포함하지 않는다. 이 로컬 종료 작업은 push/PR/merge·운영 조작을 포함하지 않는다.

## 최종 로컬 검증

[기계 판독 증거 manifest](./final-closure-evidence-manifest.json)에 원시 실행 결과·
보존 packet의 SHA-256과 실제 검사 범위를 고정한다. 반복 성공을 중복 집계하지 않는다.

| 검사                                                  | 결과                                                                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 수정 전 재현                                          | 실제 worker 예산 대기→재개→성공 후 진단 필드 잔존으로 대상1건 FAIL; 나머지12는 필터 제외                              |
| PostgreSQL 고유 사례                                  | 46 PASS / 0 FAIL / 기존 opt-in SKIP1. 실제 app A/B/수정본·Ask·보류·권한, 실행 경계·전역 예산·복구·receipt replay 포함 |
| Unit·Contract                                         | 29 PASS / 0 FAIL / 0 SKIP                                                                                             |
| TS6 표준 전체                                         | 65 PASS / 0 FAIL / 0 SKIP, 기존 `--pool=forks --maxWorkers=4` 및 timeout·assertion 유지                               |
| TS6 release·reproduction                              | PASS. v2–v7·v8 산출물 재생성/변경0, 의미 규칙/분류 완화0                                                              |
| Typecheck·lint·format·Architecture·문서/ADR/Canonical | PASS                                                                                                                  |
| 운영 독립 재생·보존                                   | 실제 DB 읽기 전용 PASS. 현재 주장105/관계280·Frontier1132 완료, 추가 호출/작업 유실/운영 변경0                        |
| 독립 AI 코드 리뷰                                     | 핵심 보정·회귀·종료 경계에서 추가 조치 지적 없음. 인간 의미 인증 아님                                                 |

최초 종합 DB 실행의44 PASS/2 FAIL/1 SKIP은 보존한다. 실패 원인은 Windows의
`pg_dump` 부재와 명시적으로 격리된 child env에 PG bridge가 빠져 발생한
`127.0.0.1:55432 ECONNREFUSED`였다. 기존 검증된 `pg-tools-preload`의 실제
container pg_dump/restore 및 자식 프로세스 연결 guard를 재사용한 뒤 동일한
priority suite12/12 PASS, 기존 opt-in1 SKIP을 확인했다. 테스트 코드·timeout·
assertion은 이 환경 보정으로 변경하지 않았다. 나머지34 PASS와 합쳐 고유46건이다.

추가 원시 TS6 수집을 DB/AST release·재생성과 겹쳐 실행한 때에는 cold audit가
62,969.97ms에서 실패해64 PASS/1 FAIL이 나왔다. JSON reporter의 메시지는
`STACK_TRACE_ERROR`이며, 검사 자체의 기존 제한은60초다. 무거운 검사를 종료한
뒤 같은 명령을 새 프로세스로 실행하여65/65 PASS, 같은 cold 검사35,717.01ms를
확인했다. 동시 부하와 시간 초과의 관측을 기록하며 모든 환경에서 일정 시간이
보장된다고 주장하지 않는다. 검증기·timeout·worker 수·반례·분류는 변경하지 않았다.

격리 PostgreSQL은 종료 전 연결0을 확인한 뒤 원래 exited 상태로 복원했다.
운영 앱은 같은 main/PID의 ready 상태로 유지했고, 감사 전후 운영 데이터 차이는
정상 auth audit 증가뿐이다. authority 전체 데이터/카탈로그는 동일하다.

## 현재 보장과 제외 범위

보장된 범위는 정상 v6/선택 확률0.9 정책, 단일 VP Ledger·원문 SourceVersion/Evidence 인용, 기존 지원 형식의 검증된 경로, bounded global authority, 재시작/복구와 운영 아이콘 사용이다. 인증되지 않은 모델 모집단 의미 정확도·critical recall·calibration, 모든 PDF 수식 추출, 일반 이미지 의미 정확성, audio/video, 독립 Desktop Distribution, 새 negative 정책의 운영 활성화, v11/SSC/새 모델은 보장하지 않는다. 보호된 72/432/B12·B 잔여24·Gold-B-7은 수정·재실험하지 않았다.

## 이번 최소 보정의 경계·재사용·되돌리기

- Target은 기존 `vp-knowledge-postgres`의 `VPRelationJobStorePort` 구현이다.
  정상 성공과 receipt 충돌 readback의 두 transaction 안에서 현재
  `next_attempt_at`/`last_failure_code`만 NULL로 바꾼다. 공개 Port·schema·migration,
  v6 prompt/선택 확률 하한, lease/claim/attempt, call output·receipt·relation·history는
  변경하지 않는다. `completeUnresolved`의 의미 보류 코드와 UNKNOWN 처리는 그대로다.
- 기존 PostgreSQL16/잠긴 `pg` 의존성과 transaction/worker/dispatcher를 **AUGMENT**한다.
  [기존 통합 결정](./integration-decisions.md)의
  [gbrain](https://github.com/garrytan/gbrain)
  `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`(MIT) Job/lease/replay
  **REFERENCE_ONLY** 판단을 재사용한다. gbrain 전체 runtime/DB는 Shotgun의
  SourceVersion·보안·원장·실행 identity를 대체할 수 없어 도입하지 않는다.
  새로운 OSS·dependency·license·runtime·일반 운영 도구는 추가하지 않는다.
  기존 lockfile·Role Matrix의 채택 범위도 그대로다.
- 검증기의 결과 판정은 현재 진단 문자열이 아니라 기존 `readDecisionOutcome()`의
  동일 project/pair/policy receipt와 실제 relation 확인을 재사용한다. 회귀는
  stale 진단+정확한 영수증의 완료 인정과 clean 진단+다른 정책 영수증의 거부를
  모두 검사한다. 봉인된 일회성 검증기/원래 STOP을 수정하거나 새 판정 권위를
  만들지 않는다. NONE→UNDIRECTED 저장 매핑과 confidence/선택 확률 구분도 유지한다.
- 기존 로컬 `e46803fc…`의 부분 예산 인수 테스트와 fixture의 선택적 Fake 응답·
  기존 restart 함수 재사용은 함께 검토한다. 기본 응답/정책은 바꾸지 않는다.
  한시841 예산 구현 `a32eb121…`은 이미 닫힌 승인 실행의 독립 계보로 보존하며
  이 제품 보정에 복사하거나 일반 운영 설정으로 채택하지 않는다.
- Additive migration이나 운영 행 수리는 필요 없다. 배포하지 않은 로컬 수정의
  rollback은 코드/테스트/종료 문서만 이전 revision으로 되돌리는 것이다.
  향후 승인 배포를 되돌리더라도 성공 call/receipt/history를 삭제하지 않는다.
  기존 운영 행1건의 과거 코드는 그대로이며 현재 원장/제품 완료 상태와 구분된다.
