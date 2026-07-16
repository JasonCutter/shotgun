<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81cdb3ded45a275ec758 -->

회의 상태: 완료
결정일: 2026-07-16
승인 방식: Phase 1 잔여 설계회의 준비안의 권장안 일괄 승인
### 확정 결정
1. IntakeItem 상위 상태는 RECEIVED, VALIDATING, ACTION_REQUIRED, READY_TO_PERSIST, PERSISTING, STORED, READY_FOR_PHASE_2, BLOCKED, INDETERMINATE, CANCELLED, FAILED_RETRYABLE로 구분한다. 세부 단계와 reason code는 별도 이벤트로 유지한다.
2. 허용된 상태 전이만 수행하고 각 전이에 선행 조건, 행위자·Job, 시각, reason code와 결과 버전을 기록한다. 완료 상태를 되돌려 덮어쓰기보다 새 Attempt와 새 결과를 연결하며 현재 상태는 이벤트 이력에서 재구성 가능한 투영으로 관리한다.
3. 제출, 항목 승격, OriginalAsset 생성·연결과 Phase 2 인계에 각각 명시적 멱등성 키를 둔다. 같은 키의 반복 요청은 기존 결과를 반환하고 새 원본·IntakeItem·Job을 중복 생성하지 않는다.
4. 같은 IntakeItem의 동일 단계가 동시에 실행되지 않도록 분산 잠금 또는 원자적 상태 갱신, lease와 fencing token을 사용한다. gbrain의 locking·recovery 패턴을 우선 검토한다.
5. 일시적 실패는 같은 IntakeItem의 새 Attempt로 재시도한다. 수정된 원문은 새 IntakeItem 후보이며 정책·검사기·변환기 업그레이드 재처리는 기존 OriginalAsset을 유지하고 새 Attempt·결과 버전을 만든다.
6. 사용자는 외부 부작용이 확정되지 않은 작업을 취소할 수 있다. 취소 요청은 새 작업 시작을 막고 실행 중 작업에 협력적 중단 신호를 보내며 생성된 임시 산출물 정리 결과를 기록한다.
7. 일반 작업 취소는 이미 존재하거나 다른 IntakeItem이 참조하는 OriginalAsset을 자동 삭제하지 않는다. 다만 IntakeSubmission 전체 취소에는 ADR-002가 우선 적용되어 해당 제출에서 새로 생성한 원본과 결과를 참조 관계와 멱등성 아래 전량 폐기한다. 기존 제출·공유 OriginalAsset은 대상이 아니다.
8. 프로세스 재시작 후 이벤트와 상태를 읽어 안전한 지점에서 작업을 재개할 수 있어야 한다. 완료가 불확실한 외부 쓰기는 멱등성 키와 저장소 상태를 확인한 뒤 재실행하며 자동 복구가 사용자 선택이나 정책 결정을 추정하지 않는다.
### 결정 근거
append-only 상태 이력, 멱등성 키와 잠금·fencing을 결합하면 장애·중복 요청·작업자 교체에도 원본과 처리 결과를 중복 생성하거나 덮어쓰지 않는다.
### 제외한 대안
자유로운 상태 변경, 파일명 기반 멱등성, 완료 결과 덮어쓰기, 취소만으로 공유 원본을 삭제하는 방식과 자동 복구가 사용자 선택을 추정하는 방식은 채택하지 않는다.
### 영향 범위와 후속 검토
Section 3.7은 삭제·격리·복구의 실제 자산 정책을, Section 3.8은 Phase 2 인계 멱등성을 확정한다.
### 미결사항
DB 트랜잭션·unique constraint·lease 구현, retry backoff와 dead-letter 운영, gbrain 어댑터의 정확한 경계는 구현 계획에서 확정한다.
