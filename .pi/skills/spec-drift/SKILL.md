---
name: spec-drift
description: Run and interpret the lean-verified drift guard (openspec/scripts/spec-drift.mjs) — the three-door check that keeps spec, acceptance tests, and code traveling together. Use when a commit is blocked by the pre-commit hook, when CI shows a spec-drift failure, when triaging an [L1]/[L2]/[O]/[L3] verdict, or before archiving a change.
---

# spec-drift — the three-door drift guard

`node openspec/scripts/spec-drift.mjs [--staged]` — exit 0 clean, 1 drift, 2 usage/environment.

- **Door 1** apply preflight: run it bare before you commit.
- **Door 2** pre-commit hook (`.githooks/pre-commit` runs `--staged`): scopes checks to the git index. **Never bypass it (`--no-verify` is forbidden).**
- **Door 3** CI: full scan on every push.

## Verdicts and fixes

| Code | Meaning | Fix |
|---|---|---|
| `[L1] … pins "x" but that file does not exist` | spec pins an acceptance test that's gone | restore the test or update the Verified by line |
| `[L1] new acceptance test/orphan … pinned by no spec` | test exists without a contract | add a "Verified by" scenario or move it out of tests/acceptance/ |
| `[L1] staged deletion … but spec still pins it` | test deleted, spec not updated | update the spec in the SAME commit |
| `[L2] … declares Code: … but no tracked file matches` | stale glob | fix the glob or remove the Code line |
| `[L2] staged code … but no spec of <cap> is in this commit` | code without spec | spec and code travel together — include the delta/living-spec update |
| `[L2] … changed after every spec … last changed` | code moved past its spec | update the scenario or Code line, commit together |
| `[O] … claimed by N capabilities` | two specs own one file | narrow the globs or give the shared helper its own capability |
| `[O] open changes … claim … in parallel` | conflicting open changes | merge them, or record `Depends on:` and land the follower after |
| `[L3] tasks.md holds N tracked tasks (>12)` | decomposition signal | split the proposal, or record `<!-- split-considered: kept whole because … -->` |

## Known transient

Between `openspec archive --yes` and the archive commit, the full scan is red
(`[L2] … changed after every spec …`) because the CLI rewrote the living spec
and it is not yet committed. That is expected: commit the archive immediately
and the guard goes green. Do not "fix" it by editing the spec by hand.

## Mechanical changes

Lint, codestyle, codemods, dependency/framework sweeps that touch no contract:
add a `Mechanical-Change: <reason>` trailer (or `[mechanical]` subject). Such
commits skip L2 but must never touch specs or acceptance tests.
