# AGENTS.md — openspec-cdd

This repo builds and dogfoods the contract-driven development method on
OpenSpec. The full operating manual is [`openspec/AGENTS.md`](openspec/AGENTS.md) —
read it before touching specs, code, or the guard.

Quick facts for working *on* this repo:

- `npm test` — the 34-check smoke suite (add a row to the table in
  `README.md` for every new check; the table and the suite must stay in lockstep)
- `npm run spec-drift` — the guard; red is a finding, never noise
- Changes to this repo go through the same loop they enforce: open change,
  spec delta with `Verified by:` pins, then implementation
