# factory v0.4.0 — per-unit pipelining (planned)

*Written 2026-08-29. Motivated by the gap analysis against "Graph Engineering" (@0xwhrrari,
x.com/0xwhrrari/status/2086784668003598356) — its points 5 (streaming vs barrier joins),
7 (verification on the edge), and 10 (failure as a local event).*

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
