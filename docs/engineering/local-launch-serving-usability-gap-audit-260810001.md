---
id: LOCAL-LAUNCH-SERVING-USABILITY-GAP-AUDIT-260810001
classification: CANONICAL
status: lpa_wp4_a0_audit_candidate
verification_gate: LOCAL-LAUNCH-SERVING-USABILITY
created_at: 2026-08-10
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
canonical_main: 53f3d4f63a2d9b97d3d99f6377e367385d52dc2d
governing_stage: LPA-WP4 (Local Launch / Serving Usability) — A0 Gap Audit / Contract Preparation
preceding_gates: Cross-Phase Verification COMPLETE / Governance Closure COMPLETE (FINAL_AFTER_MERGE)
post_closure_main_ci: 755 / run 31388793348 / SUCCESS
next_gate: GPT review of this A0 audit → LPA-WP4 Contract Freeze / Implementation Request
---

# Shotgun — Local Launch / Serving Usability Gap Audit (LPA-WP4 A0)

## 1. Goal

Shotgun은 현재 `DEVELOPER_RUNNABLE` 상태이다. A0의 목표는
`LOCAL_PRODUCT_USABLE`로 전환하기 위해 실제로 부족한 Local Launch /
Serving / Shutdown capability를 **확정**하는 것이다. 최종 사용자 목표는
개발 명령 여러 개를 직접 조합하지 않고 Shotgun을 로컬 개인 애플리케이션으로
시작하고 종료하는 것이다.

이 문서는 LPA-WP4 A0 — Gap Audit / Contract Preparation의 결과이며
**Product implementation을 포함하지 않는다.** A0가 GPT 검토에서
ACCEPTED되기 전에는 LPA-WP4 Product implementation, LPA-WP5(Backup /
Restore), LPA-WP6(Final Local Acceptance)를 시작하지 않는다.

## 2. Canonical Target Scope

검토 대상 capability:

- **Single Start Command**: 하나의 owner-facing 명령으로 Shotgun 전체 시작.
  Backend와 Frontend를 별도 터미널에서 직접 실행하게 하지 않는다.
- **SPA Serving**: 실제 사용 시 Vite development server에 의존하지 않는
  방식을 우선 검토한다.
- **Backend startup failure** / **port already in use** /
  **required environment/config 문제** / **migration/schema 문제** /
  **SPA asset/build 문제** → 이해 가능한 실패 메시지.
- **Restart / Resume**: 정상 종료 후 재시작 가능. 기존 Canonical/Project
  state가 그대로 유지되어야 하며, launch 자체가 DB reset이나 파괴적
  bootstrap action을 암묵적으로 수행해서는 안 된다.

## 3. Existing Implementation Audit (FACT — main @53f3d4f63)

### 3.1 root `package.json` scripts

| Script                                  | Command                                        | 역할                                                                                       |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `bootstrap`                             | `tsx scripts/bootstrap.ts`                     | npm ci → `docker compose up -d --wait db` → `db:migrate` → `db:verify` (Stage 0 환경 준비) |
| `bootstrap:reset`                       | `npm run bootstrap -- --reset-db`              | 명시적 DB reset 포함 환경 준비                                                             |
| `bootstrap:quick`                       | `npm run bootstrap -- --skip-db`               | 의존성만 설치                                                                              |
| `dev`                                   | `tsx watch assemblies/shotgun-app/src/main.ts` | Backend 개발(watch) — Frontend 포함하지 않음                                               |
| `start`                                 | `tsx assemblies/shotgun-app/src/main.ts`       | Backend만 실행                                                                             |
| `dev:web`                               | `npm --workspace @shotgun/web run dev`         | Vite 개발 서버(5173)                                                                       |
| `frontend:build`                        | `npm --workspace @shotgun/web run build`       | SPA production build                                                                       |
| `db:migrate` / `db:reset` / `db:verify` | `tsx scripts/database.ts …`                    | DB 관리                                                                                    |
| `backup:create/verify/restore`          | `tsx scripts/backup-restore.ts …`              | Backup/Restore (LPA-WP5 후보 재사용)                                                       |

