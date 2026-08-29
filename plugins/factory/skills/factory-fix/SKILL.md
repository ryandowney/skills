---
name: factory-fix
description: Review-and-fix loop — runs /factory-review, fixes every confirmed blocker and should-fix, re-runs the affected tests, then re-reviews, repeating until the verdict is PASS or a round cap. Takes a branch from "written" to "review-clean". This is the skill the factory uses for its review stage; it edits code but does not commit or open PRs.
---

# factory-fix — review → fix → re-review until clean

Wraps `/factory-review` (the report) in a fix loop. Default cap: **3 rounds**. If it is not PASS
after that, **stop and report what remains** rather than looping — a third failed round means
something needs a decision, not another attempt.

---

## Loop

1. **Review.** `/factory-review` over the scope (current branch by default; `$ARGUMENTS` honoured
   the same way). Read the verdict and findings.

2. **PASS → done.** Report the clean verdict and stop.

3. **Fix** every confirmed **blocker** and **should-fix** (skip nits unless trivial):

   - Small set → edit directly. Large and independent → parallel Sonnet fix agents, one per finding
     or per file, each given the finding, the fix, and the house rules.
   - **Decide the fixes yourself.** Hand agents exact resolutions; do not delegate design.
   - **Only fix what this diff owns.** A finding that turns out to be pre-existing gets dropped, not
     fixed — fixing it widens the diff and muddies the change.
   - **Do not fix one violation by introducing another.** Every fix still obeys `CLAUDE.md` and
     `/architecture-review`.

   **Test findings are fixed by writing tests, never by weakening them.** A survived mutation means
   the test could not fail; the fix is a test that *can*, via `/test-write` from the handler's
   contract. Deleting the assertion, loosening it, or adding `[Ignore]` is not a fix — it is the
   defect with the evidence removed. If a `MUST` line has no test, write the test; if the contract
   line itself is wrong, that is a design question — surface it rather than quietly editing intent
   to match the code.

4. **Re-test the touched areas.**
   - Backend: `dotnet build "$SLN"`, then targeted `dotnet test --filter "FullyQualifiedName~<area>"`.
     Mass-Inconclusive means Docker is down — that is not a pass.
   - Frontend: `npm run check`, `npm run build`, and any relevant Playwright spec.

5. **Re-review.** Back to step 1 until PASS or the cap.

---

## Output

Per round: what was fixed and what changed. End with the final `/factory-review` verdict (**PASS**,
or the residual **CHANGES REQUESTED** list if the cap was hit) and every file touched during the
loop.

---

## Notes

- This skill **edits** code, unlike `/factory-review`, which is report-only.
- It does **not** commit, push, or open PRs — that is `/factory-ship`.
- If a fix needs a design decision, or touches something risky or destructive, **stop and surface
  it** rather than guessing.
- Watch for the loop that never converges: the same finding reappearing in round 3 usually means the
  fix is addressing a symptom. Say that instead of trying a fourth time.
