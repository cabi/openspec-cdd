#!/usr/bin/env node
// arch-extract — brownfield Phase 0: induce the as-built architecture.
//
// Sibling of spec-extract (which maps contract); this maps structure. Two
// stages, honestly separated:
//
//   1. deterministic scanners, every finding labeled `derived` — manifests
//      and frameworks, directory taxonomy, entrypoints, import adjacency,
//      churn clusters
//   2. an `interpreted` section the agent or human fills from that evidence
//      — the tool never asserts interpretation as fact
//
// Existing decisions are ground truth, not audit targets: ADRs under
// openspec/decisions/ (and docs/adr/, whose content gets a thin index entry
// there so the guard sees them) are ingested and echoed as settled context.
// The report lists audit candidates only where induced reality and a
// recorded decision meet — machines detect, humans resolve.
//
// usage: node openspec/scripts/arch-extract.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const jsonOut = process.argv.includes('--json');
const exists = (p) => fs.existsSync(path.join(root, p));
const readOpt = (p) => (exists(p) ? fs.readFileSync(path.join(root, p), 'utf8') : null);

// ---------------------------------------------------------------- scanners --

function scanManifests() {
  const findings = [];
  const pkg = readOpt('package.json');
  if (pkg) {
    const meta = JSON.parse(pkg);
    const deps = { ...(meta.dependencies ?? {}), ...(meta.devDependencies ?? {}) };
    for (const name of Object.keys(deps)) findings.push({ source: 'package.json', item: `${name}@${deps[name]}` });
  }
  const composer = readOpt('composer.json');
  if (composer) {
    const meta = JSON.parse(composer);
    for (const name of Object.keys(meta.require ?? {})) findings.push({ source: 'composer.json', item: `${name}@${meta.require[name]}` });
  }
  const goMod = readOpt('go.mod');
  if (goMod) {
    for (const line of goMod.split('\n')) {
      const m = line.match(/^\s+(\S+)\s+(v\S+)/);
      if (m && !m[1].includes('indirect')) findings.push({ source: 'go.mod', item: `${m[1]}@${m[2]}` });
    }
  }
  for (const f of ['pyproject.toml', 'requirements.txt']) {
    const py = readOpt(f);
    if (py) for (const line of py.split('\n')) if (/^[A-Za-z][\w.-]*[=~<>=]/.test(line.trim())) findings.push({ source: f, item: line.trim() });
  }
  return findings;
}

