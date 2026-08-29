---
name: test-review
description: Adversarially audit a diff's tests against the INTENDED behaviour of each handler, not against its implementation. Checks the handler CONTRACT block for coverage in both directions, catches tests that exercise the wrong entry point, and falsifies each claim by mutating the production code to prove the test can actually fail. Report-only; every mutation is reverted. Use as the factory's test gate or standalone on any branch.
---

# test-review — do the tests prove the INTENDED behaviour?

The failure this exists to catch is not a missing test. It is a suite that is large, green, and
asserting the wrong feature.

That happens whenever tests are written from the implementation. A test derived from the code can
only ever prove *the code does what the code does*, so it passes just as happily when the handler is
subtly wrong — and it survives mutation testing perfectly, because it is faithfully coupled to
behaviour nobody ever asked for. **Mutation proves a test is real. It does not prove the test is
right.** Both questions have to be asked, and only one of them can be answered by reading tests.

So the independent source of truth is the handler's **`CONTRACT` block** (`CLAUDE.md` → Handler
contracts): the `MUST` / `EDGE` / `ORDER` / `NEVER` lines that say what the handler was *supposed*
to do. Everything below compares tests to that, not to the code.

**Posture: assume the tests are decoration until proven otherwise.** The implementer already
believes they are good; that opinion is in the diff and repeating it adds nothing.

**Report-only.** Mutations are temporary and every one must be reverted.

---

## 1. Scope, and get the contracts first

`REPO=$(git rev-parse --show-toplevel)`. Default scope: current branch vs its merge-base with
`origin/main`, plus uncommitted work. `$ARGUMENTS` may name a ref, a PR, `working`, or a path.

For every Manager and Validation handler in the diff, read its `CONTRACT` block **before reading a
single test**. Reading tests first anchors you to what was covered and makes the gap invisible.

**A handler with no contract is itself a finding** (`missing-contract`, should-fix at least). Do not
proceed to invent one from its implementation and then check tests against your invention — that
reintroduces exactly the circularity this skill exists to break. Report it and audit what you can.

**A contract that could only have come from the code is worth saying out loud.** When the change
adds a contract to a pre-existing handler, check it against `docs/` or the spec. If the only
available source was the implementation, say so: that contract confirms nothing by itself, and a
human should look at whether the stated intent is the intended one.

---

## 2. Four directions, and they catch different things

Build the matrix of **contract lines × tests**. Every cell is one of four findings.

### 2.1 Contract line → no test  (**the main event**)

Each `MUST`, `EDGE`, `ORDER` and `NEVER` line needs at least one test that would fail if that line
were violated. Walk them one at a time.

`EDGE` and `ORDER` are where real suites are thin, so give them disproportionate attention:

- `EDGE` lines are the cases people skip because they feel unlikely — a name freed by revocation, a
  duplicate scope, an empty collection, a boundary equal to the limit.
- `ORDER` lines are almost never tested, because a swapped order still returns *an* error and the
  test still goes green. The test has to assert **which** error, and that it stopped. An access
  check that runs second instead of first leaks which names exist to a caller with no right to know
  — and every naive test passes.

Severity by consequence, not by count. A missing test on a permission gate and a missing test on a
display string are not equals, and listing them as equals buries the one that matters.

### 2.2 Test → no contract line

A test asserting something the contract never claimed. Usually one of:

- **Implementation trivia** — asserting the private shape of something, so the test breaks on every
  refactor and proves nothing about behaviour. Should-fix.
- **Real undeclared behaviour** — the handler genuinely does this and the contract omits it. The fix
  is a contract line, not deleting the test. Worth surfacing, because undeclared behaviour is how
  scope creep enters unnoticed.

### 2.3 Code behaviour → no contract line

Read the handler for branches, refusals and side effects the contract does not mention. Each is
either undeclared behaviour or scope creep, and both want a human. This is the direction that
catches *the implementer did more than was asked* — invisible to any test-only review.

### 2.4 Test → wrong entry point  (**highest yield, seconds to run**)

`CLAUDE.md` rule 7: security tests exercise `Validate()`, not just `Handle()`. A permission test that
calls the handler directly bypasses the gate it claims to test and passes forever.

The manager runs `Validate` then `Handle`. A test calling only `Handle` has tested the happy path of
a function whose guard never ran. Confirm every test touching permission, tenancy or validation
enters through **the same path production takes**.

Falsify it directly — **delete the gate and run the suite.** If it stays green, every test on that
gate is decoration. Run this on every new gate; nothing else here has the same yield per second.

---

## 3. The mutation pass — falsify what §2 says is covered

For every contract line §2.1 marked as covered, prove the test can fail. A claim of coverage is not
coverage.

```bash
# 1. mutate ONE behaviour in PRODUCTION code (never in a test)
# 2. run only the tests claiming to cover it
~/.dotnet/dotnet test "$SLN" --filter "FullyQualifiedName~<TestClass>"
# 3. revert immediately
```

