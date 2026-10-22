---
name: factory-review
description: Run all three reviews over a diff in one pass — correctness (bugs), architecture-review (house rules), and test-review (do the tests prove the intended behaviour), plus ux-review when real UI changed — then consolidate, dedupe, adversarially verify each finding, and emit one ranked report with a PASS / CHANGES REQUESTED verdict. Report-only; makes no edits. Use to review a branch or uncommitted work without running the whole factory.
---

# factory-review — all three reviews, one verified report

Three reviews, because they catch three genuinely different failures and no one of them subsumes
the others:

| Review | Catches | Misses without the others |
|---|---|---|
| **Correctness** | Bugs, logic, security, edge cases | Code that is correct and breaks every house rule |
| **Architecture** | Layering, conventions, `AGENTS.md`/`CLAUDE.md` rules | Code that follows every rule and is wrong |
| **Test** | Tests that cannot fail, or test the wrong intent | *Everything*, once the suite is green and trusted |

The third is the one usually skipped, and it is the one that decides whether the other two mattered.
A green suite that asserts the wrong feature makes every future review lazier, because "the tests
pass" starts doing work it cannot do.

**This skill does not edit code.** For the review → fix → re-review loop use `/factory-fix`.

---

## 1. Scope

`REPO=$(git rev-parse --show-toplevel)`. Default: current branch vs its merge-base with
`origin/main`, plus uncommitted working-tree changes. `$ARGUMENTS` may name a ref, a PR, or
`working` for uncommitted only.

Establish the **test baseline** before reviewing: what was green before this change. Anything red
that was red already is not this diff's finding.

---

## 2. Run them all

Run them in parallel — they are complementary, not redundant.

**Isolation is mandatory, not implied.** Each review runs in a **fresh subagent** that has not
edited this branch and carries none of the conversation that produced the code — a context that
wrote (or fixed) any of the diff would be reviewing its own reasoning. Hand each reviewer exactly
three things: the diff scope (refs), the plan path when one exists (the statement of intent), and
the seams to probe. Nothing about how the code came to be. And no reviewer sees another reviewer's
findings before §3 — consolidation happens there, in this orchestrator, never between them.

1. **Correctness.** `/code-review` if it is model-invocable here; otherwise spawn a reviewer at high
   effort hunting real bugs in the diff: concrete failure scenarios only, verified against the code,
   with `file:line` and severity. Point it at the feature's risky seams explicitly rather than
   letting it wander, and hand it the plan path — correctness against stated intent, not just
   against plausibility. It always reasons through **failure modes** for every write, message and
   external call: the same message delivered twice, retries and throttling (429) from a dependency,
   concurrent writers (lost update), hostile input size and shape (recursion depth, quadratic time or
   memory on crafted input), a crash between two writes that must both happen, and upstream data
   moved or deleted underneath it. These found the most serious bugs in practice.

2. **Architecture.** `/architecture-review` — the 14 numbered `AGENTS.md`/`CLAUDE.md` rules plus the unnumbered
   ones. Skip re-deriving what `LayerRuleTests`, `HandlerResolutionTests`, `MigrationRegistryTests`
   and `ValidationConventionTests` already prove when the suite is green.

3. **Tests.** `/test-review` — contract coverage in all four directions, wrong-entry-point checks,
   and the mutation pass that falsifies each claim of coverage.

4. **UI (when the caller passes a `substantive` UI-triage verdict, or asks; standalone, run `/ui-triage`
   on the plan when the diff touches the frontend).**
   `/ux-review --design <design doc> --live` — reuse of the app's components, no nested dialogs,
   spacing in the app's scale, every state present, the design's acceptance checklist. Its
   blocker / should-fix findings join the consolidation below like any other.

---

## 3. Consolidate

- Merge every reviewer's result set; **dedupe** findings landing on the same `file:line` / same defect.
  The same missing gate legitimately shows up as a correctness bug *and* an untested behaviour —
  report it once, at the higher severity, mentioning both angles.
- **Honour the dispositions ledger** when the caller supplies one (`/factory-fix` maintains it
  across rounds): a finding matching a ledgered disposition is reported under that disposition —
  `fixed` expects the fix present, `dropped (pre-existing)` stays dropped, `disputed` stays
  disputed — unless this round brings concrete new evidence the disposition didn't have. The
  ledger never reaches the reviewers themselves; it applies here, at consolidation.
- **Drop pre-existing items.** Not regressions, not this diff's problem, and "fixing" them widens
  the diff and muddies the change. Note them separately if they matter.
- **Mass-Inconclusive DB tests mean Docker is down.** That is not a pass and not a finding — it is a
  broken run. Say so and stop rather than reporting a clean review over a suite that never executed.

---

## 4. Verify before reporting

For each surviving candidate confirm it is **real** (re-read the code, not just the diff) and **new**
(owned by this change). For anything non-trivial or high-severity, verify **adversarially** — try to
refute it, and keep it only if it survives.

Findings from `/test-review`'s mutation pass are already empirical: a survived mutation is a fact,
not a claim, and needs no further verification. Rank those first.

---

## 5. Report

Ranked most-severe first, each with `file:line`, severity, the defect in one line, and the concrete
fix. `ReportFindings` if available, else markdown.

Lead with the **contract-coverage and mutation tables** from `/test-review` — they are evidence
rather than opinion, and they are the part a human can check in ten seconds.

Severity:
- **blocker** — breaks layering, data integrity, an auth boundary or the migration rule; or a
  mutation survived on a permission / tenancy / money / data-loss path; or such a path is untested
- **should-fix** — a pattern violated with real downside; a `MUST` or `ORDER` contract line
  uncovered; a security test entering through the wrong path
- **nit** — style, consistency, an uncovered `EDGE` with no consequence

End with one verdict line:

- **PASS** — no blockers or should-fix items survived
- **CHANGES REQUESTED** — list them

That verdict is what `/factory-fix` and the factory conductor key on.