function scanTaxonomy() {
  const roots = ['src', 'app', 'lib', 'domain', 'server', 'internal'].filter(exists);
  const modules = [];
  for (const r of roots) {
    const dir = path.join(root, r);
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const e of entries) {
      // suffix histogram of file names in the module (XController.php, user_repo.ts)
      const hist = new Map();
      const walk = (d, depth) => {
        if (depth > 2) return;
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          if (f.isDirectory()) walk(path.join(d, f.name), depth + 1);
          else {
            const stem = f.name.replace(/\.\w+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
            for (const tok of stem.split(/[\s_-]+/)) if (tok) hist.set(tok, (hist.get(tok) ?? 0) + 1);
          }
        }
      };
      walk(path.join(dir, e.name), 0);
      const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}(${n})`);
      modules.push({ dir: `${r}/${e.name}`, hints: top.join(' ') });
    }
    if (!entries.length) modules.push({ dir: r, hints: '(flat root)' });
  }
  return { roots, modules };
}

function scanEntrypoints() {
  const candidates = [
    'public/index.php', 'index.php', 'bin', 'cmd', 'src/main.go', 'main.go',
    'src/index.ts', 'src/main.ts', 'src/app.py', 'manage.py', 'routes',
    'config/routes', 'app/Http/Controllers', 'server.js', 'app/server.js',
  ];
  return candidates.filter(exists);
}

function scanAdjacency() {
  // module -> module edges from import/use statements, capped for repo size
  const { roots } = scanTaxonomy();
  if (!roots.length) return [];
  const modOf = (rel) => roots.find((r) => rel.startsWith(r + '/')) ?? null;
  const edges = new Map();
  const walk = (d, count) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (count.n >= 2000) return;
      const fp = path.join(d, f.name);
      if (f.isDirectory()) { walk(fp, count); continue; }
      if (!/\.(ts|tsx|js|jsx|php|go|py)$/.test(f.name)) continue;
      count.n++;
      const rel = path.relative(root, fp).split(path.sep).join('/');
      const from = modOf(rel);
      if (!from) continue;
      const text = fs.readFileSync(fp, 'utf8');
      const targets = new Set();
      for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const t = modOf(path.normalize(path.join(path.dirname(rel), m[1])).split(path.sep).join('/'));
        if (t && t !== from) targets.add(t);
      }
      for (const m of text.matchAll(/^use\s+([\w\\]+)/gm)) {
        const ns = m[1].replace(/\\/g, '/').toLowerCase();
        const t = roots.find((r) => ns.includes(r.toLowerCase() + '/'));
        if (t && t !== from) targets.add(t);
      }
      for (const t of targets) edges.set(`${from}->${t}`, (edges.get(`${from}->${t}`) ?? 0) + 1);
    }
  };
  const count = { n: 0 };
  for (const r of roots) walk(path.join(root, r), count);
  return [...edges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([e, n]) => ({ edge: e, imports: n }));
}

function scanChurn() {
  const r = spawnSync('git', ['log', '-n', '300', '--name-only', '--format=%H'], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  const hist = new Map();
  for (const line of r.stdout.split('\n')) {
    const f = line.trim();
    if (!f || f.length === 40 || f.includes(' ')) continue;
    const mod = f.split('/')[0];
    if (mod && mod !== '.') hist.set(mod, (hist.get(mod) ?? 0) + 1);
  }
  return [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([dir, commits]) => ({ dir, commits }));
}

function scanDecisions() {
  const found = [];
  for (const dir of ['openspec/decisions', 'docs/adr']) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md'))) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(base, e.name), 'utf8');
      const status = text.match(/^status:\s*(\w+)/m)?.[1] ?? 'unknown';
      const code = text.match(/^code:\s*(.+)$/m)?.[1]?.trim() ?? '';
      const title = text.match(/^#\s+(.+)$/m)?.[1] ?? e.name;
      found.push({ location: `${dir}/${e.name}`, status, code, title });
    }
  }
  return found;
}

// ------------------------------------------------------------------ report --

const derived = {
  scannedAt: new Date().toISOString(),
  manifests: scanManifests(),
  taxonomy: scanTaxonomy(),
  entrypoints: scanEntrypoints(),
  adjacency: scanAdjacency(),
  churn: scanChurn(),
  decisions: scanDecisions(),
};

if (jsonOut) {
  console.log(JSON.stringify({ derived, interpreted: null }, null, 2));
  process.exit(0);
}

console.log('# As-built architecture report (Phase 0)\n');
console.log('Deterministic scanners first. Everything below is `derived` — recorded,\nnot asserted by a person. Fill the interpreted section from this evidence.\n');
console.log('## Manifests\n');
if (derived.manifests.length) for (const m of derived.manifests) console.log(`- ${m.source}: ${m.item}`);
else console.log('- none found');
console.log('\n## Directory taxonomy\n');
console.log(`- roots: ${derived.taxonomy.roots.join(', ') || '(none of the usual suspects)'}`);
for (const m of derived.taxonomy.modules) console.log(`- ${m.dir} — hints: ${m.hints}`);
console.log('\n## Entrypoints\n');
for (const e of derived.entrypoints) console.log(`- ${e}`);
if (!derived.entrypoints.length) console.log('- none of the usual suspects');
console.log('\n## Import adjacency (top edges)\n');
for (const e of derived.adjacency) console.log(`- ${e.edge} (${e.imports} imports)`);
if (!derived.adjacency.length) console.log('- no roots scanned');
console.log('\n## Churn clusters (last 300 commits)\n');
for (const c of derived.churn) console.log(`- ${c.dir}/ — ${c.commits} commits`);
if (!derived.churn.length) console.log('- no git history');
console.log('\n## Recorded decisions (ground truth — ingested, not audited)\n');
if (derived.decisions.length) {
  for (const d of derived.decisions) console.log(`- ${d.location} — ${d.status}${d.code ? `, code: ${d.code}` : ''} — ${d.title}`);
} else {
  console.log('- none found. If docs/adr/ exists elsewhere, add a thin index entry in');
  console.log('  openspec/decisions/ carrying its `code:` globs so the drift guard sees them.');
}
console.log(`
## Interpreted (fill this in — the tool never fills it for you)

- module boundaries and their jobs:
- the one or two patterns that repeat everywhere:
- decisions worth recording (four-criterion test: hard to reverse, surprising
  without context, a real trade-off, crosses capability boundaries):

## Draft ADR skeleton (create only what passes all four criteria)

---
status: accepted
code: <globs this decision governs>
---
# <title>

<one paragraph: context, options, why this one>

<!-- induced: derived|interpreted — derived if a scanner suggested this,
     interpreted if a person concluded it from the report -->
`);
