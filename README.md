# lean-verified — an OpenSpec schema that answers the spec-driven-development critique

This repo distills the critique of Spec-Driven Development from `docs/transcript.srt`
(Tim Corey, *Dev Questions: Is Spec-Driven Development Slowing You Down?*) into a
working custom schema for [OpenSpec](https://github.com/Fission-AI/OpenSpec), plus
smoke tests that prove each criticised failure mode is actually addressed.

## The critique → the fix

The transcript names five recurring failure modes. The schema (`openspec/schemas/lean-verified/`)
turns each into a mechanical constraint:

| # | Critique (from the transcript) | lean-verified fix |
|---|---|---|
| C1 | *"good management ideas turn into an overbearing bureaucracy … a whole bunch of ceremony … takes away from the task of actually doing the job"* | Three-step pipeline `proposal → specs → tasks` plus a **design gate that is automatic triage**: five mechanical triggers (cross-cutting, architecture bet, shared seam, invariant risk, parallel work). No trigger fires → the design is a one-line *recorded* skip; any fires → a one-page disposable design. No unconditional design doc, and no silent skips either. |
| C2 | *"English really isn't precise"* (bi-weekly = every two weeks or twice a week?); chasing precision ends in *"the logical conclusion … is just to write code"* | Specs must carry a **quantified requirement + at least one `#### Scenario:`** with `WHEN/THEN` and `SHALL`, each ending in `Verified by: <committed acceptance test>` (black-box, at the system boundary). Spec + acceptance tests form the **contract** — complete and machine-checkable before any code exists. Vague specs **fail `validate --strict`**. |
| C3 | *"the solution starts drifting in area where there's already a solution" … until it's bloated and messy* | Proposal must include **`## Solutions Considered`** (reuse-first: existing tools, libraries, commands) and **`## Non-Goals`** (explicit scope fence, ≥1 entry). "None found" must name what was searched. Tasks instruction forbids tasks without a requirement. |
| C4 | *"how do we know when we're done?"* | Proposal must include **`## Done When`** — 1–5 observable checks. Every task is phrased as **the interface it establishes** and ends with **`verify by <command/test/check>`**; tasks are worked **red-green-refactor** (the failing unit test *is* the design decision); a **Done When Traceability** table maps each criterion to the task ids that prove it. |
| C5 | *"the spec becomes the source of truth"* — but code is the real truth, so specs rot | The loop **ends in `openspec archive`**: verify a task → check it off → archive merges the delta into the living spec. A **three-door drift guard** (`scripts/spec-drift.mjs`: apply preflight → pre-commit hook → CI) enforces that spec, acceptance tests, and code travel together. Unit tests churn freely with the design; only the acceptance tests are contract and must stay stable — code + tests are the truth, the spec is the index. |

## The workflow

```
 openspec new change <c>
        │
        ▼
 ① PROPOSAL ────▶ ② SPECS ────────▶ DESIGN GATE ──────▶ ③ TASKS
 why + scope        contract:          automatic triage:    fulfillment plan:
 reuse scan         claims +           5 triggers; skip     interfaces, each
 non-goals          quantified         must be recorded     "verify by",
 done-when          WHEN/THEN          (one line) or a      red-green-refactor,
                   scenarios +        one-page design      traceability table
                   acceptance tests   when complexity
                   (Verified by)      demands it
        │                │                   │                  │
        ▼                ▼                   ▼                  ▼
      C3+C4        validate --strict     C1 (no ceremony,   spec+test = CONTRACT
                    (C2 gate: vague      no silent skips)
                     specs fail)                                   │
                                                                 ▼
                                                    APPLY: per task — failing unit
                                                    test first (red), smallest code
                                                    (green), refactor; acceptance
                                                    tests must pass unchanged
                                                                 │ all green
                                                                 ▼
                                                    ARCHIVE --yes: merge delta into
                                                    openspec/specs/<cap>/spec.md
```

Contract terms: the **spec is the terms**, the **acceptance tests are the arbitration
clause**, the **code is performance**. Step ② completes the contract (mostly red);
step ③ plans fulfillment; apply performs it; archive discharges it.

### The drift guard — one script, three doors

`scripts/spec-drift.mjs` keeps the index honest, nearest to where drift starts:

- **L1 traceability** — every `Verified by` pin in every spec resolves to an existing file; every test under `tests/acceptance/` is pinned by some spec (no orphans, no broken pins).
- **L2 staleness** — a requirement may carry `Code: <glob>` lines; if a matching file's last commit moved past the spec's last commit (by **topology**, not second-resolution timestamps), the spec is stale. Commits marked `Mechanical-Change: <reason>` (lint sweeps, codemods, framework updates) carry no contract information and don't move the clock.
- **M mechanical integrity** — a commit claiming to be mechanical must not touch `openspec/specs/` or the acceptance tests; otherwise "mechanical" is a smuggling route past the commit door.
- **O single owner** — a file claimed by two specs' `Code:` globs is an unowned helper: narrow the globs or promote the helper to its own capability.
- **L3 scale** — a living change's task list past 12 tracked tasks is a decomposition signal, not a work plan: split the proposal (the Done When Traceability table is the split map) or record a `split-considered:` decision. The design gate T5 fires at >8 as foresight; L3 is the backstop. Archived changes are never nagged.

| Door | Fires | Wiring |
|---|---|---|
| 1 · apply preflight | before `openspec archive` | the schema's apply instruction runs it — the agent fixes its own drift with full context |
| 2 · commit | at `git commit`, seconds after the edit | `.githooks/pre-commit` runs it with `--staged`; spec + code + tests must travel in one commit |
| 3 · CI | push / PR / MR | `.github/workflows/spec-drift.yml` **and** `.gitlab-ci.yml` (parity enforced by S16) — runs the drift guard **and the acceptance suite** (`npm test --if-present`); non-bypassable backstop for `--no-verify`. Optional agent-triage job ships commented on both: it reacts to red, never renders the verdict |

Setup for door 2, once per clone: `git config core.hooksPath .githooks`

### Where lint, codestyle, helpers, and framework sweeps live

The contract/implementation split answers all four — none of them is contract, so none of them belongs in a spec:

| Change class | Layer | Rule |
|---|---|---|
| linter / codestyle | implementation | Style is never spec content; `verify by` may run the linter, CI runs it. A repo-wide `lint --fix` sweep commits with a `Mechanical-Change:` trailer: it can't touch specs or acceptance tests, and it ages no spec (M + L2 exemption). |
| helper / shared code | implementation, **single owner** | A file is claimed by at most one spec's `Code:` glob (guard check O). A helper several capabilities use stays under its owner's glob — or, once it carries its own requirement, is promoted to its own capability with its own scenario + acceptance test. |
| automatic framework changes / codemods | mechanical | Same trailer: contract untouched, staleness exempt. If the sweep changes behavior, the acceptance tests catch it — that is what they exist for — and the behavior part goes through the change loop like any change. |

The trailer is self-certified but safe to trust: it only silences *staleness* (spec text), and a mechanical commit touching the contract layer is rejected outright. Behavior is arbitrated by acceptance tests — which no mechanical commit may edit.

### Brownfield adoption — strangler fig, not big bang

Existing projects have no specs, and every guard check is scoped by *ownership*
(`Code:` globs) — a repo with zero specs passes all three doors trivially.
Safe, but worthless until territory becomes owned. The migration has four moves:

| Phase | Move | What happens |
|---|---|---|
| 0 · adopt | copy `openspec/` + `scripts/` + `.githooks/`, CI on | every *new* change is born owned; legacy stays explicitly unowned. `tests/acceptance/` is contract territory from day one — leave it empty; legacy tests stay where they are and surface via `--tests` |
| 1 · extract | per capability area, an agent drafts a spec-change **from the existing tests**; humans review | each scenario's `Verified by` pins a test that already exists — and the same change **moves that test into `tests/acceptance/`**, pin and move in one commit. Review asks the **WANT-question**: "is this what we *want*?", not "is this accurate?" (the pins answer accuracy). Mark the proposal `Extracted from: <test paths>` so readers know the intent was reverse-engineered. |
| 2 · own-on-touch | weak-test areas stay unowned until first changed | that change brings the spec seed for the behavior it touches; known-but-untested behavior enters as a proposal pinning tests that don't exist yet — test-first tasks create them |
| 3 · burn-down | `scripts/spec-extract.mjs` | deterministic map (no LLM): unpinned tests = extraction candidates, unowned files = exposure, `% owned` = the adoption metric |

Two rules keep extraction honest:

- **Extract only what a test pins.** A test *is* a scenario — arrange/act/assert
  is GIVEN/WHEN/THEN. Code alone says what the system *does*, never what it is
  *for*: requirements reverse-engineered from untested code are plausible fiction.
- **Extraction blesses the status quo.** Bugs get extracted as scenarios too —
  by design: from approval on, fixing one is a visible contract amendment, not
  a silent code change. The WANT-review is the gate; the guard then enforces
  whatever survived it. Batch by capability — a 500-scenario PR is review theater.

```bash
node scripts/spec-extract.mjs               # the map, human-readable
node scripts/spec-extract.mjs --json        # burn-down over time (CI badge)
node scripts/spec-extract.mjs --tests src   # tests living next to their sources
```


### Kicking off step 1 — example agent prompt

Copy, replace the two placeholders, hand to your agent of choice:

```text
Draft a spec-extraction proposal for the capability area "<area>",
e.g. "billing" or "reporting". Work evidence-first:

1. Run `node scripts/spec-extract.mjs --json` (add `--tests <glob>`
   if tests live next to sources). From `unowned` and
   `extractionCandidates`, confirm the files belonging to "<area>".
2. Read the existing tests for that area. They are your ONLY admissible
   evidence — each arrange/act/assert test is a scenario (GIVEN/WHEN/THEN).
   Read the code under test only to fill in the `Code:` globs.
3. Create `openspec/specs/<area>/spec.md`: one Requirement per behavior,
   scenarios phrased from the tests, `Code:` glob per requirement,
   `Verified by:` pinning the exact existing test path(s) per scenario.
4. Move exactly those tests into `tests/acceptance/` (git mv) — pin and
   move in one commit. Do not rewrite, "improve", or fix anything.
5. End the spec with: `Extracted from: <test paths>`.
6. Anything the tests do NOT cover goes into an "Open questions (not
   covered by tests)" list in your change description — never into the
   spec. Requirements without a pin are plausible fiction and will be
   rejected.
7. Self-check, then report: `node scripts/spec-drift.mjs` must be green,
   the test suite must pass, and state the burn-down delta
   (`spec-extract.mjs --json` before vs. after).
```

Humans then run the WANT-question review — "is this what we *want*?" —
before it merges. Approval blesses bugs into visible scenarios; from then
on the guard, not goodwill, protects them.
Consistency rises as territory grows: capabilities partition the code (single
owner, check O), so contradictions become build errors; every session starts
from the same pinned intent instead of re-archaeologizing the codebase; L2
turns intent drift into a mechanical red; and bidirectional L1 stops both test
rot and untestable prose.

### Try it here

```bash
git clone <this-repo> && cd openspec-cdd
node tests/smoke.mjs        # runs the full loop against a throwaway project, 21/21
```

Requirements: Node ≥ 20 and the OpenSpec repo cloned at `vendor/OpenSpec`
(`git clone --depth=1 https://github.com/Fission-AI/OpenSpec vendor/OpenSpec && cd vendor/OpenSpec && pnpm install`).

### Use the schema in your own project

1. Copy this repo's `openspec/`, `scripts/`, and `.githooks/` folders into your project root, then `git config core.hooksPath .githooks` (door 2) — the CI workflow (door 3) copies along.
2. Run `npx openspec schema which lean-verified --json` → `"source": "project"` confirms yours shadows the built-ins.
3. Drive your agent with the normal OpenSpec loop; the schema changes what the agent is told:

```bash
openspec new change add-csv-export          # creates change dir, schema = lean-verified
openspec instructions proposal --change add-csv-export   # agent: why / reuse scan / non-goals / done-when
openspec instructions specs    --change add-csv-export   # agent: quantified scenarios + Verified by acceptance tests
openspec instructions design   --change add-csv-export   # agent: runs the 5-trigger triage, records skip or design
openspec instructions tasks    --change add-csv-export   # agent: interface-phrased tasks, verify-by, traceability
openspec validate add-csv-export --strict   # vague specs fail here, before any code
openspec instructions apply    --change add-csv-export   # agent: red-green-refactor per task, then archive
openspec archive add-csv-export --yes        # merges into openspec/specs/<capability>/spec.md
```

## Smoke tests — proof the critique is addressed

`tests/smoke.mjs` runs the real OpenSpec CLI (vendored, built from source) against a
temp project configured with this schema. Every check is labeled with the critique it
verifies:

| Check | Verifies | What it proves |
|---|---|---|
| S0/S0b | setup | schema validates; project schema shadows package built-ins |
| S1 | C1 | pipeline is `proposal → specs → design gate → tasks`; the gate sits between specs and tasks, auto-discharged |
| S2 | C2 | the literal "bi-weekly / should support / fast to generate" spec **fails `--strict`** (no scenario, no SHALL) |
| S3 | C2 | the quantified counterpart ("every 14 days", WHEN/THEN) passes |
| S4 | C2 | the agent's spec instructions actually contain the quantification rules |
| S5 | C3 | proposal instructions mandate Solutions Considered + evidence-bound Non-Goals |
| S6 | C4 | Done When + "verify by" + traceability table reach the agent |
| S7 | C5 | apply instructions demand verification before check-off, open each task with a failing unit test, and end in `archive` |
| S8 | C5 | archive mechanically updates `openspec/specs/usage-reporting/spec.md` and it validates |
| S9 | C1 | the design gate's 5-trigger triage reaches the agent; the fixture's skip is recorded, not silent |
| S10 | C4 | tasks step engrains design-by-unit-test: red-green-refactor, unit tests churn, acceptance tests stay stable |
| S11 | C2 | specs step completes the contract: `Verified by` pins exist in instruction, template, fixture spec, and the pinned acceptance test file exists |
| S12 | C5 | drift guard: broken `Verified by` pins, orphan acceptance tests, and code committed past its spec are all caught (L1 + L2, full scan) |
| S13 | C5 | the pre-commit hook blocks the drifting commit at the door; the spec+code co-travel commit passes |
| S14 | C5 | mechanical sweeps (lint/codemod/framework) with the `Mechanical-Change:` trailer age no spec — but a "mechanical" commit touching the contract is rejected |
| S15 | C5 | single-owner rule: a helper claimed by two specs' `Code:` globs is flagged |
| S16 | C5 | door 3 stays a machine: CI runs guard + acceptance suite mechanically; agent triage is opt-in and only reacts to red |
| S17 | C5 | Phase 0 cold start: a spec-less legacy repo passes all doors, `tests/acceptance/` is guarded from day one (an unpinned test dropped there goes red), and `spec-extract` maps unowned territory + extraction candidates via `--tests` |
| S18 | C5 | Phase 1 extraction moves + pins existing tests in one commit; burn-down rises, and the drift guard immediately protects the extracted territory (code-only commit goes red) |
| S19 | C5 | the brownfield playbook ships documented: strangler fig, honest-source rule, WANT-question, `Extracted from:` provenance, own-on-touch |
| S20 | C5 | split rule: a 17-task living change goes red (L3) with the split remediation; a recorded `split-considered:` decision passes |
| S21 | C5 | archived changes are frozen history — a 20-task archive never trips L3 |

Fixtures: `tests/fixtures/bad-ambiguous/` (the critique, verbatim) vs
`tests/fixtures/good-verified/` (the fix, same feature — including its recorded
design-gate skip and pinned acceptance test).

## Layout

```
.github/workflows/spec-drift.yml # door 3: CI backstop (fetch-depth: 0)
.gitlab-ci.yml                     # door 3 on GitLab (kept in parity with the workflow above)
.githooks/pre-commit             # door 2: commit-time guard (--staged)
scripts/spec-drift.mjs           # the drift guard: L1 traceability + L2 staleness
scripts/spec-extract.mjs         # brownfield map: extraction candidates + unowned files + burn-down
openspec/
  config.yaml                    # schema: lean-verified + injected rules/context
  schemas/lean-verified/
    schema.yaml                  # proposal, specs, design gate, tasks + apply contract
    templates/{proposal,spec,design,tasks}.md
tests/
  smoke.mjs                      # 21 checks, C1–C5 + brownfield mapping
  fixtures/{bad-ambiguous,good-verified}/
docs/transcript.srt              # the source critique
vendor/OpenSpec/                 # upstream repo for research + CLI (not committed)
```
