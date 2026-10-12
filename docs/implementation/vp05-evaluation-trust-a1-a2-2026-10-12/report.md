# VP-05 A1·A2 독립 검토 보정 보고

> **A1_REVIEW_CORRECTION_COMPLETE / A2_CONDITIONALLY_ACCEPTED / PUBLICATION_HOLD / STOP**
>
> 기준 Canonical `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`, 검토 대상 `e8d0f7d769722f4482ff26a9828812f37e1270cc`. 2026-10-12 후속 사용자 정정을 적용했다. 브랜치 `codex/vp05-evaluation-trust-a1-a2`. 실제 외부 독립 검증·새 Gold·신규 평가 실행 모두 0. 게시 승인은 없다.

## 확정 결정

### A1 — 책임과 검토

[보정 A1](../../architecture/add/vp05-evaluation-trust/a1-reference-review-responsibility.md)은 선행 사용자 의무를 제거한다. Project Owner의 정책 승인과 reference별 의미 검증을 혼합한 것이 root cause였다. 제품에 승인 클릭을 추가하지 않는다고 하면서도 사용자에게 개별 정답 승인/reviewer 지정 의무를 부과한 결함을 보정했다.

- **사용자는 개별 Reference 검토·검증·승인 및 reviewer 지정 의무를 맡지 않는다.** Owner의 아키텍처·정책·게시·실행 범위 승인은 유지한다.
- 상위 에이전트가 자료 준비·기계 검증·증거 수집·분류·측정 운영을 담당한다. 인증 의미 검증은 사용자 외부 적격 인간 또는 동등함이 확인된 외부 reference provenance로 한정한다. 에이전트 해석·자동 검사·AI 합의·confidence는 인간 승인 증거가 아니다.
- 언어·의미 범위·단위/논리 검증 역량 및 필요한 분야 전제를 설명할 능력을 case별로 기록한다. 학위·계정명·Git author 또는 AI 합의만으로 전문성/독립성을 추정하지 않는다.
- 새 외부 검토 경로는 exact input의 독립 검토·이견·범위를 기록하고 기존 외부 reference 경로는 실제 인간 검증·label/input/policy 동등성을 확인한다. 공식 원문이나 NLI label을 Shotgun 관계 Gold로 자동 승격하지 않는다. 실제로 없는 두 번째 승인자도 만들지 않는다.
- 기존 Markdown/JSON·Git을 사용한다. 새 reviewer DB, 서명 서비스, Vault, OS SID receipt 또는 생산 승인 경로는 도입하지 않는다.

사용 가능한 외부 독립 검증 증거를 이번 작업에서 확보·실행하지 않았다. 해당 reference는 CANDIDATE/UNVERIFIED다. 증거 미확보를 사용자의 개별 승인 대기로 전환하지 않으며, 인증 Gold가 없어도 일반 자료 투입/질문에 Review/Approval 클릭을 추가하지 않는다.

### A2 — 문맥과 판정 범위

[A2](../../architecture/add/vp05-evaluation-trust/a2-evaluation-input-context.md)는 사용자 조건부 수용 상태를 유지하고 A1의 검증 주체를 참조한 부분만 정합화했다. 다음 계약은 그대로다.

- 미래 제품 평가의 primary는 **EC_RUNTIME_2000_V1**, 현행 실제 worker의 claim + 인가된 동일 EvidenceSpan context/projection이다. claim-only는 **CLAIM_ONLY_V1** secondary로 별도 집계하며 점수를 합치지 않는다.
- 별도 span·문서 전체·웹·평가자만 아는 heading/formula/조건을 정답 근거로 추가하지 않는다. 같은 pair라도 input/profile이 다르면 별도 승인 대상이다.
- 기본 언어 의미와 명시 입력의 산술/유한 논리/정확 단위 표기는 rule/유도 과정을 드러내고, 입력에 없는 경험적·분야 전제는 금지한다. 원문/조건/괄호를 삭제하는 normalization은 하지 않는다.
- 부족/분쟁/구조 불능과 인가/DB/입력 provenance 오류, provider UNKNOWN을 구분한다. 제외 수/이유·비율을 공개하고 외부 독립 검증 provenance가 확인된 입력 부족은 별도 abstention diagnostic 범위로 관리한다.
- ID/scope/source bytes, 실제 claim/context/crop/truncation, policy/schema/projector, semantic/structured/wire digest를 구분한다. 모델에게 주지 않은 provenance ID를 읽었다고 주장하지 않는다.

