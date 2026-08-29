---
name: architecture-review
description: Review a diff against the repo's house architecture rules — the 14 numbered rules in CLAUDE.md, layer call directions, ServiceProxy, handler/request name mirroring, validation-in-engine, one-migration-per-change, token-single-source, fail-closed access. Complements a correctness review (which finds bugs); this finds code that is bug-free and still wrong here. Report-only. Use before opening a PR, or standalone on any branch.
---

# architecture-review — does this follow the house rules?

A correctness review finds bugs. **This finds code that works and is still wrong**, because it
breaks a rule this repo enforces. Those are different failure modes and one review does not catch
both: a hand-rolled button renders perfectly, a Manager calling a Manager returns the right answer,
and both are review violations here.

`CLAUDE.md` is the contract. Where this skill and `CLAUDE.md` disagree, **`CLAUDE.md` wins** — read
it at the start of every run rather than trusting this summary, which can drift.

Four of the rules are already enforced by tests: `LayerRuleTests`, `HandlerResolutionTests`,
`MigrationRegistryTests`, `ValidationConventionTests`. **If the suite is green, do not spend the
review re-deriving what those already prove** — spend it on the rules no test can check.

---

## 1. Scope

Default: current branch vs its merge-base with `origin/main`, plus uncommitted work. `$ARGUMENTS`
may name a ref, a PR, or `working`. Read each changed file's full diff plus enough surrounding code
to judge it — a layering violation is invisible in a three-line hunk.

---

## 2. The rules

### Rule 1 — layer call directions. **No exceptions, ever, including when it is obviously overkill.**

```
Clients   → exactly ONE Manager per request
Managers  → Engines, Accessors, Utilities
Engines   → Accessors, Utilities
Accessors → Utilities only
Utilities → other Utilities
```

Nothing calls sideways: no Manager→Manager, no Accessor→Accessor, no Engine→Engine. **Every
operation traverses the full chain** — no layer is skipped because it "wouldn't do anything".

This is the rule most likely to be violated with good intentions. A read that is one `SELECT` today
still gets a Client, a Manager, a Validation handler and an Accessor. **A collapsed layer is a
blocker even when the code is correct and shorter.** If the diff argues in a comment that this
particular case does not need a Manager, that comment is the finding.

### Rule 2 — handlers use `ServiceProxy`, never constructor injection

Handlers are created by reflection; a constructor dependency is never supplied and fails at run
time, not compile time.

```csharp
ITenantAccessor TenantAccessor => ServiceProxy.Required<ITenantAccessor>();
```

Prefer `Required<T>()` over optional lookups so misconfiguration fails at first use rather than as a
null reference somewhere later.

### Rule 3 — request and handler names mirror exactly

`{Entity}{Operation}Request` in `...Contracts.Requests.{Path}` must resolve to
`{Entity}{Operation}Handler` in `...Handlers.{Path}`. **Check every new pair segment by segment,
both the class name and every namespace segment.** A mismatch compiles fine, passes unit tests that
call the handler directly, and 500s on that one endpoint at run time — this shipped to production in
the project this template came from and 500'd for weeks.

### Rule 4 — validation logic lives in the Validation engine

Manager handlers keep a thin `Validate` delegate; the rules themselves are engine handlers. A
manager handler with **no** `Validate` method is denied at run time. The only exemption is
`[NoValidation("reason")]`, and there are exactly three in the repo, each argued for in
`ValidationConventionTests.ExpectedExemptions`. **A fourth needs an argument, not a precedent.**

### Rule 5 — one migration per change; never edit a shipped script

Exactly one new `NNN_Description.sql` for the whole change, next sequential number (read the folder,
never assume), and **registered in the test host's script list**. A script the test host never runs
means the suite proves nothing about the new schema.

```bash
git diff --name-status <base>...HEAD -- src/7.Database/*/Scripts/
# expect at most one A, and zero M
```

A modified shipped script is a **blocker**. "Shipped" means committed — a script that is untracked
and has never been applied anywhere may still be reshaped freely.

### Rule 6 — every data-touching test runs against real Postgres

No mocked repositories, no in-memory provider. Mass-Inconclusive means Docker is down and the run is
**not a pass**.

### Rule 7 — security tests exercise `Validate()`, not just `Handle()`

