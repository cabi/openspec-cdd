#!/usr/bin/env node
// spec-drift — the lean-verified drift guard (C5 companion).
//
// Premise: code is the truth, the spec is the index. This script keeps the
// index honest. Same script, three doors, nearest to where drift starts:
//   1. apply preflight  — the schema's apply instruction runs it before `openspec archive`
//   2. pre-commit hook  — .githooks/pre-commit runs it with --staged
//   3. CI               — full scan on push/PR (needs fetch-depth: 0)
//
// L1 traceability (always, no git needed):
//   - every `Verified by <path>` pin in every spec resolves to an existing file
//   - every file under tests/acceptance/ (or test/acceptance/) is pinned by some spec
//
// L2 staleness (living specs with git history):
//   - a requirement may carry `Code: <glob>` lines; if a matching file was
//     committed after the spec file last changed, the spec is stale — the code
//     and the spec must travel together.
//     and the spec must travel together. Commits marked mechanical (a
//     `Mechanical-Change: <reason>` trailer or a `[mechanical]` subject —
//     lint --fix sweeps, codemods, framework updates) do not advance the
//     clock: they carry no contract information.
//
// M mechanical integrity (full scan): a commit claiming to be mechanical
//     must not touch openspec/specs/ or the acceptance tests. Behavior
//     change? Not mechanical — contract travels with code, through the loop.
//
// O single owner: a file claimed by two specs' Code: globs is an unowned
//     helper — narrow the globs, or give the helper its own capability.
//
// --staged scopes the checks to the current index (the commit door):
//   staged acceptance-test deletions, staged orphan acceptance tests, or staged
//   code matching Code: globs fail unless the spec is updated in the same commit.
// L3 scale (living changes): a task list past 12 tracked tasks is a
//     decomposition signal, not a work plan — long checklists are where
//     model execution stops being reliable (mid-list skips, phantom
//     ticks). The split procedure lives in the schema's tasks
//     instruction. A recorded `split-considered:` decision passes;
//
// A architectural decisions (openspec/decisions/, full scan) — memory beside
//     the contract, created only when a decision is hard to reverse,
//     surprising without context, a real trade-off, and crosses capability
//     boundaries:
//   A0 lifecycle — status is valid, supersedes resolves, and a superseded
//     target actually flipped its status in the same commit
//   A1 citation on touch — an open change whose code overlaps an accepted
//     decision's `code:` globs must cite that ADR (follow it) or supersede it
//   A2 staleness — code under a decision's globs moving past the decision is
//     silent rot: reconfirm (touch the decision in the same commit) or
//     supersede it with a new ADR
//     archived changes are frozen history and are never nagged.
//
//
// exit 0 = no drift · 1 = drift found · 2 = usage/setup error

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const staged = argv.includes('--staged');
const unknown = argv.filter((a) => a !== '--staged');
if (unknown.length) {
  console.error(`usage: spec-drift.mjs [--staged]  (unknown args: ${unknown.join(' ')})`);
  process.exit(2);
}

// --- locate the project root (the dir that owns openspec/) --------------------
function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'openspec'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
const root = findRoot(process.cwd());
if (!root) {
  console.error('spec-drift: no openspec/ directory found upward from cwd');
  process.exit(2);
}

// --- git helpers ----------------------------------------------------------------
function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const isRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true';

// commits marked mechanical (lint sweeps, codemods, framework updates) carry
// no contract information — they advance neither side of the staleness clock
const MECH_GREP = '^Mechanical-Change:|^\\[mechanical\\]';

function lastCommit(file) {
  return (
    git([
      'log', '-1', '--format=%H',
      '--extended-regexp', '--grep', MECH_GREP, '--invert-grep',
      '--', file,
    ]) || null
  );
}

