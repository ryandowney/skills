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
and getting it wrong is the one mistake here that is annoying to undo. `CLAUDE.md` and any stored
memory are the source of truth — if this project pushes straight to `main` with no PRs, do that
instead of opening one, and say so rather than silently following this skill's default.

## Steps

1. **Commit** on the feature branch. End the message with the required trailer:
   ```
   Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
   ```

2. **Push**, then open the PR → `main`:
   ```
   gh pr create --base main --head feature/<slug> ...
   ```
   Body: summary, **test evidence** (suite count against the baseline, the frontend gate, and the
   contract-coverage / mutation tables from `/factory-review` — those are the part a reviewer can
   actually check), link to the plan, and the
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

3. **Babysit until merge-ready.** Poll `gh pr checks` until green. On failure, read the logs, fix on
   the branch, push, re-poll. If the repo has no CI checks configured, **say that explicitly in the
   handoff** rather than polling forever.

## Output — Gate 2 handoff

When green, **stop and hand off**: the PR URL, what shipped, test results against the baseline, and
the review verdicts. Merge only if the user explicitly asks — and say what merging triggers if it
deploys anything.
