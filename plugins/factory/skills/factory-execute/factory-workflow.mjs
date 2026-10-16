export const meta = {
  name: 'factory-execute',
  description: 'Factory build engine: contracts as code first, then parallel lanes in their own worktrees (build, tests from the contract, adversarial review, fix), then one integration with the full suites.',
  phases: [
    { title: 'Decompose', detail: 'read the Phase 0 file list and the lane map from the plan; check lane ownership is disjoint' },
    { title: 'Contracts', detail: 'Phase 0: every contract, DTO, migration and compiling shell, one commit' },
    { title: 'Lanes setup', detail: 'one worktree + branch per lane, all from the contracts commit' },
    { title: 'Build', detail: 'each lane implements against the frozen contracts (build model)' },
    { title: 'Tests', detail: 'tests written from the CONTRACT by a different agent, without reading the implementation' },
    { title: 'Review', detail: 'adversarial review of code AND tests, with targeted mutation on high-risk lines' },
    { title: 'Fix', detail: 'fix confirmed findings; re-review only when a blocker was fixed' },
    { title: 'Integrate', detail: 'merge lanes, full suites once, real-stack smoke' },
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
//   testCmds:       shell commands for the FULL suites, run once at integration
//   worktreeCmd:    how to create a lane worktree, with {path} {name} {branch} {start} placeholders ({name} is
//                   the last segment of {path}, for helpers that take a name). Default:
//                   git worktree add {path} -b {branch} {start}. Repos with a helper (port slots, node_modules) pass it.
//   teardownCmd:    how to remove one lane worktree, same placeholders. Default: git worktree remove {path}. Repos whose
//                   helper claims something per worktree (a port slot, a database) pass the command that releases it.
//   laneSetupNote:  extra per-lane setup the repo needs (copy .env, etc.)
//   houseRules:     one paragraph naming the repo's rule files; default points at AGENTS.md / CLAUDE.md
//   gitTrailer:     the commit trailer lines this session requires (verbatim)
//   repoRules:      extra hard rules (e.g. "no issue-tracker ids in commits")
//   strongModel:    model for contracts, review and integration. Omit to inherit the session model.
//   buildModel:     model for build, tests and fixes. Default 'sonnet'.
//   maxReviewRounds: re-reviews after a blocker fix, per lane (default 1)
//   lanes:          optional — skip decomposition and use this lane map ([{ key, name, owns:[paths], planSection, tests, highRisk, testCmd }])
//   acceptedLanes:  optional [laneKey] — lanes the coordinator fixed BY HAND on the lane branch after a stop. On resume they
//                   count as done and integration runs. This arg is not embedded in any prompt, so adding it keeps the cache.
// }
// Keep resume args IDENTICAL between a run and its resume (acceptedLanes excepted): changing any other arg changes
// every prompt that embeds it, and the cache then re-runs finished work.
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
for (const k of ['planPath', 'repoDir', 'featureBranch']) {
  if (!A[k]) throw new Error(`factory-execute: ${k} is required`)
}
const { planPath, repoDir, featureBranch } = A
const STRONG = A.strongModel ? { model: A.strongModel } : {}
const BUILD = { model: A.buildModel || 'sonnet' }
const MAX_REVIEW = A.maxReviewRounds ?? 1
const BUILD_CMDS = (A.buildCmds || []).join(' && ') || "the repo's build and type-check commands from AGENTS.md / CLAUDE.md"
const TEST_CMDS = (A.testCmds || []).join(' ; ') || 'every test suite the repo has (AGENTS.md / CLAUDE.md say how)'
const KNOWN = (A.knownFailures || []).map(k => `- ${k.test} — ${k.why}`).join('\n')
const WT_CMD = A.worktreeCmd || 'git worktree add {path} -b {branch} {start}'
const TD_CMD = A.teardownCmd || 'git worktree remove {path}'

const COMMON = `
You are one agent in an orchestrated feature build. The APPROVED plan is ${planPath}: read it fully before anything
else, starting with its decisions block, which overrides anything below it that disagrees.
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
${A.houseRules || 'House rules: read AGENTS.md (or CLAUDE.md) at the repo root and in any directory you edit; they win over habit.'}
Git: status, diff, log, rev-parse, add, commit, checkout -- <file>; merge and worktree only when your job says so.
NEVER bare \`git stash\` (the stash is shared across worktrees — use a WIP commit), never reset --hard, never push,
never open a PR, never write to an issue tracker.
${A.repoRules || ''}
Commit messages: one plain-language sentence saying what changed${A.gitTrailer ? `, ending with exactly:\n${A.gitTrailer}` : '.'}
${KNOWN ? `These tests were red on the baseline for a machine reason, not the code — set them aside and say so:\n${KNOWN}` : ''}`

const STAGE = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string' },
    commit: { type: 'string' },
    tests: { type: 'string', description: 'pass/fail counts per suite you ran' },
    issues: { type: 'array', items: { type: 'string' } },
  },
}
const REVIEW = {
  type: 'object',
  required: ['verdict', 'findings', 'treeClean'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes'] },
    findings: { type: 'array', items: { type: 'object',
      required: ['severity', 'area', 'file', 'problem', 'fix'],
      properties: {
        severity: { type: 'string', enum: ['blocker', 'should-fix', 'nit'] },
        area: { type: 'string', enum: ['code', 'tests'] },
        file: { type: 'string' }, line: { type: 'integer' },
        problem: { type: 'string', description: 'concrete input/state → wrong output' },
        fix: { type: 'string' },
      } } },
    mutations: { type: 'array', items: { type: 'object',
      required: ['line', 'killed'],
      properties: { line: { type: 'string' }, killed: { type: 'boolean' }, note: { type: 'string' } } } },
    treeClean: { type: 'boolean', description: '`git diff HEAD --stat` was empty when you finished (every mutation reverted)' },
  },
}
const DECOMPOSE = {
  type: 'object',
  required: ['contracts', 'lanes'],
  properties: {
    contracts: { type: 'string', description: "the plan's Phase 0 instructions and file list, verbatim" },
    lanes: { type: 'array', items: { type: 'object',
      required: ['key', 'name', 'owns', 'planSection', 'tests'],
      properties: {
        key: { type: 'string', description: 'short kebab-case id' },
        name: { type: 'string' },
        owns: { type: 'array', items: { type: 'string' }, description: 'repo-relative path prefixes this lane alone may edit' },
        planSection: { type: 'string' },
        tests: { type: 'string', description: "the plan's test cases for this lane, verbatim" },
        highRisk: { type: 'string', description: 'contract lines guarding auth, tenancy, money, data loss or dates — the mutation targets' },
      } } },
    smoke: { type: 'string', description: "the plan's real-stack smoke steps for integration, verbatim" },
  },
}

