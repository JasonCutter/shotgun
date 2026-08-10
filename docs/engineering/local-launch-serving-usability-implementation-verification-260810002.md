# LPA-WP4 A2 Product Implementation — Verification Evidence

- **id**: LPA-WP4-A2-VERIFICATION-260810002
- **classification**: CANONICAL
- **status**: COMPLETE
- **status_authority**: FINAL_AFTER_MERGE
- **frozen_ir**: `docs/implementation/local-launch-serving-usability-implementation-request-260810001.md` (FROZEN / ACCEPTED)
- **a1_head**: `2a2193c0ddaeee0024dc9d1c20c609518f79f019`
- **implementation_head** (stable technical authority): `56a698c24dbfa4ea90681fc1abe8691cd2acfe26`
- **ci_authority**: #756 SUCCESS (Quality / Frontend / Required Gates)
- **correction_round1_head**: `36a2886ac7c9ce37912aa5781e191d4ebc574a83`
- **correction_round1_ci**: #761 SUCCESS (run 31398793806)
- **pr**: #85 (MERGED)
- **merge_commit**: `c4ea36817aeb98823873f9b1c005cf77eea30dd8`
- **canonical_main**: `c4ea36817aeb98823873f9b1c005cf77eea30dd8`
- **post_merge_main_ci**: #762 SUCCESS (run 31399757169, event=push)

> Self-referential metadata (`final_branch_head` / “final CI”)는 더 이상 authority로
> 사용하지 않는다 (C5). #757~#760은 evidence-document CI churn이며 기술 authority로
> 승격하지 않는다. Correction commit SHA와 #761은 Governance Closure에서 정당한
> governance record로 기록한다 (GPT 승인, C5/C6).

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

- **#756 SUCCESS** — implementation head `56a698c24dbfa4ea90681fc1abe8691cd2acfe26` (PR #85)
  - Quality: success / Frontend: success / Required Gates: success
- evidence-document CI churn (non-authoritative, #757~#760): #757 FAILED(prettier
  format만, 즉시 수정) · #758~#760 SUCCESS — 기술 authority로 사용하지 않는다.
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

## 10. Review History (append-only)

### GPT A2 Review — 2026-08-10 · **CHANGES_REQUIRED** (PR #85 merge 금지)

- Correction Round 1 authorized. 사유:
  1. Frozen launch verification incomplete (focused verification 부족)
  2. browser-open failure detection incomplete (`spawnSync` 반환값 무시)
  3. startup failure graceful cleanup incomplete (application handle 생성 후
     `close()` 없이 즉시 종료)
  4. CI metadata chase governance violation
- Correction Round 1 범위: C1 launch helper 추출 / C2 startup failure cleanup /
  C3 frozen focused verification closure / C4 static-serving tests 유지 / C5
  evidence governance / C6 CI policy / C7 scope 유지.

### GPT Correction Round 1 Review — 2026-08-10 · **ACCEPTED**

- LPA-WP4 A2 Correction Round 1 **ACCEPTED**. PR #85 **READY TO MERGE**.
- 검토 근거: exact-head CI #761 SUCCESS, 새 focused tests 18개 (taxonomy 8종 /
  cleanup exactly-once / ordering / readiness-before-browser / `--no-open` /
  browser failure non-fatal / SIGINT·SIGTERM exactly-once), metadata-chase 중단,
  로컬 PostgreSQL 성공 smoke + restart persistence marker 보존.

## 11. Governance Closure (2026-08-10)

- **LPA-WP4 A2 Correction Round 1 GPT Review: ACCEPTED**
- **PR #85 MERGED** — merge commit `c4ea36817aeb98823873f9b1c005cf77eea30dd8`
- current canonical main: `c4ea36817aeb98823873f9b1c005cf77eea30dd8`
- post-merge main CI #762 / run 31399757169 / SUCCESS (event=push; Quality /
  Frontend / Required Gates)
- LPA-D01~D14: **CLOSED**
- LPA-AC-01~10: **CLOSED**
- **LPA-WP4 status = COMPLETE**
- **status authority = FINAL_AFTER_MERGE**
- 이력: A0 ACCEPTED / COMPLETE · A1 FROZEN / ACCEPTED · A2 initial review
  CHANGES_REQUIRED (보존) · Correction Round 1 ACCEPTED
- 기존 #746~#761 재실행 없음. post-merge CI 번호를 다시 기록하는 후속 commit 없음.

## 12. GPT 보고용 요약

- Implementation head (authority): `56a698c24dbfa4ea90681fc1abe8691cd2acfe26`
- CI authority: #756 SUCCESS
- static serving / launch contract / shutdown 검증 통과
- docs validation PASS
- Product code 변경 확인 완료 (Product Domain module, DB schema 변경 없음)
- LPA-WP4 COMPLETE / FINAL_AFTER_MERGE
