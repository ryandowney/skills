---
name: factory-plan
description: Produce an exhaustive implementation plan from a spec — requirements, every recorded decision, affected surface across every layer, wire contract, the single migration, house-rule checkpoints, a per-handler CONTRACT block with the test cases each line owes, the Phase 0 contract-file list, a lane map with disjoint file ownership, and the verification matrix the finished work is clicked through against. Grounds every claim in the codebase. Use as the factory's first stage, or standalone when you just need a plan.
---

# factory-plan — the plan everything downstream is built from

Turns a spec (`$ARGUMENTS` — literal text or a path) into one document an implementer can execute
without re-deriving anything.

The most important outputs are not the file list:

- **Handler contracts** — what each handler is *supposed* to do. Tests are written from them and
  reviews are held to them. Wrong contracts produce a correct-looking feature, a green suite and a
  clean review, all agreeing on the wrong thing.
- **The lane map** — which agent owns which files. It is what lets the build run in parallel without
  agents overwriting each other.
- **The verification matrix** — every path a user can take, written from the spec before any code
  exists, so the final click-through checks the spec rather than the build.

---

## Steps

1. **Plan path.** Keep plans in the repo's `docs/plans/<slug>-plan.md` when the repo keeps plans
   (check `AGENTS.md` / `CLAUDE.md`), else `<scratchpad>/factory/plan-<slug>.md`.

2. **Test baseline first.** Run the suites before anything changes; record counts and known failures.
   Mass-Inconclusive or mass-skipped DB tests mean Docker is down — not a pass.

