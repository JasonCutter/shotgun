# Shotgun Definition of Done

> 목적: 기능이 구현됐다는 주장과 실제로 다음 단계에 전달 가능한 상태를 구분한다.

## 1. 완료의 네 가지 Gate

모든 기능, 모듈과 Stage는 다음 네 Gate를 통과해야 한다.

1. Module Gate
2. Flow Gate
3. Product Gate
4. Architecture Gate

하나라도 통과하지 못하면 `COMPLETE`가 아니다.

## 2. Module Gate

### 계약

- 공개 Command·Event·Query·Asset Reference가 정의됨
- 입력·출력 Schema가 Versioned Artifact로 존재함
- Breaking Change 정책이 적용됨
- Module Manifest가 실제 구현과 일치함
- Compatibility Range가 선언됨

### 데이터 소유권

- 모듈이 소유하는 Entity·Table·File·Index가 명시됨
- 다른 모듈 Schema 직접 접근이 없음
- 비소유 데이터는 Query Port 또는 Projection을 통해 읽음
- Migration과 Rollback 방법이 있음

### 독립성

- 외부 Provider SDK 없이 Domain Unit Test를 실행 가능
- In-memory Adapter 또는 Test Double이 있음
- 특정 Assembly 없이 Contract Test를 통과함
- Adapter를 교체해도 Domain Code를 수정하지 않음

### 신뢰성

- 같은 Command의 중복 전달에 안전함
- Retryable과 Terminal Failure가 구분됨
- Timeout·Cancellation·Outcome Unknown 정책이 있음
- 부분 실패 뒤 상태 복구 또는 Quarantine이 가능함

### 보안

- 필요한 Security Context가 선언됨
- Context 누락 시 기본 거부
- 접근 범위와 민감도가 출력에 상속됨
- Secret이 Domain Model·Prompt·일반 Log에 노출되지 않음

### 관찰성

- Correlation·Causation·Trace·Job·Attempt 전달
- 주요 상태 전이와 오류 Metric 존재
- 사용자 승인·Canonical Commit·Action은 Audit Event 기록

## 3. Flow Gate

### 연결성

- 앞 모듈의 실제 출력이 뒤 모듈의 실제 입력으로 전달됨
- Test 내부에서 DB를 직접 조작해 중간 단계를 우회하지 않음
- Message Version과 Security Context가 종단까지 유지됨

### Evidence와 Provenance

- 사실적 Candidate와 결과가 Evidence 또는 Canonical Reference에 연결됨
- AI Provider·Model·Prompt·Policy·Tool·Attempt가 기록됨
- Translation·Summary·Inference가 원문 Evidence로 오인되지 않음

### 실패 흐름

- 정상 흐름뿐 아니라 최소 다음이 검증됨
  - 입력 오류
  - 의존 모듈 실패
  - Retry
  - 중복 Message
  - 권한 거부
  - Stale Version
  - Timeout
  - Partial Failure

### 상태 일관성

- 상태 전이 Diagram 또는 Table과 구현이 일치함
- 금지된 상태 전이가 Test로 차단됨
- Replay와 Recovery가 History를 덮어쓰지 않음

## 4. Product Gate

### 사용자 결과

- 사용자가 실제 UI, CLI 또는 API에서 결과를 확인 가능
- Demo 절차가 문서화됨
- 성공·실패·진행 상태가 이해 가능한 용어로 표시됨
- 빈 화면이나 Log 확인만으로 완료 처리하지 않음

### 검토와 수정

- 근거·Diff·영향을 확인할 수 있음
- 필요한 경우 승인·거절·보류·재시도 가능
- 사용자 수정이 올바른 Revalidation 또는 Reentry로 연결됨

### 접근성·가시성

- 핵심 기능은 Graph나 Visual UI 없이도 목록·표·Text로 사용 가능
- 오류와 제한이 숨겨지지 않음
- Projection Lag·Model Disagreement·Conflict를 최신 Truth처럼 표시하지 않음

### 운영 가능성

- 설치·실행·초기화·중지·복구 절차가 있음
- 최소 운영 Dashboard 또는 상태 Query가 있음
- 비용과 외부 Provider 사용량을 확인 가능

## 5. Architecture Gate

### Canonical 경계

- 미승인 Candidate가 Canonical에 기록되지 않음
- Claim과 Fact가 분리됨
- Canonical Write는 Canonical Knowledge Module만 수행
- HistoryEvent와 Revision을 조용히 덮어쓰지 않음

### Approval 경계

- 사용자 승인 대상 Revision과 Digest가 고정됨
- 승인 이후 변경 시 승인이 무효화됨
- AI 모델 합의가 사용자 승인을 대체하지 않음

