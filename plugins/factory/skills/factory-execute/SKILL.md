---
name: factory-execute
description: Execute an approved plan — Phase 0 writes every contract as compiling code in one commit, then parallel lanes (each in its own worktree, owning disjoint files) build, get unit tests written from the contract by a different agent within the plan's test budget, get an adversarial review with failure-mode reasoning and targeted mutation on high-risk lines, and fix; then integration merges the lanes bottom-up one layer at a time, running each stage's integration tests, and ends with the full suites and a real-stack smoke. Wraps the deterministic factory workflow. Use as the factory's build stage after the plan is approved and the branch is cut.
---

# factory-execute — contracts first, lanes in parallel, integration layer by layer

Drives an **approved** plan to a green, integrated feature branch.

## Why this shape

Two failures this is built to prevent, and the cost model it is built around.

**Tests written from the implementation.** A test written by the agent that just wrote the code, or
by anyone reading the code to decide what to assert, faithfully asserts whatever was built —
including the parts that are wrong — and survives review because it agrees with the code. So every
lane's tests are written by a **different agent, from the CONTRACT, without opening the
implementation**, and an adversarial reviewer then sabotages the high-risk lines to prove the tests
can fail.

**A wrong shape copied upward.** If layers guess each other's shapes, a mistake at the bottom is
built on five times. So **Phase 0 writes every contract as code first** — DTOs, interfaces, the
migration, compiling handler shells carrying their CONTRACT blocks, frontend types, mocks — in one
commit. After that, lanes never guess: they build against frozen, compiling contracts and mock the
layer below.

**Speed.** With contracts frozen, the layers no longer have to wait for each other: each lane runs
build → tests → review → fix concurrently in its own worktree, unit-testing against mocks of the layer
below, so no lane is ever blocked by a sibling's stubs. The expensive passes are spent where
they earn it: mutation only on high-risk lines, a re-review only after a blocker fix, the full suites
once at integration rather than at every step.

**Tokens.** A six-lane run cost about 2.7M subagent tokens, and each resume about 2M more, because
finished lanes redid their tests and reviews. Most of that bought nothing, so (none of it touches a
quality gate):

- **Cache-stable, idempotent lanes.** No lane prompt embeds another agent's free text — only the
  branch, a sha, counts and test names. Each lane keeps a status file on its branch
  (`.factory/lanes/<key>.json`: stage, sha, verdict, open findings, and each stage's recorded result);
  every lane agent checks it first and returns the recorded result when its stage is already done for
  the current code. A resume with unchanged work therefore replays from cache instead of redoing it.
- **Per-lane briefs.** Decompose writes `.factory/briefs/<key>.md`: the lane's decisions, contracts,
  test cases, high-risk lines, owned paths and only the house-rule passages for those paths — verbatim.
  Lane agents read the brief and open the full plan only for a section it names. Phase 0, integration
  and the whole-diff review still read the whole plan.
- **Tests where they answer a question.** Agents run the tests their change can affect (the lane's
  `testCmd` is its affected tests) plus any `guardTests` whose paths they touched. The full suites run
  twice per feature, both scheduled by the orchestrator: once at integration (mandatory — it is where
  the lanes meet) and once at the end, which is CI's run on the PR. Each full run goes to a cheap runner
  that writes the output to a log and returns counts and failing test names only.
- **Context kept small.** Test output goes to a log and is read by `tail` / `grep`; files are read by
  section after a grep; lane reviewers see exactly their lane's diff and re-reviewers only the delta
  since the last review; result fields are capped, with the detail in the lane status file; every
  prompt starts with the same shared block so the prompt cache can reuse it.
- **Model tiers.** Judgment stays on the strong tier; copying and fixed command lists go to a cheap one.
- **Cross-lane stubs are not failures.** A lane test that is red only because another lane's code is
  still a Phase 0 shell is listed as `deferred`, not counted against the lane; integration must show it
  green, and one still red there is a real failure.

**Layered integration and a test budget.** The overnight run's most serious bugs (a sanitiser stack
overflow, a quadratic memory blow-up on crafted HTML, rows lost on redelivery, throttled calls
dead-lettering mail, a lost-update race) came from adversarial review, and the next tier (a thread
marked read by older outbound mail, an editor crash on close, a missing blob returning 500, Back
discarding a draft) from real-stack smoke and stress. Contract tests from an independent agent found
real but smaller defects; mutation checks found missing tests, not bugs. Meanwhile each PR added
~500 tests, mostly mechanical positive+negative pairs, and lanes whose tests needed another lane's
real code sat blocked on stubs. So:

