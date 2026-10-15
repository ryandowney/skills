---
name: factory-execute
description: Execute an approved plan — implement each unit, then review it, then test it, unit by unit rather than all at the end. Wraps the deterministic factory workflow (decompose, parallel implementers, test, bounded fix loop) and enforces the review-then-test discipline per unit. Use as the factory's build stage after the plan is approved and the branch is cut.
---

# factory-execute — implement, review, test, per unit

Drives an **approved** plan to a green working tree on a feature branch already checked out.

## The sequencing rule

**Anything that can be tested is reviewed and then tested, at the point it is written — not at the
end of the feature.**

Reviewing at the end is cheaper per-review and far more expensive overall, for two reasons that
compound. First, by then the wrong pattern has been copied into six files, so the finding is six
fixes instead of one. Second, and worse: **tests written after a big-bang implementation get written
from that implementation**, because it is the nearest source of truth. That produces a suite which
faithfully asserts whatever was built — including the parts that are wrong — and it survives mutation
testing perfectly. The contract exists to prevent exactly that, and reviewing per unit is what keeps
the contract, not the code, in front of whoever writes the tests.

So each unit of work follows the same three beats:

```
implement  →  review (correctness + architecture)  →  test (written from the CONTRACT)
```

A "unit" is a coherent testable slice: one handler and its validation handler, one accessor, one
component. Not a whole layer, and not a whole feature.

---

## Prerequisites (the caller supplies these)

- `planPath` — the approved plan, including its handler contracts
- `repoDir` — the working tree; resolve with `git rev-parse --show-toplevel`, never hardcode
- `featureBranch` — already checked out
- the test baseline established in `/factory-plan`

---

## Steps

1. **Resolve the environment.** `SLN=$(ls "$repoDir"/src/*.sln | head -1)`. Use plain `dotnet` unless
   `AGENTS.md`/`CLAUDE.md` defines a machine-specific override, in which case use it verbatim and pass it as
   `dotnetCmd`. **Docker must be running** or DB-backed tests come back Inconclusive — treat a
   mass-Inconclusive run as NOT green.

2. **Run the workflow engine** and wait for its notification:
   ```
   Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/factory-execute/factory-workflow.mjs", args: {
     planPath, repoDir, featureBranch, solutionPath: "<resolved $SLN>",
     dotnetCmd: "dotnet", baseline: "<the recorded baseline>", maxFixRounds: 3 } })
   ```
   It decomposes the plan into per-area task lists, implements backend and frontend in parallel over
   disjoint directories on the same branch, tests (backend: build + `dotnet test`; frontend:
   `npm run check` + `npm run build`), and fix-loops to green.

3. **Carry the contracts into every implementer prompt.** An implementer that has not been given the
   handler's contract will write the handler and then write tests from it — the failure this whole
   pipeline is built to prevent. The contract block goes **into the code** as part of implementing
   the handler, not bolted on afterwards.

4. **Test each unit with `/test-write`**, from the contract rather than the implementation. That
   skill's falsification step is not optional: every `MUST` and `ORDER` line gets its mutation, and
   a test that stays green while its behaviour is sabotaged is rewritten, not accepted.

5. **Record the run id** from the Workflow result in the run manifest. If the run fails, is
   interrupted, or needs re-running after a plan edit, **resume it** with `resumeFromRunId` —
   completed agents return cached results instantly and only failed or new work re-runs. Never
   restart a partially-completed workflow from scratch; that re-pays for everything that already
   succeeded.

6. **Read the result.** Spot-check the touched area with a targeted
   `dotnet test --filter "FullyQualifiedName~<TestClass>"` rather than trusting the summary.

---

## Output

Per-area pass/fail, files touched, fix rounds used, and the suite count against the baseline. Say
which contract lines are now covered and which are not.

If `green:false`, surface exactly what is still red and hand the decision back — **do not loop
blindly**. When green, the caller proceeds to `/factory-fix`.

---

## Notes

- A suite that grew by fewer tests than the contracts owe is the signal that step 4 was skipped.
  Check the number, not the claim.
- If an implementer cannot finish, stop and report. A half-implemented unit that is reviewed and
  tested is more useful than three unreviewed ones.
