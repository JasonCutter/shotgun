# 개발 전략 ADR 승격·정합성 정비 보고

> 2026-10-10 · **STRATEGY_ADR_ALIGNMENT_READY_LOCAL**
>
> 새 전략의 사용자 승인 결정과 로컬 문서 정비 결과다. Git Canonical `main` 게시·운영 배포·VP 제품 Gate 완료는 아니다.

## 1. 완료 결과

[ADR-173](../../architecture/adr/ADR-173-product-first-development-and-evaluation-trust-strategy.md)을 신규 단일 owner로 등록했다. 확정 결정·적용 범위·한정 amendment·기존 결정 관계·미검증 대안·미결사항·후속 기준·권한과 publication을 구분했다.

새 전략은 제품 인수→평가 신뢰성→실제 병목→관련 OSS→최소 보완→Gate 순서다. 목표·완료 기준·안전 경계 안에서 방법을 실행 에이전트에게 위임한다. 두 동작 VP 제품, VP Ledger·원문/버전/근거·권한·Frontier·예산·복구·멱등성은 유지한다.

별도 선택하지 않은 SSC/compact/닫힌 문법/서명 registry, Qwen/NLI/Jev, 질문 시 관계 평가와 새 confidence 계약은 가설/초안이다. 문서에 실렸다는 이유로 채택되지 않는다. v11·0.9 유지, B v1 잔여 24회 재개 금지, VP-05 미완료와 VP-06 STOP을 명시했다.

## 2. 충돌 결정 정리

ADR/ADD **158개 문서의 자동 경계 screening**과 핵심 제품·평가·권위·provider·게시·agent·Gate 절의 수동 대조를 구분했다. 자동 keyword screening을 모든 의미 결정의 독립 승인으로 부르지 않았다. [정리표](./reconciliation.md)와 [inventory/integrity artifact](./alignment-audit.json)에 범위를 기록했다.

**기존 ADR 전체 폐기: 0개.** 실제 변경은 다음과 같다.

- 오래된 tracker의 기술 착수 순서를 현재 A–E 우선순위로 대체하고 원래 내용을 역사 기록으로 보존.
- 모든 eligible/N² 쌍의 미생성을 필수 backlog로 읽는 해석을 현행 CandidateFrontier 계약에 맞춤.
- ADR-098/172에 날짜가 있는 향후 평가 보고·증거 해석 amendment를 추가. 원래 본문은 prefix로 보존했고 recall threshold·Frontier·SQL/DB/digest 정의는 유지.
- OSS-first를 제품·평가·병목 진단을 마친 구현 범위 안에 위치시킴. 기존 채택·핀·license/security·Port/Contract Gate 유지.
- COMPLETE_WITH_LIMITS의 자동 다음 Stage 허가 해석을 배제. 적격성·필수 요건·해제 계획과 별도 판정 요구.
- ADR registry의 171까지 검사하던 범위를 173까지 확장하여 기존 172와 신규 173의 owner coverage를 확인.

ADR-098의 CANDIDATE/평가 원장 경계, ADR-172의 자동 VP 제품·원장 계약, ADR-161/164의 DeepSeek 권위, ADR-117/120/121의 publication/번호 정책은 새 전략과 일치한다. 승인형 Phase ADD의 VP 적용 제외는 이미 ADR-172가 결정한 관계이며 이번에 다시 전면 supersede하지 않았다.

## 3. 관련 문서 변경 범위

| 영역             | 변경                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 전략 ADR         | ADR-173 신규, ADR-098/172 한정 amendment, ADR README/registry                                                                 |
| ADD entry points | Phase ADD root와 Module ADD에 전략 적용 범위 안내; 기존 원문별 대량 교체 없음                                                 |
| 계획·순서        | Implementation README/roadmap, VP plan/tracker, 새 execution-plan                                                             |
| 평가·완료·릴리스 | DoD/testing/release, OSS integration/evaluation의 evidence·분모·비우회 조건                                                   |
| 개발 agent       | AGENTS의 제품/평가/병목 선행·방법 자율성·HOLD/STOP·승인 경계                                                                  |
| 기록·보존        | source/provenance, reconciliation, paused-drafts manifest, generated/evidence registry, 재현 가능한 read-only audit generator |

기존 production source code·데이터·설정, evaluator/scorer/parser, acceptance contract v1.0, Gold annotations, corpus와 실험 raw/scores/reports는 변경하지 않았다. 원래 인수 scenario, Stage/VP 추적 ID, Gate threshold를 완화하거나 새 번호로 바꾸지 않았다.

## 4. 보존과 새 승인의 관계

원본 proposal의 상태는 검토용 v0.1이었다. 원본 문서의 별도 task 문구를 스스로 실행하지 않았으며, 이번 사용자 요청을 승격·정비 승인 근거로 기록했다. [사본](./source-proposal.md)은 SHA `9fdf257d810cd3e12ee8b1cb60f871c46a7a27729d8971ea0dc65e196d562925`로 원본과 byte-identical이다.

