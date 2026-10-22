---
name: factory-ship
description: Ship a green, review-clean feature branch — commit, push, open the PR, and babysit CI to green. Stops at the human merge gate and never auto-merges. Use as the factory's final stage, or standalone whenever a reviewed branch needs a PR opened and watched.
---

# factory-ship — commit, PR, babysit CI

Takes a green, review-clean branch to merge-ready. **Never merges** — that stays a human decision.

## Prerequisites

- The branch is green and passed `/factory-fix` (verdict PASS, or the caller accepted residuals)
- The feature branch name

**Check this repo's push conventions before doing anything.** They differ per project and per phase,
and getting it wrong is the one mistake here that is annoying to undo. `AGENTS.md`/`CLAUDE.md` and any stored
memory are the source of truth — if this project pushes straight to `main` with no PRs, do that
instead of opening one, and say so rather than silently following this skill's default.

## Steps

0. **No local full run when CI runs the suites.** The feature's final full run is CI's, on the PR
   (the first was at integration); `/factory-fix` and `/factory-verify` ran only what they touched.
   Run locally only the suites CI cannot run, or all of them when the repo has no CI — and then hand
   the run to a runner (a Haiku agent or a shell step that writes the output to a log and returns
   counts and failing names), never in this context. Anything red stops the ship. Check
   `git ls-files .factory` prints nothing — the factory's lane scaffolding never ships; if it is
   there, `git rm -r .factory` and commit.

1. **Commit** on the feature branch. End the message with the trailer lines this session requires
   (the system tells you which; use them verbatim). No issue identifier anywhere the repo forbids it.

2. **Push**, then open the PR against the repo's base branch:
   ```
   gh pr create --base <the repo's base branch> --head <feature branch> ...
   ```
   Body: summary, **test evidence** (suite count against the baseline, the frontend gate, and the
   contract-coverage / mutation tables from `/factory-review` — those are the part a reviewer can
   actually check), link to the plan, a "Verification" heading that `/factory-verify` fills with the
   matrix and GIFs once it runs, and the
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

3. **Babysit until merge-ready.** Poll `gh pr checks` until green — hand the polling to a cheap
   subagent (Haiku, low effort) that reports only the final state and the failing job names, so the
   wait costs nothing; read the failing job's log by `grep` / `tail` (`gh run view --log-failed`
   piped to a file), not whole, and decide fixes yourself. On failure, fix on the branch, run the
   affected tests, push, re-poll — CI's next run is the full one.

   **CI speed.** PR pushes should run the affected tests (the selection agents use: changed projects
   and their contract dependents, `vitest related`, Playwright `--only-changed`); the full suites run on
   merge to the integration branch and nightly. Don't rerun the whole e2e suite on every push to a
   stacked branch. If CI runs everything on every push, ship anyway and note it in the handoff as a
   speed-up the repo could take. If the repo has no CI checks configured, **say that explicitly in the
   handoff** rather than polling forever.

## Output

Inside the factory, `/factory-verify` runs next against this PR; the Gate 2 handoff comes after it.
Standalone, when green, **stop and hand off**: the PR URL, what shipped, test results against the baseline, and
the review verdicts. Merge only if the user explicitly asks — and say what merging triggers if it
deploys anything.
