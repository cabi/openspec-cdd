#!/usr/bin/env node
/**
 * Smoke tests for the "lean-verified" OpenSpec schema.
 *
 * Each check is labeled with the critique from docs/transcript.srt it
 * verifies a fix for:
 *   C1 ceremony      - "good management ideas turn into an overbearing
 *                       bureaucracy ... takes away from the task of actually
 *                       doing the job"
 *   C2 ambiguity     - "English really isn't precise" (bi-weekly) and "the
 *                       logical conclusion ... is just to write code"
 *   C3 solution drift- "the solution starts drifting in area where there's
 *                       already a solution" (NIH bloat)
 *   C4 no done       - "how do we know when we're done?"
 *   C5 spec rot      - "the spec becomes the source of truth" (but never
 *                       stays one)
 *
 * The tests run the real OpenSpec CLI (cloned at vendor/OpenSpec, built from
 * source) against a throwaway project configured with our schema.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(testsDir);
const cli = path.join(repoRoot, 'vendor', 'OpenSpec', 'bin', 'openspec.js');

if (!fs.existsSync(cli)) {
  console.error(`CLI not found at ${cli}. Clone vendor/OpenSpec first (see README).`);
  process.exit(2);
}

// --- test project -----------------------------------------------------------
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-verified-smoke-'));
fs.cpSync(path.join(repoRoot, 'openspec'), path.join(project, 'openspec'), { recursive: true });

const results = [];
let cwd = project;

function cliRun(args, opts = {}) {
  const res = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd ?? cwd,
  });
  return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}


function parseJson(run) {
  // schema commands print an experimental-notice line before the JSON
  const start = run.out.indexOf('{');
  const end = run.out.lastIndexOf('}');
  return JSON.parse(run.out.slice(start, end + 1));
}
function check(id, critic, name, fn) {
  try {
    const detail = fn();
    results.push({ id, critic, name, ok: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ id, critic, name, ok: false, detail: err.message });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function copyFixture(name, changeName) {
  const src = path.join(testsDir, 'fixtures', name);
  const dst = path.join(project, 'openspec', 'changes', changeName ?? name);
  fs.cpSync(src, dst, { recursive: true });
  return dst;
}

function copyFixtureUnchecked(name, changeName) {
  const dst = copyFixture(name, changeName);
  const tasksPath = path.join(dst, 'tasks.md');
  fs.writeFileSync(tasksPath, fs.readFileSync(tasksPath, 'utf8').replaceAll('- [x]', '- [ ]'));
  return dst;
}

// --- S0: schema itself is structurally valid --------------------------------
check('S0', '—', "schema 'lean-verified' passes openspec schema validate", () => {
  const r = cliRun(['schema', 'validate', 'lean-verified', '--json']);
  assert(r.code === 0, `exit ${r.code}: ${r.out.slice(0, 300)}`);
  const parsed = parseJson(r);
  assert(parsed.valid === true, `expected valid:true, got ${r.out.slice(0, 300)}`);
  return 'valid';
});

check('S0b', '—', 'schema resolves from the project (shadows the package built-ins)', () => {
  const r = cliRun(['schema', 'which', 'lean-verified', '--json']);
  assert(r.code === 0, `exit ${r.code}: ${r.out.slice(0, 300)}`);
  const parsed = parseJson(r);
  assert(parsed.source === 'project', `expected source 'project', got '${parsed.source}'`);
  return `source=${parsed.source}`;
});

// --- S1 (C1): lean pipeline - design gate is automatic triage ----------------
check('S1', 'C1', 'pipeline is proposal -> specs -> design gate -> tasks (auto-discharged design)', () => {
  const r = cliRun(['new', 'change', 'demo', '--json']);
  assert(r.code === 0, `new change failed: ${r.out.slice(0, 300)}`);
  const s = cliRun(['status', '--change', 'demo', '--json']);
  assert(s.code === 0, `status failed: ${s.out.slice(0, 300)}`);
  const status = JSON.parse(s.out);
  const ids = Object.keys(status.artifactPaths);
  assert(
    JSON.stringify(ids) === JSON.stringify(['proposal', 'specs', 'design', 'tasks']),
    `expected artifacts [proposal,specs,design,tasks], got [${ids.join(',')}]. ` +
      'The design gate must sit between specs and tasks: automatic triage, one recorded line when unused - never a fourth mandatory ceremony doc.'
  );
  assert(status.schemaName === 'lean-verified', `expected schemaName lean-verified, got ${status.schemaName}`);
  return `artifacts=[${ids.join(' -> ')}]`;
});

// --- S2 (C2): ambiguous English is a build failure, not a hope ---------------
check('S2', 'C2', 'the "bi-weekly" spec (vague, no scenario, no SHALL) FAILS --strict validation', () => {
  copyFixture('bad-ambiguous');
  const r = cliRun(['validate', 'bad-ambiguous', '--strict']);
  assert(r.code !== 0, 'validation unexpectedly PASSED - the vague spec must be rejected');
  assert(/must include at least one scenario/.test(r.out), `expected scenario error, got: ${r.out.slice(0, 300)}`);
  assert(/SHALL or MUST/.test(r.out), `expected SHALL/MUST error, got: ${r.out.slice(0, 300)}`);
  return 'rejected: no scenario + no SHALL (exit ' + r.code + ')';
});

// --- S3 (C2): the quantified counterpart passes ------------------------------
check('S3', 'C2', 'the quantified spec ("every 14 days", WHEN/THEN scenario) passes --strict', () => {
  copyFixture('good-verified');
  const r = cliRun(['validate', 'good-verified', '--strict']);
  assert(r.code === 0, `expected valid, got: ${r.out.slice(0, 400)}`);
  return "valid - precision lives in the scenario, not in ever-longer prose";
});

// --- S4 (C2): the anti-ambiguity mandate actually reaches the agent ----------
function instructionFor(artifact, change = 'good-verified') {
  const r = cliRun(['instructions', artifact, '--change', change, '--json']);
  assert(r.code === 0, `instructions ${artifact} failed: ${r.out.slice(0, 300)}`);
  return parseJson(r);
}

check('S4', 'C2', 'spec instructions the agent receives carry the quantification rules', () => {
  const ins = instructionFor('specs');
  const text = `${ins.instruction ?? ''}\n${(ins.rules ?? []).join('\n')}\n${ins.template ?? ''}`;
  assert(/bi-weekly/.test(text), 'instructions never mention the bi-weekly anti-pattern');
  assert(/every 14 days/.test(text), 'instructions lack the quantified example');
  assert(/Comparatives \("fast", "large"/.test(ins.instruction ?? ''), 'comparatives ban missing from schema instruction');
  return 'anti-"bi-weekly" rules present in agent instructions';
});

// --- S5 (C3): reuse-first mandate reaches the agent --------------------------
check('S5', 'C3', 'proposal instructions mandate Solutions Considered + Non-Goals before any spec', () => {
  const ins = instructionFor('proposal');
  const text = `${ins.instruction ?? ''}\n${ins.template ?? ''}`;
  assert(/Solutions Considered/.test(text), 'Solutions Considered missing');
  assert(/Non-Goals/.test(text), 'Non-Goals missing');
  assert(/None found[\s\S]{0,80}name what you searched/.test(text), 'the "None found" escape hatch is not evidence-bound');
  return 'build-vs-reuse scan + scope fence are contract sections';
});

// --- S6 (C4): definition of done reaches the agent ---------------------------
check('S6', 'C4', 'Done When + per-task verification + traceability are mandated', () => {
  const prop = instructionFor('proposal');
  assert(/Done When/.test(`${prop.instruction ?? ''}\n${prop.template ?? ''}`), 'proposal lacks Done When');
  const tasks = instructionFor('tasks');
  const tt = `${tasks.instruction ?? ''}\n${tasks.template ?? ''}`;
  assert(/verify by/.test(tt), 'tasks lack "verify by" verification requirement');
  assert(/Done When Traceability/.test(tt), 'tasks lack the traceability table');
  return 'done criteria trace to verified tasks';
});

// --- S9 (C1): design gate is automatic triage, not a ceremony doc -----------
check('S9', 'C1', 'design gate: mechanical triage reaches the agent; skips are recorded', () => {
  const ins = instructionFor('design');
  const text = `${ins.instruction ?? ''}\n${(ins.rules ?? []).join('\n')}`;
  assert(/T1 Cross-cutting/.test(text) && /T5 Parallel work/.test(text), 'the five triage triggers are missing');
  assert(/any YES/.test(text), 'the mechanical decision rule (any YES => full design) is missing');
  assert(/skip that is not recorded|skip record/.test(text), 'the unrecorded-skip rule is missing');
  const gate = fs.readFileSync(path.join(project, 'openspec', 'changes', 'good-verified', 'design.md'), 'utf8');
  assert(/Skipped: no triage trigger fired/.test(gate), 'fixture design.md lacks the skip record');
  return '5-trigger triage + auditable one-line skip';
});

// --- S10 (C4): design-by-unit-test engrained in the tasks step --------------
check('S10', 'C4', 'tasks step engrains design-by-unit-test (red-green-refactor)', () => {
  const ins = instructionFor('tasks');
  const text = `${ins.instruction ?? ''}\n${(ins.rules ?? []).join('\n')}`;
  assert(/red-green-refactor/.test(text), 'the red-green-refactor loop is missing from tasks');
  assert(/failing\s+unit\s+test/.test(text), 'unit-test-first rule missing');
  assert(/stay stable/.test(text) && /acceptance tests/.test(text), 'acceptance-tests-are-contract rule missing');
  return 'tasks are interfaces, worked test-first';
});

// --- S11 (C2): contract completed at step 2 ---------------------------------
check('S11', 'C2', 'specs step completes the contract: every scenario pins an acceptance test', () => {
  const ins = instructionFor('specs');
  const text = `${ins.instruction ?? ''}\n${(ins.rules ?? []).join('\n')}\n${ins.template ?? ''}`;
  assert(/Verified by/.test(text), 'the Verified by contract rule is missing from specs');
  assert(/black-box/.test(text), 'the black-box boundary rule is missing');
  const spec = fs.readFileSync(path.join(project, 'openspec', 'changes', 'good-verified', 'specs', 'usage-reporting', 'spec.md'), 'utf8');
  assert(/\*\*Verified by\*\* tests\/acceptance\//.test(spec), 'fixture scenario lacks a Verified by pin');
  const acc = path.join(project, 'openspec', 'changes', 'good-verified', 'tests', 'acceptance', 'usage-reporting.schedule.test.ts');
  assert(fs.existsSync(acc), 'the pinned acceptance test file is missing from the fixture');
  return 'spec + acceptance test = contract, complete at step 2';
});

// --- S7 (C5): apply closes the loop - check off only after verification ------
check('S7', 'C5', 'apply instruction ties check-off to verification and ends in archive', () => {
  copyFixtureUnchecked('good-verified', 'pending-verified');
  const r = cliRun(['instructions', 'apply', '--change', 'pending-verified', '--json']);
  assert(r.code === 0, `apply instructions failed: ${r.out.slice(0, 300)}`);
  const parsed = parseJson(r);
  assert(parsed.state === 'ready', `expected state 'ready', got '${parsed.state}'`);
  const text = parsed.instruction ?? '';
  assert(/verification the task itself names|verify/.test(text), 'apply does not demand per-task verification');
  assert(/failing\s+unit\s+test/.test(text), 'apply does not open each task with a failing unit test');
  assert(/openspec archive/.test(text), 'apply does not end in archive (the living-spec merge)');
  assert(/spec-drift/.test(text), 'apply does not run the drift guard before archive');
  return 'verify-then-check-off, archive at the end';
});

// --- S8 (C5): archive mechanically updates the single source of truth --------
check('S8', 'C5', 'archive merges the delta into the living spec (source of truth stays current)', () => {
  const r = cliRun(['archive', 'good-verified', '--yes']);
  assert(r.code === 0, `archive failed: ${r.out.slice(0, 400)}`);
  const specPath = path.join(project, 'openspec', 'specs', 'usage-reporting', 'spec.md');
  assert(fs.existsSync(specPath), `main spec not created at ${specPath}`);
  const main = fs.readFileSync(specPath, 'utf8');
  assert(/every 14 days/.test(main), 'quantified requirement missing from archived main spec');
  assert(/#### Scenario: Report delivered on schedule/.test(main), 'scenario missing from archived main spec');
  const v = cliRun(['validate', '--specs']);
  assert(v.code === 0, `main spec validation failed: ${v.out.slice(0, 300)}`);
  return 'openspec/specs/usage-reporting/spec.md updated + validates';
});

// --- S12/S13 (C5): the three-door drift guard ---------------------------------
function initDriftRepo(name) {
  const gp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: gp, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  for (const a of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) g(a);
  const fx = path.join(repoRoot, 'tests', 'fixtures', 'good-verified');
  fs.mkdirSync(path.join(gp, 'openspec/specs/usage-reporting'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'tests/acceptance'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'src/usage-report'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'openspec/scripts'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'openspec', 'config.yaml'), path.join(gp, 'openspec/config.yaml'));
  fs.copyFileSync(path.join(fx, 'specs/usage-reporting/spec.md'), path.join(gp, 'openspec/specs/usage-reporting/spec.md'));
  fs.copyFileSync(path.join(fx, 'tests/acceptance/usage-reporting.schedule.test.ts'), path.join(gp, 'tests/acceptance/usage-reporting.schedule.test.ts'));
  fs.writeFileSync(path.join(gp, 'src/usage-report/report.ts'), 'export const report = 1;\n');
  fs.copyFileSync(path.join(repoRoot, 'openspec', 'scripts', 'spec-drift.mjs'), path.join(gp, 'openspec/scripts/spec-drift.mjs'));
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  const drift = () => {
    const r = spawnSync('node', ['openspec/scripts/spec-drift.mjs'], { cwd: gp, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  return { gp, g, drift };
}

check('S12', 'C5', 'drift guard: broken pins, orphan tests, and stale code are caught', () => {
  const { gp, g, drift } = initDriftRepo('drift-full');
  let r = drift();
  assert(r.code === 0, `clean project flagged as drift:\n${r.out}`);
  fs.rmSync(path.join(gp, 'tests/acceptance/usage-reporting.schedule.test.ts'));
  r = drift();
  assert(r.code === 1 && /does not exist/.test(r.out), `broken pin not caught:\n${r.out}`);
  g(['checkout', '--', '.']);
  fs.writeFileSync(path.join(gp, 'tests/acceptance/orphan.test.ts'), 'test();\n');
  r = drift();
  assert(r.code === 1 && /orphan/.test(r.out), `orphan acceptance test not caught:\n${r.out}`);
  fs.rmSync(path.join(gp, 'tests/acceptance/orphan.test.ts'));
  r = drift();
  assert(r.code === 0, `restored project still flagged:\n${r.out}`);
  fs.appendFileSync(path.join(gp, 'src/usage-report/report.ts'), '// v2\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'code only']);
  r = drift();
  assert(r.code === 1 && /changed after/.test(r.out), `code committed without its spec not caught:\n${r.out}`);
  fs.appendFileSync(path.join(gp, 'src/usage-report/report.ts'), '// v3\n');
  fs.appendFileSync(path.join(gp, 'openspec/specs/usage-reporting/spec.md'), '\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'spec + code together']);
  r = drift();
  assert(r.code === 0, `spec+code co-travel still flagged:\n${r.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'L1 both directions + L2 staleness caught; spec+code commits pass';
});

check('S13', 'C5', 'drift guard: the pre-commit hook blocks the drifting commit at the door', () => {
  const { gp, g } = initDriftRepo('drift-hook');
  g(['config', 'core.hooksPath', path.join(repoRoot, '.githooks')]);
  fs.rmSync(path.join(gp, 'tests/acceptance/usage-reporting.schedule.test.ts'));
  g(['add', '-A']);
  const head = g(['rev-parse', 'HEAD']).out.trim();
  const blocked = g(['commit', '-qm', 'remove pinned test']);
  assert(blocked.code !== 0, 'the hook let the drifting commit through');
  assert(g(['rev-parse', 'HEAD']).out.trim() === head, 'the drifting commit landed despite the hook');
  assert(/staged deletion/.test(blocked.out), `unexpected hook output:\n${blocked.out}`);
  g(['restore', '--staged', '.']);
  g(['checkout', '--', '.']);
  fs.appendFileSync(path.join(gp, 'src/usage-report/report.ts'), '// v2\n');
  fs.appendFileSync(path.join(gp, 'openspec/specs/usage-reporting/spec.md'), '\n');
  g(['add', '-A']);
  const ok = g(['commit', '-qm', 'spec + code together']);
  assert(ok.code === 0, `co-travel commit blocked by the hook:\n${ok.out}`);
  assert(g(['rev-parse', 'HEAD']).out.trim() !== head, 'the clean commit did not land');
  fs.rmSync(gp, { recursive: true, force: true });
  return 'drift rejected where it started; spec+code co-travel passes';
});

check('S14', 'C5', 'drift guard: mechanical sweeps (lint/codemod/framework) neither age the spec nor touch the contract', () => {
  const { gp, g, drift } = initDriftRepo('drift-mech');
  fs.appendFileSync(path.join(gp, 'src/usage-report/report.ts'), '// prettier reformat\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'reformat', '-m', 'Mechanical-Change: prettier sweep']);
  let r = drift();
  assert(r.code === 0, `lint sweep flagged as drift:\n${r.out}`);
  fs.appendFileSync(path.join(gp, 'tests/acceptance/usage-reporting.schedule.test.ts'), '// touched\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'codemod', '-m', 'Mechanical-Change: framework update']);
  r = drift();
  assert(r.code === 1 && /touches the contract/.test(r.out), `"mechanical" commit touching acceptance tests not caught:\n${r.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'trailer exempts sweeps from staleness; contract-touching "mechanical" commits rejected';
});

check('S15', 'C5', 'drift guard: a helper claimed by two specs has no single owner', () => {
  const { gp, g, drift } = initDriftRepo('drift-owner');
  fs.mkdirSync(path.join(gp, 'openspec/specs/billing'), { recursive: true });
  fs.writeFileSync(
    path.join(gp, 'openspec/specs/billing/spec.md'),
    '## Requirement: Billing reads usage\n\n- Code: `src/usage-report/report.ts`\n\n#### Scenario: Billing pulls the report\n\n- **WHEN** billing runs\n- **THEN** it reads the usage report\n- **Verified by** tests/acceptance/usage-reporting.schedule.test.ts\n'
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'add billing spec']);
  const r = drift();
  assert(r.code === 1 && /claimed by 2 capabilities/.test(r.out), `double-claimed helper not caught:\n${r.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'single-owner rule: one file, one spec - helpers get narrowed globs or their own capability';
});
check('S16', 'C5', 'door 3 stays a machine on every forger: guard + acceptance suite run mechanically, triage only reacts', () => {
  const files = [
    ['github', path.join(repoRoot, '.github', 'workflows', 'spec-drift.yml')],
    ['gitlab', path.join(repoRoot, '.gitlab-ci.yml')],
  ].map(([forge, f]) => [forge, fs.readFileSync(f, 'utf8')]);
  for (const [forge, wf] of files) {
    assert(/node openspec\/scripts\/spec-drift\.mjs/.test(wf), `${forge}: drift guard step missing`);
    assert(/npm test --if-present/.test(wf), `${forge}: acceptance-suite run step missing`);
    assert(/No agent harness here by design/.test(wf), `${forge}: no-agent principle not stated`);
    assert(/node-version: 20/.test(wf) || /image: node:20/.test(wf), `${forge}: node 20 not pinned`);
    assert(/fetch-depth: 0|GIT_DEPTH/.test(wf), `${forge}: full-history clone not ensured (L2/M need topology)`);
  }
  const [, gh] = files[0];
  const [, gl] = files[1];
  assert(/^  # triage:$/m.test(gh), 'github: triage job must ship commented (non-blocking)');
  assert(/if: failure\(\)/.test(gh), 'github: triage must trigger only on red');
  assert(/^# triage:$/m.test(gl), 'gitlab: triage job must ship commented (non-blocking)');
  assert(/when: on_failure/.test(gl) && /allow_failure: true/.test(gl), 'gitlab: triage must fire on red and never block');
  return 'parity: GitHub and GitLab render the verdict with machines; triage opt-in on both, reacts to red';
});
// --- S17–S19 (C5): brownfield adoption — the strangler fig ----------------------
function initBrownfield(name) {
  const gp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: gp, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  for (const a of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) g(a);
  fs.mkdirSync(path.join(gp, 'openspec'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'src/legacy'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'openspec/scripts'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'openspec', 'config.yaml'), path.join(gp, 'openspec/config.yaml'));
  fs.writeFileSync(path.join(gp, 'src/legacy/report.ts'), 'export const report = 1;\n');
  fs.writeFileSync(path.join(gp, 'src/legacy/report.test.ts'), 'test();\n'); // co-located legacy test
  fs.writeFileSync(path.join(gp, 'tests/legacy.report.test.ts'), 'test();\n'); // legacy test, plain dir
  fs.copyFileSync(path.join(repoRoot, 'openspec', 'scripts', 'spec-drift.mjs'), path.join(gp, 'openspec/scripts/spec-drift.mjs'));
  fs.copyFileSync(path.join(repoRoot, 'openspec', 'scripts', 'spec-extract.mjs'), path.join(gp, 'openspec/scripts/spec-extract.mjs'));
  g(['add', '-A']);
  g(['commit', '-qm', 'legacy codebase']);
  const run = (script, args = []) => {
    const r = spawnSync('node', [`openspec/scripts/${script}.mjs`, ...args], { cwd: gp, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  return { gp, g, run };
}

check('S17', 'C5', 'Phase 0 cold start: guard green on a spec-less legacy repo, spec-extract maps the territory', () => {
  const { gp, run } = initBrownfield('brown-p0');
  const guard = run('spec-drift');
  assert(guard.code === 0 && /no specs found/.test(guard.out), `spec-less legacy repo must pass all doors:\n${guard.out}`);
  // tests/acceptance/ is contract territory from day one: an unpinned test
  // dropped there is drift immediately — the guard teaches the convention
  fs.mkdirSync(path.join(gp, 'tests/acceptance'), { recursive: true });
  fs.writeFileSync(path.join(gp, 'tests/acceptance/rogue.test.ts'), 'test();\n');
  const rogue = run('spec-drift');
  assert(rogue.code === 1 && /orphan/.test(rogue.out), `unpinned test in the contract dir must go red:\n${rogue.out}`);
  fs.rmSync(path.join(gp, 'tests/acceptance'), { recursive: true, force: true });
  const map = JSON.parse(run('spec-extract', ['--json']).out);
  assert(map.specs.living === 0 && map.owned === 0 && map.burnDown === 0, `Phase 0 must own nothing:\n${JSON.stringify(map)}`);
  assert(map.unowned.includes('src/legacy/report.ts'), 'legacy source must be listed as unowned territory');
  const human = run('spec-extract', ['--tests', 'tests', '--tests', 'src/legacy/*.test.ts']);
  assert(/own-on-touch/.test(human.out) && /extraction candidates/.test(human.out), `human map must carry the playbook pointers:\n${human.out}`);
  assert(human.out.includes('tests/legacy.report.test.ts') && human.out.includes('src/legacy/report.test.ts'), 'legacy tests must be discoverable via --tests');
  fs.rmSync(gp, { recursive: true, force: true });
  return 'cold start safe (nothing owned, nothing blocked); contract dir guarded from day one; candidates mapped via --tests';
});

check('S18', 'C5', 'Phase 1 extraction: existing tests become contract pins and the doors immediately protect the territory', () => {
  const { gp, g, run } = initBrownfield('brown-p1');
  fs.mkdirSync(path.join(gp, 'openspec/specs/legacy-report'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'tests/acceptance'), { recursive: true });
  fs.writeFileSync(
    path.join(gp, 'openspec/specs/legacy-report/spec.md'),
    '## Requirement: Usage report exists\n\n- Code: `src/legacy/report.ts`\n\n#### Scenario: Report renders\n\n- **WHEN** the report page loads\n- **THEN** the usage report is rendered\n- **Verified by** tests/acceptance/legacy.report.test.ts\n'
  );
  // the extraction change moves the legacy test into the contract dir and
  // pins it in the same commit — spec + tests travel together
  fs.renameSync(path.join(gp, 'tests/legacy.report.test.ts'), path.join(gp, 'tests/acceptance/legacy.report.test.ts'));
  g(['add', '-A']);
  g(['commit', '-qm', 'extract legacy-report spec from existing tests']);
  const green = run('spec-drift');
  assert(green.code === 0, `extraction change must be clean:\n${green.out}`);
  const map = JSON.parse(run('spec-extract', ['--json']).out);
  assert(map.specs.living === 1 && map.owned === 1 && map.burnDown > 0, `extraction must own territory:\n${JSON.stringify(map)}`);
  assert(!map.extractionCandidates.includes('tests/acceptance/legacy.report.test.ts'), 'pinned test must leave the candidate list');
  fs.appendFileSync(path.join(gp, 'src/legacy/report.ts'), '// v2\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'code only']);
  const drift = run('spec-drift');
  assert(drift.code === 1 && /changed after/.test(drift.out), `extracted territory must be L2-protected:\n${drift.out}`);
  fs.appendFileSync(path.join(gp, 'src/legacy/report.ts'), '// v3\n');
  fs.appendFileSync(path.join(gp, 'openspec/specs/legacy-report/spec.md'), '\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'spec + code together']);
  const ok = run('spec-drift');
  assert(ok.code === 0, `co-travel on extracted territory must pass:\n${ok.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'extraction moves+pins legacy tests in one commit; burn-down rises; guard enforces the extracted contract';
});

check('S19', 'C5', 'the brownfield playbook ships documented: strangler fig, honest source, WANT-question, provenance', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert(/strangler fig/.test(readme), 'strangler-fig playbook missing');
  assert(/Extract only what a test pins/.test(readme), 'honest-source rule missing');
  assert(/WANT-question/.test(readme), 'extraction review question missing');
  assert(/Extracted from:/.test(readme), 'provenance convention missing');
  assert(/own-on-touch/.test(readme), 'Phase-2 rule missing');
  assert(/spec-extract\.mjs/.test(readme), 'inventory tool not documented');
  return 'adoption strategy is documented, not tribal';
});
// --- S20–S21 (C5): the split rule — scale backstop for the task list --------
function bloatedTasks(n) {
  const lines = ['## 1. Export', '## 2. Scheduling', ''];
  for (let i = 1; i <= n; i++) {
    const g = i <= 7 ? 1 : 2;
    const k = i <= 7 ? i : i - 7;
    lines.push(`- [ ] ${g}.${k} Interface ${i} established, verify by npm test -- t${i}`);
  }
  return lines.join('\n') + '\n';
}

check('S20', 'C5', 'split rule: a living change past 12 tracked tasks is L3 drift until split or recorded', () => {
  const { gp, g, drift } = initDriftRepo('drift-l3');
  const schema = fs.readFileSync(path.join(repoRoot, 'openspec/schemas/lean-verified/schema.yaml'), 'utf8');
  assert(/12 tracked tasks/.test(schema) && /split-considered/.test(schema) && /Depends on/.test(schema), 'schema must engrave the split procedure + escape hatch');
  fs.mkdirSync(path.join(gp, 'openspec/changes/usage-report-v2'), { recursive: true });
  fs.writeFileSync(path.join(gp, 'openspec/changes/usage-report-v2/tasks.md'), bloatedTasks(17));
  g(['add', '-A']);
  g(['commit', '-qm', 'bloated change']);
  const red = drift();
  assert(red.code === 1 && /\[L3\]/.test(red.out) && /decomposition signal/.test(red.out), `17-task change must go red with the remediation:\n${red.out}`);
  fs.appendFileSync(path.join(gp, 'openspec/changes/usage-report-v2/tasks.md'), '\n<!-- split-considered: kept whole because export and scheduling share one seam -->\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'record split decision']);
  const green = drift();
  assert(green.code === 0, `a recorded decision must pass:\n${green.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return "scale backstop: the guard enforces the schema's own threshold; the exception costs one honest sentence";
});

check('S21', 'C5', 'archived changes are frozen history: a 20-task archive never trips L3', () => {
  const { gp, g, drift } = initDriftRepo('drift-l3-archive');
  fs.mkdirSync(path.join(gp, 'openspec/changes/archive/usage-report-v2'), { recursive: true });
  fs.writeFileSync(path.join(gp, 'openspec/changes/archive/usage-report-v2/tasks.md'), bloatedTasks(20));
  g(['add', '-A']);
  g(['commit', '-qm', 'archive bloated history']);
  const r = drift();
  assert(r.code === 0 && !/L3/.test(r.out), `archives must never be nagged:\n${r.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'the backstop polices living work, not history';
});

// --- S23: every rules key must match a schema artifact ------------------------
check('S23', '—', 'config rules keys exist in the schema - the CLI never warns "Unknown artifact ID"', () => {
  const cfgText = fs.readFileSync(path.join(repoRoot, 'openspec', 'config.yaml'), 'utf8');
  const schemaText = fs.readFileSync(path.join(repoRoot, 'openspec', 'schemas', 'lean-verified', 'schema.yaml'), 'utf8');
  const rulesBlock = cfgText.split('\nrules:\n')[1] || '';
  const keys = [...rulesBlock.matchAll(/^  ([a-z-]+):$/gm)].map((m) => m[1]);
  assert(keys.length > 0, 'no rules found in config.yaml');
  const artifacts = [...schemaText.matchAll(/^  - id: ([a-z-]+)$/gm)].map((m) => m[1]);
  for (const k of keys) {
    assert(artifacts.includes(k), `rules key "${k}" matches no schema artifact (${artifacts.join(', ')})`);
  }
  // live proof against the real CLI: instructions --json must carry no warning pollution
  // live proof against the real CLI: instructions --json must carry no warning pollution
  fs.mkdirSync(path.join(project, 'openspec', 'changes', 'probe'), { recursive: true });
  fs.writeFileSync(path.join(project, 'openspec', 'changes', 'probe', '.openspec.yaml'), 'schema: lean-verified\n');
  fs.writeFileSync(path.join(project, 'openspec', 'changes', 'probe', 'proposal.md'), '## Why\nprobe\n');
  const r = cliRun(['instructions', '--change', 'probe', 'proposal', '--json']);
  assert(r.code === 0, `exit ${r.code}: ${r.out.slice(0, 300)}`);
  assert(!r.out.includes('Unknown artifact ID'), `CLI warned on stdout: ${r.out.match(/Unknown artifact ID[^\n]*/)?.[0] ?? ''}`);
  return `rules keys [${keys.join(', ')}] all match schema artifacts [${artifacts.join(', ')}]`;
});
// --- S22: injected rules must actually load ----------------------------------
check('S22', '—', 'config rules parse as strings; no-inline-markers and producer-side done-condition rules stay engraved', () => {
  const cfg = fs.readFileSync(path.join(repoRoot, 'openspec', 'config.yaml'), 'utf8');
  assert(/source code stays clean/.test(cfg) && /Code globs plus git history/.test(cfg), 'the rule that keeps spec markers out of source code must stay in config.yaml');
  assert(/clean under the repo's lint and static-analysis checks and the pinned acceptance test passes/.test(cfg) && /never as per-task verify-by pins/.test(cfg), 'the producer-side done-condition rule must stay in config.yaml');
  const r = cliRun(['list']);
  assert(r.code === 0, `exit ${r.code}: ${r.out.slice(0, 300)}`);
  assert(
    !/must be an array of strings/i.test(r.out),
    `CLI dropped injected rules - an unquoted ": " inside a rule string makes YAML parse it as a mapping; quote the whole scalar:\n${r.out.slice(0, 500)}`
  );
  return 'all rules load as strings';
});

// --- S23–S24: capability lifecycle — one capability, one owner, in flight ----
check('S23', 'C5', 'capability lifecycle: archive and in-flight updates of an existing capability stay green', () => {
  const { gp, g, drift } = initDriftRepo('drift-cap-lifecycle');
  // start greenfield: initDriftRepo's seeded "living spec" is a raw delta copy
  // (structurally invalid for the CLI's merger) — the change's delta is the only spec
  fs.rmSync(path.join(gp, 'openspec/specs'), { recursive: true, force: true });
  g(['add', '-A']);
  g(['commit', '-qm', 'greenfield start']);
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/good-verified'), path.join(gp, 'openspec/changes/usage-report-v1'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'src/usage-report'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'tests/acceptance'), { recursive: true });
  fs.writeFileSync(path.join(gp, 'src/usage-report/report.ts'), 'export const report = 1;\n');
  fs.writeFileSync(path.join(gp, 'tests/acceptance/usage-reporting.schedule.test.ts'), 'test();\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'change v1: delta + code + acceptance test']);
  let r = drift();
  assert(r.code === 0, `open change with its own delta must be green:\n${r.out}`);

  const arch = spawnSync('node', [cli, 'archive', 'usage-report-v1', '--yes'], { cwd: gp, encoding: 'utf8' });
  assert(arch.status === 0, `archive failed:\n${arch.stdout}${arch.stderr}`);
  g(['add', '-A']);
  g(['commit', '-qm', 'archive v1 (living spec created, delta frozen)']);
  r = drift();
  assert(r.code === 0 && !/\[O\]/.test(r.out), `an archived delta must stop claiming code (frozen history):\n${r.out}`);

  // v2: in-flight update of the EXISTING capability — delta + code + test together
  fs.mkdirSync(path.join(gp, 'openspec/changes/usage-report-v2/specs/usage-reporting'), { recursive: true });
  fs.writeFileSync(
    path.join(gp, 'openspec/changes/usage-report-v2/specs/usage-reporting/spec.md'),
    '## ADDED Requirements\n\n### Requirement: Batch Export\n\nThe system shall export batches.\n\n#### Scenario: Nightly batch\n\n- **WHEN** the nightly job runs\n- **THEN** a batch file is written\n- **Verified by** tests/acceptance/usage-reporting.batch.test.ts\n\nCode: `src/usage-report/**`\n'
  );
  fs.writeFileSync(path.join(gp, 'src/usage-report/batch.ts'), 'export const batch = 2;\n');
  fs.writeFileSync(path.join(gp, 'tests/acceptance/usage-reporting.batch.test.ts'), 'test();\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'v2: in-flight update of existing capability']);
  r = drift();
  assert(r.code === 0, `an open delta updating its own capability is the mechanism, not drift:\n${r.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'apply lifecycle green: open change -> archive -> follow-up change on the same capability';
});

check('S24', 'C5', 'one capability one owner: parallel open changes and cross-capability claims go red', () => {
  const { gp, g, drift } = initDriftRepo('drift-cap-owner');
  fs.mkdirSync(path.join(gp, 'openspec/specs/usage-reporting'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'src/usage-report'), { recursive: true });
  fs.mkdirSync(path.join(gp, 'tests/acceptance'), { recursive: true });
  fs.writeFileSync(
    path.join(gp, 'openspec/specs/usage-reporting/spec.md'),
    '# usage-reporting Specification\n\n## Purpose\n\nReports.\n\n## Requirements\n\n### Requirement: Schedule Export\n\n#### Scenario: on demand\n\n- **WHEN** a user asks\n- **THEN** a file is written\n- **Verified by** tests/acceptance/usage-reporting.schedule.test.ts\n\nCode: `src/usage-report/**`\n'
  );
  fs.writeFileSync(path.join(gp, 'src/usage-report/report.ts'), 'export const report = 1;\n');
  fs.writeFileSync(path.join(gp, 'tests/acceptance/usage-reporting.schedule.test.ts'), 'test();\n');
  const mkDelta = (id, cap) => {
    fs.mkdirSync(path.join(gp, `openspec/changes/${id}/specs/${cap}`), { recursive: true });
    fs.writeFileSync(
      path.join(gp, `openspec/changes/${id}/specs/${cap}/spec.md`),
      '## ADDED Requirements\n\n### Requirement: Extra\n\n#### Scenario: more\n\n- **WHEN** asked\n- **THEN** more happens\n- **Verified by** tests/acceptance/usage-reporting.extra.test.ts\n\nCode: `src/usage-report/**`\n'
    );
  };
  mkDelta('a-batch', 'usage-reporting');
  mkDelta('b-batch', 'usage-reporting');
  fs.writeFileSync(path.join(gp, 'tests/acceptance/usage-reporting.extra.test.ts'), 'test();\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'two parallel changes on one capability']);
  let r = drift();
  assert(r.code === 1 && /claim capability usage-reporting in parallel/.test(r.out), `parallel open changes on one capability must go red:\n${r.out}`);

  fs.rmSync(path.join(gp, 'openspec/changes/b-batch'), { recursive: true, force: true });
  mkDelta('b-batch', 'billing'); // different capability claims the same files
  g(['add', '-A']);
  g(['commit', '-qm', 'second capability claims the same files']);
  r = drift();
  assert(r.code === 1 && /claimed by 2 capabilities/.test(r.out), `cross-capability double claim must go red:\n${r.out}`);

  fs.rmSync(path.join(gp, 'openspec/changes/b-batch'), { recursive: true, force: true });
  g(['add', '-A']);
  g(['commit', '-qm', 'single owner restored']);
  r = drift();
  assert(r.code === 0, `one capability plus its own open delta must be green:\n${r.out}`);
  fs.rmSync(gp, { recursive: true, force: true });
  return 'ownership: parallel changes and cross-capability globs fail; single owner passes';
});

// --- S25: dogfood findings flow back — satisfiability, test-contract migration, tool skills
check('S25', 'C2/C5', 'Holzborste findings engraved: satisfiability rule, test-contract migration, pi skills for the tools', () => {
  const schema = fs.readFileSync(path.join(repoRoot, 'openspec', 'schemas', 'lean-verified', 'schema.yaml'), 'utf8');
  assert(/Satisfiability rule/.test(schema) && /cannot hold\s+on the target environment is a spec bug/.test(schema), 'schema must reject scenarios that cannot hold on the target environment');
  assert(/Test-contract migration/.test(schema) && /MODIFIED\s+requirement covering it/.test(schema) && /its own task/.test(schema), 'schema must name the test-contract migration pattern (MODIFIED requirement + tracked task)');
  const driftSkill = fs.readFileSync(path.join(repoRoot, '.pi', 'skills', 'spec-drift', 'SKILL.md'), 'utf8');
  assert(/\[L1\]/.test(driftSkill) && /\[L2\]/.test(driftSkill) && /Never bypass/.test(driftSkill) && /Mechanical-Change/.test(driftSkill), 'spec-drift skill must document verdicts, the no-bypass rule, and mechanical changes');
  assert(/transient/i.test(driftSkill) && /archive commit/.test(driftSkill), 'spec-drift skill must document the transient L2 window after archive');
  const extractSkill = fs.readFileSync(path.join(repoRoot, '.pi', 'skills', 'spec-extract', 'SKILL.md'), 'utf8');
  assert(/% owned/.test(extractSkill) && /strangler/i.test(extractSkill), 'spec-extract skill must document the burn-down metric and strangler-fig loop');
  return 'findings 1, 2, 4 engraved in schema.yaml + tool skills shipped for pi agents';
});

// --- S26: version-pinned upstream patch — resolved schema, not the raw flag ----
check('S26', '—', 'patch 2117 (pinned v1.14.3 @ c794978f): new change reports the resolved schema', () => {
  const vendor = path.join(repoRoot, 'vendor', 'OpenSpec');
  const apply = spawnSync('bash', [path.join(repoRoot, 'scripts', 'apply-openspec-patches.sh')], { encoding: 'utf8' });
  assert(apply.status === 0, `patch script failed: ${apply.stdout}${apply.stderr}`);
  const srcF = path.join(vendor, 'src', 'commands', 'workflow', 'new-change.ts');
  const distF = path.join(vendor, 'dist', 'commands', 'workflow', 'new-change.js');
  const needsBuild = !fs.existsSync(distF) || fs.statSync(srcF).mtimeMs > fs.statSync(distF).mtimeMs;
  if (needsBuild) {
    const build = ['pnpm run build', 'corepack pnpm run build']
      .map((cmd) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8', cwd: vendor }))
      .find((r) => r.status === 0);
    assert(build, 'patched but could not rebuild vendor/OpenSpec (pnpm run build failed)');
  }
  const json = cliRun(['new', 'change', 'probe-2117', '--json']);
  assert(json.code === 0, `new change failed: ${json.out}`);
  const payload = JSON.parse(json.out);
  assert(payload.change.schema === 'lean-verified', `change record says schema ${JSON.stringify(payload.change.schema)}, expected lean-verified`);
  const meta = fs.readFileSync(path.resolve(project, payload.change.path, '.openspec.yaml'), 'utf8');
  assert(/lean-verified/.test(meta), 'persisted .openspec.yaml must name the resolved schema');
  const txt = cliRun(['new', 'change', 'probe-2117-b']);
  assert(/Schema: lean-verified/.test(txt.out), `text output must print the resolved schema, got: ${txt.out.split('\n').find((l) => l.startsWith('Schema:'))}`);
  return needsBuild ? 'patch applied, CLI rebuilt, probe green' : 'patch already in place, probe green';
});

// --- S27: lean archive skill ships as a pinned patch of the vendored template --
check('S27', '—', 'patch: the generated openspec-archive-change skill is the lean-verified one (runs 3-5 wording)', () => {
  const tpl = path.join(repoRoot, 'vendor', 'OpenSpec', 'skills', 'openspec-archive-change', 'SKILL.md');
  const skill = fs.readFileSync(tpl, 'utf8');
  assert(/lean-verified workflow/.test(skill), 'template description must name the lean-verified workflow');
  assert(/mechanical finish step/.test(skill), 'template must frame archive as a mechanical finish step');
  assert(/frozen history/.test(skill), 'template must state archived changes are frozen history');
  assert(/git add openspec\//.test(skill), 'template must stage openspec/ only in the archive commit');
  assert(!/Store selection:/.test(skill) && !/allowed-tools:/.test(skill), 'upstream ceremony text must be gone from the template');
  assert(fs.readFileSync(path.join(repoRoot, 'patches', 'openspec-archive-change-skill-lean_v1.14.3.patch'), 'utf8').length > 0, 'the pinned patch file must exist');
  return 'vendored template == the skill dogfooded in runs 3-5';
});

// --- S28: the five other lean skills ship as pinned patches -------------------
check('S28', '—', 'patches: apply/explore/propose/sync/update skill templates cross-reference only real commands', () => {
  const skills = ['openspec-apply-change', 'openspec-explore', 'openspec-propose', 'openspec-sync-specs', 'openspec-update-change'];
  for (const s of skills) {
    const tpl = fs.readFileSync(path.join(repoRoot, 'vendor', 'OpenSpec', 'skills', s, 'SKILL.md'), 'utf8');
    assert(!tpl.includes('generatedBy:'), `${s}: template must not carry init-time bookkeeping`);
    assert(!tpl.includes('/openspec-continue-change'), `${s}: must not reference the never-installed continue-change skill`);
    assert(tpl.includes('/opsx-'), `${s}: must reference the real /opsx-* prompts`);
    assert(!tpl.includes(`/openspec-${s.replace('openspec-', '')} `), `${s}: must not reference its own stale long command name`);
    assert(fs.existsSync(path.join(repoRoot, 'patches', `${s}-skill-lean_v1.14.3.patch`)), `${s}: pinned patch file must exist`);
  }
  return '5 templates patched: /opsx-* names, no continue-change ghosts, no generatedBy';
});

// --- S30: ADR guard checks A0/A1/A2 ------------------------------------------
check('S30', '—', 'decisions are guarded - citation on touch, staleness, lifecycle', () => {
  const { gp, g, drift } = initDriftRepo('drift-adr');
  // accepted decision governing src/** — committed after the code, so fresh
  const decDir = path.join(gp, 'openspec/decisions');
  fs.mkdirSync(decDir, { recursive: true });
  fs.writeFileSync(
    path.join(decDir, '0001-usage-domain.md'),
    '---\nstatus: accepted\ncode: src/**\n---\n# Usage domain shape\n\nOne seam, report first.\n'
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'record decision 0001']);
  let r = drift();
  assert(r.code === 0, `fresh decision must be clean:\n${r.out}`);

  // A1: open change overlapping the globs without citing the ADR
  const chDir = path.join(gp, 'openspec/changes/add-export/specs/usage-reporting');
  fs.mkdirSync(chDir, { recursive: true });
  fs.writeFileSync(
    path.join(chDir, 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: Batch Export\n\n#### Scenario: nightly\n\n- **WHEN** the job runs\n- **THEN** a batch is written\n\nCode: `src/usage-report/**`\n'
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'open change add-export']);
  r = drift();
  assert(r.code === 1 && /\[A1\].*governed by ADR-0001/.test(r.out), `uncited decision must go red as A1:\n${r.out}`);

  // citing it in the proposal satisfies A1
  fs.writeFileSync(
    path.join(gp, 'openspec/changes/add-export/proposal.md'),
    '# Proposal\n\nFollows ADR-0001 (usage domain shape): export rides the same seam.\n'
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'cite decision in proposal']);
  r = drift();
  assert(r.code === 0, `cited decision must be clean:\n${r.out}`);

  // A2: code under the globs moves without reconfirming the decision
  fs.appendFileSync(path.join(gp, 'src/usage-report/report.ts'), '// v2\n');
  fs.appendFileSync(path.join(gp, 'openspec/specs/usage-reporting/spec.md'), '\n'); // keep L2 quiet
  g(['add', '-A']);
  g(['commit', '-qm', 'code-only drift past decision']);
  r = drift();
  assert(r.code === 1 && /\[A2\].*ADR-0001/.test(r.out), `stale decision must go red as A2:\n${r.out}`);

  // reconfirm = touch the decision in the same commit as the code
  fs.appendFileSync(path.join(decDir, '0001-usage-domain.md'), '\nReconfirmed after export change.\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'reconfirm decision 0001']);
  r = drift();
  assert(r.code === 0, `reconfirmed decision must be clean:\n${r.out}`);

  // A0: superseding without flipping the target's status
  fs.writeFileSync(
    path.join(decDir, '0002-other-seam.md'),
    '---\nstatus: accepted\ncode: docs/**\nsupersedes: ADR-0001\n---\n# Other seam\n\nDocs only, no code overlap.\n'
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'add decision 0002 superseding 0001']);
  r = drift();
  assert(r.code === 1 && /\[A0\].*0001.*still accepted/.test(r.out), `unflipped supersede must go red as A0:\n${r.out}`);

  fs.writeFileSync(path.join(decDir, '0001-usage-domain.md'), '---\nstatus: superseded\ncode: src/**\n---\n# Usage domain shape\n\nSuperseded by ADR-0002.\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'flip 0001 to superseded']);
  r = drift();
  assert(r.code === 0, `completed supersede must be clean:\n${r.out}`);
  return 'A1 red → cite → A2 red → reconfirm → A0 red → flip';
});

// --- S31: arch-extract induces structure and ingests decisions ----------------
check('S31', '—', 'arch-extract derives the as-built report and treats decisions as ground truth', () => {
  const jr = spawnSync('node', [path.join(repoRoot, 'openspec/scripts/arch-extract.mjs'), '--json'], { cwd: repoRoot, encoding: 'utf8' });
  assert(jr.status === 0, `arch-extract --json failed:\n${jr.stderr}`);
  const parsed = JSON.parse(jr.stdout);
  assert(Array.isArray(parsed.derived.taxonomy?.roots), 'taxonomy roots must be an array');
  const dec = (parsed.derived.decisions ?? []).find((d) => d.location === 'openspec/decisions/0001-zero-dependency-node-tooling.md');
  assert(dec && dec.status === 'accepted' && /openspec\/scripts\/\*\*/.test(dec.code), 'our dogfood ADR must be ingested as ground truth');
  const tr = spawnSync('node', [path.join(repoRoot, 'openspec/scripts/arch-extract.mjs')], { cwd: repoRoot, encoding: 'utf8' });
  assert(tr.status === 0 && /interpreted/i.test(tr.stdout) && /ground truth/.test(tr.stdout), 'text report must keep derived and interpreted honestly separated');
  return 'derived/interpreted separation + ADR ingestion verified on this repo';
});

