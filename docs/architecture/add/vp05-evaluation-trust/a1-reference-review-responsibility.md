# VP-05 A1 — Reference 승인 책임 및 독립 검토

- Section decision: **DECIDED_UNDER_USER_DELEGATION — 2026-10-12**
- Record identity: `VP05-EVAL-A1-20261012`
- Subject: Canonical `main@cd3cc258dcc5033cb61d7f1dc2f221f5e5016ab6`
- Decision maker: 상위 실행 에이전트, 사용자의 A1·A2 구체적 계약 결정 위임 범위
- Publication: **LOCAL / PENDING_CANONICALIZATION**. reviewed merge 전 Canonical 아님
- Individual Reference approvals issued by this Section: **0**
- Governing policies: [ADR-098](../../adr/ADR-098-stage-12-1-quality-evaluation-contract.md), [ADR-173](../../adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md), [문서 권위](../../../CANONICAL.md)

## 1. 확정 결정

평가 계약의 구체화는 위임받은 에이전트가 수행하되 **개별 의미 Reference의 승인 책임자는 현재 Project Shotgun 사용자/프로젝트 소유자인 실제 사람**으로 고정한다. 에이전트는 자료 정리, 구조 검사, 대안 및 반례 제안, 절차 운영을 맡는다. 개별 정답의 인간 검증·최종 승인 권한은 에이전트에게 주어지지 않는다.

기본 최소 절차는 **작성자 + 독립 인간 검토자 1명 이상 + 검토자와 다른 인간 최종 승인자**다. 최종 승인자는 기술 검토를 전부 다시 수행하는 역할이 아니라 검토의 범위·근거·미결사항과 책임을 확인해 해당 reference revision을 승인하는 역할이다. 전문성이 없는 승인자의 수락을 두 번째 분야 검증으로 세지 않는다.

### 역할과 실제 책임

| 역할                  | 담당 / 권한                                                                                             | 하지 않는 일                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 계약·packet 운영자    | 위임받은 상위 에이전트. exact input, source/provenance, 이력, 후보 tuple, validation 결과를 준비        | AI 간 합의나 자신의 해석을 인간 의미 검증으로 인증하지 않음                  |
| Reference 작성자      | 사람 또는 AI. 작성 방식·사용 모델/보조 도구·자신의 개입을 기록                                          | 자신의 label을 독립 검증한 것으로 세지 않음                                  |
| 독립 의미 검토자      | 소유자가 지정한 실제 사람. case별 독립성·전문성·검토 범위를 확인한 후 판단                              | 해당 case label/프롬프트/판정기 개선의 작성자가 자신의 기준을 심사하지 않음  |
| 최종 Reference 승인자 | 현재 실제 사용자/프로젝트 소유자. 검토자와 다른 사람. 명시적 case/input/tuple revision을 승인·거부·보류 | 전체 corpus freeze, 실행 허가, 문서 위임을 개별 label 승인으로 치환하지 않음 |
| 추가 adjudicator      | 의미 이견이 해소되지 않을 때 소유자가 지정하는 다른 적격 인간 검토자                                    | 표결/다수결로 타당한 반대 해석을 지우지 않음                                 |

현재 검토자로 지정·확인된 사람은 없다. 이것은 A1 계약의 미결정이 아니라 **개별 Reference 검토의 미수행 상태**다. 에이전트가 실존하지 않는 reviewer 이름이나 승인 receipt를 만들지 않는다. 지정된 사람이 없으면 해당 case는 CANDIDATE/승인 미확인으로 남는다. 최종 승인자의 교체나 인간 승인을 AI에게 넘기는 변경은 이번 위임에 포함하지 않는다.

### 전문성·독립성 요건

