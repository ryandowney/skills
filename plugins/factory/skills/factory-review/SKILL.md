---
name: factory-review
description: Run all three reviews over a diff in one pass — correctness (bugs), architecture-review (house rules), and test-review (do the tests prove the intended behaviour) — then consolidate, dedupe, adversarially verify each finding, and emit one ranked report with a PASS / CHANGES REQUESTED verdict. Report-only; makes no edits. Use to review a branch or uncommitted work without running the whole factory.
---

# factory-review — all three reviews, one verified report

Three reviews, because they catch three genuinely different failures and no one of them subsumes
the others:

| Review | Catches | Misses without the others |
|---|---|---|
| **Correctness** | Bugs, logic, security, edge cases | Code that is correct and breaks every house rule |
| **Architecture** | Layering, conventions, `CLAUDE.md` rules | Code that follows every rule and is wrong |
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

## 2. Run all three

Run them in parallel — they are complementary, not redundant.

1. **Correctness.** `/code-review` if it is model-invocable here; otherwise spawn a reviewer at high
   effort hunting real bugs in the diff: concrete failure scenarios only, verified against the code,
   with `file:line` and severity. Point it at the feature's risky seams explicitly rather than
   letting it wander.

2. **Architecture.** `/architecture-review` — the 14 numbered `CLAUDE.md` rules plus the unnumbered
   ones. Skip re-deriving what `LayerRuleTests`, `HandlerResolutionTests`, `MigrationRegistryTests`
   and `ValidationConventionTests` already prove when the suite is green.

3. **Tests.** `/test-review` — contract coverage in all four directions, wrong-entry-point checks,
   and the mutation pass that falsifies each claim of coverage.

---

## 3. Consolidate

- Merge all three result sets; **dedupe** findings landing on the same `file:line` / same defect.
  The same missing gate legitimately shows up as a correctness bug *and* an untested behaviour —
  report it once, at the higher severity, mentioning both angles.
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
