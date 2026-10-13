# Reproducible actual application regression

Date: 2026-10-13. Local execution status: **PASS in scoped runs; exact-head CI pending**.

The prior actual-application 14-case and SPA three-question evidence was stored
outside the repository. Its results remain preserved, but an external local
artifact is not an executable PR regression. A focused PostgreSQL test now
exercises only the newly connected runtime boundaries:

1. Actual `startShotgunApplication`, sealed file staging/intake, extraction,
   relation worker, Ledger search and Ask: A → question → B → same question →
   A revision → current question. Current citations bind actual Evidence and
   the current SourceVersion; historical GET is stale while stored run,
   statements, citations, attempts, capabilities and revisions stay unchanged.
2. Hold a fake answer in flight, submit an A revision, then release the known
   response. The same AnswerRun completes with the current revision in a fresh
   second attempt; the first FAILED/STALE_VERSION attempt remains recorded.
   No user retry command, new question or stale response republication occurs.
3. Fake bounded URL acquisition creates an expired initial receipt via a scoped
   test clock. The real source-refresh worker and command gateway create a
   versioned revision, completed command identity, and current Ask citation.
   The initial receipt is not rewritten. DNS and HTTP transport are test-only.

Files: `tests/database/vp-full-application-acceptance.database.test.ts` and
`tests/helpers/vp-full-application-fixture.ts`. This is not a copy of all prior
13/14 acceptance cases. Existing permission, UNKNOWN, crash, billing and
historical projection suites retain their own responsibilities.

## Isolation and reproduction

- Existing `requireTestDatabaseTarget` and isolated database helpers create
  distinct disposable workload and authority databases under TEST_DATABASE_URL.
- Normal env files are forbidden for this fixture. Provider environment keys are
  removed; Vault/configuration/standing/egress records are synthetic and isolated.
- DeepSeek's transport is intercepted with the existing Fake Provider; every
  call verifies the exact synthetic credential. Global HTTP fetch fails closed.
- URL DNS/transport and the acquisition timestamp are scoped Vitest spies, with
  explicit restoration. Application workers close before transport/environment
  restoration; all created databases and asset roots are disposed.
- Existing pinned PostgreSQL, Fake Provider and normal application Ports are
  reused. No new runtime, migration, package or transaction owner is introduced.

CI command, using its existing PostgreSQL service and installed format dependencies:

```text
node node_modules/vitest/vitest.mjs run tests/database/vp-full-application-acceptance.database.test.ts --maxWorkers=1 --fileParallelism=false --testTimeout=60000 --hookTimeout=60000
```

Each real-worker acceptance has its own explicit 180-second bound, with
45-second condition deadlines, except the relation-binding observer's 75 seconds.
The normal relation dispatcher uses a 60-second cadence; its observer allows one
tick plus 15 seconds of database/scheduling margin. These cover initial migration and durable worker
scheduling; no existing timeout or assertion is changed. Same-run stale recovery
uses the actual queue, not a mocked retry method or patched worker delay.

The initial execution was **NOT_RUN_LOCAL** while Docker was unavailable. When
Docker externally became reachable, the protected containers were observed exited.
After verifying its exact container, volume and network, the parent started only
the owned isolated container. The URL refresh suite passed all six tests. The
application suite passed same-run recovery and URL refresh, but its immediate
relation binding assertion failed before the normal worker's first scheduled tick.
That failure is preserved in `publish-application-pg-resumed.log`. The revised
bounded observer waits for a real durable record without changing the assertion,
production cadence or existing timeout. Its focused rerun passed in 119.4 seconds
(`publish-application-first-case.log`; the other two cases were excluded by the
test-name filter, not disabled in source). All three cases are enabled in normal CI.
Root typecheck, focused lint and source formatting passed. Remote CI must still
verify all cases together on the published exact head.

Fake responses verify source/version/citation and execution wiring, not actual
DeepSeek semantic accuracy, prompt-injection defense rate or provider billing.
No real provider, operating application, operating database or authority was used.