1. 해당 입력 언어를 이해하고 entity/property/time/condition/exception/unit 및 evidence 범위를 직접 설명할 수 있어야 한다. 단위·산술은 검증 과정을 제시한다.
2. 금융·표준·물리 등 외부 분야 전제가 필요한 case는 해당 전제를 검토할 전문성과 근거를 명시한다. 검토 가능한 범위를 넘어서는 분야 사실은 인증하지 않고 부족/이견으로 남긴다. 학위·직함만으로 모든 case의 전문성을 추정하지 않는다.
3. 자신이 그 case의 label·허용 tuple을 작성했거나, 그 결과에 맞춰 prompt/parser/scorer를 개선했다면 그 case의 독립 reviewer가 될 수 없다. 같은 프로젝트에 속했다는 이유만으로 자동 탈락시키지는 않지만 역할·이해관계·기존 결과 노출을 공개해야 한다.
4. 첫 판단은 제공될 입력·정책 정의·허용 전제로 수행하며 기존 label·모델 응답·점수를 가린다. 그 후 기존 기록과 비교하고 이견을 기록한다. 과거 노출이 있으면 공개한다. 이 절차가 노출된 72쌍을 새 blind holdout으로 바꾸지는 않는다.
5. AI 도구의 사용은 공개한다. 사람이 원문·논증·반대 해석을 실제로 확인하고 자기 판단에 책임질 때만 인간 검토로 기록한다. AI 결과를 읽지 않고 전달/서명하는 것은 독립 검토가 아니다.

Critical case를 포함해 최소 독립 인간 검토 1명과 별도 승인자 원칙을 유지한다. material disagreement 또는 reviewer의 전문성 범위를 넘는 전제가 있으면 별도의 적격 reviewer/adjudicator가 필요하며 해소 전 승인하지 않는다. 모든 간단한 문장에 다수 모델/다수 전문가를 의무 호출하는 절차는 도입하지 않는다.

## 2. 실제 검토와 승인 증빙

1. 운영자가 기존 label과 구분된 versioned packet을 준비한다. input 범위는 A1 완료 후 결정할 A2를 따른다. 이 단계에서 AI 후보를 approved로 표시하지 않는다.
2. 소유자가 사람을 지정하고 stable reviewer identity, 역할, 전문성 범위, 독립성/노출 선언을 기록한다. pseudonym은 가능하나 소유자가 실제 사람 및 책임 대응 관계를 확인할 수 있어야 한다. 계정명·Git author만으로 인간 여부를 추정하지 않는다.
3. reviewer가 동일 입력에서 관계 종류·방향·근거·허용 가정·반대 해석·판정 가능성을 직접 기록한다. 구조 검사 성공은 의미 검토 결과와 별도로 남긴다.
4. 단일 정답을 강제하지 않는다. 복수의 타당한 해석은 근거에 결합된 허용 tuple로 제시하며, 분쟁·문맥 부족·구조 불능은 미해결로 남긴다. 구체적인 taxonomy와 metric 결정은 이번 A1의 범위를 넘으며 미확정 계약을 조용히 채택하지 않는다.
5. 최종 승인자가 정확한 packet/reference revision과 digest, 승인/거부/보류, 이유·범위·날짜를 명시한다. case ID 목록과 각 digest가 있으면 일괄 승인도 가능하지만 단순 "72쌍 승인" 또는 "실험 진행"으로는 부족하다.
6. 승인 기록과 검토 원문을 Git-backed artifact로 보존한다. chat에서 명시한 사람의 승인도 원문 출처와 대상 digest를 안전하게 Git 기록으로 옮겨 reviewed merge를 거쳐야 한다. 파일 이동이나 승인자 교체로 기존 이력을 지우지 않는다.

**최소 증빙 필드**

- case/reference revision, actual input bundle digest, 허용 tuple/evidence/warrant/assumption digest, 적용 policy/profile identity.
- 작성자/작성 방식, reviewer의 확인 가능한 인간 identity 및 지정 근거, 승인자의 확인 가능한 인간 identity.
- reviewer의 전문성·독립성·기존 노출·AI 보조 사용과 실제 review note/반대 해석.
- 승인 대상 목록, 결정·시각·범위·이유와 원문 승인 증거의 위치/digest.
- 구조 검사 결과, unresolved 사유, 이전 revision/승인과의 관계, 보존 위치, Git publication 상태.

기존 versioned Markdown/JSON과 Git provenance로 기록한다. 새 서명 서비스, owner DB, OS SID receipt, Vault 또는 운영 Approval Runtime을 만들지 않는다. P0 유지보수의 OS→owner 권한 위임은 평가 정답 승인 증거로 재사용하지 않는다.