// --- collect specs: pins + code globs -------------------------------------------
const issues = [];
const pinRe = /Verified by[*:]*\s*`?([^\s`]+)`?/g;
const codeRe = /^\s*(?:-\s+)?Code:\s*(.+)$/gm;

function specsIn(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) specsIn(p, acc);
    else if (e.name === 'spec.md') acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const livingSpecs = specsIn(path.join(root, 'openspec', 'specs')).map(rel);
const deltaSpecs = specsIn(path.join(root, 'openspec', 'changes'))
  .map(rel)
  .filter((r) => !r.startsWith('openspec/changes/archive/')); // archive = frozen history, never a claimant
const allSpecs = [...livingSpecs, ...deltaSpecs];

/** Resolve a pin the way OpenSpec layouts work: project root first (living
 *  specs), then the change dir the spec belongs to (in-flight changes). */
function pinCandidates(pin, specRel) {
  const out = [pin];
  const m = specRel.match(/^openspec\/changes\/[^/]+\//);
  if (m) out.push(m[0] + pin);
  return out;
}
function pinResolve(pin, specRel) {
  for (const c of pinCandidates(pin, specRel)) {
    if (fs.existsSync(path.join(root, c))) return c;
  }
  return null;
}

const pinsOf = new Map(); // specRel -> [{ pin, resolved }]
const codeGlobs = new Map(); // specRel -> [globs]
for (const specRel of allSpecs) {
  const text = fs.readFileSync(path.join(root, specRel), 'utf8');
  pinsOf.set(
    specRel,
    [...text.matchAll(pinRe)].map((m) => ({ pin: m[1], resolved: null }))
  );
  for (const p of pinsOf.get(specRel)) p.resolved = pinResolve(p.pin, specRel);
  codeGlobs.set(
    specRel,
    [...text.matchAll(codeRe)].flatMap((m) =>
      m[1]
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((g) => g.replace(/`/g, ''))
    )
  );
}

// --- capability model: a living spec plus its open deltas are ONE spec line ---
const changeOf = (specRel) => (specRel.match(/^openspec\/changes\/([^/]+)\//) ?? [])[1] ?? '';
const capOf = (specRel) =>
  specRel
    .replace(/^openspec\/specs\//, '')
    .replace(/^openspec\/changes\/[^/]+\/specs\//, '')
    .replace(/\/spec\.md$/, '');
const pinnedAbs = new Set(
  allSpecs.flatMap((s) => pinsOf.get(s).map((p) => p.resolved)).filter(Boolean)
);

// --- acceptance-test dirs (convention) ------------------------------------------
const accDirs = ['tests/acceptance', 'test/acceptance']
  .map((d) => path.join(root, d))
  .filter((d) => fs.existsSync(d));
function accFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) accFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}
const accRel = accDirs.flatMap((d) => accFiles(d).map(rel));

function globToRe(glob) {
  const re = glob
    .split('**')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${re}$`);
}

// ==============================================================================
// L1 — forward: every pin resolves (staged mode: only specs staged in this commit)
// ==============================================================================
const stagedSet = new Set(
  staged && isRepo ? (git(['diff', '--cached', '--name-only']) ?? '').split('\n').filter(Boolean) : []
);
const specsToCheck = staged ? allSpecs.filter((s) => stagedSet.has(s)) : allSpecs;
for (const specRel of specsToCheck) {
  for (const { pin, resolved } of pinsOf.get(specRel)) {
    if (!resolved) {
      issues.push(`[L1] ${specRel} pins "${pin}" but that file does not exist — restore the acceptance test or update the Verified by line`);
    }
  }
}

// ==============================================================================
// L1 — reverse: every acceptance test is pinned somewhere
// (staged mode: only files newly added to tests/acceptance/)
// ==============================================================================
if (staged && isRepo) {
  const stagedAdds = (git(['diff', '--cached', '--name-only', '--diff-filter=A']) ?? '')
    .split('\n')
    .filter(Boolean);
  for (const f of stagedAdds) {
    if (accDirs.some((d) => path.join(root, f).startsWith(d + path.sep)) && !pinnedAbs.has(f)) {
      issues.push(`[L1] new acceptance test ${f} is pinned by no spec — add a "Verified by" scenario or move it out of tests/acceptance/`);
    }
  }
} else {
  for (const f of accRel) {
    if (!pinnedAbs.has(f)) {
      issues.push(`[L1] orphan acceptance test ${f} — pinned by no spec; update the spec's scenarios or delete the test`);
    }
  }
}

