export const meta = {
  name: 'factory-execute',
  description: 'Factory build engine: contracts as code first, then parallel lanes in their own worktrees (build, tests from the contract, adversarial review, fix), then one integration with the full suites.',
  phases: [
    { title: 'Decompose', detail: 'read the Phase 0 file list and the lane map from the plan; check lane ownership is disjoint and claims no foreign-owned file; write one brief per lane' },
    { title: 'Contracts', detail: 'Phase 0: every contract, DTO, migration and compiling shell, one commit' },
    { title: 'Lanes setup', detail: 'one worktree + branch per lane, all from the contracts commit' },
    { title: 'Build', detail: 'each lane implements against the frozen contracts (build model)' },
    { title: 'Tests', detail: 'tests written from the CONTRACT by a different agent, without reading the implementation' },
    { title: 'Review', detail: 'adversarial review of code AND tests, with targeted mutation on high-risk lines' },
    { title: 'Fix', detail: 'fix confirmed findings; re-review only when a blocker was fixed' },
    { title: 'Integrate', detail: 'merge lanes, drop .factory/, full suites once (by a cheap runner), fix, real-stack smoke' },
    { title: 'Teardown', detail: 'remove every lane worktree and branch that is fully merged and clean; keep and report the rest' },
  ],
}

// ---- args (passed by /factory-execute) ----------------------------------------
// {
//   planPath:       absolute path to the APPROVED plan (requirements, contracts, Phase 0 file list, lane map) (required)
//   repoDir:        absolute path to the feature worktree, already on featureBranch                      (required)
//   featureBranch:  the feature branch name                                                               (required)
//   baseline:       what was green/red before anything changed (suite counts, known failures)
//   knownFailures:  [{ test, why }] — red on the baseline for a reason that is this machine's, not the code's
//   buildCmds:      shell commands that must succeed for "it builds" (e.g. ["dotnet build src/App.sln", "cd app && npm run check"])
//   testCmds:       shell commands for the FULL suites. The engine runs them once, at integration, through a cheap
//                   runner agent; no other agent runs them. The final full run is CI's on the PR (see /factory-ship).
//   guardTests:     optional [{ when: [path globs], cmd }] — always-run tests for breakage impact analysis misses
//                   (reflection-based handler resolution, migrations / model snapshot, DI registration, config). Every
//                   agent that runs tests runs each guard whose globs match a path it changed. From the plan's Guard
//                   tests section.
//   worktreeCmd:    how to create a lane worktree, with {path} {name} {branch} {start} placeholders ({name} is
//                   the last segment of {path}, for helpers that take a name). Default:
//                   git worktree add {path} -b {branch} {start}. Repos with a helper (port slots, node_modules) pass it.
//   teardownCmd:    how to remove one lane worktree, same placeholders. Default: git worktree remove {path}. Repos whose
//                   helper claims something per worktree (a port slot, a database) pass the command that releases it.
//   laneSetupNote:  extra per-lane setup the repo needs (copy .env, etc.)
//   houseRules:     one paragraph naming the repo's rule files; default points at AGENTS.md / CLAUDE.md
//   gitTrailer:     the commit trailer lines this session requires (verbatim)
//   repoRules:      extra hard rules (e.g. "no issue-tracker ids in commits")
//   foreignOwned:   optional [paths] — files a SIBLING plan owns (the plan's "Shared files" section). No lane may claim
//                   one; decompose stops if a lane does. Lanes build against the owner's contract or a stub.
//   strongModel:    model for Phase 0 contracts. Omit to inherit the session model.
//   reviewModel:    model for lane review, re-review and integration. Default: strongModel (so the session model).
//   laneReviewModel: model for the lane review's reading pass only. Default: reviewModel. A cheaper one is an experiment
//                   to measure: the high-risk mutation checks and the whole-diff review stay on reviewModel regardless.
//   buildModel:     model for build, tests and fixes. Default 'sonnet'.
//   mechanicalModel: model for decompose extraction, lane setup and teardown (low effort). Default 'haiku'.
//   briefModel:     model that writes the per-lane briefs. Default 'sonnet' — every lane builds from its brief, so a
//                   dropped contract line there costs more than the step saves on a cheaper model.
//   maxReviewRounds: re-reviews after a blocker fix, per lane (default 1)
//   lanes:          optional — skip extraction and use this lane map ([{ key, name, owns:[paths], planSection, testCmd }]);
//                   briefs are still written from the plan. A lane's testCmd is its AFFECTED tests (its test projects or
//                   classes, `vitest related`, its e2e specs), never a full suite; omitted, the lane picks them by the
//                   TESTS rules below.
//   acceptedLanes:  optional [laneKey] — lanes the coordinator fixed BY HAND on the lane branch after a stop. On resume they
//                   count as done and integration runs. This arg is not embedded in any prompt, so adding it keeps the cache.
// }
// Keep resume args IDENTICAL between a run and its resume (acceptedLanes excepted): changing any other arg changes
// every prompt that embeds it, and the cache then re-runs finished work. When that happens anyway, each lane agent
// finds its stage already recorded in the lane's status file and returns the recorded result instead of redoing it.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
for (const k of ['planPath', 'repoDir', 'featureBranch']) {
  if (!A[k]) throw new Error(`factory-execute: ${k} is required`)
}
const { planPath, repoDir, featureBranch } = A
// Model tiers. Nothing defaults to a named strong model: the session model is the strong tier unless an arg names one.
// Judgment (contracts, review, integration) stays strong; writing code goes to buildModel; steps that only copy text
// or run a fixed command list (extraction, worktrees, teardown) go to a cheap model at low effort — they were the
// easiest tokens to save and nothing in them needs judgment.
const STRONG = A.strongModel ? { model: A.strongModel } : {}
const REVIEWM = A.reviewModel ? { model: A.reviewModel } : STRONG
const LANE_REVIEW = A.laneReviewModel ? { model: A.laneReviewModel } : REVIEWM
// A cheaper lane reviewer reads and reports only; the high-risk mutations then run as a second pass on reviewModel,
// so the one check that is evidence rather than opinion is never downgraded.
const SPLIT_REVIEW = (LANE_REVIEW.model || '') !== (REVIEWM.model || '')
const BUILD = { model: A.buildModel || 'sonnet' }
const MECH = { model: A.mechanicalModel || 'haiku', effort: 'low' }
// Briefs are copying, but every lane depends on them being complete, so they get a model that copies reliably.
const BRIEF = { model: A.briefModel || 'sonnet' }
const MAX_REVIEW = A.maxReviewRounds ?? 1
const BUILD_CMDS = (A.buildCmds || []).join(' && ') || "the repo's build and type-check commands from AGENTS.md / CLAUDE.md"
const TEST_CMDS = (A.testCmds || []).join(' ; ') || 'every test suite the repo has (AGENTS.md / CLAUDE.md say how)'
const KNOWN = (A.knownFailures || []).map(k => `- ${k.test} — ${k.why}`).join('\n')
const FOREIGN = A.foreignOwned || []
const WT_CMD = A.worktreeCmd || 'git worktree add {path} -b {branch} {start}'
const TD_CMD = A.teardownCmd || 'git worktree remove {path}'
const RULE_FILES = A.houseRules || 'House rules: read AGENTS.md (or CLAUDE.md) at the repo root and in any directory you edit; they win over habit.'
const GUARDS = A.guardTests || []
if (GUARDS.some(g => !g || !Array.isArray(g.when) || g.when.length === 0 || !g.cmd)) {
  throw new Error('factory-execute: every guardTests entry needs when: [path globs] and cmd')
}
// Per-run scratch folder outside the repo, named for the branch so parallel runs never share one: smoke helpers, test
// logs, and the lane status files copied out before integration removes .factory/. A shell expression: expand it.
const RUN_DIR = `\${TMPDIR:-/tmp}/factory-${featureBranch.replace(/[^A-Za-z0-9._-]/g, '-')}`
const clip = (s, n = 600) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s)

