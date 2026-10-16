# VP — 잔여 Gate 재분류 및 청구 증거 보완

2026-10-16 KST. 이 문서는 사용자 후속 지시와 새 CSV 제공에 따른 **로컬 보완**이다. 이전 [증거 대조](./acceptance-evidence-closure-2026-10-16.md)의 작성 시점·원본·실패·UNKNOWN을 보존한다. PR390 승인 head `ba655f5c60f0bd23fc48c116d85aa91e15af27a1`의 세 문서와 원격 브랜치는 수정하지 않았다. 이 후속 문서의 게시·merge·운영 전환은 별도 승인이다.

## 1. 청구 자료로 새로 확인한 범위

사용자 제공 provider export의 **2026-10-15 UTC+09:00 일별 사용량·보고 비용 대조는 PASS**다. 요청9, input6,234(cache hit1,536/miss4,698), output682, 총6,916 tokens가 보존된 응답9건과 정확히 일치한다. 호출 시각도 해당 일자 안이다.

보고된 비용은 **Paid USD 0.001501848**, **Granted CNY 0.00245056**이다. 통화별로 유지하며 더하거나 환산하지 않았다. Granted는 지급 크레딧 사용이고 현금 결제 인증이 아니다. 정확 decimal 연산과 독립 PowerShell Decimal 재계산으로 cost4행의 산술을 확인했다. Raw CSV·계정·masked API-key 식별자는 이 문서나 PR diff에 넣지 않는다.

따라서 이후 보고에서 실청구 자료 전체를 계속 N/A라고 쓰지 않는다. 다음 범위를 구분한다.

| 측정                                                                  | 현재 판정                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 사용자 제공 export의 일별 사용량·보고 비용                            | 확보·대조 PASS. Provider 직접 조회/서명·은행 정산 증명은 아님    |
| 개별 response/claim의 청구 귀속                                       | UNVERIFIED. Export에 response/request/claim/line ID가 없음       |
| 기존 strict accounting helper의 matched invoice lines / totalPaidCost | 0 / null 유지. 가짜 line ID를 만들거나 validator를 완화하지 않음 |
| 이전 가능한 UNKNOWN1                                                  | 미해결 유지. Aggregate 잔차0을 pre-egress 확정으로 사용하지 않음 |
| 추가 실호출 여유                                                      | 0. 기존 가능 UNKNOWN 포함 승인 상한10/10 유지                    |

건별 청구 귀속의 미검증을 일별 비용 부재와 혼동하지 않는다. 반대로 일별 합계 일치를 모든 실행의 청구 인증으로 확대하지 않는다. 기존 [accounting 계약](./evaluation-execution-accounting.md)은 변경하지 않았다. 이 세부 귀속을 입증하려고 추가 호출·새 billing 서비스·불필요한 자료 요청을 시작하지 않는다.

## 2. 실제 relation wire의 null context 조사

실행 정책은 `vp-deepseek-relation-v6-evidence-context`다. 당시 좌우 claim은 다음과 같고 wire context는 각각 null/truncated=false다.

- `The heliograph register contains 18 entries.`
- `The heliograph register is accessible only to accredited auditors.`

보존된 실제 추출 요청(slot5/3)의 같은 Evidence ID 텍스트와 assertion claim, 같은 Source/SourceVersion/Evidence ID의 저장 citation exact quote가 **양쪽 모두 정확히 일치**한다. `adapters/vp-knowledge-postgres/src/relation-jobs.ts`는 untruncated quote가 claim과 완전히 같을 때 중복 context를 생략한다. Claim 자체는 보존하고 일반 AI adapter가 부재 context를 wire null로 표현한다.

당시 실행 archive와 Canonical main75의 projector Git blob은 SHA-256 `a05dd3b64009ab45450d079ca45681ae6cbd4b3471cd432b92c0175c3b7a6258`로 byte identical이다. Windows 작업 파일은 CRLF여서 raw SHA가 다르며 LF 차이만임을 따로 확인했다. 처음 audit의 raw worktree/archive 동일성 assertion 실패도 보존했다. 테스트나 production을 고친 실패가 아니다.

