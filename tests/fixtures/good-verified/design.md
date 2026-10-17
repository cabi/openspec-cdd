# Design Gate

## Complexity Triage

- **T1 Cross-cutting (3+ capabilities)**: NO - one capability (usage-reporting), one code path.
- **T2 Architecture bet (new service / datastore / dependency, or rewrite)**: NO - platform cron plus the existing mailer; nothing new introduced.
- **T3 Shared-seam change (interface others depend on)**: NO - no interface other capabilities depend on is touched.
- **T4 Invariant risk (perf / security / correctness threshold)**: NO - the 14-day window correctness is pinned by the acceptance test; no perf or security threshold is at risk.
- **T5 Parallel work (multiple implementers or >8 tasks)**: NO - one implementer, 4 tasks.

## Design

Skipped: no triage trigger fired - a cron entry, a windowed CSV query, and the existing mailer; the interfaces are settled by the spec's acceptance test.