- **Backend와 Frontend를 함께 시작하는 단일 명령은 존재하지 않는다.**
  README도 "두 터미널에서 Backend와 독립 Frontend를 각각 실행"을 안내한다.

### 3.2 Backend (`assemblies/shotgun-app/src/main.ts` + `server.ts`)

- port = `PORT` ?? **3000**; host = `HOST` ?? **127.0.0.1**; `server.listen({host, port})`.
- 필수 env 검증(누락 시 generic Error throw): `DATABASE_URL`,
  `SOURCES_STAGING_SECRET`(≥32자), `GEMINI_API_KEY`.
  - `.env.example`에 실행 가능한 예시값 제공. `GEMINI_ALLOW_PRIVATE=false` 기본.
- Graceful shutdown: Fastify `onClose` → `options.closeResources()`
  (sources write runtime 제거 + ask worker 중지 + `pool.end()`).
  - **`SIGINT`/`SIGTERM` 핸들러 없음** — `tsx`/`tsx watch`에서 Ctrl+C 시
    closeResources가 보장되지 않는다(프로세스 종료에 의존).
- `/health` GET → `kernel.health()` (public path). 형태: `{status:"ok", …}`.
- **SPA static serving 없음** — `sendFile`/`serveStatic`/`fastify-static`
  미사용. Backend는 JSON API 전용.
- **browser auto-open 없음. 단일 supervisor/launcher 없음**
  (child-process orchestration 없음).
- startup health/readiness: `/health`(kernel)만 존재. launcher가 사용할
  frontend readiness 감지 경로 없음.

### 3.3 Frontend (`apps/shotgun-web`)

- `dev` = `vite` — host `127.0.0.1`, port **5173**, `strictPort`, proxy
  `/api`, `/product-api`, `/health` → `VITE_BACKEND_TARGET` ?? `http://127.0.0.1:3000`.
- `build` = `vite build` → **`dist/`** (명시적 `outDir`/`base` 없음, 기본값;
  `.gitignore`에 `dist/` 포함).
- API client(`packages/shotgun-api-client`)는 **상대 경로**
  (`/api/v1…`, `/product-api/frontend…`) + `credentials: 'same-origin'` 사용.
  → SPA가 Backend와 **같은 origin**에서 서빙되어야 세션 쿠키가 정상 동작한다
  (또는 동일 origin으로의 proxy 필요).
- `.env.example`: `PORT=3000`, `HOST=127.0.0.1`, `NODE_ENV=development` 등.

### 3.4 문서

- README: "Production SPA Serving은 아직 구현되지 않았습니다" 명시.
- Stage 0 개발 문서(`docs/engineering/stage-0-development.md`): 1회성 환경
  준비(`npm run bootstrap` + `npm run dev`)를 안내. Stage 0 bootstrap은
  `npm ci`/Docker/DB migration을 포함하므로 **owner launch와 역할이 다르다**
  (launch가 암묵적으로 재실행해서는 안 되는 1회성 설정).

### 3.5 재사용 가능한 기존 자산

- `/health`(kernel readiness), `frontend:build`(SPA build),
  `docker compose up -d --wait db`(DB 대기), `db:verify`,
  `.env.example`, 상대-경로 API client(동일 origin 서빙 시 그대로 동작).

## 4. GAP (LOCAL_PRODUCT_USABLE에 부족한 항목)

