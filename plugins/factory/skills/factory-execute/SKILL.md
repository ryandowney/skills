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

```
Phase 0 contracts (1 commit, strong model)
   └─ lanes in parallel, each in its own worktree:
        build (build model) → tests from contract (build model, other agent)
          → adversarial review + targeted mutation (strong) → fix (build) [→ re-review if a blocker was fixed]
   └─ integrate: merge lanes → build → FULL suites once → real-stack smoke (strong)
```

---

## Prerequisites (the caller supplies these)

- `planPath` — the approved plan with its contracts, Phase 0 file list, lane map and smoke steps
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
     laneSetupNote: "<per-worktree setup, e.g. copy app/.env>",
     gitTrailer: "<the commit trailer lines this session requires>",
     repoRules: "<repo-specific hard rules>" } })
   ```
   Planning, contracts, review and integration run on the session model (or `strongModel`); build,
   tests and fixes on `buildModel` (default Sonnet).

   **Keep the args in a file** in the scratchpad (`<scratchpad>/factory/<slug>-workflow-args.json`,
   never in the repo) and pass the same object on every resume. Changing any arg changes every prompt
   that embeds it, and the cache then re-runs finished work. The one exception is `acceptedLanes`.

3. **Record the run id** in the run manifest. Resume a failed or interrupted run with
   `resumeFromRunId` and identical args — finished agents return cached; only the failed step onward
   re-runs. Never restart a partial run from scratch.

4. **Read the result.** `stopped` tells you where and why:

   | `stopped.step` | Means | Do |
   |---|---|---|
   | `decompose` (`overlaps` / `bad`) | two lanes own the same paths, or a lane owns none | fix the plan's lane map; re-run (the plan changed, so the cache is gone anyway) |
   | `contracts` | Phase 0 could not make it build, or made no commit | read its issues; usually a plan gap |
   | `lanes-setup` | worktrees could not be created | read its summary; usually the worktree helper or a leftover worktree |
   | `lanes` | a lane is blocked — see each lane's `summary` and `notes` | judge it. A summary saying **a review left a mutation in the tree** means sabotaged code may be in that worktree: **inspect `git diff` there before anything else**. Otherwise fix by hand on the lane branch, commit, and resume with `acceptedLanes: ["<key>"]` added — a blocked result is cached, so a plain resume just stops again |

   Every lane returns `notes`: contract ambiguities the builder resolved and findings the fixer
   disputed. Write them into the run manifest's dispositions ledger so `/factory-fix` honours them
   instead of re-litigating, and treat any builder note that changes a contract as a question for the
   user.

   When `green: true`, spot-check: run the touched test classes yourself, and compare the suite counts
   with the baseline. A suite that grew by fewer tests than the contracts owe means a lane skipped
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
