# Language

One canonical term per concept. The `_Avoid_` list marks the graves of the
synonyms we rejected — use the term, not its ghosts. Terms here are language
only, never implementation detail: if a definition starts describing code, it
belongs in a spec delta or an ADR instead.

<!-- induced: interpreted — written by hand from the design discussions -->

**capability** — a named area of contract the system promises; the unit of
ownership under `openspec/specs/<capability>/`. _Avoid_: module, feature,
domain-area.

**change loop** — the four-phase authoring flow (design gate → proposal →
deltas → tasks) that produces one change folder under
`openspec/changes/<name>/`. _Avoid_: workflow, ticket.

**delta** — the spec excerpt inside a change folder that will merge into the
capability spec on archive. _Avoid_: diff, patch.

**acceptance test** — the committed test that pins a scenario, named under
`tests/acceptance/`; the reason a spec line can be trusted. _Avoid_: e2e
test, integration test (those are kinds of tests, not the pin itself).

**door** — a checkpoint the change must pass: door 1 authoring (human and
agent judgment), door 2 commit (drift guard), door 3 CI (machine verdicts).
_Avoid_: gate (reserved for the design gate specifically).

**design gate** — the first phase of the change loop where the model of the
change is designed and challenged before any artifact is written; emits the
split signal at more than 8 tasks (T5). _Avoid_: review, planning phase.

**mechanical change** — a behavior-preserving sweep (formatting, codemod,
dependency or framework bump) that ages no spec and may never touch specs or
acceptance tests; declared with the `Mechanical-Change:` trailer.
_Avoid_: chore, cleanup.

**ADR (architectural decision record)** — a decision that is hard to reverse,
surprising without context, a real trade-off, and crosses capability
boundaries; lives in `openspec/decisions/`, guarded by A0/A1/A2.
_Avoid_: design doc, RFC.
