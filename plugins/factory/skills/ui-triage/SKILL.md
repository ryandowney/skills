---
name: ui-triage
description: Classify how much user-facing UI a plan or spec involves — none / trivial / substantive — so the factory knows whether to run /ux-design before Gate 1 and /ux-review after the build. Cheap and rule-based. Invoke as /ui-triage <plan or spec path>.
---

# ui-triage — does this work need the UX agents?

Reads the plan (or spec) and returns one classification. The factory routes on it: `none` and
`trivial` skip the UX branch; `substantive` runs `/ux-design` before Gate 1 and `/ux-review` after
the build.

## Procedure

1. Find the frontend: `AGENTS.md` / `CLAUDE.md` names it (`apps/web`, `app/`, `webapp/`, …). Read
   `$ARGUMENTS`, and `git diff --stat` for any working diff already there.
2. Apply the rules **in order**; the first match wins.

| Verdict | Rule |
|---|---|
| **none** | The plan touches no frontend files (API only, migrations, tests, docs). |
| **trivial** | Every frontend change is one of: a field added to or renamed in an **existing** form using the inputs already there; a column on an **existing** table; copy, label or tooltip; wiring an existing component to a new endpoint with no layout change; an accessibility or lint fix; tests only. |
| **substantive** | Anything else — a new page, route or tab; a new dialog, drawer or menu; a new list, table or grid; a multi-step flow; a search or filter bar; navigation changes; anything the spec calls a screen, modal, workflow, wizard, picker, panel, inbox or redesign. |

3. Torn between `trivial` and `substantive`? Choose **substantive** — the UX branch is cheap next to
   reworking a screen.

## Output (exact shape — the factory parses it)

```
UI-TRIAGE: <none|trivial|substantive>
touched-screens: <existing screens/components affected, or "-">
new-surfaces: <new screens/dialogs/flows, or "-">
reason: <one sentence>
```
