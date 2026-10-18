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
| C5 | *"the spec becomes the source of truth"* — but code is the real truth, so specs rot | The loop **ends in `openspec archive`**: verify a task → check it off → archive merges the delta into the living spec. A **three-door drift guard** (`openspec/scripts/spec-drift.mjs`: apply preflight → pre-commit hook → CI) enforces that spec, acceptance tests, and code travel together. Unit tests churn freely with the design; only the acceptance tests are contract and must stay stable — code + tests are the truth, the spec is the index. |

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

`openspec/scripts/spec-drift.mjs` keeps the index honest, nearest to where drift starts:

- **L1 traceability** — every `Verified by` pin in every spec resolves to an existing file; every test under `tests/acceptance/` is pinned by some spec (no orphans, no broken pins).
- **L2 staleness** — a requirement may carry `Code: <glob>` lines; freshness is measured **per capability**: the tip is the newest commit of the living spec *or any of its open deltas* — that's what an in-flight change is. Code that moved past every spec of its capability is stale. Commits marked `Mechanical-Change: <reason>` (lint sweeps, codemods, framework updates) carry no contract information and don't move the clock.
- **M mechanical integrity** — a commit claiming to be mechanical must not touch `openspec/specs/` or the acceptance tests; otherwise "mechanical" is a smuggling route past the commit door.
- **O single owner (capability-aware)** — a file claimed by two *capabilities'* `Code:` globs is an unowned helper: narrow the globs or give the helper its own capability. A living spec overlapping **its own open delta** is the mechanism (in-flight update), not drift. Two open changes claiming one capability go red — merge them or record `Depends on:`. `archive/` is frozen history and never a claimant (applied changes don't re-claim their code forever).
- **L3 scale** — a living change's task list past 12 tracked tasks is a decomposition signal, not a work plan: split the proposal (the Done When Traceability table is the split map) or record a `split-considered:` decision. The design gate T5 fires at >8 as foresight; L3 is the backstop. Archived changes are never nagged.

| Door | Fires | Wiring |
|---|---|---|
| 1 · apply preflight | before `openspec archive` | the schema's apply instruction runs it — the agent fixes its own drift with full context |
| 2 · commit | at `git commit`, seconds after the edit | `.githooks/pre-commit` runs it with `--staged`; spec + code + tests must travel in one commit |
| 3 · CI | push / PR / MR | `.github/workflows/spec-drift.yml` **and** `.gitlab-ci.yml` (parity enforced by S16) — runs the drift guard **and the acceptance suite** (`npm test --if-present`); non-bypassable backstop for `--no-verify`. Optional agent-triage job ships commented on both: it reacts to red, never renders the verdict |

Setup for door 2, once per clone: `git config core.hooksPath .githooks`

### Where lint, static analysis, helpers, and framework sweeps live

None of these tools is contract: no lint rule, scanner finding, or codemod ever
authors a spec delta, a scenario, or an acceptance criterion. But "not
contract" does not mean "checked at the end" — each tool has **two roles at two
moments**.

**Producer-side — part of implementing.** Producing valid code belongs to the
implement step. The implementer's loop is: write code → lint and static
analysis clean → pinned acceptance test green. That is the done-condition of
every task, stated once — here and in the injected tasks rules — never repeated
as per-task `verify by` pins, which would just move the forty-lines-of-comments
problem from source code into `tasks.md`.

**Enforcement-side — at the doors.** The doors don't own these tools; they
re-run them so a skipped producer loop becomes visible. Door 2 runs formatters
and `lint --fix` beside the drift guard — style never enters the contract
layer. Door 3 runs the linter and static-analysis jobs as machine verdicts
beside the guard and the acceptance suite: a red lint job in CI is not a new
event, it is proof the producer loop didn't happen.