const RULES = `
Phase 0 writes two kinds of file. FROZEN contracts — enums, entities and DB config, the migration, request/response/
DTO/interface files, wire types, mocks — are never changed unless genuinely broken (then say exactly what and why).
SHELLS — handler bodies that throw NotImplemented, component stubs — belong to the lane that owns their path, which
fills them in keeping their signatures and CONTRACT blocks (MUST / EDGE / ORDER / NEVER).
Tests: reuse the repo's EXISTING test base classes and seed helpers (find their real names; never invent them);
seeds are FK-honest (real parent rows, valid lookup ids); anything guarding a permission, money or data loss is tested
through the same entry point production uses (if production validates before handling, the test must too — a test that
calls the handler directly and skips validation proves nothing about the gate); a migration must be registered
wherever the test host applies schema. A wave of Inconclusive or skipped DB tests means Docker / the container runtime
is down: that is NOT green — say so and stop.
${FOREIGN.length ? `Owned by a sibling plan — never write or re-implement: ${FOREIGN.join(', ')}. Build against its contract (or the
stub the plan names) as it stands.` : ''}
Git: status, diff, log, rev-parse, add, commit, checkout -- <file>; merge and worktree only when your job says so.
NEVER bare \`git stash\` (the stash is shared across worktrees — use a WIP commit), never reset --hard, never push,
never open a PR, never write to an issue tracker.
${A.repoRules || ''}
Commit messages: one plain-language sentence saying what changed${A.gitTrailer ? `, ending with exactly:\n${A.gitTrailer}` : '.'}
${KNOWN ? `These tests were red on the baseline for a machine reason, not the code — set them aside and say so:\n${KNOWN}` : ''}`

// Test-run policy. In the overnight run agents ran the full suites 5–6 times per PR and read the output each time. Now
// agents run only what their change can affect; the engine owns the full runs (integration here, CI on the PR at the
// end) and hands them to a cheap runner. Impact analysis misses indirect breakage, so guard tests always run on a
// matching path, and the integration full run and CI catch the rest.
const TESTS = `
TESTS — unless your job says you are the suite runner, never run the full suites: the orchestrator schedules those.
Run the AFFECTED tests, chosen from what you changed (\`git diff --name-only\`):
- .NET-style solutions: the test project of each project you changed. Add the test projects of projects that
  REFERENCE it only when the change touches a public contract (request / response / DTO / interface files). Filter to
  the touched handler's test class where one exists (e.g. --filter "FullyQualifiedName~<Class>").
- JS / TS: \`vitest related --run <changed files>\` (it follows the import graph); Playwright \`--only-changed=<base sha>\`
  or the e2e specs your brief lists.
- Any other stack: the narrowest selection the repo's own tooling supports (AGENTS.md / CLAUDE.md say how).
${GUARDS.length ? `GUARD TESTS catch what impact analysis misses (reflection-based resolution, the migration and model snapshot, DI
registration, config). Whenever you run tests, also run each guard whose globs match a path you changed:
${GUARDS.map(g => `- ${g.when.join(', ')} → ${g.cmd}`).join('\n')}` : ''}
Test output never enters your context whole: mkdir -p ${RUN_DIR}/logs and run every test command as
\`<cmd> > ${RUN_DIR}/logs/<label>.log 2>&1\`, then read only the summary and the failures (\`tail -n 40\`,
\`grep -inE "fail|error" <log> | head -50\`). Report counts, failing test names and the log path, never pasted output.
READ BY SECTION: grep (\`rg -n\`) for the symbol or heading first, then read only that range; never read a large file
whole to find one thing.`