## 실제 구현 대조에서 보완한 사항

| 관측                                                                              | 결정에 반영한 내용                                                                                   |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Port 1.2.0의 context limit 2,000 Unicode code points                              | 새 큰 context/schema 없이 현행 product projection을 primary로 사용                                   |
| SQL의 긴 quote 처리 = 최대 1,998 substring + 양끝 ellipsis                        | source quote와 전달 projection 구별. ellipsis는 source evidence가 아님; 실제 crop/code identity 보존 |
| 일반 AI wire prompt는 claim/context/truncation, semantic digest에는 ID/scope 포함 | 두 digest의 의미와 전달 정보 구분                                                                    |
| 현재 main v6는 6종(UNRESOLVED 포함, NO_RELATION 없음), 로컬 v11은 7종             | 평가 input/policy identity 구분. v11 7종 또는 엄격한 RELATED를 v6에 조용히 적용하지 않음             |
| Phase A 432 request 재구성 vs B12 actual wire, IRR/PV evaluator-only 문맥         | provenance 증명 강도와 문맥 부족 기준을 구체화. 원본 이관/재채점 없음                                |

위 관측은 선행 구현 대조의 보존 기록이다. 보정에서 runtime·crop·prompt·schema·taxonomy를 변경하지 않았다. Unit conversion 같은 형식 해석과 분야 법칙을 구별하며 논쟁적인 가정은 외부 독립 의미 검증 범위가 확인되지 않으면 미검증이다.

## 인증·진단·제품 사용의 분리

외부 독립 검증이 커버하는 exact input/profile의 kind/direction/evidence만 인증 측정 후보로 사용할 수 있다. 미검증 mapping/context/field는 UNVERIFIED 또는 N/A다. CANDIDATE 기준과의 일치·schema·provenance·안정성은 별도 허가된 미래 진단에서 진단임을 명시할 수 있지만 객관 의미 오류율·인간 승인 상태로 부르지 않는다. 이번 보정에서 새 채점은 실행하지 않았다. 일반 제품 사용에 검토 클릭을 추가하지 않는다.

## 반영 위치와 최소 diff

선정 owner는 `docs/architecture/add/vp05-evaluation-trust/`다. 기존 Phase 1~6 ADD의 본문·승인 기록을 다시 쓰지 않고 VP 평가 Section의 구체화를 별도 기록한다.

| 파일/영역                                  | 변경                                | 이유                                                              |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------- |
| ADD vp05-evaluation-trust README / A1 / A2 | 기존 문서 보정                      | A1 역할·절차·증거 수준, A2 종속 참조와 시간 순서                  |
| ADD root README                            | 후속 note 정합화                    | 사용자 의무 제거와 publication HOLD                               |
| ADR-098                                    | 기존 후속 구현 note 보정            | 인간 검증 전 candidate 유지와 외부 검증 책임                      |
| ADR-173                                    | 기존 위임 note에 후속 정정 관계     | 자동 제품 원칙 및 사용자 정책/Reference 의미 검증 분리            |
| execution-plan                             | 기존 후속 결정 note 보정            | 사용자 개별 승인 대기 제거, agent 운영·외부 증거 미확보 구분      |
| 이 report / evidence.json                  | 현재 결과와 선행 이력 구분          | 보정 subject·검증·최소 diff·보존 기록                             |
| 기존 Phase A 3문서                         | bytes unchanged; 로컬 Git 보존 대상 | 과거 감사/초안의 미결 상태를 지우지 않음. 현재 결정은 후속 record |

**수정하지 않는 문서:** ADR-117, ADR-120, ADR-172, docs/CANONICAL.md, canonical-manifest, ADR registry, Phase 1~6 본문, 기존 승인/증거 registry. 새 핵심 권위나 상위 정책을 바꿀 필요가 없었다. 따라서 새 ADR 번호 또는 별도 상위 정책 승인을 요청하지 않았다.

Canonical base의 4개 문서 본문은 보존하고 e8d0f7d76의 로컬 후속 note를 정합화했다. **선행 A1의 사용자 최종 Reference 승인/reviewer 지정 의무는 후속 정정으로 대체**했다. 원래 기록은 Git 이력에 남고, Phase A 원본의 같은 표현은 비활성 역사 초안이다. 개별 label·게시·실행 승인을 받은 것으로 확대하지 않는다.

