---
name: factory
description: Software-factory conductor. Drives a feature or a bug fix from a spec to a merge-ready, browser-verified PR — plan (with UI triage and UX design when there is real UI) → contracts as code → parallel lanes → integration → whole-diff review and fix → optional stress test → PR and CI → full browser click-through with GIF evidence posted to the PR and issue. Two human gates (approve the plan; review and merge). Invoke with a spec, a spec file, or `bug <description or issue>`. Invoke the stage skills to run one stage alone.
---

# factory — the conductor

Chains the pipeline and enforces the two human gates. **Gate 1** = approve the plan, its contracts,
its verification matrix and (for real UI) its design. **Gate 2** = human review and merge, with the
evidence in front of them. Everything between runs without stopping.

Each stage is its own skill and runs standalone. This conductor holds the shared state — spec, plan,
branch, baseline, run manifest — and passes it along.

**Repo:** resolve, never hardcode: `REPO=$(git rev-parse --show-toplevel)`. Build, test, run and
worktree commands come from `AGENTS.md` / `CLAUDE.md`; when they disagree with a default here, they win.

**Models:** planning, Phase 0 contracts, every review, integration and orchestration → the session
model (no stage names a stronger one unless the caller passes it). Building, test writing and fixes →
**Sonnet**. Mechanical steps — extracting the lane map, writing lane briefs, creating and tearing down
worktrees, running the full suites, watching CI — → **Haiku** at low effort: they copy text or run a fixed command list, and
judgment spent there buys nothing. `/factory-execute` exposes each tier as an arg.

**Tokens:** spend them where they find defects. Every agent reads only what its job needs (lane
agents read a per-lane brief, not the whole plan, and every agent reads files by section after a
grep); a resume replays finished work from cache. None of this relaxes a gate below.

**Test runs are the conductor's call.** Agents write tests and run the *affected* tests as they go
(plus the plan's guard tests on a matching path). The full suites run twice per feature: **once at
integration** (mandatory — it is where the lanes meet; `/factory-execute` does it) and **once at the
end**, after every review, stress and verify fix — CI's full run on the PR is that run; run it locally
only when the repo has no CI or CI cannot run a suite. Fix rounds in between run affected tests only.
The conductor decides when a full run happens and acts on its result, but **never runs a suite in its
own context**: it hands the run to a runner (a `mechanicalModel` agent or a shell step) that writes the
output to a log and returns counts, failing test names and the log path.

**Watch for milestones, not steps.** While a workflow or CI runs, surface only lane done / blocked,
integration, the PR, CI green or red. Every relayed step lands in this context; on a six-lane run the
per-step events alone filled the window.

---

## Routes

Classify first. Judgment picks the route; the routes themselves are fixed.

| Route | When | What runs |
|---|---|---|
| `direct` | typo, copy, config, a single file with no test surface | just make the change |
| `bugfix` | a defect with a reproducible symptom | reproduce → fix → review → ship → verify (below) |
| `single-unit` | one handler-sized change | plan + contracts (Gate 1), implement in-session, tests by a different subagent from the contract, `/factory-fix`, ship, verify |
| `full` | spans layers, new tests across tiers, an auth/permission boundary, or a new screen | the whole pipeline |

State the route and the one-line reason in the run manifest. Between `single-unit` and `full`, pick
`full`.

---

## Pipeline (`full`)

1. **Baseline.** One full run before anything changes, by a runner (never in this context); record
   counts and known failures. It is also `/factory-execute`'s pre-flight — do not run it twice.
   Mass-Inconclusive or mass-skipped DB tests mean Docker is down — fix that first; it is not a baseline.

2. **Plan** → `/factory-plan`. It returns the plan with the decisions block, contracts, Phase 0 file
   list, lane map, smoke steps and verification matrix, and runs `/ui-triage` (and `/ux-design` when
   substantive).

   **GATE 1.** Present the summary, **the contracts in full**, the lane map, the verification matrix
   and the design's acceptance checklist. Get approval (ExitPlanMode if plan mode is active,
   otherwise ask). Incorporate changes and re-confirm. **Do not proceed until approved.** Every later
   decision the user makes goes into the plan's decisions block, dated.

3. **Branch** — a fresh worktree off the base branch, the repo's way (a helper script if it has one).
   Never reuse a branch. Start the **run manifest** in the scratchpad (`<scratchpad>/factory/<slug>-run.md`
   — never in the repo, even when the plan is): route, branch, baseline, plan, UI-triage verdict and design path,
   then append the workflow run id and args file, each review round's verdict, the dispositions
   ledger, the verify verdicts and the evidence links. It is what makes a resume possible without
   archaeology.

