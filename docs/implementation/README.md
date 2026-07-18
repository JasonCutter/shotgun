# Shotgun Implementation Plan

> 상태: **Implementation Baseline v0.2 + Frontend Delivery Baseline**  
> 기준일: 2026-07-16  
> Frontend Baseline 결정일: 2026-07-18  
> 대상: `JasonCutter/shotgun`의 최초 구현부터 재사용 가능한 모듈과 최종 Product Frontend 검증까지

이 디렉터리는 Shotgun Architecture Design Documents와 Module Architecture를 실제 개발 작업으로 전환하는 실행 계획을 관리한다.

## 1. 기준 문서

- [Knowledge Flow 기준본](../SHOTGUN_KNOWLEDGE_FLOW_BASELINE_v1.0.html)
- [참조 아키텍처 전략](../shotgun_reference_architecture_strategy_ko.html)
- [Phase 1~6 ADD Canonical 허브](https://app.notion.com/p/39f5181d71ad81a6a51ff7f2a3a88ee6)
- [Frontend and Human Interaction Architecture](https://app.notion.com/p/3a15181d71ad81e4bfa4ee2578e692a0)
- [Module Architecture ADD](../architecture/module-architecture/README.md)

현재 Phase 1~6와 Frontend 횡단 ADD의 Canonical 기준은 위 Notion 문서다. 저장소의 완료 사본과 Amendment는 구현 추적과 검증을 위한 동기화 기록이다.

충돌이 발생하면 다음 우선순위를 따른다.

1. Phase 1~6와 Frontend 횡단 ADD의 Canonical 의미·승인·Evidence·Security 정책
2. Module Architecture의 모듈·Product Surface 경계와 Connector 계약
3. 이 구현계획서의 일정·순서·OSS 통합·기술 검증 계획
4. 개별 Issue와 PR의 구현 세부사항

구현 중 아키텍처 경계를 바꿔야 하면 계획서를 조용히 수정하지 않고 ADR을 먼저 작성한다.

## 2. 개발 운영 원칙

- **코드는 모듈 단위로 소유한다.**
- **개발 순서는 수직 슬라이스 단위로 진행한다.**
- **Phase는 통합·인수검증 단위로 사용한다.**
- 첫 제품은 모듈러 모놀리스와 In-process Connector로 구현한다.
- 최종 사용자 Product Surface는 독립 `shotgun-web`이다.
- 현재 Inline HTML은 `Backend Vertical Slice UI`이며 최종 Product UI가 아니다.
- Frontend는 Typed Product Client를 통해 Server-authoritative View Model과 Command를 사용한다.
- 각 단계가 끝날 때 실제 실행 가능한 Shotgun 상태를 유지한다.
- 미승인 Candidate는 Canonical에 기록하지 않는다.
- Claim은 자동으로 Fact가 되지 않는다.
- 외부 Action은 `Validation → ActionCandidate → Risk Decision → Preview → Approval → Preflight → Execute → Verify`를 통과한다.
- 오픈소스는 Shotgun Port와 Adapter 뒤에 배치한다.
- **관련 OSS를 먼저 검토하고 재사용 불가 근거가 있을 때만 신규 구현한다.**
- 각 단계는 관련 후보를 `ADOPT`, `EXTRACT`, `AUGMENT`, `REFERENCE_ONLY`, `DEFER`, `REJECT` 중 하나로 판정해야 한다.
- OSS 검토를 생략하고 새로 구현한 기능은 완료로 인정하지 않는다.
- Approval·Canonical Write·Action Execution에는 Client Optimistic Authority를 사용하지 않는다.

## 3. 문서 구성

| 문서 | 목적 |
|---|---|
| [Implementation Roadmap](./implementation-roadmap.md) | Stage 0~12의 개발 순서, 범위와 완료 조건 |
| [Frontend Delivery Roadmap](./frontend-delivery-roadmap.md) | F0~F5 Product Frontend 구현 순서와 화면별 Gate |
| [OSS Integration Roadmap](./oss-integration-roadmap.md) | Stage별 OSS 우선 검토 대상, 재사용 방식과 종료 판정 |
| [Vertical Slices](./vertical-slices.md) | 사용자 가치가 있는 종단 기능 단위와 인수 시나리오 |
| [Module Delivery Plan](./module-delivery-plan.md) | 모듈별 산출물, 의존성, 개발 시점과 독립성 기준 |
| [Definition of Done](./definition-of-done.md) | Module·Flow·Product·Architecture·OSS Gate의 공통 완료 정의 |
| [Dependency Map](./dependency-map.md) | 모듈 의존 방향, 금지 의존성과 단계별 Critical Path |
| [Testing Strategy](./testing-strategy.md) | Unit·Contract·Integration·E2E·Architecture·Golden Corpus 검증 |
| [OSS Evaluation Plan](./oss-evaluation-plan.md) | 오픈소스 후보의 평가·채택·고정·교체 절차 |
| [Release Strategy](./release-strategy.md) | 내부 릴리스, 버전, Migration, Rollback과 운영 준비 |
| [Risk Register](./risk-register.md) | 주요 구현 위험, 조기 신호, 완화책과 중단 기준 |

`Implementation Roadmap`은 Domain·Backend Stage를, `Frontend Delivery Roadmap`은 최종 Product Surface 전달을 추적한다. 두 로드맵의 완료 상태를 혼동하지 않는다.

## 4. Domain·Backend 개발 단계

| Stage | 목표 | 종료 시 사용 가능한 상태 |
|---|---|---|
| 0 | 저장소·기술 기반 | CI와 모듈 Skeleton, OSS Registry가 재현 가능 |
| 1 | Kernel·Contracts | 테스트 모듈 간 Command·Event·Query 전달 가능 |
| 2 | Intake·Original Asset | 텍스트 원본을 불변 저장 가능 |
| 3 | Transformation·Evidence | 원문 위치로 복귀 가능한 Evidence 생성 |
| 4 | AI·Candidate·Validation | 직접 명시된 Claim 후보 생성·검증 |
| 5 | Comparison·Review | 후보 비교와 최소 사용자 승인 수직 슬라이스 |
| 6 | Canonical Commit | 승인된 Claim과 History를 원자적으로 저장 |
| 7 | Search·Cited Answer | Canonical 검색과 최소 Ask 수직 슬라이스 |
| 8 | 문서 형식 확장 | PDF·Office·이미지·URL 처리 확장 |
| 9 | 지식 모델 확장 | Entity·Relation·Event·Decision·Conflict와 최소 Graph 검증 |
| 10 | Projection·Discovery | Compiled Truth·Graph·Gap 탐색 지원 |
| 11 | External Action | 승인된 외부 Action을 안전하게 실행 |
| 12 | 재사용성 검증 | 다른 Assembly에서 모듈·OSS Adapter·UX Mock Contract 재사용·교체 성공 |
| 12.1 | Hardening | Security·Durability·Quality·Reuse·Release Readiness 보강 |

Stage 7 완료는 Domain·Backend Walking Skeleton MVP다. 최종 Product Frontend 완료를 의미하지 않는다.

## 5. Frontend 전달 단계

| Frontend Stage | 목표 |
|---|---|
| F0 | `shotgun-web`, Typed Client, Auth·Project App Shell, SSE Foundation |
| F1 | Home·Sources·Ask·Knowledge·Settings MVP |
| F2 | Review·Activity·Evidence·Diff·Impact·Approval UX |
| F3 | 2D Semantic Graph와 접근 가능한 목록·표 대안 |
| F4 | Visual·Source Editor와 Preservation Gate |
| F5 | 별도 ADR 이후 Draft Collaboration |

F0 착수 전에 P0-1·P0-2 Security Gate를 완료하고 Frontend Framework·Runtime·Design System·Testing Tool을 별도 기술 결정으로 확정한다.

## 6. 과거 UI 완료 기록 해석

과거 Stage 완료 기록은 삭제하거나 덮어쓰지 않고 다음 의미로 유지한다.

- Stage 5: 최소 Review 수직 슬라이스와 Backend Contract 검증
- Stage 7: 최소 Ask·Cited Answer 수직 슬라이스
- Stage 9: Graph Projection과 최소 UI/List 검증
- Stage 12: ddsyasas·OpenKnowledge 기반 UX Mock Contract와 재사용 검증

최종 Product Frontend 완료는 F0~F5 Gate로만 판단한다.

## 7. OSS 통합 기준선

| 영역 | 우선 레퍼런스·후보 | 기본 방향 |
|---|---|---|
| Brain·Job·Canonical·Search·Graph·Discovery | `garrytan/gbrain` | 모듈별 Adapter·Extract 우선, 전체 강결합 금지 |
| Transformation·Highlight·Lint·Watcher | `lucasastorian/llmwiki` | 필요한 부품만 독립 Package로 추출 |
| Source·Ask·Cost·Settings UX | `ddsyasas/llm-wiki` | Backend 제외, UX·View Model만 참고 |
| Editor·2D Graph·Activity·Burst Diff | Inkeep OpenKnowledge | 전체 Runtime 제외, Human Cockpit 패턴 활용 |
| Contract·Runtime | JSON Schema, OpenTelemetry, PostgreSQL, CloudEvents 등 | Stage 0~1에서 검증·pin |
| AI Provider | 공식 SDK, LiteLLM, Pydantic/Zod, Langfuse | Provider Port 뒤에서 비교 |
| 문서 변환 | Docling, Tika, MarkItDown, PyMuPDF, Office 전용 도구 | 형식별 Golden Corpus로 선택 |
| Search·Graph | PostgreSQL FTS, pgvector, NetworkX, AGE 등 | PostgreSQL 기준 한계 확인 후 확장 |
| Policy·Action | OPA, Casbin, MCP SDK, 공식 SDK | 승인 경계를 우회하지 않는 Adapter만 채택 |

`ddsyasas/llm-wiki`와 OpenKnowledge는 전체 Product Runtime이 아니라 확정된 Interaction·Presentation·Preservation 범위만 사용한다.

## 8. 계획 상태

| 항목 | 상태 |
|---|---|
| Stage 순서와 Gate | Baseline Accepted |
| Walking Skeleton 범위 | Backend Baseline Accepted |
| Frontend Product Surface | Accepted |
| F0~F5 Frontend 전달 순서 | Accepted |
| ddsyasas·OpenKnowledge UI 참조 경계 | Accepted |
| Frontend Framework·Design System | Pending technical decision |
| 개별 OSS 최종 채택 | Stage별 Implementation Validation |
| Queue·Workflow 제품 | In-process/PostgreSQL 기준, 후보 비교 후 결정 |
| Search·Graph 제품 | PostgreSQL 기준, 한계 확인 후 확장 |
| AI Gateway 제품 | Provider Port 우선, 공식 SDK·LiteLLM Benchmark |
| 외부 Action Connector 순서 | 별도 Release Gate |

## 9. 작업 추적 방식

- **GitHub Milestone:** Stage, Frontend Stage 또는 Vertical Slice
- **Epic Issue:** 모듈, Workspace 또는 공통 기반
- **Task Issue:** 하나의 검증 가능한 산출물
- **OSS Evaluation Issue:** 후보 하나의 채택·추출·제외 결정
- **Pull Request:** 작은 계약·기능·테스트 단위
- **ADR:** 아키텍처·데이터 소유권·기술 채택 변경
- **Release:** 사용자가 실행할 수 있는 수직 기능 단위

Issue에는 관련 Stage, 모듈·Workspace, Contract, 완료 기준, 테스트, 보안·승인 영향, 관련 ADD·ADR, OSS 후보와 차단 의존성을 기록한다.

## 10. 변경 원칙

- 일정과 수치는 구현 결과에 따라 조정할 수 있다.
- OSS 역할과 채택 상태도 검증 결과에 따라 조정할 수 있다.
- Stage의 의미, Product Surface, Canonical 또는 승인 경계를 변경하려면 ADR이 필요하다.
- 채택한 OSS를 교체할 때 과거 결정을 삭제하지 않고 Migration·Rollback과 변경 이유를 기록한다.
- 구현되지 않은 기능을 문서상 완료로 표시하지 않는다.
- 부분 완료는 완료 항목, 미완료 항목과 제한을 분리해 기록한다.
