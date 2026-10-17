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
const deltaSpecs = specsIn(path.join(root, 'openspec', 'changes')).map(rel);
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
  for (const specRel of livingSpecs) {
    const globs = codeGlobs.get(specRel);
    if (!globs.length) continue;
    const res = globs.map(globToRe);
    const matches = tracked.filter((f) => res.some((re) => re.test(f)));
    if (!matches.length) {
      issues.push(`[L2] ${specRel} declares Code: ${globs.join(', ')} but no tracked file matches — fix the glob or remove the line`);
      continue;
    }
    if (staged) {
      const stagedCode = matches.filter((f) => stagedSet.has(f));
      if (stagedCode.length && !stagedSet.has(specRel)) {
        issues.push(`[L2] staged code ${stagedCode.join(', ')} but ${specRel} is not in this commit — spec and code travel together`);
      }
    } else {
      const specC = lastCommit(specRel);
      if (!specC) continue; // spec itself not committed yet — nothing to compare
      for (const f of matches) {
        const codeC = lastCommit(f);
        // stale = the code's last commit moved past the spec's last commit
        // (topology, not wall-clock: git timestamps have second resolution)
        if (codeC && codeC !== specC && git(['merge-base', '--is-ancestor', specC, codeC]) === '') {
          issues.push(`[L2] ${f} changed after ${specRel} last changed — update the spec (scenario or Code line) and commit them together`);
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
// O — single owner: a file claimed by more than one spec's Code: globs is an
// unowned helper. Narrow the globs, or — once the helper carries its own
// requirement — promote it to its own capability with its own acceptance test.
// ==============================================================================
if (isRepo) {
  const owner = new Map(); // file -> Set(specRel)
  for (const specRel of allSpecs) {
    const res = (codeGlobs.get(specRel) ?? []).map(globToRe);
    if (!res.length) continue;
    for (const f of tracked) {
      if (res.some((re) => re.test(f))) {
        if (!owner.has(f)) owner.set(f, new Set());
        owner.get(f).add(specRel);
      }
    }
  }
  for (const [f, specs] of owner) {
    if (specs.size > 1) {
      issues.push(`[O] ${f} is claimed by ${specs.size} specs (${[...specs].join(', ')}) — narrow the Code: globs or promote the helper to its own capability`);
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