**판정: 관측은 기존 중복 생략 동작과 일치하며, 새로운 문맥 손실 결함을 입증하지 않는다.** 기존 PostgreSQL relation-priority 테스트는 같은 claim의 context 생략과 긴 별도 context의 2,000 code-point 상한·핵심 문장·truncation을 이미 검사한다. 현행 Canonical/PR390 CI의 Required Gates 성공을 재사용하며 정책·prompt·projector를 변경하지 않았다.

원래 scoped SQL snapshot에는 `evidence.spans` raw row가 없다. 따라서 당시 SQL join의 access scope/sensitivity 일치를 DB에서 다시 관측했다거나 missing join 가능성까지 독립적으로 배제했다고 주장하지 않는다. 원본 span을 현재 운영 DB에서 조회해 빈틈을 채우거나 폐기된 격리 DB를 재실행하지 않았다. Review CANDIDATE의 context는 그대로 null이며, 추가 문맥·정답·Gold 승인을 넣지 않는다.

## 3. 현재 잔여 작업과 실행 조건

| 구분                   | 완료/확보                                                                                                                                           | 남은 조건·처리                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 코드·표준 Gate         | PR389 Canonical main `75c68210445d8184dee5986cfc048910fa667915`; TS6 53/53, PostgreSQL748 PASS/2 기존 SKIP; Quality/Frontend/Required Gates SUCCESS | 새 runtime 결함 없음. 기존 전체 검증을 반복하지 않음                                                                               |
| 문서 게시              | PR390 Draft, exact head ba655…, CI38834528623의 세 필수 Job SUCCESS                                                                                 | Merge 승인 필요. 본 후속 로컬 문서는 PR390 승인 head에 미포함                                                                      |
| VP-05 독립 의미 품질   | 실제 wire 검토용 CANDIDATE1, source-bound/누출 방지 검사, A1/A2/A3 계약                                                                             | 동일 입력·관계 규약·warrant를 검증한 외부 독립 증거0. 인증 품질/Frontier recall/calibration N/A 유지. 사용자 개별 review 의무 없음 |
| 비용·지연              | 일별 보고 비용 대조 PASS; 9건 harness p50/p95 관측                                                                                                  | 건별 invoice 귀속·엄밀 adapter latency 미관측은 별도 제한. 새 호출로 과거 값을 복원하지 않음                                       |
| 설치·최종 release 인수 | CI fresh distribution/실제 app+PG+Fake·재시작 및 과거 좁은 Windows 증거                                                                             | 현재 Windows 설치본 identity·reboot·운영 release 미실행. 실제 전환 승인을 먼저 받아야 함                                           |

이는 추가 구현을 요구하는 새로운 기능 목록이 아니다. 독립 의미 검증 증거를 AI 판단으로 만들거나, 설치 인수를 운영 앱 무단 실행으로 채우지 않는다. 지원 제외된 raw audio/video를 이번 범위에서 활성화하지 않으며 새 모델·v11·SSC 실험도 시작하지 않는다. **VP_FINAL_ACCEPTANCE_NOT_COMPLETE / PRODUCTION_HOLD**를 유지한다.

## 4. 검증·재사용·보존

새 provider/DB 호출, 운영 변경, 과거 재채점, Gold 승격은 모두0이다. `remaining-gates-review-20261016/context-review.json`에 오프라인 대조와 source digest를 보존했다. Text sealed131개 항목의 hash/크기도 재확인했다. 기존 청구 packet `billing-export-review-20261016`과 publication packet은 덮어쓰지 않는다.

OSS·Port 변경 및 새 dependency는 없다. 기존 PostgreSQL relation projector/AI adapter, A2 provenance, 실행 accounting과 원본 capture를 재사용했다. 기존 OSS integration 결정의 범위를 바꾸지 않아 재선정·새 runtime·migration·rollback 작업은 필요하지 않다. 이번 변경은 문서 두 파일이며 rollback은 이 후속 문서와 Master Plan의 추가 기록만 되돌리는 것이다. 기존 승인·동결 이력은 삭제하지 않는다.