// --- S32: the agent manual exists, points at real artifacts, and is found ---
check('S32', '—', 'openspec/AGENTS.md is the consumer page and root AGENTS.md routes to it', () => {
  const man = fs.readFileSync(path.join(repoRoot, 'openspec', 'AGENTS.md'), 'utf8');
  const root = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  // the manual names every artifact it governs, and they all exist
  for (const ref of ['openspec/GLOSSARY.md', 'openspec/decisions/', 'Verified by:', 'Code:', 'Mechanical-Change:', '--no-verify', 'spec-extract', 'arch-extract']) {
    assert(man.includes(ref), `manual must mention ${ref}`);
  }
  assert(fs.existsSync(path.join(repoRoot, 'openspec', 'GLOSSARY.md')), 'manual references openspec/GLOSSARY.md — it must exist');
  assert(fs.existsSync(path.join(repoRoot, 'openspec', 'decisions')), 'manual references openspec/decisions/ — it must exist');
  // routing: root AGENTS.md and README both route agents to the manual
  assert(root.includes('openspec/AGENTS.md'), 'root AGENTS.md must route to the manual');
  assert(readme.includes('openspec/AGENTS.md'), 'README must tell adopters where the agent page lives');
  // the manual stays honest with the guard's actual check IDs
  for (const id of ['L1', 'L2', 'M', 'O', 'L3', 'A0', 'A1', 'A2']) assert(man.includes(id), `manual must document guard check ${id}`);
  return 'manual ↔ artifacts ↔ routing in lockstep';
});

// --- report -----------------------------------------------------------------
const width = 74;
console.log(`\nlean-verified smoke tests  (project: ${path.basename(project)})`);
console.log('='.repeat(width));
for (const r of results) {
  const mark = r.ok ? '\u2713' : '\u2717';
  console.log(`${mark} [${r.critic}] ${r.id}: ${r.name}`);
  if (r.detail) console.log(`    ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log('='.repeat(width));
console.log(`${results.length - failed.length}/${results.length} passed`);

fs.rmSync(project, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
