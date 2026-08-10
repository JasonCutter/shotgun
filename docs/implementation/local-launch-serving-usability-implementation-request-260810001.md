---
id: LOCAL-LAUNCH-SERVING-USABILITY-IR-260810001
classification: CANONICAL
status: FROZEN / ACCEPTED
verification_gate: LOCAL-LAUNCH-SERVING-USABILITY
created_at: 2026-08-10
subject_base: 53f3d4f63a2d9b97d3d99f6377e367385d52dc2d
canonical_main: 53f3d4f63a2d9b97d3d99f6377e367385d52dc2d
a0_audit: docs/engineering/local-launch-serving-usability-gap-audit-260810001.md
a0_head: 1d36ee483f605a8656737ac37e60c865efd5fcba
a0_verdict: ACCEPTED / COMPLETE (GPT 2026-08-10; Contract Freeze AUTHORIZED)
a1_head: 2a2193c0ddaeee0024dc9d1c20c609518f79f019
a1_verdict: ACCEPTED / FROZEN (GPT 2026-08-10; Product Implementation AUTHORIZED)
a2_status: COMPLETE (FINAL_AFTER_MERGE; see closure record)
next_gate: LPA-WP5 Backup / Restore Owner Workflow (after Governance Closure ACCEPTED / FINAL_AFTER_MERGE)
---

# Shotgun — Local Launch / Serving Usability Implementation Request (LPA-WP4, Frozen — ACCEPTED)

## 0. Authority

- Repository: `JasonCutter/shotgun`, Canonical branch: `main`
- Canonical main: `53f3d4f63a2d9b97d3d99f6377e367385d52dc2d`
- LPA-WP4 A0 audit head: `1d36ee483f605a8656737ac37e60c865efd5fcba`
- A0 verdict: **ACCEPTED / COMPLETE** (GPT 2026-08-10) — Contract Freeze /
  Implementation Request 진행 AUTHORIZED
- LPA-WP4 A1 frozen head: `2a2193c0ddaeee0024dc9d1c20c609518f79f019`
- A1 verdict: **ACCEPTED / FROZEN** (GPT 2026-08-10) — LPA-WP4 A2 Product
  Implementation AUTHORIZED (Appendix A 참조)
- A2는 이 Frozen IR의 LPA-D01~D14 / LPA-AC-01~10 계약에 따라 구현한다.

## 1. Goal

현재 `DEVELOPER_RUNNABLE` 상태의 Shotgun을 `LOCAL_PRODUCT_USABLE`로 전환하는
구현 계약을 동결한다. 최종 사용자 목표는 개발 명령 여러 개를 직접 조합하지
않고 `npm run launch` 하나로 Shotgun을 로컬 개인 애플리케이션으로 시작하고
종료하는 것이다.

## 2. Architecture Decisions — FREEZE (LPA-D01 ~ LPA-D14)

### LPA-D01 — Canonical owner launch command

- Canonical owner-facing 명령은 **`npm run launch`**.
- 일반 사용자는 `npm run dev`, `npm run dev:web`, Vite dev server, 별도
  Backend terminal을 직접 실행하지 않는다.
- `dev` / `dev:web`은 개발자 workflow로 그대로 유지한다.

### LPA-D02 — Single-process normal runtime

- 일반 Local Product runtime은 **Built SPA + Fastify Backend = same process /
  same origin**으로 고정한다.
- 장기 실행 Frontend child process를 만들지 않는다.
- LPA-WP4의 목적은 generic multi-process supervisor가 아니다. 필요한
  launcher는 얇은 owner-entry orchestration만 담당한다.

### LPA-D03 — SPA serving

- SPA serving은 **`@fastify/static` → ADOPT**, 초기 dependency version
  **10.1.2 exact pin**.
  - Fastify 5와 공식 호환. custom static-file security/path handling 재구현
    방지. 2026-07 공개된 non-canonical-path 보안 문제(<=10.1.1 영향)의
    patched version.
- 수동 static-file server 구현은 **REJECT**.

### LPA-D04 — Same-origin boundary