// ---- Decompose ----------------------------------------------------------------
phase('Decompose')
let D = A.lanes ? { contracts: '', lanes: A.lanes, smoke: '' } : null
if (!D) {
  D = await agent(`${COMMON}
Read the plan and return, VERBATIM where it says so: its Phase 0 (contracts) instructions and file list; its lane
map (each lane's key, name, the path prefixes it owns, its plan section, its test cases, and its high-risk contract
lines); and its integration smoke steps. Do not invent lanes the plan does not define. Do not edit anything.`,
    { label: 'decompose', phase: 'Decompose', schema: DECOMPOSE, ...STRONG })
}
if (!D || !D.lanes || D.lanes.length === 0) return { stopped: { step: 'decompose', reason: 'the plan defines no lanes' } }
const bad = D.lanes.filter(l => !l.key || !Array.isArray(l.owns) || l.owns.length === 0)
if (bad.length) return { stopped: { step: 'decompose', reason: 'every lane needs a key and the paths it owns', bad } }

// Lane ownership must be disjoint, or two lanes write the same file and integration turns into conflict surgery.
// Deterministic — checked here in code, never by a model.
const norm = p => p.replace(/^\.\//, '').replace(/\/+$/, '')
const overlaps = []
D.lanes.forEach((a, i) => D.lanes.slice(i + 1).forEach(b => a.owns.forEach(pa => b.owns.forEach(pb => {
  const x = norm(pa), y = norm(pb)
  if (x === y || x.startsWith(y + '/') || y.startsWith(x + '/')) overlaps.push(`${a.key}:${pa} <-> ${b.key}:${pb}`)
}))))
if (overlaps.length) return { stopped: { step: 'decompose', reason: "lane ownership overlaps — fix the plan's lane map", overlaps } }
log(`Lanes: ${D.lanes.map(l => l.key).join(', ')}`)

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
Every shell goes at the path of the lane the plan assigns it to.
Then: the build passes (${BUILD_CMDS}), migration/seed tests the plan names pass, and every EXISTING test suite you
touched still passes. Make ONE commit. Return its sha, and in summary list every contract file you created.`,
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
    worktreeList: { type: 'string', description: '`git worktree list` output after cleanup, verbatim' },
  },
}
const teardown = (why) => agent(`Remove the lane worktrees of a finished build (${why}). Work from ${repoDir}.
For each lane below, in order:
1. If its path is not a registered worktree (\`git worktree list --porcelain\`) and its branch does not exist, it is
   already gone: count it as removed.
2. KEEP it, with the reason, if \`git -C <path> status --porcelain\` prints anything (uncommitted work), or if
   \`git merge-base --is-ancestor <branch> ${featureBranch}\` fails (commits that never reached the feature branch).
3. Otherwise remove the worktree with \`${TD_CMD}\` ({name} = the last path segment of {path}; read any helper script
   it names first), then delete the branch with \`git branch -d <branch>\` (lower-case -d: it refuses an unmerged
   branch, which is the point). Never --force, never -D, never rm -rf.
Then \`git worktree prune\` and return \`git worktree list\` verbatim. Touch nothing that is not in this list.
${D.lanes.map(l => `- ${l.key}: path ${wt(l)}  branch ${br(l)}`).join('\n')}`,
  { label: 'teardown', phase: 'Teardown', schema: TEARDOWN, ...BUILD, effort: 'low' })
const setup = await agent(`${COMMON}
Create one worktree and branch per lane, each starting at ${contracts.commit}. Command template: \`${WT_CMD}\`
({name} = the last path segment of {path})
(read any helper script it names first; if it cannot branch from a start point, create the branch with
\`git branch <branch> ${contracts.commit}\` and pass the branch).
${D.lanes.map(l => `- path ${wt(l)}  branch ${br(l)}`).join('\n')}
${A.laneSetupNote || ''}
Confirm each worktree's HEAD is ${contracts.commit}. Start no servers.`,
  { label: 'lane worktrees', phase: 'Lanes setup', schema: STAGE, ...BUILD })
if (!setup || setup.status !== 'done') {
  // Every lane branch still sits on the contracts commit, so whatever was created is safe to remove.
  phase('Teardown')
  return { stopped: { step: 'lanes-setup', setup }, contracts, teardown: await teardown('lane setup failed') }
}

// ---- Lanes: build → tests → review → fix (→ re-review) -------------------------
const laneRule = l => `Work ONLY in ${wt(l)} (branch ${br(l)}) — cd there first and stay there. You own: ${l.owns.join(', ')}
(including the Phase 0 shells under those paths, which you fill in). Never edit another lane's files or a FROZEN
contract file; mock the layer below as the plan says. Run this lane's tests with: ${l.testCmd || "the test project(s) for the paths you own"}.`

const reviewPrompt = (l, extra) => `${COMMON}
YOUR JOB: adversarially review ${l.name} — its code AND its tests — in ${wt(l)}: the diff \`git diff ${contracts.commit}..HEAD\`.
You did not write any of it. Try to break it:
- every MUST / NEVER / EDGE / ORDER in this lane's CONTRACT blocks (plan ${l.planSection}) against the code;
- the house rules; real bugs (time zones and day boundaries, nulls, ordering, authorization, tenancy, validation
  gaps, missing loading / empty / error states);
- the tests: missing contract cases, assertions that pass on wrong code, tests coupled to implementation details,
  mocks that hide the behaviour under test.
Targeted mutation, ONLY on these high-risk lines: ${l.highRisk || 'the auth, tenancy, money, data-loss and date lines in this lane'}.
FIRST run the lane's tests unmodified and note which are already red. Then for each line: sabotage it, run the tests,
record killed=true ONLY if a test that was green went red (an already-red test proves nothing), then restore the file
with \`git checkout -- <file>\`. Mutate nothing else. Finish with a clean tree (treeClean). (The full MUST/ORDER
mutation pass happens later, in /factory-fix → /test-review; this one covers the lines where a miss is costly.)
Only findings you verified by reading the code, with file and line. verdict "pass" only with no blockers or should-fixes
and no surviving mutation on a high-risk line. Edit nothing else.
${extra || ''}`

const results = await pipeline(
  D.lanes,
  (l) => agent(`${COMMON}
YOUR JOB: build ${l.name} (plan ${l.planSection}). ${laneRule(l)}
Phase 0 created: ${contracts.summary}
Implement every handler / module / component in this lane to its CONTRACT block, with the contract kept in the code.
Do NOT write this lane's tests — a different agent writes them from the contract. Make it build (${BUILD_CMDS}) and
keep existing tests green. Commit. Return the sha; put every contract ambiguity you resolved in issues.`,
    { label: `${l.key}: build`, phase: 'Build', schema: STAGE, ...BUILD }),

  (built, l) => agent(`${COMMON}
YOUR JOB: write ${l.name}'s tests. ${laneRule(l)}
Write them FROM THE CONTRACT ONLY: the CONTRACT blocks, wire shapes, and these cases from the plan:
${l.tests}
You may read existing tests (patterns, base classes, fixtures) and the lane's contract/interface files. Do NOT open
the lane's implementation bodies — the tests must check what the contract promises, not what the code happens to do.
Every MUST gets a positive and a negative case; every ORDER a case where both checks would fail; every NEVER an
absence assertion. Run them. Never change production code: a test that fails because the code is wrong stays as
written and goes in issues (test, expected, actual); a test that is itself wrong, you fix. Commit. Counts in tests.`,
    { label: `${l.key}: tests`, phase: 'Tests', schema: STAGE, ...BUILD })
    .then(tested => ({ built, tested })),

  ({ built, tested }, l) => agent(reviewPrompt(l,
    `The test writer reported: ${tested ? `${tested.summary} | ${tested.tests || ''} | failing: ${JSON.stringify(tested.issues || [])}` : 'nothing'}`),
    { label: `${l.key}: review`, phase: 'Review', schema: REVIEW, ...STRONG })
    .then(review => ({ review, tested, built })),

  async ({ review, tested, built }, l) => {
    const notes = [...((built && built.issues) || []).map(i => `builder: ${i}`)]
    const stop = (summary, extra) => ({ status: 'blocked', summary, notes, ...extra })
    if (!built || built.status !== 'done') return stop(`build did not finish: ${built ? built.summary : 'no result'}`)
    if (!tested || tested.status !== 'done') return stop(`tests were not written: ${tested ? tested.summary : 'no result'}`)
    let rv = review
    let failing = tested.issues || []
    for (let round = 0; ; round++) {
      if (!rv) return stop('a reviewer returned nothing — the lane is unreviewed')
      if (rv.treeClean === false) return stop(`a review left a mutation in the tree — inspect git diff in ${wt(l)}`, { review: rv })
      const must = (rv.findings || []).filter(f => f.severity !== 'nit')
      const survivors = (rv.mutations || []).filter(m => !m.killed)
      if (rv.verdict === 'pass' && survivors.length === 0 && failing.length === 0) {
        return { status: 'done', summary: round ? `clean after ${round} fix round(s)` : 'review passed; nothing to fix', notes, review: rv }
      }
      // Out of re-reviews: never hand back a fix nobody has looked at.
      if (round > MAX_REVIEW) return stop('findings still open after the review cap — judge them', { review: rv, open: must, survivors, failing })
      const fix = await agent(`${COMMON}
YOUR JOB: fix ${l.name}. ${laneRule(l)}
Confirm each finding is real before changing anything; one that is not real goes in issues with the reason.
Test findings are fixed by writing tests that CAN fail, never by weakening or deleting an assertion. A surviving
mutation means a test is missing: write the one that kills it. Make failing contract tests pass by fixing the code,
unless a test is genuinely wrong against the contract (then fix the test and say so).
Findings: ${JSON.stringify(must)}
Surviving mutations: ${JSON.stringify(survivors)}
Failing contract tests: ${JSON.stringify(failing)}
Run the lane's tests and the build. Commit. Return the sha, counts, and anything unresolved or disputed in issues.`,
        { label: `${l.key}: fix r${round + 1}`, phase: 'Fix', schema: STAGE, ...BUILD })
      if (!fix || fix.status !== 'done') return stop(`fix did not finish: ${fix ? fix.summary : 'no result'}`, { review: rv })
      notes.push(...(fix.issues || []).map(i => `fix r${round + 1}: ${i}`))
      // A re-review costs a strong-model pass: spend it where code changed to fix a blocker, a surviving mutation or
      // a failing contract test. Should-fix-only rounds are trusted to the whole-diff review in /factory-fix.
      const needsReview = must.some(f => f.severity === 'blocker') || survivors.length > 0 || failing.length > 0
      if (!needsReview) return { status: 'done', summary: fix.summary, notes, review: rv }
      failing = []
      rv = await agent(reviewPrompt(l, `This is a RE-REVIEW after fixes. Previous findings: ${JSON.stringify(must)}; surviving mutations: ${JSON.stringify(survivors)}. Confirm each is fixed (re-run those mutations), run the lane's tests (any red one is a blocker), and look for anything the fix broke. The fixer disputed: ${JSON.stringify(fix.issues || [])} — accept a dispute only if the code proves it.`),
        { label: `${l.key}: re-review r${round + 1}`, phase: 'Fix', schema: REVIEW, ...STRONG })
    }
  },
)

const lanes = D.lanes.map((l, i) => ({ lane: l.key, ...(results[i] || { status: 'blocked', summary: 'lane returned nothing' }) }))
log('Lanes: ' + lanes.map(x => `${x.lane}=${x.status}`).join(', '))
const accepted = A.acceptedLanes || []
lanes.forEach(x => { if (x.status !== 'done' && accepted.includes(x.lane)) { x.status = 'done'; x.summary = `accepted after a hand fix: ${x.summary}` } })
const blocked = lanes.filter(x => x.status !== 'done')
if (blocked.length) return { stopped: { step: 'lanes', reason: 'a lane did not finish clean — judge it, fix by hand, or resume', blocked }, contracts, lanes }

// ---- Integration ------------------------------------------------------------------
phase('Integrate')
const integration = await agent(`${COMMON}
YOUR JOB: integrate, in ${repoDir} on ${featureBranch}.
1. Merge the lane branches with \`git merge --no-ff\`, in this order: ${D.lanes.map(br).join(', ')}. A conflict means a
   lane edited a file it did not own: keep the owning lane's version and note it in issues.
2. Build: ${BUILD_CMDS}.
3. Run the FULL suites, once: ${TEST_CMDS}. Baseline: ${A.baseline || 'not recorded'}. Fix failures this feature caused;
   a failure that also fails on the base branch is noted, not fixed. Mass-Inconclusive DB tests = Docker down = not green.
4. Real stack: start it the way AGENTS.md / CLAUDE.md says, apply the migration, and run the smoke steps:
   ${D.smoke || 'create, read, update and delete through the real API for each new endpoint, checking every response'}.
   Record what you ran and what came back. Stop only what you started.
5. Commit fixes. Leave the lane worktrees alone — a separate step removes them.
Lane results: ${JSON.stringify(lanes.map(x => ({ lane: x.lane, summary: x.summary })))}
Return the final sha, per-suite counts in tests, and anything unresolved in issues.`,
  { label: 'integrate', phase: 'Integrate', schema: STAGE, ...STRONG })

// Every lane is merged (or the merge stopped part way — teardown keeps whatever is not in the feature branch).
phase('Teardown')
const cleaned = await teardown(integration && integration.status === 'done' ? 'integrated' : 'integration stopped')

return {
  green: !!integration && integration.status === 'done',
  contracts: { commit: contracts.commit, files: contracts.summary },
  lanes: lanes.map(x => ({ lane: x.lane, status: x.status, summary: x.summary, notes: x.notes || [],
    findings: ((x.review && x.review.findings) || []).length,
    mutations: (x.review && x.review.mutations) || [] })),
  integration,
  teardown: cleaned,
}
