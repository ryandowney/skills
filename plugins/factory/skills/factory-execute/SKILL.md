---
name: factory-execute
description: Execute an approved plan — Phase 0 writes every contract as compiling code in one commit, then parallel lanes (each in its own worktree, owning disjoint files) build, get tests written from the contract by a different agent, get an adversarial review with targeted mutation on high-risk lines, and fix; then one integration merges the lanes and runs the full suites and a real-stack smoke. Wraps the deterministic factory workflow. Use as the factory's build stage after the plan is approved and the branch is cut.
---

# factory-execute — contracts first, lanes in parallel, one integration

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
build → tests → review → fix concurrently in its own worktree. The expensive passes are spent where
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
- **Tests where they answer a question.** Lanes run only their own `testCmd`; the full suites run once
  at integration and once before the PR (`/factory-ship`, then CI).
- **Model tiers.** Judgment stays on the strong tier; copying and fixed command lists go to a cheap one.
- **Cross-lane stubs are not failures.** A lane test that is red only because another lane's code is
  still a Phase 0 shell is listed as `deferred`, not counted against the lane; integration must show it
  green, and one still red there is a real failure.

`.factory/` is scaffolding: briefs are committed on the feature branch before Phase 0 so every lane
worktree has them, status files on each lane branch. Integration removes the folder (`git rm -r
.factory`) right after merging, so it never reaches the PR; `/factory-ship` checks.

