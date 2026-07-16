# Stage 0 개발 환경

## 완료 상태

**COMPLETE — OSS Gate 재검증 완료**

상세 결정과 근거는
[Stage 0 OSS Integration Review](../implementation/stage-validations/stage-0-oss-integration-review.md)와
[OSS Source Registry](../implementation/oss-source-registry.json)에 기록한다.

## 준비물

- Node.js 24 이상과 npm 11 이상
- Docker Desktop (PostgreSQL 실행용)

## 처음 실행

PowerShell에서 다음 명령을 실행한다.

```powershell
Copy-Item .env.example .env
npm run bootstrap
npm run dev
```

`http://localhost:3000/health`를 열어 아래처럼 확인한다.

```json
{
  "status": "ok",
  "modules": ["stage1.ping", "stage1.pong"],
  "capabilities": ["ping-command", "pong-query"]
}
```

## 자주 쓰는 명령

| 목적                          | 명령                       |
| ----------------------------- | -------------------------- |
| 전체 품질 검사                | `npm run check`            |
| OSS 등록부·고정 버전 검사     | `npm run oss:verify`       |
| 의존성 취약점 검사            | `npm run oss:audit`        |
| CycloneDX SBOM 출력           | `npm run oss:sbom`         |
| 단위·Architecture Test        | `npm test`                 |
| Contract Test                 | `npm run test:contract`    |
| Integration Test              | `npm run test:integration` |
| DB migration 적용             | `npm run db:migrate`       |
| 개발 DB Schema 삭제 후 재생성 | `npm run db:reset`         |
| DB Bootstrap 확인             | `npm run db:verify`        |
| 서버 실행                     | `npm run dev`              |

`npm run db:reset`은 로컬 개발용 `runtime` Schema를 삭제한다. 실제 운영 DB에는 사용하지 않는다.

## 환경변수와 Secret

- 실제 값은 `.env`에만 저장하고 Git에 추가하지 않는다.
- `.env.example`에는 실행 가능한 로컬 예시값만 둔다.
- Secret을 로그, 오류 메시지, 테스트 출력에 넣지 않는다.
- `npm run secret:scan`은 알려진 API Token·Private Key 형식을 검사한다. 새 Secret 공급자를 도입하면 검사 규칙도 함께 추가한다.

## 폴더 구조

```text
packages/       # Kernel과 공유 경계
modules/        # 도메인 모듈
adapters/       # DB·외부 시스템 구현
assemblies/     # 모듈을 조립하는 Application
tests/          # Unit과 Architecture Test
db/migrations/  # PostgreSQL Schema 변경
scripts/        # DB·비밀값·Architecture 검사
```

## Stage 0 범위 밖

Knowledge Flow, 실제 Command/Event 계약, Queue, AI Provider, ORM은 다음 Stage에서 도입한다.

## OSS-first 재검증

- PostgreSQL은 `16.14-alpine` image digest로 고정한다.
- JSON Schema 검증은 `package-lock.json`에 고정된 Ajv `8.20.0`을 사용한다.
- gbrain, lucasastorian/llmwiki, ddsyasas/llm-wiki, OpenKnowledge의 baseline commit과
  license를 Source Registry에 등록한다.
- OpenTelemetry는 외부 exporter가 필요한 시점까지 `DEFER`한다.
- CI는 취약점 검사, SBOM 생성, Source Registry 자동 Gate를 실행한다.