// ==============================================================================
// L1 — the commit door: staged deletions of pinned tests
// ==============================================================================
if (staged && isRepo) {
  const stagedDels = (git(['diff', '--cached', '--name-only', '--diff-filter=D']) ?? '')
    .split('\n')
    .filter(Boolean);
  for (const f of stagedDels) {
    for (const specRel of allSpecs) {
      const hit = pinsOf
        .get(specRel)
        .some((p) => p.resolved === f || pinCandidates(p.pin, specRel).includes(f));
      if (hit && !stagedSet.has(specRel)) {
        issues.push(`[L1] staged deletion of ${f} but ${specRel} still pins it — update the spec in this same commit`);
      }
    }
  }
}

// ==============================================================================
// L2 — staleness: code matching Code: globs must not out-commit its spec
// ==============================================================================
const tracked = isRepo ? (git(['ls-files']) ?? '').split('\n').filter(Boolean) : [];

if (isRepo) {
  // applied specs must own real files (open deltas may point at future files)
  for (const specRel of livingSpecs) {
    const globs = codeGlobs.get(specRel);
    if (!globs.length) continue;
    const res = globs.map(globToRe);
    if (!tracked.some((f) => res.some((re) => re.test(f)))) {
      issues.push(`[L2] ${specRel} declares Code: ${globs.join(', ')} but no tracked file matches — fix the glob or remove the line`);
    }
  }
  // staleness is per CAPABILITY: the tip is the newest commit of the living
  // spec or any open delta. Code may out-commit older parts of the line
  // freely — that is what an in-flight change is.
  const caps = new Map(); // cap -> { specRels: [], globs: [] }
  for (const specRel of allSpecs) {
    const cap = capOf(specRel);
    if (!caps.has(cap)) caps.set(cap, { specRels: [], globs: [] });
    const c = caps.get(cap);
    c.specRels.push(specRel);
    c.globs.push(...(codeGlobs.get(specRel) ?? []));
  }
  for (const [cap, { specRels, globs }] of caps) {
    if (!globs.length) continue;
    const res = globs.map(globToRe);
    const matches = tracked.filter((f) => res.some((re) => re.test(f)));
    if (!matches.length) continue;
    if (staged) {
      const stagedCode = matches.filter((f) => stagedSet.has(f));
      if (stagedCode.length && !specRels.some((s) => stagedSet.has(s))) {
        issues.push(`[L2] staged code ${stagedCode.join(', ')} but no spec of ${cap} is in this commit — spec and code travel together (update the living spec or the change's delta)`);
      }
    } else {
      const specCs = specRels.map(lastCommit).filter(Boolean);
      if (!specCs.length) continue; // nothing committed yet — nothing to compare
      for (const f of matches) {
        const codeC = lastCommit(f);
        // stale = EVERY spec of the capability predates the code commit
        // (topology, not wall-clock: git timestamps have second resolution)
        if (codeC && specCs.every((specC) => codeC !== specC && git(['merge-base', '--is-ancestor', specC, codeC]) === '')) {
          issues.push(`[L2] ${f} changed after every spec of ${cap} last changed — update the spec (scenario or Code line) and commit them together`);
        }
      }
    }
  }
}

// ==============================================================================
// M — mechanical integrity: a commit marked mechanical must not touch the
// contract layer (specs, acceptance tests). Otherwise "mechanical" becomes a
// smuggling route past the commit door. (History check — full scan only; at
// the commit door the message doesn't exist yet, CI re-checks the tip.)
// ==============================================================================
if (isRepo && !staged) {
  const mechLog = git([
    'log', '-n', '1000', '--extended-regexp', '--grep', MECH_GREP,
    '--format=%h', '--name-only',
  ]);
  if (mechLog) {
    let hash = '';
    for (const line of mechLog.split('\n')) {
      if (!line) continue;
      if (/^[0-9a-f]{7,40}$/.test(line)) {
        hash = line;
        continue;
      }
      const isContract =
        line.startsWith('openspec/specs/') ||
        accDirs.some((d) => path.join(root, line).startsWith(d + path.sep));
      if (isContract) {
        issues.push(`[M] mechanical commit ${hash} touches the contract (${line}) — split it: a behavior change goes through the change loop, contract and code together`);
      }
    }
  }
}