| 시간 순서                     | 결정·기록                                                                  | 현재 적용                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1, 선행 사용자 위임/결정 기록 | A1 먼저 A2 다음 구체화한 e8d0f7d76; 사용자 최종 Reference 승인 구조를 기록 | 원본 Git 이력 보존. 해당 사용자 의무는 대체됨                             |
| 2, 이후 명시적 독립 검토 정정 | A1_CHANGES_REQUIRED / A2_CONDITIONALLY_ACCEPTED / PUBLICATION_HOLD         | 현재 계약: 사용자 의무 제거, 외부 독립 검증/동등 provenance 및 agent 운영 |
| 3, 이번 로컬 보정             | 종속 문서·상태·검증 evidence 정합화                                        | 새 Gold 0·실행 0, 게시 HOLD. 정정 완료를 새 게시 승인으로 해석하지 않음   |

## 검증과 재사용

검증 기록은 [evidence.json](./evidence.json)에 exact hashes·commands·상태와 함께 남긴다.

| 검사                                                                                                   | 최종 결과 / 한계                                   |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 문서 링크·ADR 1~173 owner·Canonical/evidence/generated registries·drift·Frontend completion invariants | docs-validation all PASS                           |
| Knowledge Flow 생성 HTML 일치                                                                          | PASS                                               |
| 변경 문서 Markdown/JSON format                                                                         | PASS                                               |
| Canonical 본문·A2 핵심 범위·Phase A 원본 및 선행 Git 이력                                              | PASS; 현재와 대체된 사용자 의무를 구별             |
| 동결 원본/Phase A 외부 증거·source worktree HEAD/status/stash·운영 checkout                            | PASS; 허용된 후속 note와 외부 검증 artifact를 분리 |
| app/DB/provider/quality evaluator 실행                                                                 | NOT_RUN; 이번 문서 결정 범위의 금지 유지           |
| remote CI / push / PR / merge / 운영 적용                                                              | NOT_RUN / NOT_AUTHORIZED                           |

e8d0f7d76의 선행 검증에서는 최초 AJV 부재와 작성 전 report 링크 2개 실패가 있었으며 그 이력은 별도로 보존한다. 이번 보정은 이미 설치된 dependency junction과 같은 validator를 재사용해 다시 검사했다. package 설치·lockfile·글로벌 환경 설정 또는 validator 완화는 없다. 구체적인 현재 check/log와 선행 check를 evidence에서 구분한다.

이번 구현은 문서 구체화다. 기존 quality-evaluation의 versioned artifact/인간 label 승인/ratio N/A 계약과 docs validator·Git/hash를 REFERENCE_ONLY로 재사용한다. gbrain/lucas/ddsyasas/OpenKnowledge의 기존 Role Matrix 경계를 유지하며 전체 runtime·DB·AI judge를 새 승인 권위로 채택하지 않는다. 이 책임·문맥 결정에 새 OSS dependency를 추가할 근거가 없으므로 `NO_RELEVANT_OSS` for new authority implementation; 새 ADOPT/EXTRACT/AUGMENT·license/version/lockfile 변경 없음. Migration·adapter replacement·code regression tests는 적용되지 않는다.

Rollback은 새 Section/note의 문서 변경을 명시적으로 revert하는 범위다. 원본 감사, old user approvals, frozen 결과, stash를 삭제하거나 기존 결과를 다시 쓰는 rollback은 아니다.

## 미결사항과 최종 판정

1. 외부 적격 인간 검증 또는 동등한 external reference provenance를 실제로 확보·확인한 것은 없다. 증거 확보·분류·측정 운영은 상위 에이전트 책임이며, 사용자에게 개별 검토·승인·reviewer 지정을 요구하지 않는다. 증거 없는 case는 CANDIDATE/UNVERIFIED다.
2. A3 이후의 kind/direction/warrant/absence taxonomy·metric·critical/대표 질문 및 prospective 실행 계약은 이번에 확정하지 않는다. 특히 v6 6종과 v11 7종의 호환성은 input 결정과 별도다.
3. 문서의 GitHub 게시와 미래 평가 실행은 별도 승인 대상이다. 로컬 decision completion과 Canonical publication을 구분한다.

**A1 보정 완료, A2 조건부 수용 계약 유지, PUBLICATION_HOLD.** 새로운 reviewer DB/승인 서비스/runtime 권위 없음. 운영 DB/Authority/Vault/환경 설정/앱/worker 변경 0, 실제 AI 호출 0, 신규 평가·기존 재채점 0, 새 Gold 0. B 잔여24·Gold-B-7·VP-06 및 동결/중단 상태를 유지하고 STOP한다.
