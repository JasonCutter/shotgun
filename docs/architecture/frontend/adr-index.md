---
id: FRONTEND-ARCHITECTURE-ADR-INDEX
classification: CANONICAL
status: active_index
approved_by: user
approved_at: 2026-07-29
legacy_source_id: 3a65181d-71ad-8182-b0fb-f84d722f98a2
---

# Frontend Architecture ADR Index

## 범위

Frontend and Human Interaction Architecture의 횡단 ADR을 식별한다. 이 인덱스는 ADR 본문의 결정과 변경 이력을 대체하지 않으며 ADR
번호와 Accepted 상태를 보존한다.

| ADR     | 제목                                                                                                   | 상태                                                                                     | Legacy Notion ID                       |
| ------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| ADR-099 | Local Owner Session·Authentication Adapter Recovery Boundary                                           | Accepted                                                                                 | `3a65181d-71ad-8137-b3ec-e21f484c9f16` |
| ADR-100 | Active Project·Resource Project·Draft Project Binding                                                  | Accepted                                                                                 | `3a65181d-71ad-8182-ab8f-c67e791ebd85` |
| ADR-101 | Frontend Async Command·Resource Snapshot·Outcome Unknown                                               | Accepted                                                                                 | `3a65181d-71ad-815c-8c23-e6b1cbe8d962` |
| ADR-102 | Source Library·Ask Exploration·Intake Re-entry Boundary                                                | Accepted                                                                                 | `3a65181d-71ad-81e3-b95e-eae1a0ca61fb` |
| ADR-103 | Settings as Typed Project Policy Control Plane                                                         | Accepted                                                                                 | `3a65181d-71ad-8176-9f37-e50336c18f0c` |
| ADR-104 | Global Shell and Server-ranked Action Center Boundary                                                  | Accepted                                                                                 | `3a65181d-71ad-81c7-8fb3-c5b70df73304` |
| ADR-105 | Frontend Policy Context Pinning and Current-policy Revalidation                                        | Accepted                                                                                 | `3a65181d-71ad-81b7-bf83-e54de4d814e6` |
| ADR-106 | Knowledge Workspace as Projection-based Read Model                                                     | Accepted                                                                                 | `3a65181d-71ad-8197-984c-cb1e6e7b7117` |
| ADR-107 | Knowledge Editor as DraftChangeSet Authoring Boundary                                                  | Accepted                                                                                 | `3a65181d-71ad-8159-af15-e1467969ebbf` |
| ADR-108 | Typed Semantic Graph Projection with Accessible Fallback                                               | Accepted                                                                                 | `3a65181d-71ad-81c9-a864-d74dfbbe01b7` |
| ADR-109 | Review Center as Item-level Approval Gateway                                                           | Accepted                                                                                 | `3a65181d-71ad-813b-9f5f-c2160415321b` |
| ADR-110 | External Action Validation·Approval·Preflight·Verify Boundary                                          | Accepted                                                                                 | `3a65181d-71ad-81bd-a332-e17f354c1305` |
| ADR-111 | Activity Workspace as Job·Attempt·Event Projection                                                     | Accepted                                                                                 | `3a65181d-71ad-8111-8e8e-d9f6ce0dd968` |
| ADR-112 | Immutable History and Reversal ChangeSet Boundary                                                      | Accepted                                                                                 | `3a65181d-71ad-81ba-b9a3-d3ed2b38f6ca` |
| ADR-113 | Five-phase Frontend Responsibility Separation and Design Completion Boundary                           | Accepted                                                                                 | `3a65181d-71ad-818f-818c-c00af7bd77c4` |
| ADR-114 | Project Administration and Settings Repository Ownership Boundary                                      | Accepted                                                                                 | `3a95181d-71ad-81c9-ab5e-f4348be1b08e` |
| ADR-115 | Global Shell·Action Center Read Projection and Scope Boundary                                          | Accepted 2026-07-26 / implementation not started                                         | `3a95181d-71ad-8155-85d3-ccb0420fb998` |
| ADR-116 | Zero-project Session·Principal Command·Project Bootstrap Persistence Boundary                          | Accepted 2026-07-28                                                                      | `3ab5181d-71ad-81ff-87c2-d92e7a87a00b` |
| ADR-118 | Typed Failure Taxonomy and Translation Boundary                                                        | Accepted / Product implementation merged                                                 | `3ab5181d-71ad-81de-8fa2-d52827afed19` |
| ADR-119 | Frontend Server State, Draft State and Cache Ownership Boundary                                        | Accepted / Product implementation pending at migration time                              | `3ab5181d-71ad-8132-85cb-d3154108c4a5` |
| ADR-122 | Sources Workspace Intake, Duplicate, URL and Lifecycle Boundary                                        | Accepted / Product implementation merged                                                 | Git ADR; no Legacy Notion owner        |
| ADR-123 | Ask Command, Conversation Persistence and Outcome Recovery Boundary                                    | Accepted / Increment implementation merged                                               | Git ADR; no Legacy Notion owner        |
| ADR-124 | Frontend Work Item Identity, Scope Amendment, and Completion Authority Boundary                        | Accepted / Governance boundary adopted 2026-08-01                                        | Git ADR; no Legacy Notion owner        |
| ADR-125 | Knowledge Workspace Multi-Authority Search and Non-Ready Compiled Truth Read Boundary                  | Accepted 2026-08-02 / QX-01 Stage 7 and QX-02 Stage 10 handlers authorized; Adapter held | Git ADR; no Legacy Notion owner        |
| ADR-126 | Knowledge Editor Typed DraftChangeSet Materialization, Snapshot Pinning and Review Submission Boundary | Accepted 2026-08-02 / publication pending / Product implementation not started           | Git ADR; no Legacy Notion owner        |
| ADR-127 | Semantic Graph Projection Read Persistence, Health and Continuation Boundary                           | Accepted 2026-08-04 / FE-P3-S3 Product implementation authorized                         | Git ADR; no Legacy Notion owner        |
| ADR-128 | Review Context Revision, Item Decision and Purpose-bound Approval Boundary                             | Accepted 2026-08-04 / FE-P4-S1 Product implementation authorized                         | Git ADR; no Legacy Notion owner        |
| ADR-129 | External Action Product Resource, Attempt, Credential, Budget and Compensation Boundary                | Accepted 2026-08-05 / FE-P4-S2 Product implementation complete                           | Git ADR; no Legacy Notion owner        |
| ADR-130 | Frontend Agent·Job Activity Federated Projection, Identity and Retry Boundary                          | Accepted 2026-08-06 / FE-P5-S1 Contract frozen / Product implementation not authorized   | Git ADR; no Legacy Notion owner        |