// ==============================================================================
// O — single owner, capability-aware: a file claimed by two capabilities'
// Code: globs is an unowned helper. A living spec and its own open delta
// overlapping is the mechanism (in-flight update), not drift. Two open
// changes claiming one capability collide at apply — merge or serialize
// with "Depends on:". archive/ is frozen history and never a claimant.
// ==============================================================================
if (isRepo) {
  const owner = new Map(); // file -> Map(cap -> Set(changeId | ''))
  for (const specRel of allSpecs) {
    const res = (codeGlobs.get(specRel) ?? []).map(globToRe);
    if (!res.length) continue;
    for (const f of tracked) {
      if (!res.some((re) => re.test(f))) continue;
      if (!owner.has(f)) owner.set(f, new Map());
      const byCap = owner.get(f);
      const cap = capOf(specRel);
      if (!byCap.has(cap)) byCap.set(cap, new Set());
      byCap.get(cap).add(changeOf(specRel));
    }
  }
  for (const [f, byCap] of owner) {
    if (byCap.size > 1) {
      issues.push(`[O] ${f} is claimed by ${byCap.size} capabilities (${[...byCap.keys()].join(', ')}) — one capability owns a file; narrow the Code: globs or give the shared helper its own capability`);
    } else {
      const [cap, changes] = [...byCap][0];
      const open = [...changes].filter(Boolean);
      if (open.length > 1) {
        issues.push(`[O] ${f}: open changes ${open.join(', ')} claim capability ${cap} in parallel — merge them, or record "Depends on:" and land the follower after; overlapping open changes collide at apply`);
      }
    }
  }
}

// ==============================================================================
// L3 — scale: a living change's task list past 12 tracked tasks. The design
// gate (T5) fires at >8 as foresight; this is the backstop for when the gate
// was skipped or wrong. The exception is explicit, not silent: a recorded
// split-considered decision passes, matching the skip-record pattern.
// ==============================================================================
const TASK_LIMIT = 12;
const changesDir = path.join(root, 'openspec', 'changes');
if (fs.existsSync(changesDir)) {
  for (const e of fs.readdirSync(changesDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'archive') continue;
    const tasksRel = `openspec/changes/${e.name}/tasks.md`;
    if (!fs.existsSync(path.join(root, tasksRel))) continue;
    if (staged && !stagedSet.has(tasksRel)) continue;
    const text = fs.readFileSync(path.join(root, tasksRel), 'utf8');
    const n = (text.match(/^\s*-\s+\[[ xX]\]/gm) ?? []).length;
    if (n > TASK_LIMIT && !/split-considered:/i.test(text)) {
      issues.push(`[L3] ${tasksRel} holds ${n} tracked tasks (> ${TASK_LIMIT}) — a long task file is a decomposition signal, not a work plan; split the proposal (the Done When Traceability table shows the cut lines) or record "<!-- split-considered: kept whole because <reason> -->"`);
    }
  }
}

