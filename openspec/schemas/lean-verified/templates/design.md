# Design Gate

## Complexity Triage

<!-- Answer all five with evidence from the specs and the codebase. The
     decision is mechanical: any YES requires the Design section below;
     all NO means the skip record replaces it. An unrecorded skip counts
     as an unmade decision. -->

- **T1 Cross-cutting (3+ capabilities)**: <YES/NO - evidence>
- **T2 Architecture bet (new service / datastore / dependency, or rewrite)**: <YES/NO - evidence>
- **T3 Shared-seam change (interface others depend on)**: <YES/NO - evidence>
- **T4 Invariant risk (perf / security / correctness threshold)**: <YES/NO - evidence>
- **T5 Parallel work (multiple implementers or >8 tasks)**: <YES/NO - evidence>

## Design

<!-- Only when a trigger fired. Per fired trigger: interfaces/seams
     (signatures, file paths), approach vs rejected alternative, risks +
     mitigations, open questions for tasks.md to settle as unit tests.
     Under one page; cut anything a task could decide later.

     If nothing fired, this section is ONLY the skip record:
     Skipped: no triage trigger fired - <one sentence why design is
     trivial here>. -->