### Projection 경계

- Compiled Truth·Search·Graph·Cache가 Canonical에서 재생성 가능
- Projection 실패가 성공한 Canonical Commit을 되돌리지 않음
- Watermark와 Readiness가 있음

### Action 경계

- ActionCandidate와 실제 실행이 분리됨
- Risk Decision·Preview·Approval·Preflight·Verify를 통과함
- Timeout 뒤 자동 중복 실행 금지
- 보상 작업도 별도 Action으로 기록됨

### 모듈 경계

- 모듈 간 직접 DB 접근 금지
- Provider SDK가 Domain Module에 노출되지 않음
- 공통 Connector 계약 사용
- 새로운 Architecture Decision은 ADR 기록

### 범위 준수

- Shotgun Assembly에서 오디오·영상 파일 직접 분석 기능이 활성화되지 않음
- 영상 URL은 접근 가능한 Text Metadata·Subtitle·Script 범위만 처리
- 제외 기능을 암묵적으로 우회하지 않음

## 6. Test Gate

모든 PR은 변경 범위에 따라 다음을 통과한다.

- Unit Test
- Contract Test
- Integration Test
- Architecture Test
- Migration Test
- Security Negative Test
- 관련 E2E Test
- Golden Corpus Test, 형식 변환 변경인 경우
- Replay·Idempotency Test, Event 또는 Side Effect 변경인 경우

Test를 생략하면 PR 설명에 이유, 위험과 후속 Issue를 기록한다. 안전 경계 Test는 생략할 수 없다.

## 7. Documentation Gate

- Public Contract 문서 갱신
- Module Manifest 갱신
- 관련 Stage·Slice·Issue 링크
- 설정값과 기본값 설명
- Migration·Rollback 절차
- 알려진 제한
- 보안·비용 영향
- OSS Version·License·Security 기록, 외부 Dependency 변경 시

## 8. Pull Request 완료 체크리스트

```markdown
## Scope
- [ ] 관련 Stage와 Vertical Slice를 명시했다.
- [ ] 담당 모듈과 데이터 소유권을 명시했다.

## Contracts
- [ ] 입력·출력 Contract가 Versioned다.
- [ ] Breaking Change 여부를 확인했다.
- [ ] Module Manifest를 갱신했다.

## Safety
- [ ] Security Context와 접근 범위를 검증했다.
- [ ] Canonical·Approval·Action 경계를 위반하지 않는다.
- [ ] Secret과 민감 데이터가 노출되지 않는다.

## Reliability
- [ ] Idempotency를 검증했다.
- [ ] Retry·Timeout·Partial Failure를 검증했다.
- [ ] Migration·Rollback 방법이 있다.

## Tests
- [ ] Unit Test
- [ ] Contract Test
- [ ] Integration Test
- [ ] Architecture Test
- [ ] E2E 또는 Golden Corpus Test

## Documentation
- [ ] 관련 문서를 갱신했다.
- [ ] 알려진 제한과 후속 작업을 기록했다.
```

## 9. Stage 완료 체크리스트

- Stage의 모든 필수 Deliverable 존재
- Critical Path Module Gate 통과
- 해당 Vertical Slice E2E 통과
- Product Demo 성공
- Security·Approval Negative Test 통과
- Migration·Rollback 연습 완료
- Risk Register 갱신
- Known Limitation 공개
- 다음 Stage에 전달할 Contract Version 고정
- Stage Completion PR 또는 Release Note 승인

## 10. Complete with Limits 조건

다음 조건을 모두 만족할 때만 `COMPLETE_WITH_LIMITS`를 사용할 수 있다.

- 사용자 가치가 실제로 동작함
- 안전·Canonical·Approval 경계는 완전함
- 제한이 성능·편의·지원 형식 등에 국한됨
- 제한이 문서와 UI에 표시됨
- 제거 계획과 Issue가 있음
- 다음 Stage가 제한 때문에 잘못된 가정을 하지 않음

다음은 `COMPLETE_WITH_LIMITS`로 허용되지 않는다.

- 승인 우회
- Evidence 누락
- 권한 검사 누락
- 중복 Action 위험
- History 손실
- 직접 DB 결합
- 테스트 없이 동작한다고 추정한 상태

## 11. 완료 선언 문구

완료 보고는 다음 형식을 사용한다.

```text
Completed scope:
Excluded scope:
Vertical slice demonstrated:
Contracts frozen:
Tests passed:
Security and approval checks:
Migration and rollback:
Known limitations:
Follow-up issues:
Evidence links:
```