**Why they can never author contract — the oracle argument.** PHPStan markets
itself as finding bugs "without writing tests", and it is an executable
pass/fail check with a profile (rule levels), but it is not a predefined test
suite. It proves properties over *all* executions by abstraction — types,
control flow, nullability — instead of sampling behavior on concrete inputs;
that is why it can produce false positives and why "clean" means no type
errors, not no bugs. And its oracle is the language plus the contracts your
signatures already declare: it knows `getUser(int $id): ?User` can return
null; it can never know that user 42 must exist or that an order total
includes VAT. Static analysis verifies the contracts the code already states;
tests verify the contracts only a human can state. Behavior-affecting findings
therefore escalate into the change loop as proposals, and acceptance tests
remain the only executable form of business meaning.

```
editor ── format-on-save · codestyle fixer      (producer-side: implementation)
  │
  ▼
DOOR 1 · AUTHORING LOOP (agent + human) ──────────────────────────────────────
  design gate (T5) ▶ proposal.md ▶ spec deltas ▶ tasks.md
  >8 tasks = split     Code: globs   scenarios    verify by pins
  foresight            Done-When     Verified by
       ▲                                            │
       │  ESCALATION (the only way tools enter):    ▼
       │  a static finding or lint rule that   implement ── lint and
       │  changes behavior/architecture            typecheck clean in
       │  re-enters here as a proposal         this loop, then the
       │                                    pinned acceptance test green
  │
  ▼
DOOR 2 · COMMIT (.githooks/pre-commit) ───────────────────────────────────────
  spec-drift guard: L1 pins · L2 staleness · M mechanical · O owner · L3 scale
  formatters and lint --fix re-run here — style, not contract
  codemod / framework sweep = `Mechanical-Change:` trailer
    ├─ ages no spec (L2-exempt)
    └─ M rejects the commit if it touches openspec/specs or acceptance tests
  │
  ▼  push
DOOR 3 · CI (machine verdicts only) ──────────────────────────────────────────
  guard job · acceptance suite · linter job · static-analysis job
  red build ▶ opt-in agent triage ▶ diagnosis comment on the PR
```

| Tool class | Role | Rules |
|---|---|---|
| formatter / codestyle fixer | producer, implementation | Editor and implementer loop; style is never spec content. A repo-wide format sweep commits with a `Mechanical-Change:` trailer: it can't touch specs or acceptance tests, and it ages no spec (M + L2 exemption). |
| linter | producer + door verdict | Part of the done-condition; `verify by` may pin it when a task exists to fix style. Doors 2 and 3 re-run it so a skipped producer loop is visible. |
| static analysis (type checks, security scanners) | producer + door verdict | Part of the done-condition; deterministic failures fail the door-3 build beside the guard. Findings are triage, not contract: behavior-affecting ones enter the change loop as proposals; ones the team elevates to architecture become requirements with scenarios. A repo-wide type-fix sweep is mechanical like lint. |
| helper / shared code | implementation, **single owner** | A file is claimed by at most one capability's `Code:` glob (guard check O). A helper several capabilities use stays under its owner's glob — or, once it carries its own requirement, is promoted to its own capability with its own scenario + acceptance test. |
| framework sweeps / codemods | mechanical class | Same trailer: contract untouched, staleness exempt. If the sweep changes behavior, the acceptance tests catch it — that is what they exist for — and the behavior part goes through the change loop like any change. |

The trailer is self-certified but safe to trust: it only silences *staleness*
(spec text), and a mechanical commit touching the contract layer is rejected
outright. Behavior is arbitrated by acceptance tests — which no mechanical
commit may edit.

| S32 | — | the agent manual (`openspec/AGENTS.md`) names real artifacts, documents every guard check, and root AGENTS.md routes to it |

### The agent page — `openspec/AGENTS.md`