- Owner endpoint 기본값: `http://127.0.0.1:${PORT}` (기본 PORT는 기존 계약대로
  **3000** 유지).
- SPA와 Product API는 같은 origin에서 제공.
- 기존 API client의 상대 URL과 same-origin cookie semantics를 변경하지 않는다.
- 외부 network bind를 자동 허용하지 않는다.

### LPA-D05 — SPA fallback boundary

- SPA fallback은 browser UI route에만 적용.
- 다음 reserved namespace는 절대 `index.html`로 fallback하지 않는다:
  `/api`, `/api/*`, `/product-api`, `/product-api/*`, `/health`.
- 존재하지 않는 API 경로가 HTML 200으로 바뀌어서는 안 된다. 기존
  API/security/failure semantics를 유지한다.

### LPA-D06 — Frontend build policy

- `npm run launch`는 normal launch 전에 `npm run frontend:build`를 수행.
- 현재 단계에서는 stale build detection/cache layer를 만들지 않는다. 목표는
  owner가 별도 build 명령을 기억하지 않아도 항상 현재 source와 일치하는 built
  SPA를 사용하게 하는 것이다.
- Launch는 다음을 수행하지 않는다: `npm ci`, dependency installation,
  DB reset, destructive bootstrap.

### LPA-D07 — Database policy

- Local launch는 PostgreSQL을 자동 생성하거나 `docker compose up`을 암묵
  수행하지 않는다.
- Stage 0 bootstrap은 setup responsibility로 계속 분리.
- Launch 시작 시 기존 non-destructive DB verification capability를 재사용.
- DB unavailable / schema invalid이면 Product를 시작하지 말고 actionable
  failure를 출력.
- 메시지는 최소 다음 corrective action을 구분:
  - First-time setup: `npm run bootstrap`
  - DB container가 중지된 경우: `docker compose up -d --wait db`
  - schema/migration 문제: `npm run db:migrate` 후 `npm run db:verify`
- Launch 자체는 `db:reset`을 절대 호출하지 않는다.

### LPA-D08 — Runtime composition boundary

- 가능하면 production composition을 재사용 가능한 start/close boundary로
  추출: `startShotgunApplication(...)` 또는 동등한 bounded runtime API.
- Owner launcher와 기존 Backend entrypoint가 동일 composition을 재사용.
- Product Domain logic을 launcher로 복제하지 않는다.

### LPA-D09 — Safe shutdown

- Backend는 SIGINT / SIGTERM을 명시적으로 처리.
- 종료 sequence: signal → accepting work 중단 → `server.close()` → 기존
  Fastify `onClose` → existing `closeResources()` → Ask worker stop → Sources
  runtime cleanup → PostgreSQL pool end → process exit.
- Shutdown은 idempotent해야 한다. 두 signal/close path가 중첩되어 resource
  close가 이중 실행되지 않게 한다.
- 일반 runtime에는 장기 실행 Frontend child process가 없으므로 orphan
  frontend process 문제를 구조적으로 제거한다.

### LPA-D10 — Readiness

- Browser open은 단순 process spawn 직후 수행하지 않는다. 최소 readiness:
  1. Backend listen 성공, 2) `GET /health` 성공, 3) `GET /`이 SPA HTML로
     성공 — 세 조건 뒤에만 browser open.
- readiness failure는 timeout 후 actionable failure로 종료. 기본 timeout은
  구현 상수로 둘 수 있으며 불필요한 configuration surface를 만들지 않는다.

### LPA-D11 — Browser open

- 기본 `npm run launch`는 readiness 후 기본 browser를 연다.
- Node built-in `child_process` + platform command 사용 (Windows OS
  browser-open command / macOS `open` / Linux `xdg-open`). 새 browser-open
  OSS dependency는 추가하지 않는다.
- Browser open 실패는 non-fatal: Shotgun server는 계속 실행, 사용 가능한
  local URL을 명확히 출력, owner가 수동으로 열 수 있게 한다.
- Headless/automation 검증을 위해 `npm run launch -- --no-open` 지원.

### LPA-D12 — Startup failure taxonomy