- **Test fails** → coverage is real. Move on; this needs no comment in the report.
- **Test still passes** → the coverage is fiction. **Finding**, phrased so anyone can re-run it:
  *"deleted `RequireHumanAdmin` in `ApiCredentialCreateValidationHandler`; `ApiCredentialTests`
  stayed green."* That sentence is the finding — not an opinion anyone can argue with.
- **Test errors instead of failing** (compile break, null ref before the assertion) → the mutation
  was too coarse. Make a smaller one. A compile error proves nothing about assertions.

Choose mutations that correspond to **real mistakes**, and derive them from the contract keyword:

| Contract line | Mutation that reveals a hollow test |
|---|---|
| `MUST` refuse a non-admin | Delete the check; or make it always grant |
| `MUST` refuse unknown input | Return valid unconditionally |
| `MUST` scope to tenant | Drop the `tenant_id` filter |
| `EDGE` boundary at the limit | Flip `>=` to `>` |
| `EDGE` defined answer for empty | Return early on empty |
| `ORDER` access checked first | **Swap the two checks** — the test must still fail |
| `NEVER` leaks the token | Add it to the read DTO |
| fail-closed default | Flip the default to allow |

**Budget.** Mutation is the expensive part. Spend it where being wrong is expensive: permissions,
money, data loss, tenancy, authentication. Then whatever the plan flagged as risky. Then boundaries
and error paths. A getter needs no mutation, and mutating it burns budget that belonged to the gate.

**State what you did not do.** If you mutated 6 of 14 covered lines, say so and name the 8 you left.
A review that implies total coverage while sampling commits the exact sin it exists to catch.

---

## 4. The rest — read the tests now

Weaker evidence than a surviving mutation, so rank below it.

**Hollow assertions.** Ask: *what change to production code would make this fail?* If nothing, it is
decoration. Recurring shapes: asserting non-null on something always non-null; re-asserting a value
the test just wrote; asserting a count of rows the test itself seeded; `ShouldNotThrow()` as the
only assertion; a `try`/`catch` that swallows the failure; asserting on a mock instead of a result.

**FK-honest seeds.** Real parent rows, not fabricated GUIDs. A seed that could not exist in the real
schema produces a test that passes against a database that could never exist.

**Real Postgres** (rule 6). A mocked repository tests the mock. Mass-Inconclusive means **Docker is
down and the run is not a pass** — say so loudly rather than reporting green.

**Negative cases exist and bite.** A rule tested only where it permits is untested.

**Test names describe behaviour**, so a CI failure names the broken thing, not a method.

**Frontend.** `npm run check` and `npm run build` prove compilation, not appearance. For UI changes,
confirm **empty**, **loading** and **error** states are exercised — a page that renders nothing on
failure is the most common defect a passing build hides.

---

## 5. Report

Lead with the two tables that are **evidence** rather than judgement. Findings ranked most-severe
first, each with `file:line`, severity, the defect in one line, the concrete fix. `ReportFindings`
if available.

```
CONTRACT COVERAGE — ApiCredentialCreateValidationHandler
──────────────────────────────────────────────────────────────────────────────────
MUST   refuse non-admin caller               ✓ ApiCredentialTests.Non_admin_denied
MUST   refuse duplicate live name            ✓ ..._duplicate_name_denied
MUST   refuse unknown kind before scopes     ✗ NO TEST
EDGE   name freed by revocation is reusable  ✗ NO TEST
ORDER  access checked first                  ✗ NO TEST  (leaks name existence)
NEVER  raw token on any later read           ✓ ..._token_not_returned_on_list

MUTATION RESULTS                                        mutated 6 of 11 covered lines
──────────────────────────────────────────────────────────────────────────────────
✓ caught    deleted tenant filter in ObjectTypeFilterHandler      → 3 tests red
✓ caught    flipped fail-closed default in AccessResolver         → 1 test red
✗ SURVIVED  deleted RequireHumanAdmin in ApiCredentialCreate      → suite stayed GREEN
NOT MUTATED 5 lines — display strings, mappings, nav ordering
```

Severity means something specific here:

- **blocker** — a mutation survived on a permission, tenancy, money or data-loss path; or such a
  path has no test at all; or a handler in the diff has no contract. The suite asserts something
  untrue about safety.
- **should-fix** — a mutation survived elsewhere; a `MUST`/`ORDER` line is uncovered; a security
  test enters through the wrong path; a test asserts implementation trivia.
- **nit** — naming, duplication, an uncovered `EDGE` with no real consequence.

End with one verdict line: **PASS** or **CHANGES REQUESTED**. That line is what `/factory-fix` and
the factory key on.

---

## Notes

- **Revert every mutation.** Before reporting, `git status` must show exactly the files the diff
  already touched. A mutation left behind is a production defect introduced by the reviewer.
- Never mutate a test to make a point. Mutations go in production code only.
- If a mutation will not revert cleanly, **stop and say so immediately** rather than continuing.
- This skill reports; it does not fix. `/factory-fix` owns the loop that edits.
- Standalone: `/test-review`, or `/test-review working`.
