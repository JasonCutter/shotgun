# VP-05 A1·A2 위임 결정 완료 보고

> **A1_A2_DECISIONS_COMPLETE / LOCAL_PENDING_CANONICALIZATION / STOP**
>
> 기준 Canonical `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`, ADR-173. 사용자 위임 2026-10-12. 로컬 브랜치 `codex/vp05-evaluation-trust-a1-a2`. 개별 Reference 인간 검토/승인 0, 인증 Gold 승격 0, 새로운 평가 실행 0.

## 확정 결정

### A1 — 책임과 검토

[A1 결정](../../architecture/add/vp05-evaluation-trust/a1-reference-review-responsibility.md)을 먼저 작성·확정했다.

- 개별 정답 최종 승인자는 **현재 실제 사용자/프로젝트 소유자**다. 에이전트는 위임받은 구체적 계약 결정과 packet·절차 운영을 수행하며 인간 의미 승인자가 아니다.
- 최소 **독립적인 인간 의미 검토자 1명 + 그와 다른 인간 최종 승인자**를 요구한다. 작성자·해당 case의 label/prompt/scorer를 맞춘 사람이 자신을 독립 reviewer로 기록하지 않는다.
- 언어·의미 범위·단위/논리 검증 역량 및 필요한 분야 전제를 설명할 능력을 case별로 기록한다. 학위·계정명·Git author 또는 AI 합의만으로 전문성/독립성을 추정하지 않는다.
- 가린 첫 판단→기존 기록 비교→이견/복수 tuple/부족 보존→정확한 input/reference digest의 명시적 인간 승인→Git 기록·reviewed main 게시 순서다. Material disagreement나 전문성 부족은 추가 적격 인간 검토를 거쳐 해소 전 승인하지 않는다.
- 기존 Markdown/JSON·Git을 사용한다. 새 reviewer DB, 서명 서비스, Vault, OS SID receipt 또는 생산 승인 경로는 도입하지 않는다.

실제 reviewer 지정·사람의 검토·개별 승인은 아직 수행되지 않았다. 이는 **책임 계약 미결정이 아니라 개별 Reference 승인 미수행**이다. 이번 작업에서 사람의 reviewer나 승인 receipt를 만들어 채우지 않았다.

### A2 — 문맥과 판정 범위

A1 이후 [A2 결정](../../architecture/add/vp05-evaluation-trust/a2-evaluation-input-context.md)을 작성·확정했다.

- 미래 제품 평가의 primary는 **EC_RUNTIME_2000_V1**, 현행 실제 worker의 claim + 인가된 동일 EvidenceSpan context/projection이다. claim-only는 **CLAIM_ONLY_V1** secondary로 별도 집계하며 점수를 합치지 않는다.
- 별도 span·문서 전체·웹·평가자만 아는 heading/formula/조건을 정답 근거로 추가하지 않는다. 같은 pair라도 input/profile이 다르면 별도 승인 대상이다.
- 기본 언어 의미와 명시 입력의 산술/유한 논리/정확 단위 표기는 rule/유도 과정을 드러내고, 입력에 없는 경험적·분야 전제는 금지한다. 원문/조건/괄호를 삭제하는 normalization은 하지 않는다.
- 부족/분쟁/구조 불능과 인가/DB/입력 provenance 오류, provider UNKNOWN을 구분한다. 충분 입력 의미 지표에서 제외할 사례와 이유·비율을 숨기지 않고, 인간이 입력 부족을 승인한 경우는 별도의 abstention diagnostic 범위로 관리한다.
- ID/scope/source bytes, 실제 claim/context/crop/truncation, policy/schema/projector, semantic/structured/wire digest를 구분한다. 모델에게 주지 않은 provenance ID를 읽었다고 주장하지 않는다.

## 실제 구현 대조에서 보완한 사항

| 관측                                                                              | 결정에 반영한 내용                                                                                   |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Port 1.2.0의 context limit 2,000 Unicode code points                              | 새 큰 context/schema 없이 현행 product projection을 primary로 사용                                   |
| SQL의 긴 quote 처리 = 최대 1,998 substring + 양끝 ellipsis                        | source quote와 전달 projection 구별. ellipsis는 source evidence가 아님; 실제 crop/code identity 보존 |
| 일반 AI wire prompt는 claim/context/truncation, semantic digest에는 ID/scope 포함 | 두 digest의 의미와 전달 정보 구분                                                                    |
| 현재 main v6는 6종(UNRESOLVED 포함, NO_RELATION 없음), 로컬 v11은 7종             | 평가 input/policy identity 구분. v11 7종 또는 엄격한 RELATED를 v6에 조용히 적용하지 않음             |
| Phase A 432 request 재구성 vs B12 actual wire, IRR/PV evaluator-only 문맥         | provenance 증명 강도와 문맥 부족 기준을 구체화. 원본 이관/재채점 없음                                |

위 관측은 기존 파일의 정적 대조다. 새로운 모델/성능 평가가 아니다. Unit conversion 같은 형식 해석과 분야 법칙은 구별했으며, 논쟁적인 가정은 case별 인간 검토 대상이다. 현재 corpus 전체의 단위/의미 정답을 이 문서에서 승인하지 않았다.

## 반영 위치와 최소 diff

선정 owner는 `docs/architecture/add/vp05-evaluation-trust/`다. 기존 Phase 1~6 ADD의 본문·승인 기록을 다시 쓰지 않고 VP 평가 Section의 구체화를 별도 기록한다.