// Every prompt starts with this exact block, then the role, then the job: the prompt cache matches on a prefix, so the
// identical part goes first and everything that varies (lane, sha, counts) goes last.
const SHARED = `You are one agent in an orchestrated feature build.${RULES}${TESTS}`

// Agents that need the whole picture (extraction, briefs, Phase 0, integration) read the whole plan.
const COMMON = `${SHARED}
WHAT TO READ: the APPROVED plan is ${planPath}. Read it fully before anything else, starting with its decisions block,
which overrides anything in the plan that disagrees. ${RULE_FILES}`

// Lane agents read their brief instead. Every lane agent reading a ~1000-line plan and every rule file was the largest
// fixed cost per agent; the brief carries the same words for this lane's paths, verbatim, and names the plan sections
// it leaves out, so nothing is paraphrased and nothing the lane needs is cut.
const brief = l => `.factory/briefs/${l.key}.md`
const LANE_SHARED = `${SHARED}
WHAT TO READ: your lane's brief (named below, in your worktree), first. It quotes, verbatim from the approved plan
(${planPath}), this lane's decisions, contracts, test cases, high-risk lines and the house-rule passages for its
paths. Open the full plan only for a section the brief names, and the rule files
(${A.houseRules ? 'as named here: ' + A.houseRules : 'AGENTS.md / CLAUDE.md'}) only for a path the brief does not cover.`
const LANE_COMMON = l => `${LANE_SHARED}
Your lane: ${l.key}. Your brief: ${brief(l)}.`

// Result fields are capped. Lane results of 30–60 KB each landed in the orchestrator and the workflow result was
// truncated at ~60 KB; the detail belongs in the lane status file, where the next agent reads it by pointer.
const STAGE = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string', maxLength: 600, description: 'at most ~600 chars; detail goes in the status file or issues' },
    commit: { type: 'string' },
    tests: { type: 'string', maxLength: 400, description: 'pass/fail counts per suite you ran, and the log path' },
    failing: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 200 }, description: "names of tests that fail against THIS lane's code" },
    deferred: { type: 'array', maxItems: 50, items: { type: 'object', required: ['test', 'waitsOn'],
      properties: { test: { type: 'string', maxLength: 200 }, waitsOn: { type: 'string', description: 'the key of the lane whose stub it needs' } } },
      description: "tests that fail ONLY because another lane's code is still a Phase 0 stub" },
    issues: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 300 }, description: 'short items, one line each' },
  },
}
const REVIEW = {
  type: 'object',
  required: ['verdict', 'findings', 'treeClean'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes'] },
    findings: { type: 'array', maxItems: 30,
      description: 'most severe first; if there are more than 30, the rest go in the status file\'s "open" list',
      items: { type: 'object',
      required: ['severity', 'area', 'file', 'problem', 'fix'],
      properties: {
        severity: { type: 'string', enum: ['blocker', 'should-fix', 'nit'] },
        area: { type: 'string', enum: ['code', 'tests'] },
        file: { type: 'string' }, line: { type: 'integer' },
        problem: { type: 'string', maxLength: 400, description: 'concrete input/state → wrong output' },
        fix: { type: 'string', maxLength: 300 },
      } } },
    mutations: { type: 'array', maxItems: 30, items: { type: 'object',
      required: ['line', 'killed'],
      properties: { line: { type: 'string', maxLength: 200 }, killed: { type: 'boolean' }, note: { type: 'string', maxLength: 200 } } } },
    treeClean: { type: 'boolean', description: '`git status --porcelain` was empty when you finished (every mutation reverted, the status file committed)' },
  },
}
const DECOMPOSE = {
  type: 'object',
  required: ['contracts', 'lanes'],
  properties: {
    contracts: { type: 'string', description: "the plan's Phase 0 instructions and file list, verbatim" },
    lanes: { type: 'array', items: { type: 'object',
      required: ['key', 'name', 'owns', 'planSection'],
      properties: {
        key: { type: 'string', description: 'short kebab-case id' },
        name: { type: 'string' },
        owns: { type: 'array', items: { type: 'string' }, description: 'repo-relative path prefixes this lane alone may edit' },
        planSection: { type: 'string' },
        testCmd: { type: 'string', description: "the command that runs this lane's AFFECTED tests (its test projects or classes, its e2e specs), verbatim" },
      } } },
    smoke: { type: 'string', description: "the plan's real-stack smoke steps for integration, verbatim" },
  },
}
// What the suite runner returns: counts and names only. The log stays on disk for whoever has to read a failure.
const SUITES = {
  type: 'object',
  required: ['suites', 'failing', 'failingTotal', 'infraDown'],
  properties: {
    suites: { type: 'array', items: { type: 'object', required: ['cmd', 'passed', 'failed', 'log'],
      properties: { cmd: { type: 'string' }, passed: { type: 'integer' }, failed: { type: 'integer' },
        skipped: { type: 'integer', description: 'skipped plus inconclusive' }, log: { type: 'string', description: 'the log file path' } } } },
    failing: { type: 'array', maxItems: 60, items: { type: 'string', maxLength: 200 }, description: 'failing test names, at most 60' },
    failingTotal: { type: 'integer' },
    infraDown: { type: 'boolean', description: 'a suite could not start, or a wave of Inconclusive / skipped DB tests (the container runtime is down)' },
  },
}

// ---- Decompose ----------------------------------------------------------------
phase('Decompose')
let D = A.lanes ? { contracts: '', lanes: A.lanes, smoke: '' } : null
if (!D) {
  D = await agent(`${COMMON}
Read the plan and return, VERBATIM where it says so: its Phase 0 (contracts) instructions and file list; its lane
map (each lane's key, name, the path prefixes it owns, its plan section and the command that runs its tests); and its
integration smoke steps. Do not invent lanes the plan does not define. Do not edit anything.`,
    { label: 'decompose', phase: 'Decompose', schema: DECOMPOSE, ...MECH })
}
if (!D || !D.lanes || D.lanes.length === 0) return { stopped: { step: 'decompose', reason: 'the plan defines no lanes' } }
const bad = D.lanes.filter(l => !l.key || !Array.isArray(l.owns) || l.owns.length === 0)
if (bad.length) return { stopped: { step: 'decompose', reason: 'every lane needs a key and the paths it owns', bad } }