```
decompose + briefs (mechanical model) → Phase 0 contracts (1 commit, strong model)
   └─ lanes in parallel, each in its own worktree, each agent checking the lane's status file first:
        build (build model) → tests from contract (build model, other agent)
          → adversarial review + targeted mutation (review model) → fix (build) [→ re-review if a blocker was fixed]
   └─ integrate: merge lanes → drop .factory/ → build → FULL suites once → real-stack smoke (review model)
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

- `planPath` — the approved plan with its contracts, Phase 0 file list, lane map and smoke steps
  (and its **Shared files** section when it sits in a stack or beside sibling plans)
- `repoDir` — the feature worktree, already on `featureBranch`
- the baseline from `/factory-plan`

## Steps

1. **Pre-flight the suites once** on the feature branch before the engine starts. Anything red now is
   the machine's, not the feature's (missing `.env` in a fresh worktree, a container down, a shared
   queue another worktree consumes). Fix it, or record it as `knownFailures: [{ test, why }]` — never
   list a test the feature could break.

2. **Run the engine** and wait for its notification:
   ```
   Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/factory-execute/factory-workflow.mjs", args: {
     planPath, repoDir, featureBranch, baseline, knownFailures,
     buildCmds: ["<build>", "<frontend type-check>"], testCmds: ["<backend suites>", "<frontend unit>", "<e2e>"],
     worktreeCmd: "<the repo's worktree helper, with {path} {branch} {start}>",
     teardownCmd: "<how to remove one, with {path} {name} — default git worktree remove {path}>",
     laneSetupNote: "<per-worktree setup, e.g. copy app/.env>",
     gitTrailer: "<the commit trailer lines this session requires>",
     repoRules: "<repo-specific hard rules>",
     foreignOwned: ["<every path the plan's Shared files section gives to ANOTHER plan>"] } })
   ```
   Models, by tier — no tier names a strong model unless you pass one:

   | Tier | Arg (default) | Runs |
   |---|---|---|
   | strong | `strongModel` (the session model) | Phase 0 contracts |
   | review | `reviewModel` (= `strongModel`) | lane review, re-review, the high-risk mutations, integration |
   | lane review | `laneReviewModel` (= `reviewModel`) | the lane review's reading pass only — see below |
   | build | `buildModel` (`sonnet`) | build, tests, fixes |
   | mechanical | `mechanicalModel` (`haiku`, low effort) | decompose extraction and briefs, lane setup, teardown |

   **`laneReviewModel` is an experiment, opt-in.** Setting it cheaper than `reviewModel` splits the lane
   review in two, run in sequence: the cheaper model reads and reports, then a `reviewModel` pass runs the
   high-risk mutations. The mutation checks and the whole-diff review in `/factory-fix` always stay on
   `reviewModel`. Measure before keeping it: compare the lane findings, and what the whole-diff review
   then catches that the lanes missed, against runs without it.

   `foreignOwned` names files a sibling plan owns. Decompose stops if any lane claims one, and every
   agent builds against the owner's contract (or the stub the plan names) instead of re-implementing it.

   **Keep the args in a file** in the scratchpad (`<scratchpad>/factory/<slug>-workflow-args.json`,
   never in the repo) and pass the same object on every resume. Changing any arg changes every prompt
   that embeds it, and the cache then re-runs finished work. The one exception is `acceptedLanes`. The
   lane status files are the safety net when an arg did change: each re-asked lane agent finds its stage
   recorded and returns the result instead of redoing it.

3. **Record the run id** in the run manifest. Resume a failed or interrupted run with
   `resumeFromRunId` and identical args — finished agents return cached; only the failed step onward
   re-runs. Never restart a partial run from scratch.

4. **Read the result.** `stopped` tells you where and why:

   | `stopped.step` | Means | Do |
   |---|---|---|
   | `decompose` (`overlaps` / `bad`) | two lanes own the same paths, or a lane owns none | fix the plan's lane map; re-run (the plan changed, so the cache is gone anyway) |
   | `decompose` (`foreign`) | a lane claims a path in `foreignOwned` | the lane map or the Shared files section is wrong: give the file to one plan only |
   | `decompose` (`briefs`) | the lane briefs were not committed | read its summary; usually an ignored `.factory/` the agent did not `add -f` |
   | `contracts` | Phase 0 could not make it build, or made no commit | read its issues; usually a plan gap |
   | `lanes-setup` | worktrees could not be created | read its summary; usually the worktree helper or a leftover worktree |
   | `lanes` | a lane is blocked — see each lane's `summary` and `notes` | judge it. A summary saying **a review left a mutation in the tree** means sabotaged code may be in that worktree: **inspect `git diff` there before anything else**. Otherwise fix by hand on the lane branch, commit, and resume with `acceptedLanes: ["<key>"]` added — a blocked result is cached, so a plain resume just stops again |

   A `lanes` stop keeps every lane worktree on purpose — they hold the work to judge. Teardown runs when
   the resumed run integrates. If you abandon the run instead, clean up by the same rule: for each
   `<feature worktree>-lane-*`, remove it only when `git status --porcelain` there is empty and its branch
   is merged; otherwise ask the user.

   **After every run, read `teardown`**: `kept` lists what is still on disk and why; `worktreeList` should
   show no `-lane-` entries otherwise. Record both in the run manifest.

   Every lane returns `deferred`: its tests that were red only because another lane was still a stub.
   Integration ran them green or fixed them; check its result says so.

   Every lane returns `notes`: contract ambiguities the builder resolved and findings the fixer
   disputed. Write them into the run manifest's dispositions ledger so `/factory-fix` honours them
   instead of re-litigating, and treat any builder note that changes a contract as a question for the
   user.

   When `green: true`, spot-check: run the touched test classes yourself (not the full suites — integration
   just ran them), and compare the suite counts with the baseline. `git ls-files .factory` on the feature
   branch prints nothing. A suite that grew by fewer tests than the contracts owe means a lane skipped
   cases.

   The lanes mutate only their high-risk lines. The full mutation pass — every `MUST` and `ORDER` line —
   is `/test-review`'s, inside `/factory-fix`. Do not drop it because the lanes "already mutated".

## Output

Per-lane status and findings, the mutation table (line · killed), the integration test counts against
the baseline, the smoke results, and which contract lines are covered and which are not. If not
green, say exactly what is red and hand the decision back — **do not loop blindly**.

## Notes

- `single-unit` work skips the engine: write the contracts, implement, have a *different* subagent
  write the tests from the contract, review, then `/factory-fix`.
- A lane that cannot finish should stop and report. A half-built lane that is reviewed and tested is
  more useful than three unreviewed ones.