최소 다음 owner-facing failure category를 고정:
`ENV_CONFIGURATION_INVALID`, `DATABASE_UNAVAILABLE`,
`DATABASE_SCHEMA_INVALID`, `PORT_UNAVAILABLE`, `SPA_BUILD_FAILED`,
`SPA_ASSETS_UNAVAILABLE`, `BACKEND_START_FAILED`, `READINESS_TIMEOUT`.
각 오류는: 무엇이 실패했는가 / 무엇을 확인해야 하는가 / 어떤 명령을 실행하면
되는가를 포함. stack trace만 보여주는 것을 정상 owner UX로 간주하지 않는다.

### LPA-D13 — Restart / state preservation

- Launch / shutdown / restart는 persistent Product data의 lifecycle과 분리.
- Launch 과정에서 다음 금지: DB reset, Project recreation, Canonical rewrite,
  automatic destructive migration, owner data deletion.
- 정상 종료 후 재시작하면 기존 Project / Canonical / Source / Review 등
  persistent state가 유지되어야 한다.

### LPA-D14 — No ADR

- 이번 구현은 기존 Fastify / Node / local assembly의 bounded usability
  extension이다. 새 system architecture boundary를 만들지 않으므로
  **ADR: NOT_REQUIRED**로 고정.
- 새로운 구조적 요구가 실제 구현 중 발견되는 경우에만 GPT에 Amendment 후보를
  제출한다. 임의 ADR 생성 금지.

## 3. Frozen Acceptance Criteria (LPA-AC-01 ~ LPA-AC-10)

| #         | 기준                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| LPA-AC-01 | `npm run launch` 하나로 normal Local Product 시작 가능. 별도 Backend/Frontend terminal 불필요.                               |
| LPA-AC-02 | Backend와 built SPA가 하나의 loopback origin에서 사용 가능.                                                                  |
| LPA-AC-03 | Backend health + SPA readiness가 성공한 뒤에만 browser open 시도. browser-open 자체 실패는 Product failure가 아님.           |
| LPA-AC-04 | env / DB / schema / port / build / assets / backend / readiness 실패가 owner-actionable message로 구분.                      |
| LPA-AC-05 | Ctrl+C 및 SIGTERM이 `server.close()`와 existing resource cleanup을 거쳐 종료.                                                |
| LPA-AC-06 | 정상 runtime 종료 뒤 LPA-WP4가 소유한 장기 실행 child process가 남지 않음. 일반 serving은 별도 Vite process를 생성하지 않음. |
| LPA-AC-07 | 정상 launch → use → shutdown → relaunch 뒤 persistent Product state가 유지.                                                  |
| LPA-AC-08 | Launch는 `db:reset`, destructive bootstrap, `npm ci`를 암묵 실행하지 않음.                                                   |
| LPA-AC-09 | normal Local Product 사용에 Vite development server 불필요.                                                                  |
| LPA-AC-10 | 기존 loopback/security/authority boundary 불변. 특히 unknown API routes가 SPA fallback에 흡수되지 않음.                      |

## 4. Expected Implementation Scope

Implementation candidate 범위를 다음 수준으로 제한한다.

- root `package.json` (`launch` script)
- `scripts/launch-local.ts`
- 필요 시 small launch helper module
- `assemblies/shotgun-app/src/main.ts`
- `assemblies/shotgun-app/src/server.ts`
- 필요 시 production runtime composition extraction file
  (`startShotgunApplication(...)`)
- `@fastify/static` dependency + lockfile (10.1.2 exact pin)
- focused LPA-WP4 tests
- README local launch instructions
- 필요 최소 engineering evidence

Product Domain modules와 DB schema/migrations는 기본적으로 **scope 밖**이다.
Migration이 필요하다고 판단되면 즉시 **STOP**하고 Amendment 후보로 보고한다.

## 5. Verification Contract

- 기존 전체 Product 테스트를 습관적으로 재실행하지 않는다. 새 구현으로 생기는
  delta만 검증한다.
