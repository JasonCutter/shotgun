<!-- Canonical source: https://app.notion.com/p/39f5181d71ad818e8c8def05e8be96b4 -->

회의 상태: 완료
결정일: 2026-07-16
승인 방식: Phase 1 잔여 설계회의 준비안의 권장안 일괄 승인
### 확정 결정
1. OriginalAsset은 변경되지 않은 원본 표현과 원본에 직접 결속된 무결성 정보를 나타낸다. 원본 바이트 또는 Section 3.3의 비파일 원본 표현, 콘텐츠 해시·길이·저장 참조·형식, 불변 생성 시각, 저장 상태와 원본 수준 접근·민감도 기본 경계를 가진다.
2. IntakeItem은 사용자가 자료를 접수한 한 번의 업무 맥락과 처리 상태를 나타낸다. Submission·항목 식별자, OriginalAsset 또는 임시 원본 참조, 입력 채널·원래 이름·제출 URL, 선택적 사용자 메모, 검증 Attempt·현재 상태·오류·중복 선택, Phase 2 인계 상태를 가진다.
3. 프로젝트·태그·표시 제목과 이후 승인되는 처리 규칙은 OriginalAsset의 정체성에 포함하지 않는다. Phase 1 입력 단계에서는 Section 1.7·1.8에 따라 선택적 사용자 메모 외의 사용자 지정 메타데이터와 처리 지시를 추가하지 않는다.
4. 하나의 OriginalAsset을 여러 IntakeItem이 참조할 수 있고 하나의 IntakeItem은 일반적으로 하나의 OriginalAsset을 참조한다. 정확 중복은 새 OriginalAsset을 만들지 않고 새 IntakeItem 또는 발생 기록을 기존 자산에 연결한다.
5. IntakeItem은 사용자가 제출을 확정한 시점에 생성한다. Step 2 이전과 진행 중의 원본은 TemporaryIntakeBlob 또는 동등한 임시 참조이며, Step 2 통과 후 영구 저장 트랜잭션에서 OriginalAsset을 생성하거나 기존 자산에 연결한다.
6. BLOCKED·INDETERMINATE 항목도 IntakeItem과 검증 이력은 보존할 수 있지만 정상 OriginalAsset 검색·미리보기·Phase 2 경로로 승격하지 않는다. 위험 원본의 격리 보존 여부는 Section 3.7에서 확정한다.
7. OriginalAsset은 바이트 또는 버전화된 원본 표현 단위다. Stable Source와 SourceVersion은 동일 문서·자료의 버전 관계를 의미하며 Phase 2 Step 5.7에서 생성한다.
8. OriginalAsset ID와 IntakeItem ID는 독립적이고 불변이다. 표시 제목·파일명이 바뀌어도 ID를 변경하지 않으며 상태·관계 변경은 Audit 이벤트로 기록한다.
### 결정 근거
불변 원본과 접수·처리 맥락을 분리하면 같은 원본을 여러 맥락에서 재사용하면서도 원본 동일성과 사용자 작업 이력을 모두 보존할 수 있다.
### 제외한 대안
파일·URL·메모·프로젝트·작업 상태를 하나의 가변 Source 레코드에 모두 저장하는 방식, 정확 중복마다 새 원본을 만드는 방식, Phase 1에서 OriginalAsset을 Stable Source나 SourceVersion으로 곧바로 승격하는 방식은 채택하지 않는다.
### 영향 범위와 후속 검토
Section 3.2는 OriginalAsset의 불변 저장과 내용 주소화를, Section 3.3은 비파일 원본 표현을, Section 3.6은 IntakeItem 상태와 멱등성을 정한다.
### 미결사항
정책 수준 미결사항은 없다. 구체 데이터베이스 테이블·키·외래키·unique constraint는 구현 계획에서 확정한다.