- **Lanes write unit tests** that mock the layer below through the frozen contracts — fast, fully
  parallel — only where logic is dense, preferring property-based or fuzz tests there. Integration
  tests go where the boundaries are (data access against a real store; per use case one happy path
  plus the edges that matter) and e2e only for the matrix's journeys. Each lane's **budget** comes from
  the plan and is handed verbatim to its test writer. Every contract line still owes one test that can
  fail, at the level the plan names; quality is judged by targeted mutation, not by count.
- **Integration merges bottom-up, one stage at a time** (data access → engines/domain →
  orchestration/managers → API → UI, as the plan's Integration stages declare) and runs that stage's
  integration tests through the cheap runner after each merge. A failure is then in the layer just
  merged or its contract with the one below, and it is fixed there, on the review model, before
  anything is merged on top. The full suites still run once after the last stage.
- **The saved effort goes to what found the serious bugs**: every lane review reasons through failure
  modes (redelivery, retries and throttling, concurrency, hostile input size and shape, partial failure
  between two writes, upstream data moved or deleted), and real-stack smoke plus stress stay mandatory
  for anything with a queue, an external API or a user-facing flow.
- **Rolling merge-in stays an option** (`laneMergeIn`): a long-running upper lane pulls a finished,
  reviewed lower lane into its branch after its build and writes and runs its tests against the real
  code.

`.factory/` is scaffolding: briefs are committed on the feature branch before Phase 0 so every lane
worktree has them, status files on each lane branch. Integration removes the folder (`git rm -r
.factory`) at each stage's merge, so it never reaches the PR; `/factory-ship` checks.

```
decompose (mechanical model) + briefs (brief model) → Phase 0 contracts (1 commit, strong model)
   └─ lanes in parallel, each in its own worktree, each agent checking the lane's status file first:
        build (build model) [→ merge-in of finished lower lanes, laneMergeIn only]
          → unit + merge-stage tests from contract, within the lane's budget (build model, other agent)
          → adversarial review + failure modes + targeted mutation (review model) → fix (build) [→ re-review if a blocker was fixed]
   └─ integrate, bottom-up, per stage: merge its lanes → drop .factory/ → build (review model)
        → that stage's integration tests (runner, mechanical model) → fix at this stage (review model) → re-run → next stage
   └─ after the last stage: FULL suites once (runner) → fix what they found, re-running only those tests
        → real-stack smoke (review model)
   └─ teardown (mechanical): remove every lane worktree + branch that is merged and clean; keep and report the rest
```

**Worktrees are scaffolding.** Each lane works in its own worktree on its own branch; the integration
agent merges those branches into the feature branch; then a separate teardown step removes each lane's
worktree (with the repo's `teardownCmd`, so a helper can release a port slot or database) and deletes its
branch with `git branch -d`. It never forces: a lane with uncommitted changes, or with commits that did
not reach the feature branch, is kept and listed in `teardown.kept`, because that is work someone needs to
look at. Only the feature worktree survives the run — it is where review fixes, the PR and verification
happen, and it goes when the PR merges.

---

## Prerequisites (the caller supplies these)

- `planPath` — the approved plan with its contracts, Phase 0 file list, lane map (with each lane's
  test budget), integration stages and smoke steps
  (and its **Shared files** section when it sits in a stack or beside sibling plans)
- `repoDir` — the feature worktree, already on `featureBranch`
- the baseline from `/factory-plan`

## Steps

1. **Pre-flight is the baseline run.** The conductor's baseline (one full run on the untouched feature
   worktree, before anything changes) doubles as the pre-flight; do not run the suites a second time.
   Hand it to a runner — a `mechanicalModel` agent or a shell step — that writes the output to a log and
   returns counts and failing names. Anything red now is the machine's, not the feature's (missing `.env`
   in a fresh worktree, a container down, a shared queue another worktree consumes). Fix it, or record
   it as `knownFailures: [{ test, why }]` — never list a test the feature could break.

2. **Run the engine** and wait for its notification:
   ```
   Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/factory-execute/factory-workflow.mjs", args: {
     planPath, repoDir, featureBranch, baseline, knownFailures,
     buildCmds: ["<build>", "<frontend type-check>"], testCmds: ["<backend suites>", "<frontend unit>", "<e2e>"],
     guardTests: [{ when: ["<path globs>"], cmd: "<always-run test for indirect breakage>" }],  // the plan's Guard tests
     worktreeCmd: "<the repo's worktree helper, with {path} {branch} {start}>",
     teardownCmd: "<how to remove one, with {path} {name} — default git worktree remove {path}>",
     laneSetupNote: "<per-worktree setup, e.g. copy app/.env>",
     gitTrailer: "<the commit trailer lines this session requires>",
     repoRules: "<repo-specific hard rules>",
     foreignOwned: ["<every path the plan's Shared files section gives to ANOTHER plan>"],
     laneMergeIn: { "<upper lane>": ["<lower lane>"] } } })    // optional; stages and budgets come from the plan
   ```
   Models, by tier — no tier names a strong model unless you pass one:

   | Tier | Arg (default) | Runs |
   |---|---|---|
   | strong | `strongModel` (the session model) | Phase 0 contracts |
   | review | `reviewModel` (= `strongModel`) | lane review, re-review, the high-risk mutations, integration |
   | lane review | `laneReviewModel` (= `reviewModel`) | the lane review's reading pass only — see below |
   | build | `buildModel` (`sonnet`) | build, tests, fixes |
   | mechanical | `mechanicalModel` (`haiku`, low effort) | decompose extraction, lane setup, teardown |
| briefs | `briefModel` (`sonnet`) | the per-lane briefs — every lane builds from one, so completeness matters more than the saving |

   **`laneReviewModel` is an experiment, opt-in.** Setting it cheaper than `reviewModel` splits the lane
   review in two, run in sequence: the cheaper model reads and reports, then a `reviewModel` pass runs the
   high-risk mutations. The mutation checks and the whole-diff review in `/factory-fix` always stay on
   `reviewModel`. Measure before keeping it: compare the lane findings, and what the whole-diff review
   then catches that the lanes missed, against runs without it.

   `testCmds` are the full suites; only the engine's integration runner runs them. `guardTests` are
   the plan's always-run tests for breakage impact analysis misses — reflection-based handler
   resolution, migrations and the model snapshot, DI registration, config. Any agent that touches a
   matching path runs them, so the cheap affected-test selection never hides that kind of break.

   The integration stages and each lane's budget are read from the plan (`stages` and a lane's
   `budget` override them, as `lanes` does the lane map). A plan with no Integration stages merges every
   lane in one stage with no stage tests, as before. `maxStageFixRounds` (default 2) caps fix → re-run
   rounds per stage. `laneMergeIn` must name lower lanes in the same or an earlier stage, and no cycle;
   decompose checks both in code. A lower lane that does not finish clean is not merged in — the upper
   lane carries on with mocks and deferred tests.

   `foreignOwned` names files a sibling plan owns. Decompose stops if any lane claims one, and every
   agent builds against the owner's contract (or the stub the plan names) instead of re-implementing it.

   **Keep the args in a file** in the scratchpad (`<scratchpad>/factory/<slug>-workflow-args.json`,
   never in the repo) and pass the same object on every resume. Changing any arg changes every prompt
   that embeds it, and the cache then re-runs finished work. The one exception is `acceptedLanes`. The
   lane status files are the safety net when an arg did change: each re-asked lane agent finds its stage
   recorded and returns the result instead of redoing it.

   **While it runs, watch for milestones only** — a lane done or blocked, integration, the result.
   Do not read or relay every agent step: each one lands in your context, and on a six-lane run that
   alone filled the orchestrator's window.