- 최소 focused verification:
  - Static SPA serving: `/` → SPA; built asset → served; browser deep route →
    SPA fallback; unknown `/api/*` → SPA HTML 아님; unknown
    `/product-api/*` → SPA HTML 아님; `/health` 기존 semantics 유지.
  - Launch contract: canonical `npm run launch`; build failure classification;
    DB verification failure classification; readiness success/failure;
    browser open after readiness; `--no-open`; browser-open failure
    non-fatal.
  - Shutdown: SIGINT/SIGTERM close path; existing `closeResources`
    exactly-once semantics; no owned persistent child process.
  - Restart preservation: focused persisted-state smoke only; launch가 DB
    reset하지 않는다는 증거.
  - Existing affected tests: 실제 touched boundary에 해당하는 기존 test만
    실행. Cross-Phase 전체 suite 재실행 금지.
- Implementation exact head에서 normal push로 자동 실행되는 CI를 authority로
  사용한다. 동일 exact head CI 재실행 금지, manual duplicate CI 금지, empty
  commit 금지, CI 번호 기록 전용 commit 금지.

## 6. Contract Freeze Deliverable (A1 완료 보고)

- exact head
- A0 status / subject_base normalization 결과
- Frozen IR path
- LPA-D01 ~ LPA-D14
- LPA-AC-01 ~ LPA-AC-10
- OSS decision (`@fastify/static` 10.1.2 exact pin — ADOPT)
- ADR decision (`NOT_REQUIRED`)
- implementation file scope
- focused test plan
- excluded scope
- unresolved items — 목표 **NONE**
- Product implementation이 아직 시작되지 않았음
- docs validation 결과

GPT가 이 Frozen IR을 ACCEPTED하기 전에는 Product implementation을
시작하지 않는다. LPA-WP5 Backup/Restore와 LPA-WP6 Final Local Acceptance는
계속 시작하지 않는다.

## 8. A1 Acceptance Record (append-only)

- **2026-08-10 — GPT ACCEPTED / FROZEN** (page: Make Shotgun)
  - A1 head: `2a2193c0ddaeee0024dc9d1c20c609518f79f019`
  - A1 verdict: LPA-WP4 Contract Freeze 승인 — LPA-D01~D14, LPA-AC-01~10을
    구현 계약으로 동결.
  - 다음 게이트: LPA-WP4 A2 Product Implementation AUTHORIZED.
  - LPA-WP5 Backup/Restore, LPA-WP6 Final Local Acceptance는 A2가
    ACCEPTED되기 전까지 시작하지 않는다.

## 7. Excluded scope (고정)

- Electron / Tauri / desktop installer / OS service / system tray /
  auto-update / cloud deployment / container orchestration / 새 packaging
  platform.
- Launch의 암묵적 DB auto-start(`docker compose up`) / DB reset /
  destructive bootstrap / `npm ci`.
- 장기 실행 Frontend child process / generic multi-process supervisor.
- Vite dev server를 일반 사용의 기본 serving으로 사용.
- Product Domain module 변경 / DB schema·migration 변경(필요 시 STOP →
  Amendment 후보).
- LPA-WP5 Backup/Restore, LPA-WP6 Final Local Acceptance.

## 9. Closure Record (append-only)

- **2026-08-10 — LPA-WP4 Product Implementation COMPLETE / FINAL_AFTER_MERGE**
  - LPA-WP4 A2 Correction Round 1 GPT Review: **ACCEPTED**.
  - PR #85 **MERGED** — merge commit `c4ea36817aeb98823873f9b1c005cf77eea30dd8`
  - post-merge main CI #762 / run 31399757169 / SUCCESS (event=push)
  - LPA-D01~D14: **CLOSED** · LPA-AC-01~10: **CLOSED**
  - canonical main: `c4ea36817aeb98823873f9b1c005cf77eea30dd8`
  - 상세: `docs/engineering/local-launch-serving-usability-implementation-verification-260810002.md`
  - 다음 게이트: LPA-WP5 Backup / Restore Owner Workflow (Governance Closure가
    ACCEPTED / FINAL_AFTER_MERGE가 된 뒤에만 시작).
