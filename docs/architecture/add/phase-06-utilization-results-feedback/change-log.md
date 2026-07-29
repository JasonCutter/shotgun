<!-- Canonical source: https://app.notion.com/p/39f5181d71ad8138ad46f1f62c36b38a -->

## 문서 관리
- 범위: Phase 6 설계·결정 이력
- 상태: **누적 기록**
- 관련 ADD: [Phase 6 — 활용·결과·피드백 ADD](https://app.notion.com/p/39f5181d71ad81948c94cbf0a894ea01)
## 2026-07-16
### Phase 6 작성 시작
사용자가 Phase 6이 아직 작성되지 않았음을 확인하고 작성을 요청했다. Detailed Map의 Phase 6 Step 18\~22, 총 43개 Section을 기준으로 전체 설계를 시작했다.
### 세 가지 사용 모드
Canonical, Source 탐색, 외부 조사 모드를 분리하고 결과의 구간·Citation·Provenance에 사용 모드를 표시하도록 했다. 외부 조사와 미승인 후보가 승인 지식처럼 보이지 않도록 경계를 확정했다.
### 근거 기반 결과와 콘텐츠 생성
사실 진술을 Citation·추론·Gap·Conflict 상태로 결속했다. 문서·보고서·슬라이드·이미지는 사실 층과 표현 층을 분리하며, 시각 원본 이해와 시각 산출물은 실제 렌더링을 멀티모달 AI가 검증하도록 했다.
### 위험도와 사용자 검토
읽기·쓰기, 외부 공개, 민감정보, 금전·법률·의료·안전, 가역성, 규모와 권한을 분리 평가하는 R0\~R4 정책을 설계했다. 기본 쓰기는 실행 직전 승인을 요구하고, 제한적이며 되돌리기 쉬운 R2 Action만 명시적 범위 위임을 허용했다.
### 출력·읽기 API
화면·문서·내보내기·읽기 API에서 사용 모드·Citation·Canonical snapshot·Projection watermark·접근 정책을 유지하도록 했다. 외부 게시·발송·업로드·공유 권한 변경은 읽기 출력이 아니라 Action으로 분류했다.
### 외부 Action 실행
Connector capability, ActionAuthorizationToken, Preflight, idempotency, verify, OUTCOME_UNKNOWN, compensation과 end-to-end Audit을 확정했다. Connector secret은 AI·일반 로그와 분리했다.
### 피드백 순환
사용자 수정과 평가를 사실·근거·표현·선호·Directive·새 자료·Action 결과로 분리했다. 적절한 이전 Phase로 재진입하며 대화 피드백을 Fact나 장기 기억으로 조용히 승격하지 않도록 했다.
### 사용자 결정
기존 Project Shotgun 원칙과 보수적인 안전 기본값으로 모든 정책을 설계했다. 추가 사용자 결정 대기 항목은 만들지 않았다.
