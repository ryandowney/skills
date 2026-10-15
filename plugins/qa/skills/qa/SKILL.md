---
name: qa
description: Exploratory QA agent for a template-derived repo. Boots the full stack locally, sweeps every screen with a deterministic crawler (console errors, failed requests, screenshots), then interactively investigates what the sweep flags, probes the three async states (loading/empty/error), and walks the repo's declared workflows — producing a bug report with severities, repro steps, and evidence. Finds bugs; does not fix them. Invoke as /qa [branch-or-ref | workflow name | route | "sweep-only"]. Given a branch, it QAs that branch in an isolated worktree and focuses judgment on the surfaces the diff actually touched.
---

# qa — explore the running app and find bugs

Not the e2e suite. Playwright specs assert *known* journeys; this hunts *unknown* bugs — console
errors, dead ends, broken states, workflows that quietly do the wrong thing. Report-only: findings,
never fixes (hand confirmed bugs to `/factory` or fix directly, outside this skill).

**Cost shape (deliberate):** a zero-token crawler does the sweep; the model spends judgment only on
what the sweep flags, on the three-state probes, and on declared workflows. Do not hand-visit
healthy pages the crawler already cleared.

`REPO=$(git rev-parse --show-toplevel)`. `$ARGUMENTS` may name a branch/ref to QA, one workflow or
route to focus on, or `sweep-only` for phase 2 alone.

---

## 0. Scope — branch and diff focus

When `$ARGUMENTS` names a git ref (a branch, `origin/x`, a PR head):

1. **Never disturb the user's checkout.** Put the ref in its own worktree —
   `git worktree add <scratch>/qa-<slug> <ref>` — and treat that directory as `$REPO` for
   everything below. Only one stack can own the ports: if a stack from another checkout is
   running, say so and ask before stopping it. Remove the worktree when done.
2. **Let the diff aim the judgment.** Compute the diff vs the merge-base with `origin/main`
   (the same scoping `/flow` uses — run `/flow` if its citations would help). Map it to surfaces:
   changed web routes/components directly; changed handlers/engines/accessors upward through
   their request types and `apps/web/src/lib/api.ts` to the screens that call them.
3. **Spend accordingly.** The full sweep still runs — it is free. Interactive triage, the
   three-state probes, and workflow walks go to the affected surfaces first and deepest;
   surfaces the diff does not touch get judgment only if the sweep flags them. In the report,
   mark each finding **in-scope** (owned by this branch's diff) or **pre-existing** (reproduce
   on the base branch when cheap to check) — the same discipline `/factory-review` applies.

No ref argument means: QA whatever is checked out, full breadth.

## 1. Boot the stack (or reuse it)

Check first — `curl -s localhost:5000/health` and the web port — a running stack is reused, never
restarted. Otherwise, per the repo's AGENTS.md/CLAUDE.md commands (authoritative over these defaults):

```
docker compose up -d
dotnet run --project src/7.Database/*.DbUp          # migrate
dotnet run --project src/1.Clients/*.Client.WebApi  # background; wait for /health
cd apps/web && npm install --silent && npm run dev  # background; note the port
```

Dev auth (`Kinde:IsEnabled=false`) signs in a seeded local user. If a Development-only
`/api/test/seed` endpoint exists, seed a rich world: several entities per list, at least one
archived, names with spaces/unicode/max-length. Thin seed data hides bugs — an empty world
exercises nothing. Record what you seeded; it is the repro context for every finding.

If the stack will not boot, that is finding #1 — report it and stop.

## 2. Deterministic sweep (no tokens)

Copy the bundled crawler into `e2e/` (where `@playwright/test` resolves), run it, remove the copy:

```
cp "${CLAUDE_PLUGIN_ROOT}/skills/qa/qa-crawl.mjs" "$REPO/e2e/.qa-crawl.mjs"
cd "$REPO/e2e" && node .qa-crawl.mjs --base <web url> --routes ../apps/web/src/routes --out <scratch>/qa-out
rm "$REPO/e2e/.qa-crawl.mjs"
```

It visits every static route plus every same-origin link it discovers (which reaches dynamic
`[id]` pages through real seeded hrefs), and records per page: console errors/warnings, uncaught
page errors, 4xx/5xx/failed requests, a full-page screenshot, and near-empty-page flags.

## 3. Triage what the sweep flagged (judgment starts here)

Read `sweep.json`. For each flagged page: read the errors, open the screenshot, and decide —
real bug, noise (third-party 404, dev-server warning), or needs interactive investigation.
Investigate interactively with the browser tools (claude-in-chrome when connected; otherwise a
targeted Playwright script): reproduce, narrow, capture the exact repro steps.

Then look at *every* screenshot once, quickly — broken layout, overflow, unstyled fallbacks, and
missing data render fine as HTTP 200 and only a look catches them.

## 4. Probe the three async states

House rule: every async surface needs loading, empty, and error states — and a passing build hides
all three when they're missing.

- **Error:** stop the API (`docker compose stop` the API container, or kill the process), reload
  each primary screen. A blank page or spinner-forever is a bug; the rule requires a rendered
  error state. Restart the API afterwards and confirm recovery.
- **Empty:** reach each list with zero items (fresh tenant, or filters that match nothing). A
  bare white region where an empty-state belongs is a bug.
- **Loading:** throttle or delay (DevTools/Playwright route delay) and confirm something renders
  during fetch.

## 5. Walk the declared workflows

Read `docs/qa-workflows.md` in the target repo — plain-language critical journeys, e.g.
"create a project → rename it → archive it → verify it leaves the list unless includeArchived".
Execute each end-to-end in the browser, verifying outcomes in the UI **and** against the API
(the UI saying "saved" is a claim; the list re-fetch is the evidence). Try the obvious abuses
alongside the happy path: double-submit, stale tab, back-button after mutation, the same name
twice, boundary-length input.

No `docs/qa-workflows.md`? Derive 3–5 candidate workflows from the controllers and routes,
**run them**, and include the drafted file in the report for the user to keep.

## 6. Report

Artifact (bugs ranked by severity) + terminal summary. Every finding carries: severity
(blocker / major / minor / polish), exact repro steps from the seeded world, evidence
(screenshot, console/network capture), and — where diagnosable — the suspected `file:line`.
Separate **bugs** (wrong behaviour) from **observations** (works, but worth a look). End with:
which workflows passed clean, what was NOT covered, and which findings deserve a Playwright spec
so the e2e suite owns them permanently — offer to write those with `/test-write`.

Leave the stack as you found it: running if it was running, stopped if you started it.