Agents don't read READMEs or docs folders; they read `AGENTS.md` files, and
the OpenSpec CLI itself looks for `openspec/AGENTS.md`. That file is the
consumer page: the one rule (no behavior change without an open change),
map-first brownfield onboarding, the change loop, the doors, and the memory
artifacts — lean enough to be read every session. Root `AGENTS.md` carries
only a marker paragraph routing agents there. When you adopt, copy the tree
and keep both files.

### Architectural decisions and the glossary — memory beside the contract

Specs are promises, tasks are plans, tests are proof — none of them remember
*why*. A codebase where the reasons live only in osmosis loses them at the
first team rotation. Two artifacts fix that, both lazily created, both guarded:

**`openspec/decisions/` — ADRs.** One decision per file, minimal format:

```markdown
---
status: accepted          # accepted | superseded | draft | proposed
code: src/usage-report/** # globs this decision governs
supersedes: ADR-0004      # only when replacing one
---
# Title

One paragraph: context, options, why this one. Longer only if it earns it.
```

Create an ADR only when **all four** hold — hard to reverse, surprising
without context, a real trade-off, and crossing capability boundaries.
Anything less is proposal content and dies with its change. The lifecycle is
create → cite → supersede → freeze; superseding means a new ADR that
`supersedes:` the old one, with the old one flipped to `status: superseded`
*in the same commit*. Existing ADRs elsewhere (e.g. `docs/adr/`) stay where
they are — add a thin index entry under `openspec/decisions/` carrying their
`code:` globs so the guard sees them. Archive-time ingestion: `arch-extract`
labels every induced decision `derived` vs `interpreted`, so a scanner's
suggestion never masquerades as a person's conclusion.

**Guard checks** (full scan, beside L/M/O):

- **A0 — lifecycle**: status is valid, `supersedes:` resolves, and a
  superseded target actually flipped status in the same commit
- **A1 — citation on touch**: an open change whose code overlaps an accepted
  decision's globs must cite that ADR in its proposal — follow it or
  supersede it, never drift past it silently
- **A2 — staleness**: code under a decision's globs moving past the decision
  is silent rot. Reconfirm (touch the decision in the same commit) or
  supersede. The on-touch contradiction audit *is* A2; induced-vs-recorded
  disagreements surface in the `arch-extract` report — machines detect,
  humans and agents resolve.

**`openspec/GLOSSARY.md` — the language.** One canonical term per concept,
tight definitions, and an `_Avoid_` list marking the graves of rejected
synonyms. Consulted at the design gate (step ① challenges new vocabulary
against it) — language only, never implementation detail, and deliberately
without a `capability:` field: the spec tree is already the index, and a
second home for capability names would be write-coupling, not coverage.
Traceability stays where it belongs: markdown in the openspec tree, zero
spec markers in source code.

**`arch-extract` — Phase 0 for structure.** The sibling of `spec-extract`
(which maps contract) maps the as-built architecture: deterministic scanners
for manifests, directory taxonomy, entrypoints, import adjacency, and churn
clusters (`derived`), an `interpreted` section only a human or agent fills,
and recorded decisions ingested as ground truth. `npm run arch-extract`, or
`--json` for the same evidence machine-readable.
### Brownfield adoption — strangler fig, not big bang

Existing projects have no specs, and every guard check is scoped by *ownership*
(`Code:` globs) — a repo with zero specs passes all three doors trivially.
Safe, but worthless until territory becomes owned. The migration has four moves:

| Phase | Move | What happens |
|---|---|---|
| 0 · adopt | copy `openspec/` + `.githooks/`, CI on | every *new* change is born owned; legacy stays explicitly unowned. `tests/acceptance/` is contract territory from day one — leave it empty; legacy tests stay where they are and surface via `--tests` |
| 1 · extract | per capability area, an agent drafts a spec-change **from the existing tests**; humans review | each scenario's `Verified by` pins a test that already exists — and the same change **moves that test into `tests/acceptance/`**, pin and move in one commit. Review asks the **WANT-question**: "is this what we *want*?", not "is this accurate?" (the pins answer accuracy). Mark the proposal `Extracted from: <test paths>` so readers know the intent was reverse-engineered. |
| 2 · own-on-touch | weak-test areas stay unowned until first changed | that change brings the spec seed for the behavior it touches; known-but-untested behavior enters as a proposal pinning tests that don't exist yet — test-first tasks create them |
| 3 · burn-down | `openspec/scripts/spec-extract.mjs` | deterministic map (no LLM): unpinned tests = extraction candidates, unowned files = exposure, `% owned` = the adoption metric |