| 파일/영역                                  | 변경                                | 이유                                                                |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| ADD vp05-evaluation-trust README / A1 / A2 | 신규 3문서                          | 두 Section의 결정·근거·제외 대안·영향·미결·이력을 각각 소유         |
| ADD root README                            | 날짜 있는 탐색 note 추가            | 새 record 위치와 local pending 상태 명시                            |
| ADR-098                                    | 끝에 구현 note 추가                 | 인간 승인/평가-생산 분리 정책과 Section의 연결                      |
| ADR-173                                    | 끝에 위임 note 추가                 | 구체적 방법 선택 대기 해소; Gold/상위 정책/실행·게시 경계 유지      |
| execution-plan                             | 끝에 후속 결정 note 추가            | 2026-10-10 미결사항은 보존하고 A1/A2 계약 완료와 검토 미수행을 구분 |
| 이 report / evidence.json                  | 신규 보고 및 safe evidence manifest | exact subject·검증·외부 증거 보존/역할·상태 기록                    |
| 기존 Phase A 3문서                         | bytes unchanged; 로컬 Git 보존 대상 | 과거 감사/초안의 미결 상태를 지우지 않음. 현재 결정은 후속 record   |

**수정하지 않는 문서:** ADR-117, ADR-120, ADR-172, docs/CANONICAL.md, canonical-manifest, ADR registry, Phase 1~6 본문, 기존 승인/증거 registry. 새 핵심 권위나 상위 정책을 바꿀 필요가 없었다. 따라서 새 ADR 번호 또는 별도 상위 정책 승인을 요청하지 않았다.

기존 4개 수정 문서는 원래 전체 본문이 byte-identical prefix로 남으며 note만 추가했다. 기존 사용자 승인 취소/대체는 없다. Phase A의 사용자 세부 선택 대기 상태는 후속 위임 범위 A1/A2에서 해소하며, 개별 label/Git 게시/실행 승인을 받은 것으로 확대하지 않는다.

## 검증과 재사용

검증 기록은 [evidence.json](./evidence.json)에 exact hashes·commands·상태와 함께 남긴다.

| 검사                                                                                                   | 최종 결과 / 한계                                   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 문서 링크·ADR 1~173 owner·Canonical/evidence/generated registries·drift·Frontend completion invariants | docs-validation all PASS                           |
| Knowledge Flow 생성 HTML 일치                                                                          | PASS                                               |
| 변경 문서 Markdown/JSON format                                                                         | PASS                                               |
| 기존 4문서의 byte prefix 및 Phase A 3문서 hash                                                         | PASS; 원 승인/역사 기록 유지                       |
| 동결 원본/Phase A 외부 증거·source worktree HEAD/status/stash·운영 checkout                            | PASS; 허용된 후속 note와 외부 검증 artifact를 분리 |
| app/DB/provider/quality evaluator 실행                                                                 | NOT_RUN; 이번 문서 결정 범위의 금지 유지           |
| remote CI / push / PR / merge / 운영 적용                                                              | NOT_RUN / NOT_AUTHORIZED                           |

초기 validator 실행은 분리 worktree에 `ajv`가 없어 실행 전 실패했다. 이미 설치된 `C:/dev/shotgun/node_modules`를 새 audit worktree의 ignored junction으로 재사용했고 package 설치·lockfile 변경·글로벌 환경 변수 변경을 하지 않았다. 보고서를 작성하기 전 중간 검사는 아직 없는 report 링크 2개 때문에 실패했다. 파일 작성 후 같은 검사를 다시 수행해 통과했으며 최초 실패를 숨기거나 validator를 완화하지 않았다.

이번 구현은 문서 구체화다. 기존 quality-evaluation의 versioned artifact/인간 label 승인/ratio N/A 계약과 docs validator·Git/hash를 REFERENCE_ONLY로 재사용한다. gbrain/lucas/ddsyasas/OpenKnowledge의 기존 Role Matrix 경계를 유지하며 전체 runtime·DB·AI judge를 새 승인 권위로 채택하지 않는다. 이 책임·문맥 결정에 새 OSS dependency를 추가할 근거가 없으므로 `NO_RELEVANT_OSS` for new authority implementation; 새 ADOPT/EXTRACT/AUGMENT·license/version/lockfile 변경 없음. Migration·adapter replacement·code regression tests는 적용되지 않는다.

Rollback은 새 Section/note의 문서 변경을 명시적으로 revert하는 범위다. 원본 감사, old user approvals, frozen 결과, stash를 삭제하거나 기존 결과를 다시 쓰는 rollback은 아니다.

## 미결사항과 최종 판정

1. 실제 인간 reviewer 지정·전문성/독립성 확인 및 case별 review/최종 사용자 승인은 미수행이다. 승인 증빙 없는 case는 Gold가 아니다.
2. A3 이후의 kind/direction/warrant/absence taxonomy·metric·critical/대표 질문 및 prospective 실행 계약은 이번에 확정하지 않는다. 특히 v6 6종과 v11 7종의 호환성은 input 결정과 별도다.
3. 문서의 GitHub 게시와 미래 평가 실행은 별도 승인 대상이다. 로컬 decision completion과 Canonical publication을 구분한다.

**A1·A2 계약 결정 완료. 새로운 상위 정책 권위 없음. 새 Gold 승인 없음.** 운영 DB/Authority/Vault/환경 설정/앱/worker 변경 0, 실제 AI 호출 0, 기존 평가 재채점 0. B 잔여24·Gold-B-7·VP-06 및 동결/중단 상태 유지. 후속 Section을 시작하지 않고 STOP한다.
