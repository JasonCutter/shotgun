# VP 남은 인수 Gate — Canonical 증거 대조

- 날짜: 2026-10-16 KST
- 기준 main: `75c68210445d8184dee5986cfc048910fa667915`
- Tree: `121d5073f5d70e698ec4c0efe14e86024cf15f3e`
- 판정: **OFFLINE_CAPTURE_PERSISTENCE_RECONCILED / VP_FINAL_ACCEPTANCE_NOT_COMPLETE**
- 범위: 기존 격리 실호출의 capture/저장 기록 대조, 최신 main 설치 검증 재사용, 설치 launcher 읽기 전용 확인. 추가 provider 호출·평가 실행·운영 변경은 0이다.

이 문서는 [전체 실행 지시](./execution-directive.md)에 대한 후속 증거 정리다. [A1](../../architecture/add/vp05-evaluation-trust/a1-reference-review-responsibility.md), [A2](../../architecture/add/vp05-evaluation-trust/a2-evaluation-input-context.md), [A3](../../architecture/add/vp05-evaluation-trust/a3-relation-reference-measurement.md), [측정 계약](./evaluation-execution-accounting.md)과 [DoD](../definition-of-done.md)를 변경하거나 새 평가 권위를 채택하지 않는다. 이전 보고서의 당시 상태는 보존한다. 파일별 원본 locator/size/SHA-256은 [manifest](./acceptance-evidence-closure-manifest.json)에 있다.

## 1. Canonical 게시와 기존 실패의 현재 상태

PR #388의 TS5 보정은 main `e02d96ff1dffa8291da969088c763bdca7df73ed`에 반영됐다. PR #389는 사용자 별도 승인 후 위 main75에 병합됐다. 승인 head `bfb189860c211680763d03cba8f7b202c019899b`와 병합 tree가 같으며 27개 파일 blob을 대조했다.

