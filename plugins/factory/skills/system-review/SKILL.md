---
name: system-review
description: Whole-repository audit rather than a diff review — architecture conformance across every layer, system coherence (does the code match the design docs), and a test-suite audit that asks what the suite would fail to catch. Produces a written report with a prioritised backlog. Expensive and deliberate; use when you want to know the true state of the system, not to gate a change.
---

# system-review — the state of the whole system

Every other review skill answers *"is this change safe?"* This one answers a different question:
**"what is true about this system right now, and what would we not find out until it hurt?"**

That needs a different method. A diff review has an anchor — the change — and everything outside it
is assumed fine. Here nothing is assumed fine, which means the work has to be **bounded by
structure** rather than by scope, or it becomes an unfalsifiable wander through the codebase.

**Expensive on purpose.** Run it at milestones — before a real deployment, after a burst of
agent-written code, when something felt wrong and nobody can say what. Not per-change.

**Report-only.** It changes nothing and opens no PRs. Its output is a document and a backlog.

---

## 0. Write the report as you go

`docs/reviews/system-review-<YYYY-MM-DD>.md`, committed. A review that lives in terminal scrollback
gets re-run from scratch in three months, and the second run cannot tell what was already known and
consciously accepted. **Record what you accept as much as what you find** — an accepted risk with a
reason is a finding; an accepted risk nobody wrote down is a landmine.

---

## 1. Ground truth first

Do not review from memory of the docs. Establish what is actually true:

```bash
REPO=$(git rev-parse --show-toplevel); SLN=$(ls "$REPO"/src/*.sln | head -1)
dotnet build "$SLN" && dotnet test "$SLN"          # count, failures, duration
cd apps/web && npm run check && npm run build
```

Record: suite count, failures, duration, frontend gate. **Mass-Inconclusive means Docker is down —
stop and fix that first**, because every conclusion below would be drawn over a suite that never ran.

Then the shape: `git log --oneline | head -50`, code per layer, migration count, how many handlers
exist, and how many of them carry a `CONTRACT` block.

---

## 2. Three passes, run in parallel

### 2.1 Architecture conformance

`/architecture-review` scoped to the whole repo rather than a diff. Every layer, every handler.

Beyond the per-rule checks, look for what only shows up at scale:

- **Rule 1 erosion.** Any layer skipped anywhere, and whether the skips cluster — one is a mistake,
  five in one area is a pattern somebody adopted deliberately and never wrote down.
- **Convention drift.** Two ways of doing the same thing. Usually one was copied from an older
  example, and the older example is still there teaching it.
- **The exemption list.** `[NoValidation]` count vs `ValidationConventionTests.ExpectedExemptions`.
  Three arguments-for is a considered position; nine is a rule that quietly died.
- **Dead scaffolding.** Template placeholder code still present and now load-bearing.

### 2.2 System coherence — code vs the design documents

The design here is well ahead of the code, so the useful finding is **where they silently diverged**.
For each of `docs/data-model.md`, `roadmap.md`, `screens.md`, `component-registry.md`:

- **Documented and built** — does the code do what the doc says, or only share its nouns?
- **Documented and not built** — is that honest (`Available = false`) or does the UI imply it works?
- **Built and not documented** — the dangerous quadrant. Undocumented behaviour is behaviour nobody
  can review, and it is where agent-written code accumulates.
- **Contradicted** — doc says one thing, code does another. One is wrong, and the fix is a decision.

`docs/component-registry.md` claims to track built-vs-unbuilt: **verify a sample rather than trusting
it.** A registry that has drifted is worse than none, because it is believed.

Note anything `AGENTS.md`/`CLAUDE.md` marks as untrustworthy (`docs/functional-spec.md` is template boilerplate)
and do not review against it.

### 2.3 Test-suite audit — what would this suite fail to catch?

Not "is coverage high". The question is what could break in production while the suite stayed green.

- **Contract coverage.** How many Manager and Validation handlers have a `CONTRACT` block? For a
  sample, run `/test-review`'s four directions. **Handlers with no contract are the backlog** —
  their tests cannot be trusted to test intent, whatever their count.
- **The gate audit.** Every permission, tenancy and auth gate: is there a test entering through
  `Validate()`? Falsify by **deleting the gate and running the suite**. Do this for every gate — it
  is seconds each and the highest-yield check available.
- **Mutation sample.** Take the highest-consequence behaviours — auth, tenancy, money, data loss —
  and mutate each. Report the survival rate honestly, and **name what you did not mutate.**
- **Structural gaps.** Layers, endpoints or components with no tests at all, ranked by consequence.
- **Suite health.** Duration (a slow suite stops being run, and `AGENTS.md`/`CLAUDE.md` treats that as a
  feature), flakiness, FK-honest seeds, anything `[Ignore]`d and why.
- **Frontend.** Which routes have Playwright coverage, and whether **empty / loading / error** states
  are exercised anywhere — the defect class a passing build cannot see.

---

## 3. Synthesis — the part that makes it worth the cost

A list of findings is not a review. Answer these four in prose, in the report:

1. **What would break first in production, and would we know?**
2. **Where is the code lying** — a screen, doc or name implying something that is not true?
3. **What is one bad day away from being unrecoverable** — no test, no doc, one person's memory?
4. **What did the last burst of fast work leave behind?** Velocity has a cost, and it is paid in
   undeclared behaviour and tests written from implementations.

Then the backlog, ranked by **consequence × likelihood**, each item small enough to act on:

```
BLOCKER    api_credential scope check has no test through Validate() — deleting the gate keeps the suite green
HIGH       9 of 14 manager handlers have no CONTRACT block; their tests assert implementation, not intent
HIGH       docs/component-registry.md lists 6 blocks as built; 2 do not exist
MEDIUM     two spellings of tenant scoping in accessors; the older one misses archived rows
LOW        suite duration up 40% since Aug 12 — still under a minute
ACCEPTED   functional-spec.md is boilerplate; known, and AGENTS.md/CLAUDE.md says so
```

---

## 4. Output

- The report path
- Ground-truth numbers: suite count, failures, duration, frontend gate
- The four synthesis answers, a paragraph each at most
- The ranked backlog
- **What you did not cover**, explicitly. A whole-system review that implies completeness while
  sampling commits the same sin as a suite that implies coverage while asserting nothing.

---

## Notes

- Fan out for the three passes; **synthesise yourself.** The synthesis is the deliverable and needs
  one head holding all three at once.
- Never fix while reviewing — a fix mid-review invalidates the ground truth you measured against.
- Findings need `file:line` and a re-runnable command. "Test coverage feels thin" is not a finding;
  *"deleted `RequireHumanAdmin`, suite stayed green"* is.
