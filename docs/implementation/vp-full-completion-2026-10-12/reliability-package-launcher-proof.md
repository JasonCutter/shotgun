# Isolated package import and launcher identity scope

Date: 2026-10-13.

## New concrete package proof

The existing Stage 12 standalone consumer Gate covers lucas-text-locator and
quality-evaluation, but did not cover the new vp-relation-evaluation package.
Source imports in unit tests alone cannot establish that its published dist
exports include the relative contracts and quality metric dependencies.

`tests/integration/vp-release-package.test.ts` builds the actual package project
into a fresh temporary output tree, copies its actual package manifest, packs
only declared dist files with scripts disabled, and installs the local tarball
into a fresh offline consumer. A plain Node import resolves its exported
measurement version, digest and accounting functions. Empty denominator, latency
and billing remain N/A. The consumer has only the one package dependency and no
Shotgun application, worker, provider adapter or assembly.

The final isolated test **1/1 PASS**. Existing npm and TypeScript are reused; no
package build/export correction, dependency adoption or operating installation
was required. Environment/provider keys are excluded, npm user/global config
files and cache are temporary/empty, network is offline, and package scripts are
disabled. No whole repository archive, env file, original asset, frozen Gold or
experiment data is packed. Temporary build/package/consumer/cache files are
removed after verification. Standard lint/format and root typecheck are separate
combined Gates.

## Existing launcher coverage reused

- Canonical launcher tests use temporary local Git origins and injected process
  inspection: exact freshly fetched main SHA, clean tracked tree, fast-forward
  only, refusal of ahead/diverged branches, starting-owner reservation,
  PID/start-token/command ownership, nonce-safe cleanup and readiness-based reuse.
- Launch core contract tests cover env validation, SPA build/asset presence,
  non-destructive schema checks, maintenance recovery, startup/readiness ordering
  and exactly-once shutdown.
- Supervisor tests exercise bounded transient recovery, terminal failures and
  real fixture-child IPC, without starting the operating application.
- Existing same-origin SPA serving tests preserve API/auth boundaries and reject
  non-browser fallback. Parent actual SPA/product evidence is recorded separately.

Those existing tests are reused; no parallel launcher, installer or startup
framework is introduced. The new evaluation-package test does not exercise
`launch-local.ts`, which has an executable owner entry and must not be imported
as a harmless module. A development branch is correctly rejected by the current
Canonical launcher; this safety boundary is not bypassed for acceptance.

## Still required for VP-11 final acceptance

The offline consumer is not the installed Shotgun desktop application. It cannot
prove desktop shortcut target, final merged main SHA, actual DB/asset identity,
operating worker cutover, parent crash or Windows reboot. These require their
existing separately authorized installed-release and operating acceptance.
No normal app/worker, real credential, production authority, reboot or shortcut
configuration was started or changed by this proof.
