# Working in this repository — operating manual for agents

The `openspec/` tree is the contract. Code is proof. Specs say *what*, tests
prove it, code performs. This page is how you operate inside that world.

## The one rule

**Never change behavior without an open change that carries the spec delta.**
If you are about to edit a tracked file and no open change's `Code:` globs
cover it, stop: author the change first (or extend an open one).

## Before you start (brownfield or unknown territory)

Map before you propose. If the repo has Phase 0 extractors, run them and read
the reports before designing anything:

```
npm run spec-extract -- --json   # which behaviors are already pinned
npm run arch-extract             # as-built structure + recorded decisions
```

`derived` sections are scanner facts; `interpreted` sections are judgments —
never copy a `derived` claim into a spec as if a human concluded it.

## The change loop (door 1 — authoring)

1. **Design gate.** Challenge the requested behaviors: which capability owns
   each? Consult `openspec/GLOSSARY.md` for canonical vocabulary and its
   `_Avoid_` list. Check `openspec/decisions/` — if your code overlaps an
   accepted decision's `code:` globs, cite `ADR-NNNN` in the proposal
   (follow it) or supersede it; drifting past it fails the guard (A1).
2. **Proposal + spec delta.** Scenarios state observable behavior, one
   example, and end with `Verified by: <committed acceptance-test path>`.
   `Code:` globs declare which files this change owns — neither more nor
   less than you intend to touch.
3. **Tasks + implementation.** Every task ends with its verify-by pin.
   Acceptance tests land in the same commit as the behavior they pin.

## Doors 2 and 3 — verification is not your call

- **Pre-commit** runs the drift guard (L1 pins · L2 staleness · M mechanical
  · O owner · L3 scale · A0 lifecycle · A1 citation · A2 decision staleness).
  Red means stop and fix the cause. **Never** `--no-verify`.
- **CI** re-runs the guard plus the acceptance suite and tool jobs
  (lint/static analysis). Verdicts are machine-owned; a red build is a fact,
  not an opinion to argue with.
- Linters, formatters, codemods, framework sweeps are *mechanical*: commit
  them with a `Mechanical-Change: <reason>` trailer. They age no spec and
  must never touch `openspec/specs/` or acceptance tests — the guard rejects
  that (M).

## Memory

- `openspec/GLOSSARY.md` — canonical language; don't introduce synonyms.
- `openspec/decisions/` — the *why*, with `status:` and `code:` globs;
  supersede openly, never edit history silently.
- Archived changes are frozen history. Never modify them.

Traceability lives in this tree only — source code carries no spec markers.