| #   | Gap                                           | 근거                                                                     |
| --- | --------------------------------------------- | ------------------------------------------------------------------------ |
| G-1 | 단일 owner-facing launch 명령 없음            | Backend(`start`)와 Frontend(`dev:web`)를 별도로 실행해야 함              |
| G-2 | Production SPA serving 없음                   | Backend가 built SPA(`dist/`)를 서빙하지 않음; README도 미구현 명시       |
| G-3 | Browser 자동 열기 없음                        | 실행 후 사용자가 수동으로 URL을 열어야 함                                |
| G-4 | 시작 실패 시 actionable 메시지 없음           | env 누락은 generic throw; port-in-use / DB-down / SPA-missing 처리 없음  |
| G-5 | 안전 종료 / orphan child 관리 없음            | SIGINT/SIGTERM 핸들러 없음; supervisor 없음 → closeResources 미보장 가능 |
| G-6 | launcher용 startup health/readiness 감지 없음 | `/health`만 존재, SPA endpoint 확인 경로 없음                            |
| G-7 | restart 시 state 보존 계약 미정의             | DB reset / 파괴적 bootstrap 암묵 수행 금지가 계약으로 고정되지 않음      |

## 5. DECISION CANDIDATE (LPA-WP4에서 구현할 최소 방안)

1. **DC-1 — 단일 launch supervisor**: 루트 `start:local`(또는 `launch`)
   명령 → `scripts/launch-local.ts`(tsx). 역할:
   - (a) DB 준비 확인(미기동 시 `docker compose up -d --wait db` **비파괴** 사용
     또는 actionable 안내),
   - (b) built SPA 준비(`dist/` 없으면 `frontend:build` 실행 안내/실행 — 명시적),
   - (c) Backend를 static-serving 플래그로 시작,
   - (d) `/health` + SPA endpoint(GET / → 200) readiness 확인,
   - (e) browser 자동 열기,
   - (f) SIGINT/SIGTERM → owned child 종료 + Backend graceful close 대기,
   - (g) 실패 단계별 actionable 메시지.
   - Electron/Tauri 없이 기존 Node/Fastify/Vite build 재사용.
2. **DC-2 — Backend의 SPA static serving**: Fastify가
   `apps/shotgun-web/dist`(SPA_DIR env)를 서빙 + 비-API 경로는
   `index.html` fallback. → 동일 origin + 상대 경로 API + 세션 쿠키 충족
   (LPA-AC-02/09의 최소 충족 방안). 의존성은 `@fastify/static` 추가 또는
   수동 `sendFile`(runtime dependency 최소화 검토) 중 Contract Freeze에서 결정.
3. **DC-3 — env 검증 메시지 개선**: 누락 변수·해결 방법(`.env.example` 참조)을
   포함한 actionable 오류 (기존 검증 로직 REUSE).
4. **DC-4 — 재사용**: `/health`, `frontend:build`, `docker compose … --wait`,
   `db:verify`, `.env.example`, 상대-경로 API client.

## 6. REJECTED / EXCLUDED (이번 범위에서 하지 않을 것)

- Electron / Tauri / 데스크톱 installer / OS service / system tray /
  auto-update system / cloud deployment / container orchestration /
  새로운 packaging platform.
- Launch가 암묵적으로 DB reset(`db:reset`)이나 파괴적 bootstrap을 수행하는 것.
- Launch가 매번 `npm ci`를 재실행하는 것.
- Vite dev server를 일반 로컬 사용의 기본 serving으로 사용하는 것
  (개발 전용으로만 유지).
- LPA-WP5(Backup/Restore Owner Workflow)와 LPA-WP6(Final Local Acceptance)는
  이 단계에서 시작하지 않음.

## 7. IMPACT (변경 예상 범위 — 구현 단계 기준)

- `scripts/launch-local.ts`(신규 supervisor) + root `package.json`
  `start:local`/`launch` script.
- Backend: built SPA static serving(SPA_DIR env + fallback), signal handling,
  env 실패 메시지 개선. 기존 API/권위/보안 경계 변경 없음.
- Web: `dist/` 재사용(빌드 산출물); 일반 사용 시 Vite 불필요.
- 문서: README 실행 섹션 갱신, Stage 0 문서와의 역할 구분 명시,
  필요한 경우 경량 ADR(예: Local Launch Supervisor Boundary).