[Post-merge CI38829565062](https://github.com/JasonCutter/shotgun/actions/runs/38829565062)의 Quality·Frontend·Required Gates가 모두 SUCCESS다. Unit1,675, contract823, integration531 PASS/10 기존 SKIP, PostgreSQL748 PASS/2 기존 SKIP, Frontend405, browser86 PASS/6 기존 SKIP, 표준 TS6 53/53 PASS다. Timeout·assertion·skip 설정은 완화하지 않았다. CI38755062571의 A6 기대값 실패와 CI38757474020의 migration139 기대값 실패는 이전 head의 기록으로 남아 있다.

## 2. 10회 상한과 실제 관측 모집단

| 항목                               | 보존 원본을 대조한 결과                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| 확인된 provider 응답               | 9건: 추출3, Ask4, 관계1, 이미지1                                                             |
| 응답과 저장 기록의 1:1 attribution | 9/9; 응답 ID, 응답 본문 SHA-256, usage, 실행/attempt 식별자 대조                             |
| 이전 가능한 UNKNOWN                | 1건; 최초 slot marker와 STOP은 있고 invoke/response receipt는 없음                           |
| 실제 egress 수                     | 확인된 최소9, 가능한 최대10. 최초 slot을 호출0 또는 확정 호출1로 바꾸지 않음                 |
| 보수적으로 소진한 승인 상한        | 10/10, 잔여0. UNKNOWN 재호출·상한 초기화 없음                                                |
| 확인된 응답의 보고 토큰            | input6,234 + output682 = total6,916                                                          |
| usage coverage                     | 확인된 응답9/9. 가능한 UNKNOWN의 usage는 UNKNOWN이며 전체 실행 완전 coverage를 주장하지 않음 |

저장된 추출 output/attempt3, Ask run/attempt4, relation provider-call1, image execution1을 각 transport response와 연결했다. Extensionless slot에 보존된 실제 request body9건도 다시 해시해 invocation/result의 wire digest와 일치함을 확인했다. 본문을 재파싱한 것은 ID/usage/입력 동등성 대조 목적이며, 의미 답변을 재채점하거나 원래 parsing·채택 결과를 변경하지 않았다. 동결72/432/B12·B 잔여24는 읽거나 실행하지 않았다.

최초 UNKNOWN은 logging 이전 egress 또는 pre-egress crash를 구분할 증거가 없다. Receipt 부재만으로 미호출을 선언하지 않으며 과거 불확실성을 해소한 것처럼 기록하지 않는다.

## 3. 실행·관계 채택·비용 분모 분리

실제 전역 relation claim은 **1개**다. Global claim/job/semantic-attempt/execution-key/provider/response와 저장 output의 ID·usage를 대조했다. 나머지8건은 추출·Ask·이미지 실행으로, 허구의 relation claim을 만들어 기존 helper에 넣지 않았다. 전체10회 상한은 격리 인수 통제이며 전역 relation 예산과 별개다.

이 실제 relation만 기존 `accountRelationExecutions`에 연결했다. `taskId`는 보존된 `relation_request_id`, `inputDigest`는 저장 call의 `request_digest`를 명시적으로 투영한다. 구조적 wire digest와 같은 값이라고 가정하지 않는다. Provider 성공1/전역 claim1이며, 실제 채택은 WITHHELD1이다. Job은 `COMPLETED`, `last_failure_code=INSUFFICIENT_EVIDENCE`, 원본 choice는 RELATED였다. **실행 완료를 관계 채택이나 의미 정답으로 세지 않는다.**

처음 작성한 오프라인 auditor가 withheld job의 실행 상태를 `UNRESOLVED`로 예상해 실패했다. 실제 SQL은 `COMPLETED`와 위 reason을 함께 보존하고 있었다. 원본/생산 코드는 수정하지 않고 auditor를 이 두 정확한 필드에 맞췄다. 최초 script·실패 log를 보존했으며 정상 실행 상태를 새 제품 결함 또는 모델의 UNRESOLVED 선언으로 재분류하지 않았다.

중복 response, 저장 usage 불일치, 미귀속 response, 잘못된 global attempt, UNKNOWN 누락, 소진 한도 초기화, 완료 job의 채택 오인 **7개 negative check가 모두 거부**됐다. 이 검사는 오프라인 대조기의 오류 검출이며 의미 Gold 검증이 아니다.

### 실제 wire를 사용한 외부 독립 검토 준비

해당 relation1건의 보존 request body에서 system/user 메시지와 전송 parameters를 그대로 추출해 **CANDIDATE/UNVERIFIED** 입력 packet을 준비했다. 원문은 text run의 `slot-07`이며 실행 commit은 `80eeb2f2936d58b12cc1faf465b3bfd46161512a`다. 이는 새 모델 실행이나 현행 main 결과의 생성이 아니다.

실제로 전달된 user payload는 두 claim과 **양쪽 null evidenceContext, false truncation**이었다. 이를 EvidenceSpan 문맥이 전달된 primary reference라고 인증하지 않고 `CLAIMS_WITH_NULL_EVIDENCE_CONTEXT` 관측으로 남겼다. 문맥이 null인 이유나 의미 충분성을 추정하지 않으며 Source의 내용을 평가자에게만 보충하지 않는다. Assertion text와 실제 Source/SourceVersion/Evidence ID 연결은 저장 snapshot으로 대조했지만 원문 EvidenceSpan quote/crop 및 현재 가시성의 독립 권위 조회는 수행하지 않았다.

Review input에는 모델의 답·confidence·채택 결과·expected tuple·provider header를 넣지 않았다. 개발자가 원래 모델 결과를 본 사실과 외부 reviewer의 노출 여부 미확인을 기록했으므로 새 blind holdout은 아니다. 독립 review/인증 기록은 null/0이며 실제 적격 외부 검토와 A1/A2의 남은 provenance 검증 전에는 A3 인증 reference로 투입하지 않는다. 사용자에게 이 사례의 검토·승인을 요구하지 않는다.

Claim 재작성·평가자 전용 context 추가·expected tuple 누출·자동 Gold 승격·SourceVersion 바꿔치기 **5개 negative check를 거부**했다. Packet은 실제 wire와 동일하고 외부 연락/전송은0이다. 향후 검증 준비 자료를 만든 것이며 기존 결과의 재채점·정답 확정은0이다.

## 4. 실제 청구 및 latency 한계

보존 packet에 실제 response별 청구 provenance는 0건이다. 추출의 cost는 `unavailable`, Ask의 `cost_micros`는 null이다. **실청구액은 N/A**다. 원문 토큰 합계를 가격표와 곱하거나 null을 무료0으로 바꾸지 않는다. Relation helper에도 invoice line을 넣지 않았으며 `totalPaidCost=null`이다. 응답/실행과 연결할 수 있는 실제 청구 export가 확보되면 그 범위에서 별도 대조해야 한다.

Capture의 시간 경계는 `HARNESS_FETCH_ENTRY_THROUGH_RESPONSE_CLONE_BODY`다. 관측9건의 NEAREST_RANK p50=1,089ms, p95=1,914ms지만 서로 다른 작업이 섞인 작은 제품 표본의 transport 기술통계다. 일반 성능 Gate, 서버 추론 시간, relation-only p95 또는 accounting 계약의 `ADAPTER_INVOKE_TO_RESPONSE_OR_THROW` 시간으로 재명명하지 않는다. 이 경계의 whole-experiment adapter latency는 N/A이며 relation helper의 latency도 null로 남겼다. Claim 생성→settle 시간을 대용하지 않았다.

## 5. 최신 main 설치 증거 재사용

위 main CI에는 `vp-application-distribution.test.ts`의 실제 새 설치/복구/정상 제품 여정이 포함됐다. Source base는 정확히 main75이며 allowlist runtime875파일, lockfile441 package entries다. Source digest는 `8d1607e1fc49e1d9438743d6093fb02c9069d167e83740918fd155353d2fa970`, archive digest는 `2ea82123d26cb3fb4726f45613c66ae8f0f631d203c7aeb4f7094e4fdaff4e6b`다.

새 설치, SPA/application/worker/PostgreSQL/Fake 정상 A/B/수정본 여정, 같은 identity 재사용, child3세대 및 owner crash recovery를 통과했다. 새로 같은 시험을 반복하지 않았다. 이 fixture는 검증용 파일이 포함된 합성 origin/main `c1a33d30dc39d008cca3fcbac316b245e5a78061`을 만든다. **Ubuntu CI의 최신 코드 distribution 증거이며 실제 GitHub main 설치본의 Windows desktop/reboot 인수는 아니다.** 기존 [Windows owner 증거](./canonical-owner-fake-proof.md)의 좁은 범위도 그대로 유지한다.

Windows에서 실제 이미지/Ask를 실행한 `6276186929055bbb3bc2e3a2a57a9e6560885396`과 현재 main75의 `adapters/apps/assemblies/modules/packages/db`, `scripts/launch-local.ts`, `scripts/launch-core.ts`, root manifest/lockfile을 Git으로 비교했다. 선택된 application runtime·dependency 경로의 변경은 0이다. 이후 변경은 이 범위 밖의 문서·감사·테스트다. 따라서 기존 [이미지 인수](./isolated-image-live-acceptance-2026-10-15.md)를 해당 코드 바이트의 제품 증거로 재사용하며 같은 실호출을 반복하지 않는다. 이것이 설치된 Git HEAD·운영 schema/configuration·Windows reboot를 증명하지는 않는다.

Desktop shortcut은 읽기 전용으로 확인했다. Target은 `Start-Shotgun.ps1`, working directory는 `C:/dev/shotgun`이다. 해당 checkout은 clean/main23be다. Launcher는 실행 시 먼저 origin을 fetch하고 main을 fast-forward하므로 현재 checkout이 과거 SHA라는 사실만으로 다음 실행의 코드가 과거 버전이라고 단정하지 않는다. 반대로 이 정적 검토를 현재 설치본 실행 성공으로 계산하지도 않는다.

이 launcher는 operating .env를 읽고 Docker/운영 DB와 정상 앱을 시작할 수 있다. Shortcut 저장·실행, Git 갱신, Docker/DB/app 시작을 하지 않았다. 현재 컨테이너 상태나 전체 host quiescence도 인증하지 않는다.

## 6. 재사용 및 변경 범위

기존 `vp-relation-evaluation` accounting/digest, Node crypto/fs/assert, 저장된 SQL/transport/CI 증거와 기존 launcher/배포 fixture를 **AUGMENT/REFERENCE_ONLY**로 재사용했다. 신규 패키지·OSS runtime·reviewer DB·billing 서비스·권위·migration은 없다. 기존 gbrain/lucas/ddsyasas/OpenKnowledge 및 PostgreSQL의 [통합 결정](./integration-decisions.md), pin·license·보안·교체 경계를 유지하므로 OSS Role Matrix의 채택 행을 바꾸지 않는다. 과거 외부 reference 조사를 반복하거나 새 prompt/model/schema 실험을 하지 않았다.

Repository 변경은 이 보고서·manifest·Master Plan의 후속 기록뿐이다. 한 번 사용하는 오프라인 script와 원시 결과는 외부 artifact에 둔다. Rollback은 새 문서와 artifact 참조를 제외하는 것으로 충분하며 운영 데이터 복구가 필요하지 않다.

## 7. 남은 실제 완료 조건

| Gate                                    | 현재 상태                                                                                                 | 필요한 최소 증거/권한                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 현재 v6 입력에 대한 독립 의미 reference | Actual-wire candidate1 준비, 독립 검토/Shotgun 인증0, precision/recall/F1·Frontier recall·calibration N/A | Exact input/kind/direction/warrant/context에 대응한 적격 외부 독립 검증. AI 합의나 기존 NLI label 자동 mapping으로 대체하지 않음 |
| 실청구                                  | 응답/usage 대조9/9, 실제 청구 N/A                                                                         | 실제 provider billing provenance와 실행 attribution. 가능한 UNKNOWN까지 전체 대사했다고 주장하지 않음                            |
| Windows 설치본 및 운영 release          | 최신 코드 Linux 격리 설치/제품/복구 PASS, Windows 실제 운영 인수 미실행                                   | 별도 승인된 release/cutover 창, 최신 backup/DB/authority/config/schema/readback, 현재 설치 identity 및 reboot/recovery 증거      |

사용자에게 개별 지식/Reference 승인 또는 reviewer 지정 의무를 추가하지 않는다. 의미 검증 인력 접촉·유료 의뢰, 추가 실AI, 운영 전환, 게시·병합을 이 보고서로 승인하지 않는다. 10회 상한 STOP과 운영 HOLD는 유지한다.

남은 자료 없이 synthetic 시험이나 모델 호출을 반복해 위 분모를 채우지 않는다. 새로운 구현 결함은 이번 대조에서 확인되지 않았으며 기존 성공을 재사용했다. **VP 전체/최종 인수 완료는 아직 아니다.**