3. **Record the run id** in the run manifest. Resume a failed or interrupted run with
   `resumeFromRunId` and identical args — finished agents return cached; only the failed step onward
   re-runs. Never restart a partial run from scratch.

4. **Read the result.** `stopped` tells you where and why:

   | `stopped.step` | Means | Do |
   |---|---|---|
   | `decompose` (`overlaps` / `bad`) | two lanes own the same paths, or a lane owns none | fix the plan's lane map; re-run (the plan changed, so the cache is gone anyway) |
   | `decompose` (`foreign`) | a lane claims a path in `foreignOwned` | the lane map or the Shared files section is wrong: give the file to one plan only |
   | `decompose` (`briefs`) | the lane briefs were not committed | read its summary; usually an ignored `.factory/` the agent did not `add -f` |
   | `decompose` (`stageErr` / `mergeErr`) | a lane is in no integration stage or in two, or `laneMergeIn` names an unknown lane, a later-stage lane or a cycle | fix the plan's Integration stages or lane map |
   | `contracts` | Phase 0 could not make it build, or made no commit | read its issues; usually a plan gap |
   | `integration` (`stage`) | that stage stayed red after `maxStageFixRounds`, its merge failed, or its tests could not run (`infraDown`) | nothing above it was merged. Read `stages` (counts, failing names, log glob) and judge it at that layer; fix on the feature branch and resume. Lanes above it are kept by teardown, unmerged |
   | `integration` not done, `fullRun.infraDown` | the full suites never really ran (a container down, a suite that could not start) | fix the machine, then resume; the logs are at `logs` |
   | `lanes-setup` | worktrees could not be created | read its summary; usually the worktree helper or a leftover worktree |
   | `lanes` | a lane is blocked — see each lane's `summary`, counts and `statusFile` | judge it. A summary saying **a review left a mutation in the tree** means sabotaged code may be in that worktree: **inspect `git diff` there before anything else**. Otherwise fix by hand on the lane branch, commit, and resume with `acceptedLanes: ["<key>"]` added — a blocked result is cached, so a plain resume just stops again |

   A `lanes` stop keeps every lane worktree on purpose — they hold the work to judge. Teardown runs when
   the resumed run integrates. If you abandon the run instead, clean up by the same rule: for each
   `<feature worktree>-lane-*`, remove it only when `git status --porcelain` there is empty and its branch
   is merged; otherwise ask the user.

   **After every run, read `teardown`**: `kept` lists what is still on disk and why; `worktreeList` holds
   only the `-lane-` entries still registered, and should be empty otherwise. Record both in the run manifest.

   The result is compact on purpose: per lane, status, branch, counts (findings, mutations killed and
   survived, `deferred`, `notes`, `mergedIn` when it merged lanes in) and a `statusFile` path; per
   integration stage, status, counts, fix rounds and a log glob; for integration, the full run's counts
   and log paths. Paths start with `${TMPDIR:-/tmp}` — expand them in a shell. The detail is in the status
   files (copied out of the repo at integration; in the lane worktree for a lane that stopped), read
   with `jq` or by section, never all at once.

   `deferred` counts a lane's tests that were red only because another lane was still a stub.
   The first integration stage that holds both lanes ran them; check its result says so.

   `notes` counts contract ambiguities the builder resolved and findings the fixer disputed — the
   `issues` of the `build` and `fix-*` stages in the status file. Write them into the run manifest's
   dispositions ledger so `/factory-fix` honours them instead of re-litigating, and treat any builder
   note that changes a contract as a question for the user.

   When `green: true`, spot-check without running suites in your own context: compare the integration
   counts with the baseline (a runner ran them; the logs are at `logs`). `git ls-files .factory` on the feature
   branch prints nothing. A suite that grew by far more than the plan's budgets add up to means a
   lane wrote mechanical cases; one that grew by less means a lane skipped contract lines.

   The lanes mutate only their high-risk lines. The full mutation pass — every `MUST` and `ORDER` line —
   is `/test-review`'s, inside `/factory-fix`. Do not drop it because the lanes "already mutated".

## Output

Per-lane status and finding counts, the mutation counts (killed · survived; the lines are in the status files), each
integration stage's result and fix rounds, the integration test counts against the baseline, the smoke results, and which contract lines are covered and which are not. If not
green, say exactly what is red and hand the decision back — **do not loop blindly**.

## Notes

- `single-unit` work skips the engine: write the contracts, implement, have a *different* subagent
  write the tests from the contract, review, then `/factory-fix`.
- A lane that cannot finish should stop and report. A half-built lane that is reviewed and tested is
  more useful than three unreviewed ones.