// Lane ownership must be disjoint, or two lanes write the same file and integration turns into conflict surgery.
// Deterministic — checked here in code, never by a model.
const norm = p => p.replace(/^\.\//, '').replace(/\/+$/, '')
const clash = (x, y) => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')
const overlaps = []
D.lanes.forEach((a, i) => D.lanes.slice(i + 1).forEach(b => a.owns.forEach(pa => b.owns.forEach(pb => {
  if (clash(norm(pa), norm(pb))) overlaps.push(`${a.key}:${pa} <-> ${b.key}:${pb}`)
}))))
if (overlaps.length) return { stopped: { step: 'decompose', reason: "lane ownership overlaps — fix the plan's lane map", overlaps } }
// The same rule one level up: a file a sibling plan owns is built once, there. Two stacked PRs each building and
// hardening their own copy of one shared file is what this prevents — so a lane that claims one stops the run.
const foreign = []
D.lanes.forEach(l => l.owns.forEach(p => FOREIGN.forEach(f => { if (clash(norm(p), norm(f))) foreign.push(`${l.key}:${p} <-> foreign:${f}`) })))
if (foreign.length) return { stopped: { step: 'decompose', reason: "a lane claims a file a sibling plan owns — fix the plan's lane map or its Shared files section", foreign } }
log(`Lanes: ${D.lanes.map(l => l.key).join(', ')}`)

// One brief per lane, committed on the feature branch so every lane worktree starts with it. Copying, not judging:
// the mechanical model is enough, and verbatim is the rule that keeps it safe.
const briefs = await agent(`${COMMON}
YOUR JOB: in ${repoDir} on ${featureBranch}, write one brief per lane at ${brief({ key: '<key>' })}. A lane agent reads its brief
INSTEAD of the plan, so it must hold everything that lane needs, copied VERBATIM from the plan — never paraphrased,
never summarised:
1. the lane's key, name, owned paths, affected-test command (and the e2e specs it owns, if any), and how it mocks
   the layer below;
2. every entry of the decisions block that bears on those paths;
3. the CONTRACT block (MUST / EDGE / ORDER / NEVER) of every handler, module and component under those paths, and the
   wire shapes and Phase 0 files they use;
4. the lane's test cases and its high-risk lines;
5. only the house-rule passages that apply to those paths, each quoted with its file and heading;
6. "Plan sections to consult": the headings of any plan section the lane may need beyond this (say none if none).
Lanes:
${D.lanes.map(l => `- ${l.key} (${l.name}) — owns ${l.owns.join(', ')}; plan ${l.planSection || 'see lane map'}`).join('\n')}
Write nothing else. \`git add -f .factory/briefs\` and make ONE commit. Return its sha.`,
  { label: 'briefs', phase: 'Decompose', schema: STAGE, ...BRIEF })
if (!briefs || briefs.status !== 'done' || !briefs.commit) return { stopped: { step: 'decompose', reason: 'the lane briefs were not committed', briefs } }

// ---- Phase 0: contracts as code -----------------------------------------------
phase('Contracts')
const contracts = await agent(`${COMMON}
YOUR JOB: Phase 0, in ${repoDir} on ${featureBranch}. Write EVERY contract the lanes will build against, so that no
lane ever has to guess a shape another lane owns:
${D.contracts || "(see the plan's Phase 0 / Contracts section)"}
That means: shared enums; entities, DB configuration and the ONE migration; every request/response/DTO/interface
file in every layer; handler SHELLS that compile, whose bodies throw NotImplemented, each carrying its CONTRACT block
from the plan; frontend types, accessor signatures, API-mock fixtures and component stubs the plan lists; and the
shared registration files the plan assigns to Phase 0 (DI registration, route tables, barrels, nav, project files).
Every shell goes at the path of the lane the plan assigns it to. Leave .factory/ alone.
Then: the build passes (${BUILD_CMDS}), migration/seed tests the plan names pass, and the existing tests affected by
what you touched, plus every matching guard test, still pass (TESTS above — never the full suites). Make ONE commit.
Return its sha, and in summary the number of contract files (\`git show --stat\` lists them; do not list them here).`,
  { label: 'Phase 0: contracts', phase: 'Contracts', schema: STAGE, ...STRONG })
if (!contracts || contracts.status !== 'done' || !contracts.commit) return { stopped: { step: 'contracts', reason: 'Phase 0 did not finish with a commit', contracts } }
log(`Contracts committed: ${contracts.commit}`)

// ---- Lane worktrees -------------------------------------------------------------
phase('Lanes setup')
const wt = l => `${repoDir}-lane-${l.key}`
const br = l => `${featureBranch}-lane-${l.key}`

// Lane worktrees are scaffolding: once a lane's work is in the feature branch, its worktree and branch go. Nothing is
// thrown away to get there — a lane whose branch is not fully merged, or whose tree has uncommitted changes, is kept
// and reported, because that is exactly the work a person needs to look at.
const TEARDOWN = {
  type: 'object',
  required: ['removed', 'kept', 'worktreeList'],
  properties: {
    removed: { type: 'array', items: { type: 'string' }, description: 'lane keys whose worktree AND branch are gone' },
    kept: { type: 'array', items: { type: 'object', required: ['lane', 'reason'],
      properties: { lane: { type: 'string' }, reason: { type: 'string' } } } },
    worktreeList: { type: 'string', description: 'the `git worktree list` lines still containing -lane- after cleanup, verbatim (empty when none)' },
  },
}
const teardown = (why) => agent(`${SHARED}
YOUR JOB: remove the lane worktrees of a finished build (${why}). Work from ${repoDir}.
For each lane below, in order:
1. If its path is not a registered worktree (\`git worktree list --porcelain\`) and its branch does not exist, it is
   already gone: count it as removed.
2. KEEP it, with the reason, if \`git -C <path> status --porcelain\` prints anything (uncommitted work), or if
   \`git merge-base --is-ancestor <branch> ${featureBranch}\` fails (commits that never reached the feature branch).
3. Otherwise remove the worktree with \`${TD_CMD}\` ({name} = the last path segment of {path}; read any helper script
   it names first), then delete the branch with \`git branch -d <branch>\` (lower-case -d: it refuses an unmerged
   branch, which is the point). Never --force, never -D, never rm -rf.
Then \`git worktree prune\` and return the \`git worktree list\` lines that still contain "-lane-", verbatim (none
when every lane is gone). Touch nothing that is not in this list.
${D.lanes.map(l => `- ${l.key}: path ${wt(l)}  branch ${br(l)}`).join('\n')}`,
  { label: 'teardown', phase: 'Teardown', schema: TEARDOWN, ...MECH })
// Setup only runs a command list: it gets the shared block, not the plan.
const setup = await agent(`${SHARED}
YOUR JOB: create one worktree and branch per lane, each starting at ${contracts.commit}. Command template: \`${WT_CMD}\`
({name} = the last path segment of {path})
(read any helper script it names first; if it cannot branch from a start point, create the branch with
\`git branch <branch> ${contracts.commit}\` and pass the branch).
${D.lanes.map(l => `- path ${wt(l)}  branch ${br(l)}`).join('\n')}
${A.laneSetupNote || ''}
Confirm each worktree's HEAD is ${contracts.commit}. Start no servers.`,
  { label: 'lane worktrees', phase: 'Lanes setup', schema: STAGE, ...MECH })
if (!setup || setup.status !== 'done') {
  // Every lane branch still sits on the contracts commit, so whatever was created is safe to remove.
  phase('Teardown')
  return { stopped: { step: 'lanes-setup', setup }, contracts, teardown: await teardown('lane setup failed') }
}

// ---- Lanes: build → tests → review → fix (→ re-review) -------------------------
const laneRule = l => `Work ONLY in ${wt(l)} (branch ${br(l)}) — cd there first and stay there. You own: ${l.owns.join(', ')}
(including the Phase 0 shells under those paths, which you fill in). Never edit another lane's files, a FROZEN
contract file, or anything under .factory/ except your lane's status file; mock the layer below as the plan says.
Your tests are this lane's AFFECTED tests: ${l.testCmd || 'chosen by the TESTS rules above for the paths you changed (your brief names the projects and specs)'},
plus every guard test whose globs match a path you changed. Never the full suites: they run at integration.`

// Each lane keeps a status file on its own branch. A resume used to cost as much as the run: one changed prompt upstream
// re-ran every lane's tests and review, because each prompt embedded the previous agent's free-text summary. Now
// prompts carry only deterministic facts (branch, sha, counts, test names) and point at this file; an agent asked for a
// stage that is already recorded returns the recorded result, so the next prompt is identical and replays from cache.
// The file is committed (a resume finds it in the worktree) and .factory/ is removed at integration, so it never ships.
const statusFile = l => `.factory/lanes/${l.key}.json`
const ledger = (l, stage) => `
STATUS FILE: ${statusFile(l)} in your worktree. Shape: { "lane", "stage" (latest), "sha" (latest code sha), "verdict"
(latest review verdict), "open" (latest open findings), "done" (stage names in the order they ran), "stages":
{ "<name>": { "sha", "result", "detail" } } }. Your stage is "${stage}".
FIRST, before any other work: if "stages" records "${stage}" and EITHER nothing outside .factory/ changed since its sha
(\`git diff --quiet <sha> HEAD -- . ':(exclude).factory'\`) OR a later stage follows it in "done", the stage is already
done — return its recorded result exactly as stored and do nothing else.
LAST, after your own work and commit: record the stage — stages["${stage}"] = { sha: the HEAD of the code you produced
or reviewed, result: exactly the JSON you are returning, detail: whatever did not fit the capped result (full notes,
extra findings, test and expected/actual for each failure) }; append "${stage}" to "done"; update stage, sha, verdict and
open. Create the file if it is missing. \`git add -f ${statusFile(l)}\` and commit it on its own. Edit no other key.`

// Cross-lane stubs are not failures. A test that is red only because the lane it calls is still a Phase 0 shell says
// nothing about this lane — counting it blocked lanes that were finished. It is listed, not fixed, and integration,
// where the real code exists, must show it green.
const deferredNote = deferred => deferred.length
  ? `Deferred (red only because another lane's code is still a stub — NOT findings, never "fixed" here): ${deferred.map(d => `${d.test} [waits on ${d.waitsOn}]`).join('; ')}.
Check each classification: a deferred test that fails on THIS lane's code is a blocker.`
  : ''

const reviewPrompt = (l, stage, opts) => `${LANE_COMMON(l)}
YOUR JOB: adversarially review ${l.name} — its code AND its tests — in ${wt(l)}. You did not write any of it.
${opts.prev ? `SCOPE: this is a re-review, so read only the prior findings (below) and what changed since that review:
\`git diff <stages["${opts.prev}"].sha>..HEAD -- . ':(exclude).factory'\`. The rest of the lane was reviewed already.` : `SCOPE: exactly this lane's diff, \`git diff ${contracts.commit}..HEAD -- . ':(exclude).factory'\`, and your brief.`}
Open other code only to follow a call out of that diff, and then by section. Try to break it:
- every MUST / NEVER / EDGE / ORDER in this lane's CONTRACT blocks (in your brief) against the code;
- the house rules; real bugs (time zones and day boundaries, nulls, ordering, authorization, tenancy, validation
  gaps, missing loading / empty / error states);