사람의 명시적 승인과 검토는 `HUMAN_REVIEWED / APPROVED_PENDING_CANONICALIZATION`의 증거 차원이고, Git main 게시가 Canonical publication 차원이다. 둘을 합치지 않는다. **인증 Gold 사용에는 둘 모두와 일치하는 input/profile/reference identity가 필요하다.** merge만으로 미승인 label이 Gold가 되지 않으며, label 승인도 새로운 평가 실행 권한을 주지 않는다. 이 명칭들은 문서의 증거 상태이며 생산 상태 enum 변경이 아니다.

## 3. 근거와 기존 승인 이력

- ADR-098 Decision 2/3/6은 인간 검토 전 CANDIDATE, version/provenance/digest, AI judge의 한계를 이미 정한다.
- ADR-173 D2/D5는 AI 해석·동결 점수와 독립 인간 검증을 구분하며 목표 안에서 방법 선택을 위임한다.
- [Phase A 감사](../../../implementation/vp05-evaluation-trust-phase-a-2026-10-12/report.md)는 30 candidate와 42 승인 미확인, 3 directed 대안 결함 및 metric 문제를 확인했다. `APPROVED` 문자열이나 freeze 기록만으로 이 간극이 사라지지 않는다.
- [Phase 4 ADD](../phase-04-comparison-change-approval/add.md)의 AI 보조/다수결 비권위 원칙은 유지한다. 평가 label은 test oracle이고 제품 Claim/Fact 또는 VP 지식 승인과 별개다.
- ADR-117/120 및 docs/CANONICAL.md의 승인·merge 분리는 유지한다. 기존 ADR-098의 2026-07-22 Claim/Search 승인과 제품·P0·PR 승인들은 원래 범위 그대로 보존한다.

이번 사용자의 위임은 **계약의 구체적 결정을 에이전트가 완료하도록 허용**한 것이다. 기존 "사용자가 세부 절차를 모두 다시 선택해야 한다"는 Phase A의 대기 해석은 이 Section 범위에서 해소한다. **개별 의미 label 승인과 핵심 승인 권위의 위임은 포함하지 않는다.** 기존 사용자 결정의 취소/대체는 없다.

## 4. 제외 대안·영향·미결사항

| 대안                                                           | 제외 이유                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| 상위 에이전트를 Gold 최종 승인자로 지정                        | ADR-098/173 및 이번 위임의 인간 검증 경계 위반                     |
| 여러 AI의 합의 또는 confidence로 독립 review 대체              | 서로 다른 모델도 인간 승인 증거가 아니며 공통 오류 가능            |
| corpus 실행/freeze 승인을 label 승인으로 간주                  | 승인 대상·의미·digest와 책임이 다름                                |
| reviewer와 approver를 같은 사람으로 채우고 두 독립 검토로 계산 | 역할·검증 수준을 부풀림                                            |
| 새 registry/서명/운영 DB 구축                                  | 문서·기존 Git만으로 필요한 범위를 충족하며 불필요한 핵심 권위 추가 |

영향은 미래 평가 packet의 책임·검토·승인 증거 요건에 한정한다. Ledger·제품 사용 흐름·SourceVersion·보안·예산·모델·prompt/schema·0.9·현재 v6 또는 보존 v11은 변경하지 않는다. 72/432/B 원본과 과거 승인 상태는 그대로다.

남은 것은 실제 사람의 지정/독립 검토·개별 승인의 수행, taxonomy/측정 계약 및 대표 집합의 미확정 항목, Git 게시 승인이다. A2의 문맥 계약은 다음 순서로 결정한다. 이 문서는 그 수행이나 전체 Phase A/VP-05 Gate 완료를 인증하지 않는다.

## 5. 변경 이력

- 2026-10-12: 사용자의 A1·A2 결정 위임에 따라 **A1 먼저 확정**. 상위 정책 변경 없이 현재 인간 소유자 + 독립 reviewer + 별도 승인자의 절차와 증빙을 구체화. 새 Reference 승인 0, 미게시 상태 유지.
