---
name: factory-plan
description: Produce an exhaustive implementation plan for a feature in an IDesign-layered repo from a spec — requirements, affected surface across every layer, API contract, the single migration, house-rule checkpoints, and a per-handler CONTRACT block plus the test cases each contract line owes. Grounds every claim in the codebase. Use as the factory's first stage, or standalone when you just need a plan.
---

# factory-plan — the plan everything downstream is built from

Turns a spec (`$ARGUMENTS` — literal text or a path to a spec file) into one document an implementer
can execute without re-deriving anything.

The plan's most important output is not the file list. It is the **handler contracts**: the statement
of what each handler is *supposed* to do. Tests are written from those, and reviewed against those.
Get them wrong and every downstream stage faithfully builds and verifies the wrong feature — with a
green suite and a clean review to prove it.

---

## Steps

1. **Plan path.** `<scratchpad>/factory/plan-<slug>.md` (slug from the spec); `/tmp/factory/` if no
   scratchpad is configured. Plans are scratch — do not commit them.

2. **Establish the test baseline first.** Run the suite *before* anything changes and record the
   count and any known failures. Everything after is compared to that; anything newly red is yours.
   Mass-Inconclusive means Docker is down, not a pass.

3. **Spawn the planner** at high effort:
   `Agent(description:"Plan <feature>", subagent_type:"general-purpose")`.
   It must read `AGENTS.md`/`CLAUDE.md` and the relevant `docs/`, grep the codebase to ground every claim, and
   **write the plan to the plan path**. Required sections:

   - **Requirements** — functional and non-functional; explicit in-scope / out-of-scope; every open
     question resolved, with assumptions stated where the spec is silent.

   - **Affected surface** — exact backend files by layer (Client → Manager handler → Validation
     handler → Accessor → EF entity + `DatabaseContext`, request/response contracts, DTO mappers,
     DbUp script) and frontend files (`apps/web/src/lib/api.ts`, routes, stores, components).

   - **API contract** — request/response shapes. Frontend calls in `api.ts` must match controller
     routes **exactly**; there is no generated contract file, so the controllers are the truth and a
     typo is a runtime 404 no compiler catches.

   - **Data / migrations** — **exactly ONE** new DbUp script, next sequential number (read the
     folder, never assume), consolidating every schema change. Never edit a shipped script. Update
     the EF entity and `DatabaseContext`, **and register the script in the test host** — a migration
     the test host never runs is a green suite proving nothing.

   - **HANDLER CONTRACTS — one per new Manager and Validation handler.** The `MUST` / `EDGE` /
     `ORDER` / `NEVER` lines that will live in the code (`AGENTS.md`/`CLAUDE.md` → Handler contracts). These are
     written **from the spec and the design docs**, never from an implementation that does not exist
     yet — which is exactly why writing them here, before any code, is what keeps the tests
     independent. Cover the happy path, every refusal, the edges with defined answers, any ordering
     that is itself a guarantee, and anything that must never happen.

   - **Test plan, derived line by line from those contracts.** For each contract line, the concrete
     case(s) it owes: positive and negative, which error code and field, which entry point. Anything
     guarding a permission, money or data loss goes through `Validate()` (rule 7). Read the existing
     test project and **reuse its real base classes and seed helpers — discover the names, do not
     invent them.** Seeds must be FK-honest. Frontend has no unit tests: the gate is `npm run check`
     plus `npm run build`, with Playwright for critical journeys.

   - **House-rule checkpoints** — where `AGENTS.md`/`CLAUDE.md`'s rules bite for this change: layer call
     directions, ServiceProxy, handler/request name mirroring, validation-in-engine, auth-gate
     placement, fail-closed enforcement on any new agent- or token-facing surface.

   - **Docs** — what changes in the living design docs. Not an afterthought; §2.2 of
     `/system-review` exists because this step gets skipped.

   - **Risks & rollout** — destructive-op safeguards, sequencing, anything irreversible.

4. **Read the plan yourself.** Check the contracts hardest: a contract line that merely restates a
   function name (`MUST create the credential`) is not intent, it is a label — it yields no test
   that could fail. Push back before the plan is presented.

5. **Present a tight summary** and return the plan path.

---

## Output

The plan path, a 5–8 line summary, the migration number chosen, **the handler contracts in full**,
and any assumption the planner made where the spec was silent.

This is **Gate 1**: the caller gets the user's approval before `/factory-execute`. The contracts are
the part most worth a human's eye — they are cheap to correct now and expensive after tests exist.
