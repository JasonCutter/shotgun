# VP-11 — Windows Canonical 소스 설치·빌드 검증

2026-10-16 KST. **WINDOWS_CANONICAL_DEPENDENCY_INSTALL_AND_BUILD_PASS**.
이 판정은 운영 앱 설치·활성화나 전체 VP 최종 인수 완료가 아니다.

## 1. 새로 검증한 범위

[PR390](https://github.com/JasonCutter/shotgun/pull/390)의 Canonical merge
`d5503922052320ccb9c7b08500911ccc1d8313d8`, tree
`82c3f8b17ed15e6590c8dba089a792eadfa1bcc3`를 실제 GitHub origin/main에서
새 격리 디렉터리로 가져왔다. Synthetic origin이나 개발 브랜치가 아니다.
실행 host는 Windows `10.0.19045`, win32/x64이며 기존 Node v24.15.0,
npm11.12.1, Git2.54.0.windows.1을 사용했다.

기존 `vp-application-distribution.test.ts`의 runtime allowlist를 재사용하되
**고정된 Git HEAD의 tracked tree만** 열거했다. Partial clone/blob filter와
정확한 파일별 sparse checkout으로 runtime874개를 materialize했다. Tests,
동결 자료·Gold·운영 env/Asset/DB는 checkout하지 않았다. `.env.example`은
기존 빈 key/placeholder를 검사한 sample뿐이며 실제 `.env/.env.test`는 없다.

| 검사                                 | 결과                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| GitHub origin/main HEAD·tree         | 승인 Canonical SHA/tree와 exact 일치                                     |
| 실제 materialized 파일 집합          | 허용 대상 Git tree874개와 exact 일치                                     |
| 각 파일 Git blob ID                  | 874/874 일치; CRLF 변환 없이 Git 원본 bytes 확인                         |
| 설치 후 source SHA-256 재확인        | 874/874 동일                                                             |
| 새 npm cache·node_modules / lockfile | `npm ci --ignore-scripts --no-audit --no-fund` PASS; lockfile441 entries |
| Bootstrap 진입점                     | `npm run bootstrap -- --help` PASS; 도움말만 실행                        |
| Frontend 타입 검사                   | `npm run frontend:typecheck` PASS                                        |
| Frontend 빌드·산출물                 | `npm run frontend:build` PASS; SPA root와 emitted JS 존재                |
| Git tracked/index 상태               | clean                                                                    |

Source manifest digest는
`95725d75dbacbf264a38f0622f0d673bd600b799aa7b763e3886ea91b0e10031`다.
이는 path/mode/Git blob/byte size/SHA-256을 포함하는 이번 manifest 표현의
digest다. 기존 synthetic distribution의 다른 표현/source digest와 동일하다고
주장하지 않는다. Exact 파일·로그 locator와 digest는
[보존 manifest](./windows-canonical-install-manifest.json)에 기록한다.

자식 프로세스에는 명시한 OS/PATH와 임시 npm/Git 설정만 공급했다. AI key,
DB URL, Vault master, 운영 authority, NODE_OPTIONS를 상속하지 않았다.
의존성 lifecycle scripts는 비활성화하고 registry는 기존 public npm으로 한정했다.
운영 디렉터리의 node_modules나 npm cache를 설치 대상으로 재사용하지 않았다.

## 2. 최초 감사 실패와 기존 증거의 구분

Run1은 clone/HEAD/tree까지 성공한 뒤, auditor가 이전 CI runtime file 수875를
최소 기대값으로 재사용해 `selected.length>=875`에서 실패했다. Npm 설치·앱·DB
실행 전이며 원본 script/log/failure를 보존했다. 현재 고정 Canonical tree의
대상은874개임을 실제 `git ls-tree`로 확인했고, Run2는 **정확히874개**와 전체
materialized 경로 집합 및 모든 Git blob ID를 비교한다. Validator/assertion을
제거해 파일 누락을 허용한 보정이 아니다.

기존 CI의 distribution fixture는 tracked 및 untracked working files를 포함하는
별도 synthetic snapshot이며 `sourceSnapshotIncludesLocalChanges=true`를 기록한다.
875번째 파일의 identity는 이번 보존 로그만으로 확정하지 않았다. 따라서
CI artifact 전체가 이번 tracked Canonical runtime과 byte identical이라고
보고하지 않는다. CI의 별도 정상 Fake·recovery 증거는 그 정확한 범위로 재사용한다.

Run2의 npm에는 기존 `node-domexception` deprecation, Vite에는 500kB 초과 chunk
경고가 있다. 명령은 모두 성공했으며 원본 경고를 보존했다. 경고 상한 변경,
임의 dependency upgrade 또는 이번 범위 밖의 bundle 재설계는 하지 않았다.

## 3. 재사용·변경·복구 경계

[ADR-167](../../architecture/adr/ADR-167-canonical-desktop-launcher-repository-and-runtime-identity.md)의
Git/npm/Node 표준 기능, 기존 runtime allowlist, bootstrap 도움말과 Frontend
build를 재사용했다. 기존 NO_RELEVANT_OSS launcher-boundary 결정,
PM2 REJECT/gbrain REFERENCE_ONLY를 변경하지 않았다. 새 installer·supervisor,
runtime dependency, schema migration 또는 권위는 없다. 원격 접속은 public
GitHub/npm 소스·의존성 확보이며 AI provider 호출은0이다.

현재 개발 checkout은 Canonical main에서 후속 로컬 문서 f31eeedc8을 별도
commit으로 재사용했다. 원래 f31 commit/branch와 승인·실패 이력을 보존했다.
운영 `C:/dev/shotgun`, desktop shortcut, Vault/configuration/env 및 DB는 변경하지
않았다. 새 clone/cache/build는 격리 artifact 디렉터리에 남겨 검토 가능하게 한다.
Rollback은 해당 artifact를 보존 정책에 따라 정리하는 것으로 충분하며 운영
schema/정책 rollback은 필요 없다.

## 4. 남은 제품 인수 조건

Docker 엔진이 꺼져 있다는 읽기 전용 확인 결과를 보존했다. 자동 재시작될 수
있는 운영 컨테이너 상태를 확인할 수 없으므로 엔진·컨테이너를 임의로 시작하지
않았다. 정상 앱/worker, PostgreSQL 연결·migration, Windows shortcut 실행과
OS reboot는 이번 검증에서 수행하지 않았다.

기존 [정상 owner Fake 검증](./canonical-owner-fake-proof.md)과
[distribution proof](./reliability-application-distribution-proof.md)의 제품·복구
증거 및 [main CI38844117150](https://github.com/JasonCutter/shotgun/actions/runs/38844117150)의
Quality/Frontend/Required Gates 성공은 재사용한다. 이번 Windows 소스 설치
통과가 이들을 운영 설치·실AI 의미 정확성으로 승격하지 않는다.

남은 조건은 인가된 격리 PostgreSQL에서 이번 설치본의 실제 제품 경로 확인,
별도 승인된 Windows 운영 설치 identity/shortcut/reboot 인수, 외부 독립 의미
검증이다. 기존 가능한 UNKNOWN1과 총10회 실호출 한도 잔여0을 유지한다.
**VP_FINAL_ACCEPTANCE_NOT_COMPLETE / PRODUCTION_HOLD**다.