- the tests: missing contract cases, assertions that pass on wrong code, tests coupled to implementation details,
  mocks that hide the behaviour under test.
${opts.mutate ? `Targeted mutation, ONLY on the high-risk lines your brief lists (the auth, tenancy, money, data-loss and date lines).
FIRST run the lane's affected tests unmodified and note which are already red. Then for each line: sabotage it, run the
tests that cover it (the affected tests, narrowed to the covering test class where one exists),
record killed=true ONLY if a test that was green went red (an already-red test proves nothing), then restore the file
with \`git checkout -- <file>\`. Mutate nothing else. (The full MUST/ORDER mutation pass happens later, in /factory-fix
→ /test-review; this one covers the lines where a miss is costly.)` : 'Do not mutate anything: a separate pass on the review model mutates the high-risk lines after you. Return no mutations.'}
Only findings you verified by reading the code, with file and line. verdict "pass" only with no blockers or should-fixes${opts.mutate ? '\nand no surviving mutation on a high-risk line' : ''}. Edit nothing but the status file; finish with a clean tree (treeClean).
${deferredNote(opts.deferred)}
${opts.prev ? `This is a RE-REVIEW after "${opts.fix}". The previous review is recorded as ${recordsOf(opts.prev)} in the status file
(${opts.counts.findings} blocker/should-fix findings, ${opts.counts.survivors} surviving mutations); the fixer's disputes are the "${opts.fix}"
record's issues. Confirm each finding is fixed${opts.mutate ? ' (re-run those mutations)' : ''}, run the lane's affected tests (any red one is a
blocker, except a deferred one), and look in the delta for anything the fix broke. Accept a dispute only if the code proves it.` : ''}
${ledger(l, stage)}`

const mutatePrompt = (l, stage, opts) => `${LANE_COMMON(l)}
YOUR JOB: targeted mutation of ${l.name} in ${wt(l)}, ONLY on the high-risk lines your brief lists (the auth, tenancy,
money, data-loss and date lines). Another agent reviewed the code; you prove whether the tests can fail.
FIRST run the lane's affected tests unmodified and note which are already red. Then for each line: sabotage it, run
the tests that cover it (narrowed to the covering test class where one exists), record killed=true ONLY if a test that
was green went red (an already-red test proves nothing), then restore the file
with \`git checkout -- <file>\`. Mutate nothing else.${opts.prev ? ` This is a re-check after "${opts.fix}": the previous run is recorded as
"${opts.prev}-mutations"; re-run every mutation it lists as surviving, then the rest.` : ''}
A mutation that survives is a finding (area tests, severity blocker). verdict "pass" only when every one is killed.
Edit nothing but the status file; finish with a clean tree (treeClean).
${ledger(l, stage)}`