- 테스트: launch supervisor contract 테스트(focused) — **구현 단계**에서 추가.

## 8. UNRESOLVED (A0에서 확정할 수 없는 사항 — Contract Freeze 대상)

- SPA static serving 구현 방식: `@fastify/static` 신규 의존성 vs 수동
  `sendFile`(runtime dependency를 늘리지 않는 방향 우선).
- Launch가 SPA build를 자동 실행할지 vs 사전 build 요구할지
  (DC-1b는 build-if-missing + 명시적 메시지 우선).
- Launch가 Docker DB 기동을 자동 수행할지 vs DB-down 시 actionable 안내만
  할지.
- Browser auto-open의 cross-platform 구현(`start`/`open`/`xdg-open`) 방식.
- ADR 필요 여부 — 새 아키텍처 결정이 필요한 경우에만 최소 1건.
- OSS 결정 — A0 현재 `NO_RELEVANT_OSS` 우선(기존 Node/Fastify/Vite 재사용);
  `@fastify/static` 검토 시에만 후보 재평가.

## 9. Contract Candidate (Acceptance Criteria 초안)

| #         | 후보                                                     |
| --------- | -------------------------------------------------------- |
| LPA-AC-01 | owner-facing 단일 launch 명령 존재                       |
| LPA-AC-02 | Backend + built SPA가 정의된 로컬 endpoint에서 사용 가능 |
| LPA-AC-03 | readiness 확인 후 browser 자동 열기                      |
| LPA-AC-04 | 시작 실패 시 actionable 메시지                           |
| LPA-AC-05 | Ctrl+C / termination 시 안전 종료                        |
| LPA-AC-06 | orphan owned child process 없음                          |
| LPA-AC-07 | restart 시 persistent Product state 유지                 |
| LPA-AC-08 | launch가 DB를 암묵적으로 reset하지 않음                  |
| LPA-AC-09 | 일반 로컬 사용에 Vite dev server 불필요                  |
| LPA-AC-10 | 기존 security/authority 경계 불변                        |

(후보 — A0 검토에서 실제 repository facts와 대조해 수정 가능)

## 10. Verification Policy (A0)

A0는 audit/document 작업이다. 다음을 금지한다.

- 기존 Product 전체 테스트 재실행 / Cross-Phase suite 재실행 /
  CI #755 또는 이전 CI 재실행.
- launcher implementation 선행 / Product code 변경 / dependency 추가 /
  migration 추가.
- LPA-WP5(Backup/Restore), LPA-WP6(Final Local Acceptance) 시작.

필요한 검증은 기존 파일/코드/문서 inspection과 문서 validation
(`docs:validate`, formatting) 수준으로 제한한다.

## 11. Completion Report 요약

- audit exact head: A0 문서 커밋 head (push 후 기록).
- 조사한 현재 launch topology: root scripts / Backend(main.ts, server.ts) /
  Frontend(vite) / README / Stage 0 문서 — §3.
- 이미 존재하는 capability: `/health`, `frontend:build`(dist),
  `docker compose up -d --wait db`, `db:verify`, `.env.example`, 상대-경로
  API client — §3.5.
- 실제 GAP 목록: §4 (G-1 ~ G-7).
- 최소 구현안: §5 (DC-1 ~ DC-4).
- Acceptance Criteria 후보: §9 (LPA-AC-01 ~ 10).
- Architecture Amendment/ADR 필요 여부: UNRESOLVED(최소 1건 가능) — §8.
- OSS 결정: A0 현재 `NO_RELEVANT_OSS` 우선 — §8.
- 예상 implementation scope: §7.
- 제외 범위: §6.
- 미결 사항: §8.
- 다음 단계: LPA-WP4 Contract Freeze / Implementation Request — GPT가 이
  A0를 ACCEPTED하면 진행.
