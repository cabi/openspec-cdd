#!/usr/bin/env node
// spec-extract — the brownfield ownership map (strangler-fig companion).
//
// Premise: in an existing project there are no specs. The drift guard is
// scoped by ownership (`Code:` globs), so legacy code is exempt — correct,
// but worthless unless territory becomes owned. This script is the map for
// that migration. It is deterministic: no LLM, no generation, no invention.
// It reports
//   - extraction candidates: existing test files pinned by no spec — the
//     only honest source for reverse-engineering a spec (a test IS a
//     scenario: arrange/act/assert is GIVEN/WHEN/THEN)
//   - unowned territory: tracked files matched by no spec's Code: glob
//   - burn-down: how much of the tree is owned (the adoption metric)
//
// Drafting specs from the candidates is agent authoring work (the change
// loop); approving them is the human WANT-question — extraction blesses the
// status quo, so review asks "is this what we WANT?", not "is this
// accurate?" (accuracy is what the pins are for). This script maps; it does
// not invent intent.
//
// Standalone by design: copied into target projects next to spec-drift.mjs.
//
// usage: spec-extract.mjs [--json] [--tests <dir|glob>]...
//   --tests adds extraction-candidate sources beyond the acceptance
//   convention (tests/acceptance, test/acceptance) — e.g. `--tests src` for
//   codebases whose tests live next to their sources. Repeatable.
//
// exit 0 = report rendered (this is a map, never a verdict) · 2 = usage/setup

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// --- args -----------------------------------------------------------------------
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const testSources = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--tests') testSources.push(argv[++i]);
  else if (argv[i] !== '--json') {
    console.error(`usage: spec-extract.mjs [--json] [--tests <dir|glob>]...  (unknown arg: ${argv[i]})`);
    process.exit(2);
  }
}
if (testSources.some((t) => t === undefined)) {
  console.error('usage: spec-extract.mjs [--json] [--tests <dir|glob>]...');
  process.exit(2);
}

// --- locate the project root (the dir that owns openspec/) ----------------------
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
  console.error('spec-extract: no openspec/ directory found upward from cwd');
  process.exit(2);
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// --- file universe: tracked files if a repo, else a walked tree ------------------
function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const isRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true';

const IGNORED = new Set(['.git', 'node_modules', 'openspec']);
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile()) acc.push(rel(p));
  }
  return acc;
}
const files = isRepo
  ? (git(['ls-files']) ?? '').split('\n').filter(Boolean).filter((f) => !f.startsWith('openspec/'))
  : walk(root);
// the contract itself (openspec/) is not territory; .git/node_modules never are

// --- collect specs: pins + code globs (same grammar as spec-drift.mjs) ----------
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
const livingSpecs = specsIn(path.join(root, 'openspec', 'specs')).map(rel);
const deltaSpecs = specsIn(path.join(root, 'openspec', 'changes')).map(rel);

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

function globToRe(glob) {
  const re = glob
    .split('**')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${re}$`);
}

const pinned = new Set();
const globRes = [];
for (const specRel of [...livingSpecs, ...deltaSpecs]) {
  const text = fs.readFileSync(path.join(root, specRel), 'utf8');
  for (const m of text.matchAll(pinRe)) {
    const r = pinResolve(m[1], specRel);
    if (r) pinned.add(r);
  }
  for (const m of text.matchAll(codeRe)) {
    for (const g of m[1].split(/[,\s]+/).filter(Boolean)) globRes.push(globToRe(g.replace(/`/g, '')));
  }
}

// --- owned territory -------------------------------------------------------------
const owned = new Set(files.filter((f) => globRes.some((re) => re.test(f))));

// --- extraction candidates: test sources pinned by no spec -----------------------
const accDirs = ['tests/acceptance', 'test/acceptance'];
function filesUnderDir(dirRel, acc = []) {
  const dir = path.join(root, dirRel);
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesUnderDir(rel(p), acc);
    else if (e.isFile()) acc.push(rel(p));
  }
  return acc;
}
const candidateFiles = new Set();
for (const d of accDirs) for (const f of filesUnderDir(d)) candidateFiles.add(f);
for (const src of testSources) {
  if (fs.existsSync(path.join(root, src)) && fs.statSync(path.join(root, src)).isDirectory()) {
    for (const f of filesUnderDir(src)) candidateFiles.add(f);
  } else {
    const re = globToRe(src);
    for (const f of files) if (re.test(f)) candidateFiles.add(f);
  }
}
const candidates = [...candidateFiles].filter((f) => !pinned.has(f)).sort();

// --- report ----------------------------------------------------------------------
const unowned = files.filter((f) => !owned.has(f)).sort();
const report = {
  root: path.basename(root),
  specs: { living: livingSpecs.length, inFlight: deltaSpecs.length },
  territory: files.length,
  owned: owned.size,
  burnDown: files.length ? Math.round((owned.size / files.length) * 100) : 0,
  extractionCandidates: candidates,
  unowned,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`spec-extract: brownfield map for ${report.root}`);
console.log(`  specs          ${livingSpecs.length} living, ${deltaSpecs.length} in flight`);
console.log(`  territory      ${files.length} files (excluding openspec/)`);

if (files.length === 0) {
  console.log('  no files to own yet — empty project');
} else {
  const pct = report.burnDown;
  const bar = '#'.repeat(Math.round(pct / 5)).padEnd(20, '·');
  console.log(`  owned          ${owned.size}/${files.length} (${pct}%) ${bar}  burn-down`);
}
if (candidates.length) {
  console.log(`  extraction candidates — unpinned tests, the honest spec sources:`);
  for (const c of candidates) console.log(`    - ${c}`);
  console.log(`    ^ draft one extraction change per area (agent authors, human answers`);
  console.log(`      the WANT-question); scenarios pin these tests via "Verified by"`);
} else if (candidateFiles.size) {
  console.log(`  extraction candidates — none: every test source is already pinned`);
}
if (unowned.length) {
  console.log(`  unowned        ${unowned.length} file${unowned.length === 1 ? '' : 's'} — first change that touches one owes it a spec seed (own-on-touch)`);
  const cap = 20;
  for (const f of unowned.slice(0, cap)) console.log(`    - ${f}`);
  if (unowned.length > cap) console.log(`    … and ${unowned.length - cap} more`);
} else if (files.length) {
  console.log(`  unowned        none — the whole tree is spec territory`);
}
