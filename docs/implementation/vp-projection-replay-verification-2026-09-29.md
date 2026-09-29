# VP 원장 재생·현재 조회 검증 — 2026-09-29

## 범위와 결정

`scripts/verify-vp-projection-replay.ts`는 DB를 변경하지 않고 VP 이력·SourceVersion·Stage 3 revision·Candidate Batch·Validation·주장·관계를 읽어 현재 주장과 관계를 독립적으로 재계산한다. `REPEATABLE READ READ ONLY` 스냅샷 안에서 원장 epoch 연속성, 모든 직접 주장·관계의 HistoryEvent 연결, 최신 처리 완료 Batch와 미해결 판단의 효과를 검사한다. SQL View가 반환한 ID 집합과 재계산한 ID 집합이 다르면 실패한다.

- [gbrain](https://github.com/garrytan/gbrain) `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT)의 Fact·History·Projection 재생 패턴은 `REFERENCE_ONLY`다. 전체 Runtime/DB를 채택하면 Shotgun의 SourceVersion·Evidence·Ledger ID 소유권과 충돌한다.
- 저장소에 고정된 PostgreSQL 16.14를 `AUGMENT`하여 읽기 전용 검증을 추가한다. 새 OSS 종류나 Schema Migration은 없다. 기존 `oss-source-registry.json`의 version·license·security·maintenance 평가와 Open-source Role Matrix 경계가 유지된다. 교체 경계는 이 검증기의 `Pool` 조회이며, 향후 다른 저장 Adapter를 채택하면 같은 fixture에서 재생 결과를 비교한다.
- CI 의존성 감사에서 기존 `fast-uri` 4.1.3의 고위험 취약점 두 건이 새로 보고됐다. [공식 저장소](https://github.com/fastify/fast-uri)의 BSD-3-Clause 패키지를 `ADOPT` 상태로 유지하면서 override와 lockfile을 수정 버전 `4.1.4` (npm `gitHead` `a34ced25d015d12dfc2b0cf85ce01a4a0d12ecf6`)에 고정했다. [포트 직렬화 권고](https://github.com/advisories/GHSA-qw65-cvwx-89v3)와 [authority bracket 권고](https://github.com/advisories/GHSA-58mr-gqgx-xq4g)는 모두 4.1.4를 패치 버전으로 표시한다. `ajv`, Fastify compiler, `fast-json-stringify`는 동일한 4.1.4를 사용하며 `npm run oss:audit`의 고위험 Gate가 통과했다. 현재 중간 위험 경고는 별도 평가 대상이다. 이 버전 변경은 새로운 Shotgun Port나 데이터 소유권을 만들지 않아 Role Matrix 개정이 필요 없다.
- 검증기 롤백은 스크립트와 테스트 호출을 제거하는 것이다. 사용자 DB 변경이나 데이터 복원은 필요 없다. `fast-uri` 패치에서 호환 문제가 생기면 취약한 4.1.3으로 복귀하지 않고 검증된 후속 패치로 정방향 교체한다.

## 검증 증거

- 독립 PostgreSQL 테스트에서 추출 Batch 교체, 최신 SourceVersion 변경, 의미 관계 정책 재판정, 미해결 관계 철회 후 재생 결과와 현재 View가 일치했다.
- 운영 VP DB: HistoryEvent 47건과 epoch 47, 과거 주장 39건, 과거 관계 12건. 재생 결과와 현재 조회는 주장 16건·관계 2건으로 같았다.
- A/B·수정 버전 검증 DB: HistoryEvent 89건과 epoch 89, 과거 주장 82건, 과거 관계 13건. 재생 결과와 현재 조회는 주장 13건·관계 1건으로 같았다.
- PostgreSQL을 재시작한 뒤 두 DB에서 같은 결과로 다시 통과했다. 원장이나 View 데이터를 수정하지 않았다.

## 남은 Gate

- 이 검증은 **이미 저장된** Source·Candidate·원장을 현재 조회로 재생한다. 원문에서 변환·AI 추출·관계 판단까지 전체 파이프라인을 처음부터 다시 실행해 의미 결과를 비교하는 검증은 아니다.
- DB 재시작 시 전용 maintenance lock 세션이 끊어지면 Runtime은 설계대로 fail-stop한다. 이번 재시작에서 실행 중 샷건은 종료됐고 바탕화면 아이콘으로 다시 시작해 복구했다. 무인 자동 재기동은 아직 구현·검증하지 않았다.
- 모든 형식 Golden Corpus, DeepSeek 품질·비용 Gate와 제품 답변의 epoch 고정은 별도 완료 기준이다. 이 보고서만으로 VP를 `COMPLETE`로 판정하지 않는다.

## 2026-09-29 재생 완료 판정 보강

기존 검사기는 현재 Projection과 일치하는 ID만 비교해, 최신 `READY` Candidate가 원장에 아직 기록되지 않았거나 최신 SourceVersion의 Stage 3가 끝나지 않은 상태를 완전 수렴으로 오판할 수 있었다. 다음 조건을 모두 확인하도록 보강했다.

- Source마다 최신 SourceVersion의 Stage 3 인덱싱이 완료됐다.
- 최신 Transformation revision의 가장 최근 Candidate batch가 Validation까지 끝났고, 각 `READY` Candidate의 Evidence가 같은 SourceVersion·revision에 속하며 Claim 문구·접근 범위·민감도가 원장 Assertion과 일치한다.
- 모든 `READY` Candidate가 원장에 기록되고, 재구성한 현재 주장·관계가 DB의 현재 View와 일치한다.
- 활성 관계 Job이 `PENDING`, `RUNNING`, `RETRYABLE` 상태로 남아 있지 않다.

격리 PostgreSQL 테스트는 원장 기록 전에는 `expectedReadyCandidates=1`, `ledgeredReadyCandidates=0`으로 실패하고, 원장 기록 후 통과하는 것을 확인했다. Stage 3가 끝나지 않은 최신 수정 버전과 대기 관계 Job도 각각 미수렴으로 표시했다. VP 관계 우선순위 테스트와 함께 두 DB 테스트가 통과했다.

`main@c7f152cc` 기준 실제 Shotgun DB를 읽기 전용으로 다시 검사한 결과는 주장 16/16, 관계 3/3, History epoch/event 48/48, 최신 자료 처리 완료, Candidate·원장 매핑 완료, 대기 관계 Job 0건이었다. 원장·Projection을 변경하지 않았다.

이번 변경은 기존 PostgreSQL Adapter를 `AUGMENT`한다. gbrain은 고정 commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT)의 replay 패턴만 `REFERENCE_ONLY`로 유지한다. 새 OSS·Migration·Schema는 없다. 되돌리기는 검증기 코드와 음성 테스트를 이전 커밋으로 복귀하는 것이다.

이 보강은 저장된 AI Candidate·VP history에서 수렴 여부를 더 엄격히 검사한다. 원본 Asset부터 Transformation, 실제 DeepSeek 주장 추출·관계 판단, 새 공간 재빌드, 답변까지 독립 재실행하는 VP-02 기준은 아직 통과하지 않았다. 전체 TypeScript 검사도 이번 파일에서는 오류가 없고, 기존 untracked `tests/contract/ts7-cross-section-acceptance.contract.test.ts`의 구형 계약 타입 오류로 계속 실패한다.

## 2026-09-29 실제 DeepSeek 제품 경로 검증

테스트 전용 격리 PostgreSQL DB에서 Shotgun 브라우저의 Sources 화면으로 서로 충돌하는 공개 합성 Markdown 두 건을 투입했다. Stage 2~4 추출과 VP 관계 작업에 실제 설정된 DeepSeek adapter를 연결하고, 주장·관계 작업이 끝난 뒤 제품 Ask 화면에서 같은 주제로 질문했다. 운영 DB에는 Source나 VP 데이터를 쓰지 않았다. Vault의 설정 자격 증명은 테스트 프로세스 안의 임시 메모리 Vault로만 전달했고, 출력·보고서에는 비밀을 기록하지 않는다.

실제 결과:

- 주장 2개가 저장되고 `CONTRADICTS` 관계 1개가 현재 조회에 반영됐다.
- 관계 대기 작업 0건을 확인한 뒤 질문했고, 답변은 `42`와 `43` 양쪽을 설명하며 인용 링크 2개를 표시했다.
- 질문 전후 독립 읽기 전용 재생 검사는 SourceVersion·Stage 3·Candidate·Evidence·VP 원장·현재 조회가 일치한다고 판정했다 (`replayMatches=true`).
- 첫 실행에서 관계 갱신 도중 제출된 질문 결과는 Ask의 epoch 일관성 경계가 게시를 거부했다. 브라우저 인수 흐름은 관계 작업 완료를 확인한 뒤 질문하도록 조정했고, 재실행은 통과했다.

재실행 명령과 결과:

```powershell
$env:VP_LIVE_DEEPSEEK='1'; npm run frontend:test:e2e -- tests/browser/vp-deepseek-full-flow.live.spec.ts --reporter=line
```

결과는 Chromium 1건 통과, `activeAssertions=2`, `activeRelations=1`, `pendingRelationJobs=0`, `answerCitations=2`, `replayMatches=true`다. 같은 검증에서 VP 원장 누락·관계 우선순위 DB 테스트 2건과 실제 DeepSeek 추출 재시도 통합 테스트 1건도 통과했다. 추출 재시도는 API 1회, 입력 252 tokens, 출력 58 tokens를 사용했고 두 번째 같은 명령은 저장된 출력을 재사용했다. 구현·검증 코드는 `main@49455929`에 있다.

이번 결과는 두 합성 문서로 실행한 실제 증분 제품 흐름의 통과 증거다. 대표 Golden Corpus 품질·비용, Source 수정 및 정책 변경 뒤의 증분 동등성, 저장 원문에서 독립적으로 모든 처리 단계를 다시 구축한 결과와 기존 증분 결과의 비교는 검증하지 않았다. 따라서 VP-02는 계속 열려 있고 이 테스트만으로 VP 완료를 선언하지 않는다. 테스트 보강은 기존 PostgreSQL·DeepSeek Adapter와 VP Port를 사용하며 OSS 채택·Migration·Schema 변경은 없다. 롤백은 테스트 전용 옵션·검증 파일을 되돌리는 것이며 운영 데이터 변경은 없다.

변경한 브라우저 fixture·live test·통합 test의 ESLint, 포맷, 대상 파일 TypeScript 검사와 `git diff --check`는 통과했다. 전체 `npm run typecheck`는 현재 작업과 무관한 untracked `tests/contract/ts7-cross-section-acceptance.contract.test.ts`의 오래된 계약 타입 오류로 여전히 실패한다.