3. **Spawn the planner** on the strongest model at high effort (`Agent`, general-purpose). It reads
   `AGENTS.md` / `CLAUDE.md` and the relevant docs, greps the codebase to ground every claim, and
   writes the plan with these sections:

   - **Decisions** — at the very top, every decision the user has made (in chat, on a call, in the
     ticket), dated, each marked as overriding the spec where it does. Later sections must agree with
     it; this block wins when they don't.
   - **Requirements** — functional and non-functional; explicit in-scope / out-of-scope; every open
     question resolved or flagged for Gate 1. A business rule (a rate, a role, a wording) is never
     assumed — it is flagged.
   - **Affected surface, per layer, bottom-up** — exact backend files by layer, then frontend data
     (types, accessors, API mocks), then routes and components. A thing belongs to the lowest layer it
     can live in.
   - **Wire contract** — request/response shapes, byte-for-byte; frontend names match the API's
     serialization exactly.
   - **Data / migrations** — exactly one migration for the feature, in the repo's own migration tool
     and numbering (read the folder; never assume), registered wherever the test host applies schema.
     Never edit a shipped migration.
   - **HANDLER CONTRACTS** — one per new handler: `MUST` / `EDGE` / `ORDER` / `NEVER` lines covering
     the happy path, every refusal, the edges with defined answers, any ordering that is itself a
     guarantee, and what must never happen. Written from the spec and design docs, before any code.
   - **Test plan, line by line from the contracts, per lane** — for each line the concrete case(s):
     positive and negative, which error, which entry point. Anything guarding a permission, money or
     data loss is tested through the same entry point production uses (if production validates before
     handling, so does the test). Reuse the test projects' real base classes and seed helpers — name
     them; do not invent them. Seeds are FK-honest.
   - **Phase 0 — contracts as code.** The exact list of files one agent writes *before* any lane
     starts: shared enums, entities and DB config, the migration, every request/response/DTO and
     interface in every layer, compiling handler **shells** carrying their CONTRACT blocks, frontend
     types and accessor signatures, API-mock fixtures, component stubs — and every **shared
     registration file** (DI registration, route tables, barrels, navigation, project/solution files,
     lockfiles) the feature touches, since no lane may own a file another lane also needs. Mark each
     file **frozen** (contract) or **shell** (a body a lane fills in), and give every shell the lane
     that owns its path. After Phase 0 the solution builds and no lane guesses a shape another owns.
   - **Lane map.** Lanes that can be built in parallel once Phase 0 exists — typically one per layer
     group (data access; use cases + validation; API; frontend data; frontend UI). For each: a key,
     the **path prefixes it alone owns** (disjoint — the build engine refuses overlaps), how it mocks
     the layer below, its test cases, the command that runs just its tests, and its **high-risk
     lines** (auth, tenancy, money, data loss, dates and time zones) that the reviewer will
     mutation-test. Lanes run their DB-backed tests at the same time: say how the test projects keep
     databases isolated (per-test containers, per-lane database names), or serialise those lanes.
     Give each lane's contracts, test cases and high-risk lines under headings the engine can quote
     verbatim into that lane's brief — lane agents read the brief, not the whole plan.

     **Size the lanes to the work.** Every lane costs a fixed overhead (a worktree, a builder, a test
     writer, a reviewer), so a lane must carry enough work to pay for it. A small change — a handful of
     handlers and one screen — gets **2–3 lanes** (e.g. backend; frontend data + UI). A large one, many
     handlers across every layer plus several screens, gets **up to 6**. Split further only where two
     pieces are each big enough to keep one builder busy, can be tested on their own, and touch disjoint
     paths; merge two lanes when either would hold fewer than about three handlers or components, or
     when one could not be tested without the other's real code.
   - **Shared files** — required when this plan sits in a stack or runs beside other plans (sibling
     PRs, a parallel factory run). List every file two of the plans touch and give it **exactly one
     owning plan**. The others never re-implement it: they build against the owner's contract when it
     has landed, or against a minimal stub matching that contract exactly (say which, and where it
     comes from — the owner's branch, or Phase 0 here, marked as a stub the stack replaces). Every path
     owned by another plan is passed to `/factory-execute` as `foreignOwned`; its decompose step stops
     if a lane claims one. Two plans each building and hardening their own copy of one shared file is
     exactly what this prevents.
   - **Integration smoke** — the real-stack steps run after the lanes merge (each endpoint through the
     real API, the migration applied).
   - **Verification matrix** — numbered user paths with their expected outcomes, each tagged with its
     source (spec / decision / plan): every flow end to end, every action from every place it is
     offered, loading / empty / error states, validation, a second user, deep links and back/forward,
     counts and badges that must agree, narrow width, keyboard, motion. `/factory-verify` clicks
     through exactly this list at the end. For a bug fix: the reproduction, the fixed behaviour, and
     the neighbouring paths the fix could disturb.
   - **House-rule checkpoints** — where the repo's rules bite for this change.
   - **Docs** — what changes in the living design docs.
   - **Risks & rollout** — deploy blast radius, migration safety on live data, sequencing.

4. **UI triage.** Run `/ui-triage <plan path>`. If `substantive`, run
   `/ux-design <plan path> --live --design <next to the plan>` and link it from the plan; its
   acceptance checklist joins the verification matrix. Return the verdict and design path so the
   conductor can record them and hand them to `/factory-fix`.

5. **Read the plan yourself.** Check the contracts hardest: a line that restates a function name
   (`MUST create the task`) is a label, not intent — it yields no test that could fail. Check that lane
   ownership is disjoint and that every new file belongs to exactly one lane or to Phase 0. Check that
   the matrix covers every surface in the affected list. Check the lane count fits the size of the
   change, and that a plan in a stack has its Shared files section. Push back before presenting.

6. **Present a tight summary** and return the plan path.

---

## Output

The plan path, a 5–8 line summary, the migration chosen, **the handler contracts in full**, the lane
map (with the reason for its lane count), the Shared files section and its `foreignOwned` list when
there is one, the verification matrix line count (and the lines themselves on request), the UI triage verdict
and design path, and every assumption made where the spec was silent.

This is **Gate 1**: the caller gets the user's approval before `/factory-execute`. The contracts and
the matrix are the parts most worth a human's eye — cheap to correct now, expensive after tests exist.