// One review pass, or two when laneReviewModel is cheaper than reviewModel. Run in sequence, never together: a reader
// in the same worktree as a mutator would review sabotaged code.
const laneReview = async (l, stage, opts) => {
  const label = stage === 'review' ? `${l.key}: review` : `${l.key}: re-${stage}`
  const ph = stage === 'review' ? 'Review' : 'Fix'
  if (!SPLIT_REVIEW) return agent(reviewPrompt(l, stage, { ...opts, mutate: true }), { label, phase: ph, schema: REVIEW, ...REVIEWM })
  const read = await agent(reviewPrompt(l, stage, { ...opts, mutate: false }), { label, phase: ph, schema: REVIEW, ...LANE_REVIEW })
  if (!read) return null
  const mut = await agent(mutatePrompt(l, `${stage}-mutations`, opts), { label: `${label} mutations`, phase: ph, schema: REVIEW, ...REVIEWM })
  if (!mut) return null
  return {
    verdict: read.verdict === 'pass' && mut.verdict === 'pass' ? 'pass' : 'changes',
    findings: [...(read.findings || []), ...(mut.findings || [])],
    mutations: mut.mutations || [],
    treeClean: read.treeClean !== false && mut.treeClean !== false,
  }
}
const recordsOf = stage => SPLIT_REVIEW ? `"${stage}" and "${stage}-mutations"` : `"${stage}"`