Two rules keep extraction honest:

- **Extract only what a test pins.** A test *is* a scenario — arrange/act/assert
  is GIVEN/WHEN/THEN. Code alone says what the system *does*, never what it is
  *for*: requirements reverse-engineered from untested code are plausible fiction.
- **Extraction blesses the status quo.** Bugs get extracted as scenarios too —
  by design: from approval on, fixing one is a visible contract amendment, not
  a silent code change. The WANT-review is the gate; the guard then enforces
  whatever survived it. Batch by capability — a 500-scenario PR is review theater.

```bash
node openspec/scripts/spec-extract.mjs               # the map, human-readable
node openspec/scripts/spec-extract.mjs --json        # burn-down over time (CI badge)
node openspec/scripts/spec-extract.mjs --tests src   # tests living next to their sources
```


### Kicking off step 1 — example agent prompt

Copy, replace the two placeholders, hand to your agent of choice:

```text
Draft a spec-extraction proposal for the capability area "<area>",
e.g. "billing" or "reporting". Work evidence-first:

1. Run `node openspec/scripts/spec-extract.mjs --json` (add `--tests <glob>`
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
7. Self-check, then report: `node openspec/scripts/spec-drift.mjs` must be green,
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
node tests/smoke.mjs        # runs the full loop against a throwaway project, 26/26
```

Requirements: Node ≥ 20 and the OpenSpec repo cloned at `vendor/OpenSpec`
(`git clone --depth=1 https://github.com/Fission-AI/OpenSpec vendor/OpenSpec && cd vendor/OpenSpec && pnpm install`).

### Use the schema in your own project

1. Copy this repo's `openspec/` and `.githooks/` folders into your project root, then `git config core.hooksPath .githooks` (door 2) — the CI workflow (door 3) copies along. Assert `openspec --version` matches your init version first: a stale global install silently shadows `npx` (a 1.1.1 global produced archive data loss and missing commands behind 1.14.3-generated skills).
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
| S22 | — | config rules parse as strings (the CLI never silently drops them), and the "source code stays clean — no spec markers" rule stays engraved |
| S23 | — | every `rules:` key matches a schema artifact id, and `openspec instructions --json` runs without "Unknown artifact ID" stdout pollution (run-3 finding) |
| S23 | C5 | capability lifecycle: open change → `archive` → follow-up change on the same capability all stay green (archived deltas stop claiming; in-flight delta + code + test in one commit is fresh) |
| S24 | C5 | one capability, one owner: parallel open changes on a capability and cross-capability `Code:` double-claims go red; single owner + its own delta passes |
| S25 | C2/C5 | Holzborste findings engraved: satisfiability rule, test-contract migration, pi skills for the tools |
| S26 | — | patch 2117 (pinned v1.14.3 @ c794978f): `new change` reports and persists the resolved schema — applied to the vendored CLI, rebuilt, and probed end-to-end against this repo's own schema |
| S27 | — | the generated `openspec-archive-change` skill is the lean-verified one, shipped as a version-pinned patch of the vendored template (runs 3-5 wording) |
| S28 | — | the other five skill templates (apply/explore/propose/sync/update) ship as pinned patches too: `/opsx-*` names, no never-installed `continue-change` ghosts, no init-time bookkeeping |
| S30 | — | ADR guard checks: A1 red on uncited touch → cite → A2 red on staleness → reconfirm → A0 red on half-done supersede → flip |
| S31 | — | arch-extract derives the as-built report (derived/interpreted separated) and ingests decisions as ground truth |