// ==============================================================================
// A — architectural decisions (openspec/decisions/): the memory that replaces
// osmosis. Beside the contract tree in form, visible to the guard in fact.
// ==============================================================================
const decisionsDir = path.join(root, 'openspec', 'decisions');
const adrs = [];
if (fs.existsSync(decisionsDir)) {
  for (const e of fs.readdirSync(decisionsDir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const num = e.name.match(/^(\d{4})-/);
    if (!num) continue;
    const fileRel = `openspec/decisions/${e.name}`;
    const text = fs.readFileSync(path.join(root, fileRel), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    const header = {};
    for (const line of (fm ? fm[1] : '').split('\n')) {
      const kv = line.match(/^([\w-]+):\s*(.+)$/);
      if (kv) header[kv[1]] = kv[2].trim();
    }
    adrs.push({
      id: `ADR-${num[1]}`,
      fileRel,
      status: (header.status ?? 'accepted').toLowerCase(),
      supersedes: header.supersedes ?? null,
      globs: (header.code ?? '').split(/[,\s]+/).filter(Boolean).map((g) => g.replace(/`/g, '')),
    });
  }
}
const adrByNum = new Map(adrs.map((a) => [a.id.replace(/^ADR-/, ''), a]));

if (adrs.length) {
  // A0 — lifecycle integrity
  for (const a of adrs) {
    if (!['accepted', 'superseded', 'draft', 'proposed'].includes(a.status)) {
      issues.push(`[A0] ${a.fileRel} has unknown status "${a.status}" — use accepted, superseded, draft, or proposed`);
    }
    if (a.supersedes) {
      const target = adrByNum.get(a.supersedes.replace(/^ADR-/, ''));
      if (!target) {
        issues.push(`[A0] ${a.fileRel} supersedes ${a.supersedes} but no such decision exists`);
      } else if (target.status === 'accepted') {
        issues.push(`[A0] ${a.fileRel} supersedes ${target.id} but ${target.id} is still accepted — flip its status to superseded in the same commit`);
      }
    }
  }

  const acceptedAdrs = adrs.filter((a) => a.status === 'accepted' && a.globs.length);
  const filesOf = (globs) => {
    const res = globs.map(globToRe);
    return tracked.filter((f) => res.some((re) => re.test(f)));
  };

  // A1 — citation on touch: follow it or supersede it, never drift past it
  if (!staged) {
    const changeFiles = new Map(); // change -> Set(tracked files its deltas claim)
    for (const specRel of deltaSpecs) {
      const res = (codeGlobs.get(specRel) ?? []).map(globToRe);
      if (!res.length) continue;
      const change = specRel.split('/')[2];
      for (const f of tracked) {
        if (res.some((re) => re.test(f))) {
          if (!changeFiles.has(change)) changeFiles.set(change, new Set());
          changeFiles.get(change).add(f);
        }
      }
    }
    for (const [change, files] of changeFiles) {
      const cdir = path.join(root, 'openspec', 'changes', change);
      const docs = fs
        .readdirSync(cdir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => fs.readFileSync(path.join(cdir, e.name), 'utf8'))
        .join('\n');
      for (const a of acceptedAdrs) {
        const governed = new Set(filesOf(a.globs));
        const overlap = [...files].filter((f) => governed.has(f));
        if (!overlap.length) continue;
        if (!docs.includes(a.id)) {
          issues.push(`[A1] change ${change} touches code governed by ${a.id} (${a.fileRel}; e.g. ${overlap[0]}) — cite "${a.id}" in the proposal (follow it) or supersede the decision first`);
        }
      }
    }
  }

  // A2 — staleness: silent rot detection. Same topology trick as L2: the
  // decision is stale when the code commit is a descendant of the decision's
  // last commit. Reconfirming = touching the decision in the same commit.
  if (isRepo && !staged) {
    for (const a of acceptedAdrs) {
      const adrC = lastCommit(a.fileRel);
      if (!adrC) continue; // decision not committed yet — nothing to compare
      for (const f of filesOf(a.globs)) {
        const codeC = lastCommit(f);
        if (codeC && adrC !== codeC && git(['merge-base', '--is-ancestor', adrC, codeC]) === '') {
          issues.push(`[A2] ${f} moved after ${a.id} was last touched — silent rot: reconfirm the decision (update ${a.fileRel} in this commit) or supersede it with a new ADR that marks this one superseded`);
          break; // one finding per decision is enough to ring the bell
        }
      }
    }
  }
}

// --- report --------------------------------------------------------------------
if (issues.length) {
  console.error(`spec-drift: ${issues.length} issue(s) in ${path.basename(root)} — the spec, its acceptance tests, and the code must travel together:`);
  for (const i of issues) console.error(`  ${i}`);
  process.exit(1);
}
console.log(
  allSpecs.length
    ? `spec-drift: clean (${allSpecs.length} spec${allSpecs.length > 1 ? 's' : ''}, ${accRel.length} acceptance test${accRel.length === 1 ? '' : 's'}, ${staged ? 'staged' : 'full'} scan)`
    : 'spec-drift: no specs found — nothing to guard'
);
