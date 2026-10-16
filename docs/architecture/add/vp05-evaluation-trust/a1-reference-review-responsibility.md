# VP-05 A1 — Reference 승인 책임 및 독립 검토

> 2026-10-16 후속 사용자 승인: [인증과 제품 인수 범위 분리](./relation-negative-and-acceptance-policy-draft.md#5-승인된-인간-인증과-제품-인수-범위-분리)를 적용한다.
> 아래의 외부 인간/동등 reference 요건은 **CERTIFICATION/Gold의 요건**으로 유지한다.
> 모든 내부 관계 또는 기존72개 전부의 인간 승인을 일반 제품 인수의 일률적 선행
> 조건으로 확대하지 않는다. AI 교차 검토·결정론적 제품 검증의 실제 범위는 별도
> 보고하고 인증 점수와 구분한다. 사용자 개별 검토·reviewer 지정 의무는 없다.

- Section decision: **CORRECTED_PER_USER_REVIEW / PUBLICATION_HOLD — 2026-10-12**
- Record identity: `VP05-EVAL-A1-20261012`
- Subject: Canonical `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`
- Decision maker: 상위 실행 에이전트, A1·A2 위임과 후속 명시적 사용자 정정 범위
- Review subject: `e8d0f7d769722f4482ff26a9828812f37e1270cc`; 후속 `A1_CHANGES_REQUIRED / A2_CONDITIONALLY_ACCEPTED / PUBLICATION_HOLD`가 현재 적용 계약
- Publication: **LOCAL / PUBLICATION_HOLD**. reviewed merge 전 Canonical 아님
- Individual Reference approvals issued by this Section: **0**
- Governing policies: [ADR-098](../../adr/ADR-098-stage-12-1-quality-evaluation-contract.md), [ADR-173](../../adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md), [문서 권위](../../../CANONICAL.md)

## 1. 확정 결정

**Shotgun 사용자는 개별 Reference의 reviewer/approver가 아니며 reviewer 지정 의무도 없다.** Project Owner는 아키텍처·정책·게시·실행 범위에 관한 승인 역할을 유지한다. 그 역할과 개별 reference의 의미 검증은 별개다. 일반 자료 투입·질문·관계·AI 결과에 사용자 Review/Approval 클릭을 추가하지 않는다.

상위 에이전트가 평가 자료 준비·기계적 검증·증거 수집·분류·측정 운영을 담당한다. 인증에 필요한 독립 의미 검증은 **사용자 외부의 적격 인간 검토자** 또는 **동등한 독립 의미 검증 provenance를 확인한 외부 reference**로 충족한다. 에이전트가 이 증거를 확보하지 못하면 CANDIDATE/UNVERIFIED로 유지한다. 이를 사용자의 승인 대기로 돌리거나 AI 검증으로 대신 채우지 않는다.

### 역할과 실제 책임

| 역할                              | 담당 / 권한                                                                                                          | 하지 않는 일                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 계약·packet 운영자                | 위임받은 상위 에이전트. exact input, source/provenance, 이력, 후보 tuple, validation 결과를 준비                     | AI 간 합의나 자신의 해석을 인간 의미 검증으로 인증하지 않음                                          |
| Reference 작성자                  | 사람 또는 AI. 작성 방식·사용 모델/보조 도구·자신의 개입을 기록                                                       | 자신의 label을 독립 검증한 것으로 세지 않음                                                          |
| 독립 의미 검토자 / 외부 검증 주체 | 사용자 외부의 적격 실제 사람 또는 그 검토를 입증하는 외부 reference의 검증 주체. case별 전문성·독립성·검증 범위 기록 | 해당 case의 작성자가 자신을 독립 reviewer로 세거나 AI 검증을 인간 검증으로 표시하지 않음             |
| 평가 증거 운영자                  | 상위 에이전트. 적격 검토/외부 검증 provenance 확보 경로를 관리하고 exact input과 검증 범위의 대응·보존을 확인        | 사용자를 reviewer 지정자/개별 의미 승인자로 배정하지 않음; 자신의 판단만으로 인증 Gold를 만들지 않음 |
| 추가 외부 검토자                  | 이견이 해소되지 않을 때 적격성과 독립성을 확인할 다른 사용자 외부 인간 검토자                                        | 증거가 없으면 미해결 유지. 표결로 타당한 반대 해석을 지우지 않음                                     |
| Project Owner                     | 아키텍처·평가 정책·게시·실행 권한의 승인 범위 유지                                                                   | 개별 Reference 검토·검증·승인 또는 reviewer 지정 의무를 맡지 않음                                    |

현재 이 작업에서 적격 외부 검토자나 동등한 외부 reference 검증 증거를 확보한 것은 없다. **새 인증 Gold는 0건**이다. 실존하지 않는 reviewer·review·승인 receipt를 만들지 않는다. 증거 미확보는 평가 인증 수준의 제한이며 정상 제품 사용에 사용자 승인 절차를 추가하는 사유가 아니다. 이번 작업에서 외부 사람에게 연락하거나 reference를 새로 채점하지 않는다.

### 전문성·독립성 요건

1. 해당 입력 언어를 이해하고 entity/property/time/condition/exception/unit 및 evidence 범위를 직접 설명할 수 있어야 한다. 단위·산술은 검증 과정을 제시한다.
2. 금융·표준·물리 등 외부 분야 전제가 필요한 case는 해당 전제를 검토할 전문성과 근거를 명시한다. 검토 가능한 범위를 넘어서는 분야 사실은 인증하지 않고 부족/이견으로 남긴다. 학위·직함만으로 모든 case의 전문성을 추정하지 않는다.
3. 자신이 그 case의 label·허용 tuple을 작성했거나, 그 결과에 맞춰 prompt/parser/scorer를 개선했다면 그 case의 독립 reviewer가 될 수 없다. 같은 프로젝트에 속했다는 이유만으로 자동 탈락시키지는 않지만 역할·이해관계·기존 결과 노출을 공개해야 한다.
4. 첫 판단은 제공될 입력·정책 정의·허용 전제로 수행하며 기존 label·모델 응답·점수를 가린다. 그 후 기존 기록과 비교하고 이견을 기록한다. 과거 노출이 있으면 공개한다. 이 절차가 노출된 72쌍을 새 blind holdout으로 바꾸지는 않는다.
5. AI 도구의 사용은 공개한다. 사람이 원문·논증·반대 해석을 실제로 확인하고 자기 판단에 책임질 때만 인간 검토로 기록한다. AI 결과를 읽지 않고 전달/서명하는 것은 독립 검토가 아니다.

Critical case에도 독립 인간 의미 검증의 범위·근거를 확인한다. material disagreement 또는 전문성 부족이 해소되지 않으면 분쟁/UNVERIFIED로 유지한다. 외부 검증 기관의 역할 분리와 추가 검토가 실제로 있다면 그대로 기록하며, 없는 두 번째 승인자나 두 번의 독립 검토를 만들어 세지 않는다. 사용자 최종 승인자 또는 일률적인 두 인간 승인 단계를 인증 조건으로 요구하지 않는다.

## 2. 실제 검토와 승인 증빙

1. 상위 에이전트가 기존 label과 구분된 versioned packet을 준비하고 A2의 exact input·권한·version·digest를 기계적으로 확인한다. AI 후보는 CANDIDATE다.
2. 사용자 외부의 적격 검토 증거나 외부 reference provenance를 확보·확인한다. 인간 identity/역할·전문성·독립성·검토 시점·범위를 확인할 수 있어야 한다. pseudonym은 가능하나 감사 가능한 책임 대응이 필요하다. 계정명·Git author·기관 이름만으로 인간 검증을 추정하지 않는다. 증거 확보를 사용자 지정 의무로 넘기지 않는다.
3. 새 외부 인간 검토 경로에서는 동일 입력의 종류·방향·근거·가정·반대 해석·판정 가능성 및 검증 결과를 기록한다. 이미 검증된 외부 reference 경로에서는 그 검증 기록과 아래의 동등성 요건을 확인한다. 구조 검사와 의미 검증은 별도다.
4. 단일 정답을 강제하지 않는다. 복수의 타당한 해석은 근거에 결합된 허용 tuple로 제시하며, 분쟁·문맥 부족·구조 불능은 미해결로 남긴다. 구체적인 taxonomy와 metric 결정은 이번 A1의 범위를 넘으며 미확정 계약을 조용히 채택하지 않는다.
5. 외부 검증 주체의 실제 검증/승인 결과를 정확한 case/input/tuple revision·digest·날짜·범위·제한과 연결한다. 기존 검증 자료의 재사용도 실제 기록이 있어야 하며 에이전트가 그 사람을 대신해 승인하지 않는다. 단순 "72쌍 승인"·실험 허가·모델 합의는 개별 의미 검증 증거가 아니다.
6. 원래 검토·검증·승인 provenance와 에이전트의 대응 검사 결과를 Git-backed artifact 또는 checksum/access/retention을 가진 안전한 reference manifest로 보존한다. 문서 main 게시와 인증 수준을 구분한다. 자료 이관으로 과거 검토자를 현재 새 case의 승인자로 바꾸지 않는다.

### 외부 reference의 동등한 검증 provenance

외부 자료를 인증 기준으로 사용할 때는 source/label/input revision과 실제 인간 의미 검증 절차·책임·결과·이견 처리를 추적할 수 있어야 한다. 검증이 관계 종류뿐인지, 방향·근거·조건까지 포함하는지 범위를 확인한다. 라이선스·접근·보존 권한과 exact bytes/digest도 확인한다.

외부 label 정의와 Shotgun target policy/input profile의 대응은 별도다. 외부 NLI entailment label을 SUPPORTS/QUALIFIES 정답으로 자동 변환하거나, 원문 fact의 공식 출처를 Shotgun 관계 검증으로 취급하지 않는다. 변환/문맥 축소/label mapping으로 의미가 달라지면 해당 대응의 독립 의미 검증이 추가로 확인돼야 한다. 단순 기계적 mapping 또는 에이전트의 "동등하다"는 해석은 인증 근거가 아니다. 증명된 범위 밖은 UNVERIFIED다. A2의 미전달 문맥 금지와 v6/v11 구분을 그대로 적용한다.

**최소 증빙 필드**

- case/reference revision, actual input bundle digest, 허용 tuple/evidence/warrant/assumption digest, 적용 policy/profile identity.
- 작성자/작성 방식, 사용자 외부 검증 주체의 확인 가능한 인간 identity/책임·적격성 근거 또는 동등한 외부 검증 절차의 provenance.
- reviewer의 전문성·독립성·기존 노출·AI 보조 사용과 실제 review note/반대 해석.
- 실제 검증 대상·결과·시각·범위·이유, 존재하는 경우 원래 승인 기록의 위치/digest. 에이전트 대응 검사는 별도 필드.
- 구조 검사 결과, unresolved 사유, 이전 revision/승인과의 관계, 보존 위치, Git publication 상태.

기존 versioned Markdown/JSON과 Git provenance로 기록한다. 새 서명 서비스, owner DB, OS SID receipt, Vault 또는 운영 Approval Runtime을 만들지 않는다. P0 유지보수의 OS→owner 권한 위임은 평가 정답 승인 증거로 재사용하지 않는다.

독립 인간 의미 검증(또는 그와 동등함이 확인된 외부 검증 provenance), exact input/profile/reference 대응, Git main의 평가 기준 게시, 실제 실행 허가는 서로 다른 차원이다. **인증 Gold는 실제 검증 증거가 커버하는 범위에만 한정한다.** 자동 검증·AI 합의·confidence·main merge·Project Owner의 정책 승인을 인간 의미 승인으로 기록하지 않는다. 새로운 평가 실행은 별도 허가가 필요하다. 아래는 평가 문서의 상태이며 생산 enum 변경이 아니다.

| 증거 상태                                            | 향후 채점 가능 범위 / 보고                                                                      | 경계                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| CANDIDATE / UNVERIFIED                               | 허가된 미래 진단에서 구조 검사, provenance/일관성, 후보 기준과의 일치 등을 명시적으로 보고 가능 | 인증 의미 정확도·객관 오류율·인간 승인으로 보고하지 않음       |
| INDEPENDENT_SEMANTIC_EVIDENCE_CONFIRMED              | 외부 인간/동등 외부 reference 검증과 exact profile이 커버하는 종류·방향·근거만 인증 측정 후보   | 미검증 field/mapping/context는 N/A 또는 UNVERIFIED로 별도 보고 |
| DISPUTED / CONTEXT_INSUFFICIENT / PROVENANCE_INVALID | 문제·제외 수/비율, 승인된 부족 입력 diagnostic이 있으면 그 범위만 사용                          | 어려운 사례를 숨겨 점수를 높이거나 모델 오판으로 단정하지 않음 |

이번 작업은 증거 분류 계약 보정이며 새 평가 실행·Gold 채택·threshold 변경을 수행하지 않는다. 인증 Gold가 없어도 기존 정책·원장·근거·권한·불확실성 표시를 유지한 일반 Shotgun 자료 투입/질문은 사용자 검토 클릭 없이 동작한다. 그 제품 동작을 인증 의미 품질로 과장하지 않는다.

## 3. 근거와 기존 승인 이력

- ADR-098 Decision 2/3/6은 인간 검토 전 CANDIDATE, version/provenance/digest, AI judge의 한계를 이미 정한다.
- ADR-173 D2/D5는 AI 해석·동결 점수와 독립 인간 검증을 구분하며 목표 안에서 방법 선택을 위임한다.
- [Phase A 감사](../../../implementation/vp05-evaluation-trust-phase-a-2026-10-12/report.md)는 30 candidate와 42 승인 미확인, 3 directed 대안 결함 및 metric 문제를 확인했다. `APPROVED` 문자열이나 freeze 기록만으로 이 간극이 사라지지 않는다.
- [Phase 4 ADD](../phase-04-comparison-change-approval/add.md)의 AI 보조/다수결 비권위 원칙은 유지한다. 평가 label은 test oracle이고 제품 Claim/Fact 또는 VP 지식 승인과 별개다.
- ADR-117/120 및 docs/CANONICAL.md의 승인·merge 분리는 유지한다. 기존 ADR-098의 2026-07-22 Claim/Search 승인과 제품·P0·PR 승인들은 원래 범위 그대로 보존한다.

선행 A1 위임 결정의 사용자 최종 Reference 승인/검토자 지정 구조는 후속 명시적 사용자 정정으로 **대체됐다**. 그 구조는 `e8d0f7d769722f4482ff26a9828812f37e1270cc`의 역사 기록에 보존한다. 현재 적용 계약은 사용자 개인의 지식·관계·AI 결과 검토 의무를 제외하며, ADR-098의 인간 의미 검증 경계와 ADR-172/173의 자동 제품 사용 원칙을 함께 유지한다. Owner의 아키텍처·정책 승인, 과거 실제 승인 기록의 원래 범위는 유지한다.

## 4. 제외 대안·영향·미결사항

| 대안                                                            | 제외 이유                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| 사용자를 개별 Reference 검토/승인자 또는 reviewer 지정자로 강제 | 후속 사용자 정정 및 Shotgun의 자료 투입·질문 자동 제품 원칙과 충돌 |
| 상위 에이전트의 판단을 독립 인간 의미 검증으로 기록             | ADR-098/173의 인간 검증 경계 위반                                  |
| 여러 AI의 합의 또는 confidence로 독립 review 대체               | 서로 다른 모델도 인간 승인 증거가 아니며 공통 오류 가능            |
| corpus 실행/freeze 승인을 label 승인으로 간주                   | 승인 대상·의미·digest와 책임이 다름                                |
| 존재하지 않는 별도 approver 또는 두 독립 검토를 기록            | 실제 provenance 이상의 역할·검증 수준을 부풀림                     |
| 공식 원문/외부 dataset이라는 이름만으로 Gold 지정               | 원문 사실성·라벨 검증·Shotgun tuple/input 대응은 다른 증거         |
| 새 registry/서명/운영 DB 구축                                   | 문서·기존 Git만으로 필요한 범위를 충족하며 불필요한 핵심 권위 추가 |

영향은 미래 평가 packet의 책임·검토·승인 증거 요건에 한정한다. Ledger·제품 사용 흐름·SourceVersion·보안·예산·모델·prompt/schema·0.9·현재 v6 또는 보존 v11은 변경하지 않는다. 72/432/B 원본과 과거 승인 상태는 그대로다.

남은 것은 상위 에이전트의 외부 적격 검증 증거 확보·동등성 확인, taxonomy/측정 계약 및 대표 집합의 미확정 항목, 별도 게시/실행 허가다. 사용자에게 개별 검토·승인·reviewer 지정 의무를 부과하지 않는다. A2의 기존 문맥 계약은 유지한다. 이 문서는 실제 외부 검토, 인증 Gold 또는 전체 VP-05 Gate 완료를 주장하지 않는다.

## 5. 변경 이력

- 2026-10-12, 선행 위임 결정/승인 기록: A1 먼저 구체화했고 사용자 최종 Reference 승인/검토자 지정 구조를 기록한 local head는 `e8d0f7d769722f4482ff26a9828812f37e1270cc`다. 새 Reference 승인 0. 이 구조는 현재 적용하지 않으며 Git 이력에 보존한다.
- 2026-10-12, 이후 독립 검토 정정: `A1_CHANGES_REQUIRED / A2_CONDITIONALLY_ACCEPTED / PUBLICATION_HOLD`. 앞선 사용자 의무를 제거하고 외부 적격 인간/동등 검증 provenance 및 agent 운영으로 책임을 보정했다. **뒤의 명시적 정정이 현재 적용 계약**이며 게시 HOLD·새 Gold 0을 유지한다.
