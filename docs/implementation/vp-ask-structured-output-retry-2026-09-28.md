# VP Ask 구조화 응답 재시도 — 2026-09-28

## 근거와 변경

실제 PDF와 상충 자료를 함께 질문한 검증에서 DeepSeek 응답 한 건이 구조화 JSON 검사를 통과하지 못해 AnswerRun이 `FAILED`로 끝났다. 같은 자료로 재질문하자 정상 답변과 두 출처 인용이 나왔다. 자료 투입과 질문 외 사용자 조작을 요구하지 않는 ADR-172 계약에 맞춰, `StructuredAskAnswerProviderAdapter`가 VP 자동 질문 모드의 **응답 형식 오류에만** 동일한 인가 문맥·질문·모델·Schema로 한 번 재호출한다. 기존 Source Exploration 모드는 변경하지 않는다.

- 재시도는 정확히 한 번이며 두 번째 형식 오류는 기존 실패 계약으로 끝난다.
- 네트워크 오류, 중단 신호, 인가 거부, 허가되지 않은 인용 참조에는 재시도하지 않는다.
- 첫 응답과 재호출 응답에 사용량이 있으면 토큰 수를 합산한다. 사용 가능한 마지막 응답의 Provider Response ID를 반환한다.
- SourceVersion/Evidence, 접근 범위, 민감도, Provider Policy와 AI Execution Pin은 변경하지 않는다.

## Integration Decision

- `garrytan/gbrain` Job/Retry는 Role Matrix의 `REFERENCE_ONLY`를 유지한다. 답변 JSON과 발급된 Evidence 인용 참조는 Shotgun의 `AskAnswerProviderPort` 계약이며 외부 Runtime이나 Schema를 도입하지 않는다.
- 이 좁은 형식 오류 복구에는 관련 외부 OSS가 없으므로 `NO_RELEVANT_OSS`다. 기존 DeepSeek/AI Provider Adapter를 `AUGMENT`하며 새 의존성이나 Version pin은 없다.
- 교체 경계는 `AskAnswerProviderPort`다. 롤백은 Adapter의 단일 재시도만 되돌리며 DB Migration과 데이터 변환은 없다.

## 검증과 한계

- 단위 테스트에서 첫 응답이 잘못된 JSON이고 두 번째가 정상일 때 같은 prompt로 2회 호출, 유효한 인용 바인딩, 두 호출의 합산 토큰 수를 확인했다.
- 연속 2회 형식 오류는 실패로 끝나며, 중단 신호·허가되지 않은 인용 참조·기존 Source Exploration 모드에서는 재호출하지 않는다.
- 기존 Ask Adapter/Policy 테스트, TypeScript, ESLint, Prettier, TS-6 권위 검증을 통과했다.
- 첫 번째 잘못된 응답의 Provider Response ID는 별도 영수증으로 기록되지 않는다. 프로세스가 첫 호출과 두 번째 호출 사이에 중단되는 경우의 자동 복구도 아직 보장하지 않는다. 완전한 호출별 비용·재시작 복구 Gate를 이 변경만으로 완료로 판정하지 않는다.