const results = await pipeline(
  D.lanes,
  (l) => agent(`${LANE_COMMON(l)}
YOUR JOB: build ${l.name}. ${laneRule(l)}
Phase 0 is commit ${contracts.commit} (\`git show --stat ${contracts.commit}\` lists the contract files).
Implement every handler / module / component in this lane to its CONTRACT block, with the contract kept in the code.
Do NOT write this lane's tests — a different agent writes them from the contract. Make it build (${BUILD_CMDS}) and
keep this lane's affected existing tests green. Commit. Return the sha; put every contract ambiguity you resolved in issues.
${ledger(l, 'build')}`,
    { label: `${l.key}: build`, phase: 'Build', schema: STAGE, ...BUILD }),

  (built, l) => agent(`${LANE_COMMON(l)}
YOUR JOB: write ${l.name}'s tests. ${laneRule(l)}
Write them FROM THE CONTRACT ONLY: the CONTRACT blocks, wire shapes, and the test cases in your brief.
You may read existing tests (patterns, base classes, fixtures) and the lane's contract/interface files. Do NOT open
the lane's implementation bodies — the tests must check what the contract promises, not what the code happens to do.
Every MUST gets a positive and a negative case; every ORDER a case where both checks would fail; every NEVER an
absence assertion. Run them (the lane's affected tests, output to a log). Never change production code. Classify
every red test:
- fails against THIS lane's code → it stays as written; its name goes in failing (test, expected, actual in the
  status file's detail);
- fails ONLY because it reaches another lane's code that is still a Phase 0 stub (NotImplemented, an empty component)
  → it stays as written and goes in deferred with that lane's key. It is not a failure of this lane;
- the test itself is wrong → you fix it.
Commit. Counts in tests.
${ledger(l, 'tests')}`,
    { label: `${l.key}: tests`, phase: 'Tests', schema: STAGE, ...BUILD })
    .then(tested => ({ built, tested })),

  ({ built, tested }, l) => laneReview(l, 'review', { deferred: (tested && tested.deferred) || [] })
    .then(review => ({ review, tested, built })),

  async ({ review, tested, built }, l) => {
    // Lane results stay small: counts, not findings. The findings, notes and disputes are in the status file.
    let notes = ((built && built.issues) || []).length
    const deferred = (tested && tested.deferred) || []
    const tally = rv => rv ? { findings: (rv.findings || []).filter(f => f.severity !== 'nit').length,
      survived: (rv.mutations || []).filter(m => !m.killed).length, killed: (rv.mutations || []).filter(m => m.killed).length } : {}
    const stop = (summary, extra) => ({ status: 'blocked', summary: clip(summary), notes, deferred, ...extra })
    if (!built || built.status !== 'done') return stop(`build did not finish: ${built ? built.summary : 'no result'}`)
    if (!tested || tested.status !== 'done') return stop(`tests were not written: ${tested ? tested.summary : 'no result'}`)
    let rv = review
    let rvStage = 'review'
    let failing = tested.failing || []
    for (let round = 0; ; round++) {
      if (!rv) return stop('a reviewer returned nothing — the lane is unreviewed')
      if (rv.treeClean === false) return stop(`a review left a mutation in the tree — inspect git diff in ${wt(l)}`, tally(rv))
      const must = (rv.findings || []).filter(f => f.severity !== 'nit')
      const survivors = (rv.mutations || []).filter(m => !m.killed)
      if (rv.verdict === 'pass' && survivors.length === 0 && failing.length === 0) {
        return { status: 'done', summary: round ? `clean after ${round} fix round(s)` : 'review passed; nothing to fix', notes, deferred, ...tally(rv) }
      }
      // Out of re-reviews: never hand back a fix nobody has looked at.
      if (round > MAX_REVIEW) return stop('findings still open after the review cap — judge them', { ...tally(rv), failing: failing.length })
      const fixStage = `fix-${round + 1}`
      const fix = await agent(`${LANE_COMMON(l)}
YOUR JOB: fix ${l.name}. ${laneRule(l)}
What to fix is recorded in ${statusFile(l)}, in the ${recordsOf(rvStage)} record${SPLIT_REVIEW ? 's' : ''} (and "open"): ${must.length} blocker/should-fix finding(s)
(skip nits) and ${survivors.length} mutation(s) with killed=false. Contract tests failing against this lane's code: ${JSON.stringify(failing)}.
Confirm each finding is real before changing anything; one that is not real goes in issues with the reason.
Test findings are fixed by writing tests that CAN fail, never by weakening or deleting an assertion. A surviving
mutation means a test is missing: write the one that kills it. Make failing contract tests pass by fixing the code,
unless a test is genuinely wrong against the contract (then fix the test and say so). Leave deferred tests alone.
Run the build and the affected tests for what you changed (plus matching guard tests). Commit. Return the sha, counts, and anything unresolved or disputed in issues.
${ledger(l, fixStage)}`,
        { label: `${l.key}: fix r${round + 1}`, phase: 'Fix', schema: STAGE, ...BUILD })
      if (!fix || fix.status !== 'done') return stop(`fix did not finish: ${fix ? fix.summary : 'no result'}`, tally(rv))
      notes += (fix.issues || []).length
      // A re-review costs a review-model pass: spend it where code changed to fix a blocker, a surviving mutation or
      // a failing contract test. Should-fix-only rounds are trusted to the whole-diff review in /factory-fix.
      const needsReview = must.some(f => f.severity === 'blocker') || survivors.length > 0 || failing.length > 0
      if (!needsReview) return { status: 'done', summary: `fixed ${must.length} should-fix finding(s)`, notes, deferred, ...tally(rv) }
      failing = []
      const prev = rvStage
      rvStage = `review-${round + 1}`
      rv = await laneReview(l, rvStage, { deferred, prev, fix: fixStage, counts: { findings: must.length, survivors: survivors.length } })
    }
  },
)

// The run's return value is what the orchestrator reads, so it carries status, counts and pointers only. The detail
// (findings, builder notes, fixer disputes) is in each lane's status file: in the lane worktree while the lane is
// unfinished, and copied to RUN_DIR/lanes/ by integration before .factory/ is removed.
const compact = (x, l, where) => ({ lane: x.lane, status: x.status, summary: clip(x.summary, 300),
  branch: br(l), findings: x.findings || 0, mutations: { killed: x.killed || 0, survived: x.survived || 0 },
  failing: x.failing || 0, deferred: (x.deferred || []).length, notes: x.notes || 0,
  statusFile: where === 'run' ? `${RUN_DIR}/lanes/${l.key}.json` : `${wt(l)}/${statusFile(l)}` })
const lanes = D.lanes.map((l, i) => ({ lane: l.key, ...(results[i] || { status: 'blocked', summary: 'lane returned nothing' }) }))
log('Lanes: ' + lanes.map(x => `${x.lane}=${x.status}`).join(', '))
const accepted = A.acceptedLanes || []
lanes.forEach(x => { if (x.status !== 'done' && accepted.includes(x.lane)) { x.status = 'done'; x.summary = `accepted after a hand fix: ${x.summary}` } })
const blocked = lanes.filter(x => x.status !== 'done')
if (blocked.length) {
  return { stopped: { step: 'lanes', reason: 'a lane did not finish clean — judge it, fix by hand, or resume',
    blocked: blocked.map(x => x.lane) }, contracts: { commit: contracts.commit },
    lanes: lanes.map((x, i) => compact(x, D.lanes[i], 'worktree')) }
}
const deferredAll = lanes.flatMap(x => (x.deferred || []).map(d => `${d.test} (${x.lane}, waited on ${d.waitsOn})`))

