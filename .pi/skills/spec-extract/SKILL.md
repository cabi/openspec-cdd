---
name: spec-extract
description: Map an un-specced codebase for brownfield adoption — deterministic extraction candidates (unpinned acceptance tests), exposure (files no capability owns), and the % owned burn-down metric. Use when starting OpenSpec adoption on an existing project, when planning a strangler-fig increment, or when CI tracks adoption progress via --json.
---

# spec-extract — the brownfield burn-down map

`node openspec/scripts/spec-extract.mjs [--json] [--tests <dir|glob>]…` — deterministic, no LLM: it reads `openspec/specs/` (Code: globs, Verified by pins) and the test tree, then reports:

- **Extraction candidates** — existing tests pinned by no spec. Each is a
  ready-made acceptance test: wrap its behavior in a scenario (WHEN/THEN),
  add `Verified by: <that test path>`, done.
- **Exposure** — tracked files no capability's `Code:` globs own. Nobody's
  contract protects them; list them in the proposal's risks.
- **% owned** — the adoption metric. `--json` emits it machine-readable for a
  CI badge / burn-down chart over time.

## Adoption loop (strangler fig)

1. Run the map, look at `% owned` and the largest exposure clusters.
2. Pick ONE cluster; write the capability spec around existing behavior —
   the honest source question is "what does the code DO", not "what should it
   do". Capture the WANT (intended behavior worth testing) separately from
   the IS.
3. Pin the cluster's best existing tests as acceptance tests (Verified by);
   write new ones only for unpinned contract-critical paths.
4. Archive the change, re-run the map, watch `% owned` rise. Repeat.