Fixtures: `tests/fixtures/bad-ambiguous/` (the critique, verbatim) vs
`tests/fixtures/good-verified/` (the fix, same feature — including its recorded
design-gate skip and pinned acceptance test).

## Validated in the wild
## Patching the vendored CLI

Upstream bug [Fission-AI/OpenSpec#2117](https://github.com/Fission-AI/OpenSpec/issues/2117):
`openspec new change` prints and persists `spec-driven` even when `config.yaml`
selects a custom schema, because `root.defaultSchema` is hardcoded and the raw
`--schema` flag (undefined when omitted) is persisted. Until it is fixed
upstream, this repo carries a version-pinned patch:

- `patches/openspec-2117-new-change-schema-label_v1.14.3.patch` — pinned to
  upstream **v1.14.3 @ c794978f**; three hunks: resolve the schema from
  `readProjectConfig(root).schema`, fall back to `root.defaultSchema`, and
  persist the resolved value.
- `patches/openspec-archive-change-skill-lean_v1.14.3.patch` — replaces the
  generated `openspec-archive-change` skill with the lean-verified one
  (mechanical finish step, archive+commit as one stop, staged `openspec/` only,
  frozen history): the exact wording dogfooded in runs 3-5.
- `patches/openspec-{apply-change,explore,propose,sync-specs,update-change}-skill-lean_v1.14.3.patch`
  — fix the other five generated skills' stale cross-references: they point at
  long command names (`/openspec-apply-change`) while the shipped prompts are
  `/opsx-*`, and at `/openspec-continue-change`, a skill `init` never installs
  into projects.
- `scripts/apply-openspec-patches.sh` — applies every patch in `patches/`,
  idempotently (`npm run patch:openspec`). A patch that neither applies nor
  reverse-applies means upstream moved past the pin: it refuses with a rebase
  hint instead of half-applying.
- Smoke tests **S26** and **S27** apply the patches, rebuild `vendor/OpenSpec`
  when `src/` changed, and probe the results: S26 checks `new change` reports
  the configured schema end-to-end; S27 pins the vendored skill template to the
  lean wording.

To rebase after an upstream release: rebuild `vendor/OpenSpec` at the new pin,
regenerate the diffs into `patches/`, and update the pins in the script header,
the filenames, and this section.

## Validated in the wild

The full loop (schema + guard + hooks + `openspec init --agent pi` skills) was
dogfooded twice on the same product — once by the schema's author, once by four
cold-start agents that had never seen the project. Result: near-identical
contracts (17 requirements each), 100% first-try `validate --strict`, zero
guard blocks, zero hook bypasses. Numbers, per-agent detail, and the findings
ledger: **[case-study-holzborste.md](case-study-holzborste.md)**.

## Layout

```
.github/workflows/spec-drift.yml # door 3: CI backstop (fetch-depth: 0)
.gitlab-ci.yml                     # door 3 on GitLab (kept in parity with the workflow above)
.githooks/pre-commit             # door 2: commit-time guard (--staged)
openspec/
  config.yaml                    # schema: lean-verified + injected rules/context
  scripts/
    spec-drift.mjs               # the drift guard: L1 traceability + L2 staleness + L3 scale
    spec-extract.mjs             # brownfield map: extraction candidates + unowned files + burn-down
  schemas/lean-verified/
    schema.yaml                  # proposal, specs, design gate, tasks + apply contract
    templates/{proposal,spec,design,tasks}.md
tests/
  smoke.mjs                      # 26 checks, C1–C5 + brownfield mapping + split rule + capability lifecycle
  fixtures/{bad-ambiguous,good-verified}/
docs/transcript.srt              # the source critique
vendor/OpenSpec/                 # upstream repo for research + CLI (not committed)
```
