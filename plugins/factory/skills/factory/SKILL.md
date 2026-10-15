---
name: factory
description: Software-factory conductor. Drives one feature from a spec to a merge-ready PR by chaining factory-plan → factory-execute → factory-fix → factory-ship, with two human gates (approve the plan; review and merge). Invoke with a spec — literal text or a path to a spec file. Use for real multi-layer feature work; invoke the individual stage skills to run just one.
---

# factory — the conductor

Chains the pipeline and enforces the two human gates. **Gate 1** = approve the plan (and its handler
contracts). **Gate 2** = human review and merge. Everything between runs without stopping.

Each stage is its own skill and runs standalone. This conductor holds the shared state — spec, plan
path, repo, branch, test baseline — and passes it along.

**Repo:** resolve once, never hardcode: `REPO=$(git rev-parse --show-toplevel)`,
`SLN=$(ls "$REPO"/src/*.sln | head -1)`. Backend under `src/`, frontend under `apps/web`.

**Model assignments:** planning, orchestration and review verification → the session model at high
effort. Implementation and fixes → **Sonnet**, inside `/factory-execute`.

`$ARGUMENTS` is the spec: literal text, or a path to a spec file.

---

## When NOT to use it

A full run is a planner, parallel implementers, three reviewers, a fix loop and a CI babysit. That
only pays off for real, multi-layer work.

**Just do it directly** when the change is a typo, copy, or formatting fix; a single-file change with
no test surface; a one-line bug fix you already understand; a dependency bump; or anything you could
finish, test and explain faster than writing the spec would take.

**Use the factory** when the change spans layers, needs new tests across tiers, touches an auth or
permission boundary, or has enough surface that a second pair of eyes on architecture is worth
buying.

---

## Pipeline

0. **Route.** Classify the spec before starting any machinery. Judgment picks the route; the three
   routes themselves are fixed — a probabilistic classifier over deterministic paths:

   | Route | When | What runs |
   |---|---|---|
   | `direct` | typo, copy, config, or a single-file change with no test surface | just make the change — no factory |
   | `single-unit` | one handler-sized change: one unit plus its validation and tests | contracts still written and approved (Gate 1), implement in-session, then `/factory-fix`; the workflow engine is skipped |
   | `full` | spans layers, new tests across tiers, or touches an auth/permission boundary | the pipeline below |

   State the route and the one-line reason, and record both in the run manifest. When in doubt
   between `single-unit` and `full`, pick `full` — the router exists to cut waste, not gates.

1. **Baseline.** Run the suite before anything changes; record the count and any known failures.
   Everything after is measured against it. Mass-Inconclusive means Docker is down — fix that first.

2. **Plan** → `/factory-plan` with the spec. Returns the plan path and the **handler contracts**.

   **GATE 1 — approval.** Present the summary and the contracts and get the user's approval. Use
   ExitPlanMode if plan mode is active, otherwise ask directly. Incorporate changes and re-confirm.
   Do not proceed until approved.

   Put the contracts in front of the user, not just the file list. They are the statement of what
   each handler is *supposed* to do, everything downstream is written and verified against them, and
   they are cheap to correct now and expensive once tests exist. A wrong contract produces a
   correct-looking feature, a green suite and a clean review — all agreeing on the wrong thing.

3. **Branch.** `git fetch origin && git checkout -b feature/<slug> origin/main`. Never reuse a
   branch.

   Then start the **run manifest** — a file next to the plan (`<plan basename>-run.md`) recording:
   route + rationale, branch, baseline, plan path. Append as they happen: the workflow run id from
   `/factory-execute`, each review round's verdict, and `/factory-fix`'s dispositions ledger. This
   is the run's durable memory — what ran, why, with what state — and what makes resuming after an
   interruption possible without archaeology.

4. **Execute** → `/factory-execute` with `planPath`, `repoDir`, `featureBranch`, the baseline. It
   implements, reviews and tests **per unit** — not all at the end — and fix-loops to green. If it
   returns not-green, decide whether to iterate before review.

5. **Review + fix** → `/factory-fix`. Runs `/factory-review` (correctness + architecture + tests,
   consolidated and adversarially verified), fixes every confirmed blocker and should-fix, re-tests
   and re-reviews to **PASS** or its cap. If it hit the cap with residuals, decide whether to iterate
   before shipping.

6. **Ship** → `/factory-ship`. Commits, opens the PR, babysits CI to green.

   **GATE 2 — handoff.** It stops merge-ready. The factory does **not** merge.

---

## Notes

- **Check this repo's push conventions** before stage 6 — `AGENTS.md`/`CLAUDE.md` and stored memory are the
  source of truth, and they may say push straight to `main` with no PR at all.
- If a stage stalls or a subagent cannot finish, **stop and report** rather than looping blindly.
- Local run/debug: API `dotnet run --project src/1.Clients/*.Client.WebApi`; frontend
  `cd apps/web && npm run dev`. Ports and dev-auth settings are in `AGENTS.md`/`CLAUDE.md`.
- Keep the living design docs current — that is part of the feature, and `/system-review` §2.2 exists
  because this is the step that gets skipped.

---

## The stages, standalone

| Skill | Does | Edits? |
|---|---|---|
| `/factory-plan` | Plan + handler contracts + test plan | no |
| `/factory-execute` | Implement → review → test, per unit | yes |
| `/factory-review` | All three reviews, one verdict | no |
| `/architecture-review` | House rules only | no |
| `/test-review` | Adversarial: do tests prove intent? | no |
| `/test-write` | Tests written from a contract | yes |
| `/factory-fix` | Review → fix → re-review loop | yes |
| `/factory-ship` | Commit, PR, babysit CI | yes |
| `/system-review` | Whole-repo audit, not a diff | no |
