<!-- Canonical source: https://app.notion.com/p/39f5181d71ad81d0b4a7dbcfda44e7ef -->

회의 상태: 완료
결정일: 2026-07-16
승인 방식: Phase 1 잔여 설계회의 준비안의 권장안 일괄 승인
성격: Phase 1 완료 게이트
### 확정 결정
1. Phase 1은 항목마다 버전화된 Phase2IntakeManifest 또는 동등한 인계 계약을 생성한다. 이 계약은 원본과 Step 2 결과를 대체하지 않고 Phase 2 작업에 필요한 불변 참조를 묶는다.
2. 최소 필드는 IntakeItem ID와 OriginalAsset ID, 원본 표현 유형·저장 참조·해시·길이·형식, Step 2 통합 결과와 계약 버전, 경고·제한·제외 요소·안전성 상태, 입력 채널과 MaterialKind, 선택적 사용자 메모와 Provenance 참조, 적용된 표준 정책·User Directive 버전, 접근·민감도 정책, 중복 재사용·관계 의도, Phase 2 허용·금지 작업, 인계 생성 시각·Attempt·schema_version이다.
3. Phase 2 진입 조건은 OriginalAsset 저장 또는 승인된 기존 자산 연결 완료, Step 2 진행 가능 상태, 필요한 사용자 선택 완료, 원본 무결성 검증 성공, 접근·민감도와 적용 정책 결속, 인계 스키마 검증 통과, IntakeItem 상태 READY_FOR_PHASE_2다.
4. 인계 시점에는 Stable Source와 SourceVersion을 만들지 않는다. Phase 2가 OriginalAsset과 IntakeItem을 입력으로 문서 구조·버전 관계를 분석하며 사용자의 새 버전·관련 자료 의도는 후보 관계로만 전달한다.
5. 같은 IntakeItem·OriginalAsset·인계 스키마 버전에는 하나의 유효 Manifest를 사용한다. Queue 전송이 반복돼도 같은 Phase 2 시작 Job을 중복 생성하지 않는다. 정책·지시가 바뀌면 기존 Manifest를 덮어쓰지 않고 새 버전과 재처리 결정을 만든다.
6. Queue 또는 Phase 2 Job 생성 실패는 OriginalAsset 저장 완료 상태를 되돌리지 않는다. 재시도 가능한 인계 실패로 표시하고 멱등하게 다시 전달한다. 인계 전 취소 시 Phase 2 Job을 만들지 않는다.
7. Phase 1 완료 기준은 Step 1 Section 1.1\~1.9, Step 2 Section 2.1\~2.8, Step 3 Section 3.1\~3.8 확정, 관련 ADR·미결사항·변경 이력 정리, Phase 1 ADD 완료 표시, Phase 2 인계 계약과 금지 경계 검증, 사용자 최종 확인이다.
8. 완료된 Phase 1 결정을 조용히 수정하지 않는다. 정책 변경은 변경 이유·대안·영향과 ADR을 남기고 구현 제품·라이브러리·운영 수치 변경이 정책을 바꾸지 않는 경우에는 구현·운영 설정 이력으로 관리한다.
### 결정 근거
명시적인 인계 Manifest와 완료 게이트를 두면 Phase 2가 Phase 1 내부 테이블을 추측하지 않고 원본·검증·정책 경계를 안정적으로 소비할 수 있다. Stable Source 판정을 Phase 2에 남겨 원본 바이트 동일성과 문서 버전 관계를 혼동하지 않는다.
### 제외한 대안
OriginalAsset 생성과 동시에 SourceVersion을 만드는 방식, Queue 전송 실패 시 저장 완료를 롤백하는 방식, 버전 없는 인계 payload, 완료된 Phase의 조용한 수정은 채택하지 않는다.
### 영향 범위와 후속 검토
Phase 2 Step 4는 Manifest를 입력으로 변환기를 선택하고 Step 5.7은 Stable Source·SourceVersion을 판정한다. 구체 Manifest 스키마와 Queue 기술은 구현 계획에서 확정한다.
### 미결사항
정책 수준 미결사항은 없다. Manifest의 정확한 타입·필드명, Queue·Job API, schema migration과 Phase 2 시작 Job의 gbrain 어댑터는 구현 계획에서 확정한다.