// ---- Integration ------------------------------------------------------------------
phase('Integrate')
const merged = await agent(`${COMMON}
YOUR JOB: merge the lanes, in ${repoDir} on ${featureBranch}.
1. Merge the lane branches with \`git merge --no-ff\`, in this order: ${D.lanes.map(br).join(', ')}. A conflict means a
   lane edited a file it did not own: keep the owning lane's version and note it in issues.
2. Copy the lane status files out of the repo first, so their detail outlives the scaffolding:
   \`mkdir -p ${RUN_DIR}/lanes && cp .factory/lanes/*.json ${RUN_DIR}/lanes/\`. Then remove the scaffolding (briefs and
   status files) so it never ships: \`git rm -r -q .factory\`, committed on its own. After this, \`git ls-files .factory\`
   prints nothing.
3. Build: ${BUILD_CMDS}. Fix a break the merge caused. Commit.
Run no tests: a runner runs the full suites next. Return the sha.`,
  { label: 'integrate: merge', phase: 'Integrate', schema: STAGE, ...REVIEWM })

// The full suites run once here, where the lanes first meet: mandatory, the one point that can show a cross-lane break.
// A cheap runner runs them, so thousands of lines of output land in a log, not in the integrator's context or ours.
const full = merged && merged.status === 'done' ? await agent(`${SHARED}
YOUR JOB: you are the suite runner. Run the FULL suites once, in ${repoDir} (on ${featureBranch}), after every lane was
merged. You judge nothing and fix nothing. mkdir -p ${RUN_DIR}/logs, then run each command in order as
\`<cmd> > ${RUN_DIR}/logs/integration-<n>.log 2>&1\` (n = its number below):
${(A.testCmds || []).map((c, i) => `${i + 1}. ${c}`).join('\n') || `1. ${TEST_CMDS}`}
Read each log only with tail / grep, for its counts and the names of failing tests — never whole. Mark infraDown when a
suite could not start or a wave of DB tests came back Inconclusive or skipped: that is a broken run, not a result.`,
  { label: 'integrate: full suites', phase: 'Integrate', schema: SUITES, ...MECH }) : null

const suiteCounts = full ? full.suites.map(x => `${x.cmd}: ${x.passed} passed, ${x.failed} failed${x.skipped ? `, ${x.skipped} skipped` : ''}`).join('; ') : ''
const integration = !merged || merged.status !== 'done'
  ? { status: 'blocked', summary: clip(`merge did not finish: ${merged ? merged.summary : 'no result'}`) }
  : !full ? { status: 'blocked', summary: 'the suite runner returned nothing' }
  : full.infraDown ? { status: 'blocked', summary: `the full suites did not really run (infrastructure down) — logs in ${RUN_DIR}/logs` }
  : await agent(`${COMMON}
YOUR JOB: finish integration, in ${repoDir} on ${featureBranch} (lanes merged at ${merged.commit}: ${D.lanes.map(l => l.key).join(', ')}).
1. A runner just ran the full suites; do NOT run them again. Counts: ${suiteCounts}.
   Failing (${full.failingTotal}): ${JSON.stringify(full.failing)}${full.failingTotal > full.failing.length ? ' and more — grep the logs for "fail"' : ''}.
   Logs: ${RUN_DIR}/logs/integration-*.log — grep them for a failure's message, never read one whole.
   Baseline: ${A.baseline || 'not recorded'}. Fix failures this feature caused; a failure that also fails on the base
   branch is noted, not fixed. After a fix, re-run only the tests that failed and the affected tests for what you
   changed (plus matching guard tests): the next full run is CI's, on the PR.
   ${deferredAll.length ? `These tests were deferred in their lanes because the code they reach was still a stub; with every lane merged
   they MUST pass — one still red is a real failure, fix it like any other: ${deferredAll.join('; ')}.` : ''}
2. Real stack: start it the way AGENTS.md / CLAUDE.md says, apply the migration, and run the smoke steps:
   ${D.smoke || 'create, read, update and delete through the real API for each new endpoint, checking every response'}.
   Never hardcode a port or URL: derive them for THIS worktree from the repo's own env / port mechanism (its dev
   scripts, env files, per-worktree instance settings) — other runs may be up on this machine at the same time. Put any
   helper script you write in ${RUN_DIR}/ (a per-run folder outside the repo, named for this branch), never at a shared
   name another run could overwrite or execute. Record what you ran and what came back. Stop only what you started.
3. Commit fixes. Leave the lane worktrees alone — a separate step removes them.
Return the final sha, per-suite counts in tests (the runner's, updated for what you re-ran), and anything unresolved in issues.`,
    { label: 'integrate', phase: 'Integrate', schema: STAGE, ...REVIEWM })

// Every lane is merged (or the merge stopped part way — teardown keeps whatever is not in the feature branch).
phase('Teardown')
const cleaned = await teardown(integration && integration.status === 'done' ? 'integrated' : 'integration stopped')

return {
  green: !!integration && integration.status === 'done',
  contracts: { commit: contracts.commit },
  lanes: lanes.map((x, i) => compact(x, D.lanes[i], merged && merged.status === 'done' ? 'run' : 'worktree')),
  integration: integration && { status: integration.status, commit: integration.commit || (merged && merged.commit),
    summary: clip(integration.summary), tests: clip(integration.tests || suiteCounts, 400),
    fullRun: full && { suites: full.suites, failingTotal: full.failingTotal, infraDown: full.infraDown },
    issues: (integration.issues || []).slice(0, 12).map(i => clip(i, 300)) },
  logs: `${RUN_DIR}/logs`,
  teardown: cleaned,
}
