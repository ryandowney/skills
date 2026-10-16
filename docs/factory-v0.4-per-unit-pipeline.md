# factory v0.4.0 — per-unit pipelining (planned)

*Written 2026-08-29. Motivated by the gap analysis against "Graph Engineering" (@0xwhrrari,
x.com/0xwhrrari/status/2086784668003598356) — its points 5 (streaming vs barrier joins),
7 (verification on the edge), and 10 (failure as a local event).*

## Status and decision log

- **2026-08-29 — deferred, leaning against.** Ryan's call after the v0.3.0 upgrades: current
  performance is already quite good, and runs already take longer than he'd like. v0.4's
  price — roughly 2–3× the tokens and more wall-clock on small-to-mid features — is exactly the
  wrong direction while latency is the standing complaint and the failure mode it insures
  against (replicated mistakes, implementation-derived tests) has not shown up in real runs.
  Per the article's own cost logic (point 11), coordination is only spent where it earns its
  keep — so this stays a documented option behind its adoption trigger, not a roadmap item.
- **If the factory gets attention next, aim it at speed, not granularity** — v0.4 adds agents;
  the standing pain is duration. Revisit only if fix-loop logs start showing the same mistake
  corrected across many files, or test-review flags suites written from implementation.

## The problem

`factory-execute/SKILL.md` opens with the per-unit doctrine — *implement → review → test at the
point it is written, not at the end* — and states why: a wrong pattern caught late is six fixes
instead of one, and tests written after a big-bang build get written from the implementation.

But `factory-workflow.mjs` doesn't do that. It hands ONE backend agent ALL backend tasks, one web
agent all web tasks, and tests once at the end. Area-level big-bang with a barrier join — exactly
the topology the skill argues against. The doctrine is enforced by prose, not by the graph.

## The design

Restructure the engine so units stream through a pipeline:

1. **Decompose returns units, not areas.** Each unit = a coherent testable slice (one handler +
   its validation handler + its tests; one accessor; one component) with an explicitly disjoint
   file set and its CONTRACT block. Decompose must declare inter-unit dependencies; independent
   units may run concurrently, dependent ones are ordered.
2. **`pipeline()` over units**: implement(unit) → test(unit), so unit 2 builds while unit 1
   tests. Keep backend/web as parallel lanes as today.
3. **Per-unit fix**: a failing unit gets its own bounded fix loop (cap 2) before the next
   dependent unit starts — failure stays local to the unit instead of surfacing in a global fix
   round.
4. **One integration join at the end**: full build + full suite against the baseline, catching
   cross-unit breakage. This is the one barrier that earns its wait.
5. Milestone commits per green unit (optional flag) so a crashed run resumes from the last green
   unit even without workflow cache.

## The tradeoffs (why this isn't v0.3.0)

- **More tokens**: one implementer per unit instead of per area. A 6-unit feature spawns ~6
  implement + ~6 test agents versus 2 + 2 today.
- **Decompose quality becomes structural**: overlapping unit file sets cause same-branch write
  conflicts. Needs a validation pass on the decomposition (disjointness check is deterministic —
  do it in script code, not with a model).
- **Latency may rise** for small features (pipeline overhead) — the v0.3.0 router should send
  those down `single-unit` anyway.

## Adoption trigger

Do this when real runs show the failure it prevents: `/factory-fix` rounds repeatedly finding the
same mistake replicated across files, or test-review flagging suites written from implementation.
If fix rounds stay one-off and cheap, the current shape is the right cost model — don't build it.

## Acceptance

- Engine enforces implement→test per unit; SKILL.md prose and script agree (no doctrine the graph
  doesn't enforce).
- A killed run resumed via `resumeFromRunId` re-runs only incomplete units.
- Token cost per feature reported in the workflow result, so the v0.3 vs v0.4 cost delta is
  measurable, not vibes.

## 2026-10-16 — superseded by v0.4.0 "contracts first, lanes in parallel"

Ryan's call after a full-stack feature build in a work repo (five lanes, about 1h46m and 25
agents, then stress testing and a 72-path browser QA pass). That run used a
different topology from both this doc and v0.3, and it was faster *and* caught more:

- **Phase 0 writes every contract as compiling code** (DTOs, interfaces, migration, handler shells
  with CONTRACT blocks, frontend types, mocks) in one commit. Lanes then build against frozen
  shapes instead of guessing each other's, which removes the reason for bottom-up serial layers.
- **Lanes in their own worktrees, owning disjoint paths** (checked in script code), each running
  build → tests from the contract by a different agent → adversarial review with mutation on
  high-risk lines only → fix → re-review only after a blocker fix.
- **Full suites once, at integration**, plus a real-stack smoke; then the whole-diff review.
- **Verification as the last stage**: every path clicked in a real browser, GIF evidence posted.

The per-unit granularity below stays unbuilt: lanes are the unit, and the cost concern (2–3× tokens
for per-unit agents) still holds. The two ideas it shared with v0.4.0 — disjointness checked in code,
failure kept local to its lane — shipped.

## 2026-10-16 — v0.5.0: lanes clean up after themselves; Playwright records the click-through

- **Teardown is its own step**, not a sentence in the integration prompt. After integration (or a failed lane
  setup) a cheap agent removes each lane worktree with the repo's `teardownCmd` and deletes its branch with
  `git branch -d`. It never forces: a dirty lane, or one whose commits did not reach the feature branch, is kept
  and reported in `teardown.kept`. A `lanes` stop keeps everything on purpose; the conductor checks
  `git worktree list` before Gate 2.
- **factory-verify records with Playwright when the repo has it**: true 390 px width, `reducedMotion`, no
  background-tab pauses, video per flow. GIFs come from ffmpeg when installed, else from step screenshots via
  `frames-to-gif.py` (Pillow). The Chrome extension stays as the fallback for repos without Playwright or
  when Playwright cannot sign in.
