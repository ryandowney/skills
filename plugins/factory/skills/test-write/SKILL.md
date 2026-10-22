---
name: test-write
description: Write tests for a handler from its CONTRACT block rather than from its implementation — derive the case list from the stated intent first, then read the code only to learn how to invoke it. Produces handler-specific tests covering every MUST, EDGE, ORDER and NEVER line, entering through the same path production takes. Use when adding tests to new or existing handlers, or as the factory's test stage.
---

# test-write — tests derived from intent, not from code

Most useless test suites are written the same way: open the handler, read what it does, assert that
it does it. The result is faithful, green, and proves nothing — it cannot fail when the handler is
wrong, because it was copied *from* the handler. It also survives mutation testing perfectly, which
is what makes it so hard to spot later.

This skill exists to break that loop with one rule:

> **Write the case list from the `CONTRACT` block before you read the handler body.**

Read the implementation afterwards, and only to learn *how to invoke it* — the request type, the
base class, the seed helpers. Never to decide *what to assert*.

---

## 1. Get the contract

Every Manager and Validation handler carries one (`AGENTS.md`/`CLAUDE.md` → Handler contracts): `MUST`, `EDGE`,
`ORDER` and `NEVER` lines stating what the handler was supposed to do.

**No contract? Write it first, and do not derive it from the handler body.** Ground it in
`docs/data-model.md`, the roadmap, or the spec, then have it reviewed as part of the change. If the
only source available is the implementation, say so explicitly when you hand the work back — a
contract reverse-engineered from code confirms nothing, and a human needs to confirm the stated
intent is the intended one before tests are built on it.

That step is not bureaucracy. It is the only thing standing between "we have tests" and "we have
tests that could catch a mistake".

---

## 2. Derive the case list — before opening the handler

One line at a time, mechanically:

| Line | Cases it owes |
|---|---|
| `MUST <do X>` | The positive case, **and** the negative: it does not happen when it should not |
| `MUST refuse <Y>` | A refusal case asserting **which** error, plus a case that is correctly allowed |
| `EDGE <Z>` | One case for exactly that input, asserting the defined answer |
| `ORDER a before b` | A case where **both** would fail, asserting it stops at `a` |
| `NEVER <leak>` | A case asserting **absence** — the field is missing, the row is not written |

Two that get skipped and should not:

**`ORDER` lines.** Swapped order still produces *an* error, so a naive test stays green. Assert the
specific error and that it stopped there. When the ordering exists to prevent information disclosure
— access checked before name-uniqueness, so a stranger cannot learn which names exist — the test
must assert the caller learned nothing, not merely that a call failed.

**`NEVER` lines.** Asserting absence feels redundant and is the only thing that catches a leak added
later. `NEVER returns the raw token on a read` is a real test, and it is the one that fails the day
somebody adds the field to a DTO for debugging.

Write the list out before touching the code. If a contract line yields no obvious case, that is a
signal the line is vague — fix the contract.

---

## 3. Now read the code, for mechanics only

Discover, never invent:

- the real base class — `PostgresTestBase` for handler tests, `ApiTestBase` for routes and gates
- the actual seed helpers in the test project
- the real request/response contract types

Inventing a helper that does not exist produces a compile error; inventing a *seed shape* that does
not exist produces something worse — a passing test against a schema that could never exist.

---

## 4. Write them

**Enter through the same path production takes.** The manager runs `Validate` then `Handle`. A
permission test calling only `Handle` has tested the happy path of a function whose guard never ran
— rule 7, and the defect this repo has actually shipped. For anything guarding a permission, money
or data loss, **call `Validate()`**.

**Seeds are FK-honest.** Insert real parent rows. Fabricated GUIDs give you a green test against an
impossible database.

**Real Postgres** (rule 6). No mocked repositories, no in-memory provider. Mass-Inconclusive means
Docker is down and the run is **not** a pass.

**Assert the specific thing.** The error code and the field, not merely "there was an error". A test
asserting *some* failure passes when the handler fails for the wrong reason — which is precisely the
bug you were trying to catch.

**Name for behaviour**, so a CI failure names the broken thing:
`A_non_admin_cannot_mint_a_credential`, not `TestCreate2`.

**One behaviour per test.** A test asserting five things reports one failure and hides four.

---

## 5. Falsify your own work before handing it over

Non-negotiable, and it takes a minute per test. For each test you just wrote, **break the production
code it covers and confirm it goes red.**

```bash
# mutate the behaviour in PRODUCTION code, run the narrow selection, revert
~/.dotnet/dotnet test "$SLN" --filter "FullyQualifiedName~<TestClass>"
```

A test that stays green while the thing it covers is sabotaged is not a weak test — it is a false
claim of coverage, and it is worse than nothing because it stops anyone looking again.

Do this for every `MUST` and `ORDER` line at minimum. **Revert every mutation**; before you finish,
`git status` must show only the files you intended to add or change.

Then run the suite the tests live in and confirm the count moved by exactly the number of tests you
added. Inside a factory lane that is the lane's affected-test command only; the full suites run at
integration. Send the output to a log and read the summary and failures with `tail` / `grep`.

**A red test is not always this code's fault.** Inside a factory lane, classify each one: red against
the code under test is a finding; red only because it reaches another lane's code that is still a
Phase 0 stub is **deferred** — list it with the lane it waits on, leave it as written, and integration
must show it green.

---

## 6. Report

- Contract lines → the test now covering each, and any line still uncovered with the reason
- Which tests you falsified, and which mutation each survived
- Anything the contract left ambiguous, phrased as a question for a human
- The suite count before and after

If you had to write the contract yourself, **say where the intent came from** — and say plainly if
the only source was the implementation.

---

## Notes

- Frontend has no unit tests; the gate is `npm run check` + `npm run build`, plus Playwright for
  critical journeys. UI changes still owe **empty**, **loading** and **error** states.
- Do not weaken a test to make it pass. A failing new test is information — read it.
- If a behaviour has no testable seam, that is usually a design problem: say so rather than testing
  around it.
- `/test-review` audits the result of this skill, adversarially and from the same contract.