ADR-117과 ADR-120은 Frontend 기능 ADR이 아니라 Project 전체 문서 Canonical 운영을 지배한다. ADR-124는 Frontend Work
Item과 완료 권위의 Accepted 경계를 정의한다. ADR-129는 FE-P4-S2의 Product 실행·Attempt·Credential·Budget·Compensation
경계를 정의한다. ADR-130은 ADR-111의 Activity 설계를 federated read projection, Domain identity mapping, retry
semantics, additive read model과 polling baseline으로 구체화하며 ADR-112의 History 경계를 보존한다.

## Git 소유 경계

- ADR-099와 ADR-114–130의 권위 본문은 `docs/architecture/adr/`의 개별 Git 파일이다.
- ADR-100–113의 권위 본문은 [`adr-100-113-consolidated-record.md`](adr-100-113-consolidated-record.md)다.
- 개별 Notion 페이지는 Legacy Reference와 승인 당시의 원문 이력이다.
- 전역 번호·Gap·Owner 정보는 [`docs/architecture/adr/adr-registry.json`](../adr/adr-registry.json)이 지배한다.

## 인덱스 규칙

1. 인덱스가 ADR 본문을 대체하지 않는다.
2. 동일 번호 또는 제목의 Notion 페이지는 Legacy Reference 또는 Mirror다.
3. 이관 과정에서 ADR 번호, Accepted 상태 또는 구현 완료 상태를 추측해 변경하지 않는다.
4. ADR 본문과 Phase 통합 문서가 충돌하면 변경 이력과 승인 시점을 대조하고 명시적으로 조정한다.
5. 설계 Accepted, Product 구현, 원격 CI, Merge와 Production 검증을 별도 상태로 기록한다.
6. 후속 변경은 기존 결정을 조용히 덮어쓰지 않고 새 ADR 또는 명시적 Amendment를 사용한다.

## 알려진 역사적 상태 차이

- Frontend 구현계획 v1.0의 초기 상태에는 Phase 1 Section 2가 미착수로 기록돼 있다.
- 이후 PR #20과 Phase 1 상위 결정문이 Section 2 구현·검증·병합 완료를 확정했다.
- 따라서 현재 상태 표시는 이후 승인·병합 기록을 따른다. 초기 기록은 당시 Fact로 보존하며 삭제하지 않는다.
- ADR-119의 설계 문서 병합과 Product 구현 완료는 별개다.
- ADR-130의 Contract 승인과 FE-P5-S1 Product 구현 완료는 별개다.

## 2026-07-29 전역 정리 결과

- ADR-100–113을 승인 본문과 Contract Normalization 이력이 보존된 통합 Git 소유 기록으로 이관했다.
- 번호를 재사용하거나 변경하지 않았다.
- Notion 원문을 삭제하지 않고 Legacy Reference로 유지했다.
- Project-wide ADR 소유자와 명시적 Legacy Gap은 ADR-121과 전역 Registry에서 검증한다.
