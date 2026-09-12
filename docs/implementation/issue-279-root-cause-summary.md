# Issue #279 root cause summary

The observed Source 2 omission is caused by two independent defects that compose:

1. Stage7 lexical projection rows retain the Canonical version at which each Claim row was projected. Stage5 shortlist/Hybrid incorrectly interpret that per-row version as the current Snapshot version / Claim resource revision. Historical Canonical Claims therefore trigger false snapshot-integrity/version-mismatch failures in a current READY projection.
2. The real `CandidateValidated` V2_ACTIVE handler is still shaped around the legacy V1 `execution.result` field. A V2 BLOCKED/non-terminal execution can therefore return normally, causing Connector durable delivery to record success/completion even though no Comparison/Review terminal artifact exists.

The correction must address both defects; fixing either one alone leaves a silent-loss path.
