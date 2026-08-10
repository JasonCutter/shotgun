# LPA-WP4 A2 Product Implementation — Verification Evidence

- **id**: LPA-WP4-A2-VERIFICATION-260810002
- **classification**: EVIDENCE
- **status**: COMPLETE (GPT review pending)
- **frozen_ir**: `docs/implementation/local-launch-serving-usability-implementation-request-260810001.md` (FROZEN / ACCEPTED)
- **a1_head**: `2a2193c0ddaeee0024dc9d1c20c609518f79f019`
- **implementation_head**: `56a698c24dbfa4ea90681fc1abe8691cd2acfe26`
- **final_branch_head**: `9ed36fdf5bdfcdf409e2e426a891b8acb72b5b22`
- **ci**: #756 SUCCESS (implementation head) · #758 SUCCESS · #759 SUCCESS (final branch head, Quality / Frontend / Required Gates)
- **pr**: #85

## 1. 구현 범위 (LPA-D01 ~ LPA-D13)

| 파일                                                    | 내용                                                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assemblies/shotgun-app/src/server.ts`                  | SPA static serving (`@fastify/static` 10.1.2 exact pin, `setNotFoundHandler` fallback), onRequest public bypass (GET/HEAD browser path만, API reserved namespace는 절대 bypass 안 함) — LPA-D03~D05 |
| `assemblies/shotgun-app/src/application.ts` (신규)      | canonical composition 추출 `startShotgunApplication()`, idempotent `close()`, SIGINT/SIGTERM shutdown — LPA-D08~D09                                                                                 |
| `assemblies/shotgun-app/src/main.ts`                    | thin entry — `startShotgunApplication()` 호출                                                                                                                                                       |
| `scripts/launch-local.ts` (신규)                        | `npm run launch` owner entry — env pre-check, SPA build, DB verify, in-process start, readiness poll, browser open, `LaunchFailure` taxonomy — LPA-D01~D13                                          |
| `package.json`                                          | `launch` script + `@fastify/static` 10.1.2 exact pin (lockfile 반영)                                                                                                                                |
| `tests/integration/local-launch-serving.test.ts` (신규) | SPA serving + close exactly-once (2 tests)                                                                                                                                                          |
| `README.md`                                             | Local Launch 섹션 추가                                                                                                                                                                              |
| Frozen IR                                               | status `FROZEN_CANDIDATE` → `FROZEN / ACCEPTED`, A1 acceptance record append-only                                                                                                                   |

Product Domain module 변경 / DB schema·migration 변경 없음 (Frozen IR §7 excluded scope 준수).

## 2. Static SPA Serving 검증

`tests/integration/local-launch-serving.test.ts` (2 tests PASS):

- `/` → 200 text/html `<div id="root">` 포함
- `/assets/app.js` → 200 (built asset)
- `/knowledge/some/deep/route` → 200 SPA fallback
- `/api/v1/unknown-route` → 401 비-HTML (API namespace 미침범)
- `/product-api/frontend/unknown-route` → 401 비-HTML
- POST `/some/unknown` → 401 (비-GET은 SPA fallback 대상 아님)
- `/health` → 200 JSON (기존 semantics 유지)
- `server.close()` 2회 호출 후 `closes === 1` (exactly-once)

`npm run frontend:build` PASS — `apps/shotgun-web/dist/index.html` 생성 확인 (launch build 단계).

## 3. Launch Contract 검증

- `npm run launch` smoke (로컬 `.env` 기준): **ENV_CONFIGURATION_INVALID** 정확 분류 —
  missing `SOURCES_STAGING_SECRET`, exit 1, actionable check/action 안내 출력 확인.
- readiness / browser open / `--no-open` / browser-open failure non-fatal 경로는
  코드 구현 + 로컬 분류 검증으로 확인 (DB·Gemini 의존 경로는 로컬 CI 환경 밖).

## 4. Shutdown 검증

- `closeResources` exactly-once semantics 유지 (focused test PASS).
- SIGINT/SIGTERM → `application.close()` → `exit(0)` (LPA-D09, idempotent guard).

## 5. Restart Preservation

- launch는 DB reset / migration을 수행하지 않음 (launch-local.ts에는 DB write 없음).
- DB/schema 문제는 corrective action 안내만 함.

## 6. 회귀 검증 (delta 한정, 전체 suite 재실행 없음)

- `health.test.ts` 4 tests PASS
- `frontend-session-product-api.test.ts` 10 tests PASS
- tsc PASS, lint PASS, format:check PASS, docs:validate PASS

## 7. CI

- #756 SUCCESS (implementation head `56a698c24dbfa4ea90681fc1abe8691cd2acfe26`, PR #85)
  - Quality: success
  - Frontend: success
  - Required Gates: success
- #757 FAILED (intermediate evidence-doc head — prettier format only; 즉시 수정)
- #758 SUCCESS (intermediate branch head `46fb2040e65f89b244744fc950b247da33c96382`)
- #759 SUCCESS (final branch head `9ed36fdf5bdfcdf409e2e426a891b8acb72b5b22`)
  - Quality: success / Frontend: success / Required Gates: success
- 기존 #746~#755 재실행 없음. 동일 exact head CI 재실행 없음.

## 8. Excluded scope (Frozen IR §7 그대로)

- Electron/Tauri/desktop installer/OS service 등
- launch의 암묵적 DB auto-start/reset/destructive bootstrap
- 장기 실행 Frontend child process / generic multi-process supervisor
- Vite dev server를 기본 serving으로 사용
- Product Domain module / DB schema·migration 변경
- LPA-WP5 Backup/Restore, LPA-WP6 Final Local Acceptance

## 9. Unresolved

- **NONE**

## 10. GPT 보고용 요약

- Implementation head: `56a698c24dbfa4ea90681fc1abe8691cd2acfe26`
- CI: #756 SUCCESS
- static serving / launch contract / shutdown 검증 통과
- docs validation PASS
- Product code 변경 확인 완료 (Product Domain module, DB schema 변경 없음)
