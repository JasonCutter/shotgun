# Stage 0 OSS Integration Review

- 재검증일: 2026-07-16
- 대상: Repository and Engineering Foundation
- OSS Gate: **COMPLETE**
- 상세 등록부: [`oss-source-registry.json`](../oss-source-registry.json)

## 완료 판정

**Stage 0: COMPLETE**

기존 개발 환경과 CI를 유지하면서, OSS-first 원칙에서 빠져 있던 고정 버전, 라이선스,
보안 검토, 재사용 경계, 교체 방법을 저장소에 기록하고 자동 검사에 연결했다.

## 핵심 결정

| 후보                  | 결정             | 고정 기준                     | 적용 범위                              |
| --------------------- | ---------------- | ----------------------------- | -------------------------------------- |
| PostgreSQL            | `ADOPT`          | `16.14-alpine` + image digest | 개발 DB와 Stage 2 metadata             |
| Ajv                   | `ADOPT`          | npm lock `8.20.0`             | JSON Schema 기반 Contract 검증         |
| OpenTelemetry         | `DEFER`          | 검토 버전 `1.9.1`             | 외부 trace exporter가 필요할 때        |
| gbrain                | `REFERENCE_ONLY` | commit `a25209b...`           | Minion, migration, Page/Fact 경계 참고 |
| lucasastorian/llmwiki | `DEFER`          | commit `ad626a3...`           | watcher/reconcile과 변환 후보          |
| ddsyasas/llm-wiki     | `REFERENCE_ONLY` | commit `e8dd69e...`           | Intake와 Action Home UX                |
| Inkeep OpenKnowledge  | `REFERENCE_ONLY` | commit `f2834c2...`           | editor, graph, activity, diff UX       |

## 검증 근거

- PostgreSQL 이미지는 `16.14-alpine`의 실제 digest로 고정했다.
- 설치된 npm 의존성은 `package-lock.json`의 실제 해석 버전을 등록부와 대조한다.
- `npm audit --audit-level=high`를 로컬과 CI의 필수 검사로 둔다.
- CI에서 CycloneDX SBOM을 생성하고 JSON 파싱까지 확인한다.
- 네 개의 Reference 저장소는 URL, commit, license, 적용 경계와 재평가 시점을 등록했다.
- 라이선스가 현재 제품 경계와 충돌하거나 정확한 채택 버전이 없는 후보는 코드 채택 상태로
  올리지 않았다.

## 자동 Gate

`npm run oss:verify`는 다음을 검사한다.

1. 필수 Reference와 결정값 존재
2. 후보별 URL, pin, license, security, maintenance, boundary, replacement 기록
3. Ajv 등록 버전과 `package-lock.json` 일치
4. PostgreSQL 등록 digest와 `compose.yaml` 일치
5. Stage 0~2 OSS 검토 문서의 완료 상태

이 검사는 `npm run check`에 포함되어 이후 Stage가 OSS 검토 없이 직접 구현되는 것을
차단한다.

## 경계와 Rollback

- 등록부는 OSS 자체가 아니라 Shotgun의 채택 결정을 기록한다.
- PostgreSQL은 Repository Port 뒤에, Ajv는 `SchemaRegistry` 뒤에 둔다.
- OpenTelemetry와 외부 Queue는 아직 설치하지 않는다.
- PostgreSQL digest 변경은 등록부와 Compose를 함께 되돌리면 된다.
- Ajv 교체 시 같은 Schema Registry와 Connector Contract Test를 통과해야 한다.

## Gate 체크

- [x] 개발 환경과 Bootstrap 재현 가능
- [x] PostgreSQL exact image pin
- [x] 4개 Reference 저장소의 commit과 license 기록
- [x] npm vulnerability audit
- [x] SBOM 생성 경로
- [x] 자동 OSS Gate
- [x] Architecture, Secret, Contract 검사와 연결

## 최종 실행 증거

| 검사                | 결과                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run check`     | PASS                                                                      |
| `npm run oss:audit` | PASS, 취약점 0건                                                          |
| CycloneDX SBOM      | 1.5, 구성요소 220개                                                       |
| SBOM SHA-256        | `bbd50bfccf8896e57c830c31b1bd53828977f49c612d071f29dd4ac95a7f8d35`        |
| PostgreSQL runtime  | 16.14                                                                     |
| PostgreSQL image    | `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` |
| `npm run db:reset`  | PASS                                                                      |
| `npm run db:verify` | PASS                                                                      |
