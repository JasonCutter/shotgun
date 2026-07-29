# Project Shotgun Engineering Evidence

This directory stores durable reports, audits, test results, migration verifications and completion records used to support Project Shotgun claims.

## Evidence classes

### `ARCHITECTURE_VERIFICATION`

Confirms that a document, contract or implementation matches an approved architecture boundary. It does not establish deployment or production behavior unless those checks are explicitly included.

### `IMPLEMENTATION_VERIFICATION`

Confirms behavior at an exact branch or commit through named tests, inspection or scenarios. It must identify the subject revision and separate `PASS`, `FAIL`, `BLOCKED` and `NOT_RUN`.

### `MIGRATION_VERIFICATION`

Confirms source identity, export or transformation method, target path, semantic-change boundary and retained legacy source.

Examples:

- Knowledge Flow Detailed Map migration;
- Frontend Architecture migration;
- Phase 1–6 ADD migration.

### `AUDIT_REPORT`

Records findings and evidence from a bounded audit. An audit may identify risks without declaring implementation complete.

### `GATE_RECORD`

Records one named quality, security, durability, operations or release Gate. It supports only that Gate's scope.

### `COMPLETION_RECORD`

Records the final approved status of a Stage, Phase Section or migration increment. It must identify approval, exact evidence and known limits. A completion record does not silently erase earlier intermediate records.

### `DEPLOYMENT_VERIFICATION`

Confirms deployment behavior in a named environment. Local or CI success is not deployment verification.

### `PRODUCTION_VERIFICATION`

Confirms behavior in the production environment. It must not be inferred from development, local, CI or staging evidence.

### `REFERENCE_EVIDENCE`

Supports context but is not sufficient by itself for a completion, release or production claim.

## Evidence state dimensions

The following dimensions are independent and must not be collapsed into one `verified` flag:

```text
local_verification
remote_ci
review
user_approval
merge
release
 deployment
production_verification
```

A record may pass local and remote CI while merge, deployment and production verification remain pending.

## Required record fields

A material evidence record should include, as applicable:

- stable record ID;
- record class;
- execution or decision date;
- repository, branch and exact commit SHA;
- subject scope;
- commands, checks or manual procedures;
- environment and relevant versions;
- explicit results for required checks;
- failure, skip, retry and flaky behavior;
- approval and merge state;
- external evidence links or checksums;
- known limits and the exact claim supported.

## Status precedence

For the same scope:

1. final approved completion record;
2. approved Gate record;
3. exact implementation verification;
4. remote CI evidence;
5. audit or intermediate report;
6. PR discussion or chat context.

Precedence applies only to current status. Earlier evidence remains part of the history.

## Registry

[`evidence-registry.json`](evidence-registry.json) identifies the high-value status authorities and migration verifications that must remain addressable from Git.

## Validation

```text
npm run docs:canonical
npm run docs:validate
```

The validation Gate checks registered paths and prohibits external-only evidence from being represented as a Git completion authority.