중지된 평가 draft **20개 파일**을 stash `57b05edb2ebe262180d15383850121a50f26655a`로 보존하고 original-file SHA와 stash blob SHA의 정확한 일치를 검증했다. 기존 B v2 stash `6ff388bdcacd3d519381ab625892c39a583a43d2`도 보존했다. 초안의 자체 “verified/ready” 필드는 승인 상태로 사용하지 않는다. evaluator 개발은 재개하지 않았고 전략 문서 commit에 평가 코드 초안을 포함하지 않았다.

Git `main`은 `e08449982cbf2247b9b1e7a7ef39281eab09166a` 그대로다. 현재의 사용자 결정 승인과 reviewed merge 후 Canonical 게재를 구분했다. push/PR/merge 없이 로컬 검토 가능한 결과를 제공한다.

## 5. 검증

| 항목                                                                      | 결과                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 변경 전 docs validation                                                   | PASS: Markdown 상대 링크 660, ADR coverage 1–171, Canonical/generated/evidence/drift/Frontend governance |
| 변경 후 docs validation                                                   | PASS: Markdown 상대 링크 696, ADR coverage 1–173, Canonical/generated/evidence/drift/Frontend governance |
| ADR-172/173 단일 owner / reserved gap 유지                                | audit PASS; 기존 validator의 1–173 gate로 추가 확인                                                      |
| 기존 ADR-098/172 원문 prefix 보존                                         | PASS, 시작 commit의 본문 그대로 뒤에 amendment만 추가                                                    |
| 전략 원본 / stopped draft 20개 bytes / B v2 stash                         | PASS                                                                                                     |
| frozen acceptance/evaluator/runner/raw/scores와 production code 변경 범위 | audit PASS, 허용 문서 밖의 기존 tracked 변경 없음                                                        |
| production semantic digest                                                | 재계산 PASS: `996ad83ba1fd74e8b50c07ed0811adbe8a4e7e6a1b801c893c251929615bf463` 동일                     |
| typecheck / scoped ESLint / authored-doc format / diff whitespace         | PASS: 전체 typecheck, audit generator ESLint, 변경 문서/코드 scoped Prettier 및 diff whitespace 확인     |
| real provider / production DB / Gold-B-7 / VP-06                          | 모두 실행·변경·개봉·진입 없음                                                                            |

문서 승격 작업이므로 runtime/DB/quality 성능 실험은 수행하지 않았다. 새 custom scorer/semantic parser는 채택하지 않았으며 기존 문서 validation과 Git/hash 인프라를 재사용했다. `NO_RELEVANT_OSS` for strategy decision authority; 신규 package·lockfile·license·OSS role 변경 없음.

재현 가능한 경계 audit는 `node node_modules/tsx/dist/cli.mjs scripts/audit-development-strategy.ts`다. 원본 file과 보존 stash가 유지된 이 로컬 환경을 전제로 하며 semantic-label approval이나 제품 품질을 검증하는 도구가 아니다. generated/evidence registry에 owner·입력·generator·권위 범위를 등록했다.

## 6. 남은 위험과 다음 기준

- 평가 승인 책임자·범위·독립 검증/정규화 의미 승인 절차·대표 제품 질문 집합은 아직 미결이다. 기존 72쌍의 모든 정답을 틀렸다고 결론 내리지 않는다.
- 0.9 보정성, 실제 청구 대사, scale/candidate recall, 제품 대기·회귀와 VP-05 제한부 완료 적격성은 이번에 해결하지 않았다.
- 원본이 언급한 SSC v0.2 파일은 현재 review worktree와 primary checkout의 해당 경로에 없다. 내용을 추정하거나 설계 권위로 승격하지 않았다.
- 신뢰 가능한 기준을 만들기 위한 수단을 이번 ADR이 미리 선택하지 않는다. 닫힌 문법이나 서명 review prototype의 재사용 여부도 후속 검증 대상이다.
- Canonical main publication이 남아 있다. 운영 정책·생산 데이터·권위 변경, Gold-B-7, VP-06, push/PR/merge는 별도 명시적 승인 대상이다.

다음 목표는 [execution-plan](./execution-plan.md)의 **VP-05 전략 재정립 및 평가 신뢰성 회복**이다. 실제 제품 인수와 남은 Gate를 연결해 현행 방식의 유지/보완/전환 필요성을 판단한다. 이 보고서로 해당 구현 작업을 자동 시작하지 않는다.

rollback은 새 전략 문서 변경을 명시적으로 revert하고 amendment/owner 관계를 갱신하는 것이다. 기존 ADR·실험 이력과 보존 stash는 삭제하지 않는다. 로컬 commit SHA와 commit 후 clean worktree proof는 완료 응답에서 제공한다.

**STRATEGY_ADR_ALIGNMENT_READY_LOCAL — 결정·문서 정비 완료; Canonical main 게시와 제품 Gate 완료는 별도.**
