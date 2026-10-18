---
status: accepted
code: openspec/scripts/**
---
# Zero-dependency Node tooling at the doors

The guard and the Phase 0 extractors are plain Node scripts over `fs` and `git` — no runtime dependencies, no framework. This repo's whole promise is that the doors stay runnable anywhere Node exists: CI images, git hooks, agent sandboxes. A dependency tree sitting at the door would be drift risk guarding drift — the guard must be the thing that never itself needs guarding.