4. **Execute** → `/factory-execute`. Phase 0 contracts, parallel lanes, integration. Pass the plan's
   Shared files that another plan owns as `foreignOwned`. Not green → read `stopped`, decide, resume.

5. **Whole-diff review + fix** → `/factory-fix`. The lane reviews each saw one lane; this catches what
   only shows across them (a field dropped between two layers that are each correct, a wire name
   spelled differently). Correctness + architecture + tests, plus `/ux-review --live` when UI triage
   said substantive. Fresh reviewers, to PASS or the cap.

6. **Stress (optional; default on for `full` with real UI or risky dates/permissions).** Hunt the
   bugs nobody listed: `/qa <branch>` if the qa plugin is installed, and/or 2–3 parallel agents each
   attacking one dimension against the running stack — the UI (rapid clicks, odd widths, long text,
   back/forward), the API (malformed input, races, someone else's ids), and dates (time zones,
   midnight, DST). Each derives its URLs from the repo's own env / port mechanism for its worktree
   (never a hardcoded port — another run may be up beside it) and writes any helper script under a
   per-run folder named for the branch, never at a shared name. They report; they do not fix. Confirmed in-scope bugs are fixed with a regression
   test, then **back through `/factory-fix`** so fresh reviewers see the fixes; the rest are reported.

7. **Ship** → `/factory-ship`. Commit, push, open the PR, CI to green. Do not merge. No local full run
   here when CI runs the suites.

8. **Verify** → `/factory-verify`. Every line of the verification matrix clicked through in the real
   browser, a GIF per flow, the database cross-checked. Fails are fixed with a regression test proven
   to fail on the old code and re-verified live; then the conductor runs `/factory-fix` over those
   fixes (fresh reviewers), pushes, and re-checks CI. **CI's run on that last push is the feature's
   final full run**; with no CI (or a suite CI cannot run), hand that run to a runner now. The evidence
   goes to the per-branch evidence folder and is posted to the PR and the issue, as the repo's rules
   allow.

   **Before Gate 2, leave nothing behind**: `git worktree list` shows no lane worktrees (any the engine
   kept are named in the run manifest with the reason, and the user hears about them), no temporary
   evidence worktree, no browsers or dev servers the factory started, and every `QA-` row is gone.

   **GATE 2 — handoff.** The PR URL, what shipped, test counts against the baseline, review verdicts,
   the verify matrix with its counts (PASS / FAIL / PARTIAL / SKIPPED), what is not verified and why,
   and where the evidence is, and any worktree still on disk. The factory does **not** merge.

## Route `bugfix`

1. **Baseline and branch** — a fresh branch off the base, suites run, before anything changes.
2. **Reproduce on the branch, before any change.** `/factory-verify bug-before …` clicks through the
   reproduction and records a **before** GIF; write the failing regression test. No reproduction →
   stop and ask; a fix for a bug nobody can see is a guess.
3. **Gate 1 only when it matters**: if the fix changes intended behaviour, a contract, a migration or
   crosses layers, present the cause and the fix approach and wait for approval. Otherwise proceed.
4. **Fix.** Commit, then prove the test fails with the old code put back (`/factory-verify` §5).
5. **Review** → `/factory-fix` (correctness + tests; add architecture when the fix crosses layers).
6. **Ship**, then `/factory-verify bug …`: the reproduction now behaves (an **after** GIF), plus the
   neighbouring paths. Before and after are posted to the PR and the bug's issue. **Gate 2** as usual.

---

## Notes

- **Push and tracker conventions** live in `AGENTS.md` / `CLAUDE.md` and stored memory: base branch,
  whether PRs exist at all, whether Claude may write to the tracker, whether issue identifiers may
  appear in branches, commits or PRs. They win over every default here.
- If a stage stalls or an agent cannot finish, **stop and report**; do not loop blindly.
- Keep the living design docs current; that is part of the feature.

## The stages, standalone

| Skill | Does | Edits? |
|---|---|---|
| `/factory-plan` | Plan, contracts, lane map, verification matrix | no |
| `/ui-triage` | none / trivial / substantive UI | no |
| `/ux-design` | Design doc and acceptance checklist for real UI | no |
| `/factory-execute` | Contracts → lanes → integration | yes |
| `/factory-review` | Correctness + architecture + tests (+ UX), one verdict | no |
| `/ux-review` | UI against the design and the app's look | no |
| `/architecture-review` | House rules only | no |
| `/test-review` | Adversarial: do the tests prove intent? | no |
| `/test-write` | Tests written from a contract | yes |
| `/factory-fix` | Review → fix → re-review loop | yes |
| `/factory-ship` | Commit, PR, babysit CI | yes |
| `/factory-verify` | Browser click-through, GIFs, evidence posted | fixes only inside the factory |
| `/system-review` | Whole-repo audit, not a diff | no |