A permission test that calls the handler directly bypasses the gate it claims to test. See
`/test-review`, which proves this empirically by deleting the gate and re-running.

### Rule 8 — frontend pages compose from `$lib/components`

The library is shadcn-svelte and everything under `lib/components/ui/` is **ours to edit**, not a
dependency. A new pattern is pulled from the registry into the library and exported from `index.ts`
**first**, then used. Hand-rolled buttons, cards, inputs or dialogs in a page are a violation. Pages
import from `$lib/components`, never `$lib/components/ui/...` directly, so the barrel stays the one
import surface.

### Rule 9 — design values live in exactly one file

`apps/web/src/lib/styles/tokens.css`. `app.css` bridges names onto Tailwind's `@theme` and **must
never redefine a value**. Falsifiable:

```bash
grep -E "#[0-9A-Fa-f]{6}|oklch\(|rgb\(|hsl\(" apps/web/src/app.css   # must return nothing
```

Watch for `shadcn-svelte init`, which writes a literal `:root`/`.dark` block into whichever CSS file
it is pointed at.

### Rule 10 — access resolution fails closed

Every unknown, missing or error path denies. **Never grant on an exception.** The same applies to
configuration: an unrecognised environment name is `Unknown`, and `Unknown` is treated as production
everywhere it gates something. A `catch` that returns `true`, or a `default:` that permits, is a
blocker regardless of how unreachable it looks.

### Rule 11 — scripts fail loudly

No `|| true` on a command whose success matters; never pipe a command whose exit code you need into
something that swallows it.

### Rule 12 — no deployed environment runs as `Development`

Development enables the anonymous destructive `/api/test/seed`, disables HSTS and HTTPS redirection,
allows any loopback CORS origin, and permits dev auth.

### Rule 13 — secrets never reach a log

Log `exception.Message`, not the exception object, anywhere the exception can carry a connection
string.

### Rule 14 — no connection string with a password in a deployed environment

Outside Development the app authenticates with an Entra token from its managed identity. A password
makes the API and the migration job refuse to start, naming the key.

---

## 3. Rules that are not numbered but are still rules

- **Entities do not cross layer boundaries.** Map at the edge; each layer owns its mapping registry
  in `ServiceRegistration.cs`.
- **Identity is never threaded through method parameters.** It lives in `AmbientContext`, read via
  `ContextUtility`.
- **`api.ts` matches the controllers exactly.** There is no generated contract — the controllers are
  the truth, and a route typo is a runtime 404 no compiler catches.
- **Three states on every async surface**: loading, empty, error. A page that renders nothing on
  failure is the most common defect a passing build hides.
- **Accessibility is part of done**: visible focus states, accessible names on icon-only controls,
  labels tied to inputs, every interactive list keyed. `Field` does not wire ids for you — the page
  owns `for` / `id` / `aria-describedby` / `aria-invalid`. `routes/projects/+page.svelte` is the
  worked example.
- **Machine vs human schemes stay separate.** `DefaultPolicy`/`FallbackPolicy` accept the human
  scheme only; `/mcp` opts into the credential scheme by name. Any new endpoint that blurs this is a
  blocker, and check `DevAuthHandler` too — the boundary once held everywhere except a developer's
  machine, which is where people test it.
- **Agents emit declarative JSON we validate and execute** — never SQL or HTML we store and later
  run (data-model §3).
- **The tenancy noun is Tenant, not Account** — in code. In *user-facing copy* it is "workspace".

---

## 4. Verify before reporting

For each candidate: confirm it is **real** (re-read the code, not the diff) and **new** (owned by
this change, not pre-existing). A pre-existing violation is not this diff's finding — note it
separately if it matters, but do not block on it and do not "fix" it, which only widens the diff.

For anything high-severity, verify adversarially: try to refute it, and keep it only if it survives.

---

## 5. Report

Ranked most-severe first, each with `file:line`, the rule it breaks, why that rule exists, and the
concrete fix. `ReportFindings` if available, else markdown.

- **blocker** — breaks layering, data integrity, an auth boundary, or the migration rule
- **should-fix** — violates a pattern with a real downside
- **nit** — style or consistency

End with a one-line verdict: **PASS** or **CHANGES REQUESTED**.
