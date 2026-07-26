# Frontend Section 2 OSS Integration Review

- 상태: Implementation review pending user approval
- 기준일: 2026-07-26
- 대상: Settings, Project Administration, Frontend Command Gateway, Product API, browser interaction
- Lockfile source of truth: `package-lock.json`
- Canonical 경계: OSS는 Principal, Membership, Capability, Project/Resource binding, Policy Context, Command Outcome, Canonical 또는 Approval의 권위가 아니다.

## 후보별 결정

| 후보                         | 공식 Repository                                  |                               Lock/검토 버전 | License                           | 결정             | 적용 Module·Port                                                                                   |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------: | --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| React Router Data Mode       | <https://github.com/remix-run/react-router>      |                                      `8.3.0` | MIT                               | `ADOPT`          | `apps/shotgun-web` route composition                                                               |
| TanStack Query               | <https://github.com/TanStack/query>              |                                    `5.101.4` | MIT                               | `ADOPT`          | Browser query cache and invalidation                                                               |
| AJV                          | <https://github.com/ajv-validator/ajv>           |                                     `8.20.0` | MIT                               | `REFERENCE_ONLY` | JSON Schema validation precedent; Section 2 Product API uses explicit fail-closed runtime decoders |
| Fastify                      | <https://github.com/fastify/fastify>             |                                     `5.10.0` | MIT                               | `ADOPT`          | Product API transport adapter                                                                      |
| node-postgres (`pg`)         | <https://github.com/brianc/node-postgres>        |                                     `8.22.0` | MIT                               | `ADOPT`          | PostgreSQL repository and Frontend Command Gateway adapters                                        |
| WAI-ARIA Authoring Practices | <https://github.com/w3c/aria-practices>          |                          reviewed 2026-07-26 | W3C Software and Document License | `REFERENCE_ONLY` | Dialog, focus return, keyboard and accessible-name test pattern                                    |
| focus-trap-react             | <https://github.com/focus-trap/focus-trap-react> | not installed; candidate reviewed 2026-07-26 | MIT                               | `DEFER`          | Potential accessible dialog focus adapter if the current browser contract cannot be maintained     |

## 포함·제외·교체 경계

### React Router

- 포함: Settings nested routes, protected loader boundary, navigation and leave-guard integration.
- 제외: Principal/Project authority, membership resolution, server capability computation, SSR and Framework Mode.
- 교체 검증: protected-route, deep-link, active/resource Project mismatch, dirty-draft navigation tests must remain green.

### TanStack Query

- 포함: Principal/Project/Policy/Revision-scoped read cache and explicit invalidation after completed commands.
- 제외: optimistic Project or Policy mutation, command identity, `OUTCOME_UNKNOWN` resolution.
- 교체 검증: cache-key isolation, access-revision purge, and completed-command invalidation tests must remain green.

### AJV and runtime validation

- AJV remains an existing repository dependency and schema-validation precedent, but Section 2 does not add an AJV-coupled transport boundary.
- The exported Product API views and `FrontendCommandRequest` use explicit runtime decoders so browser authority-field rejection and typed error semantics stay visible in contract tests.
- Replacement test: malformed view, unsupported envelope/schema version, unmasked secret, unknown enum, and browser authority-field injection must fail closed.

### Fastify

- 포함: HTTP route registration, status mapping, CSRF transport hook, session-bound request handling.
- 제외: domain authorization, revision validation, semantic digest meaning, outcome persistence.
- 교체 검증: Product API integration fixtures must produce the same typed status/error/outcome contract.

### PostgreSQL `pg`

- 포함: parameterized SQL, transaction boundaries, row locking, revision and command-ledger persistence.
- 제외: exposing DB row identifiers as Product API authority or allowing repositories to bypass their Port.
- 교체 검증: in-memory/PostgreSQL contract parity, atomic precondition failure, idempotency replay/mismatch, restart recovery, and migration verification.

### Accessible dialog and focus

- Current Section 2 dialogs use application-owned React markup and focus management tested against WAI-ARIA Authoring Practices patterns.
- `focus-trap-react` is not added in this Section because no failing replacement requirement currently justifies another runtime dependency. This is `DEFER`, not a claim that no relevant OSS exists.
- Re-evaluation trigger: nested modal, complex focus cycling, browser E2E failure, or accessibility audit finding.
- Replacement test: initial focus, Tab/Shift+Tab containment, Escape behavior where permitted, accessible name/description, and focus return to the invoker.

## License·Security·Maintenance

- The five installed packages above are exact lockfile pins; production use of `latest`, an unpinned branch, or an automatic major upgrade is prohibited.
- License values were checked from installed package metadata and official repositories. WAI-ARIA/focus-trap licenses are reference-candidate metadata and do not add shipped code.
- Security evidence includes successful CI Run
  [`30184330373`](https://github.com/JasonCutter/shotgun/actions/runs/30184330373) for the
  previous reviewed head, plus the audit, secret scan, OSS registry verification, and SBOM
  commands recorded for each subsequent final working tree in the Draft PR evidence.
- Maintenance recheck triggers: package major upgrade, abandoned release/security response, SSR introduction, database driver replacement, or a dialog accessibility finding.

## Migration·Rollback

- Application rollback disables Section 2 write routes and retains compatible readers; it does not delete Project, Settings, Command, Audit, or Revision data.
- Package replacement occurs behind the route/cache/repository/command-gateway boundaries above.
- PostgreSQL corrections use forward additive migrations. Backup restore or point-in-time recovery is used for data recovery; destructive schema-down migration is not a production rollback.
