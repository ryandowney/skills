---
name: ux-design
description: UX/UI planning for a feature with real UI. Reads the plan, the repo's UI kit doc if it has one, and the existing screens most like what is being built (optionally screenshotting the live app), then writes a design doc naming the exact components to reuse, layout and spacing in the app's own scale, dialog strategy, every state, copy, and an acceptance checklist the implementer builds to and /ux-review checks. Run before Gate 1 when /ui-triage says substantive. Invoke as /ux-design <plan path> [--design <output path>] [--live].
---

# ux-design — new UI that looks like the rest of the app

Goal: **new UI must look like it was built by the same person who built the rest of the app.** Reuse
first, invent last. The design doc is read by the human at Gate 1, the frontend implementer, and
`/ux-review`.

## Inputs

- `$ARGUMENTS`: the plan path; `--design <path>` (default: next to the plan, `<plan dir>/<slug>-design.md`,
  so a plan committed to the repo links a design others can open);
  `--live` to also screenshot the running app.
- **Mockups decide function, not look — unless the user says otherwise.** Spec screenshots are often
  from a future redesign. Unless told to adopt the new look, build with the app's current components
  and styles, and use the mockups only for what is on the screen, in what order, doing what. Ask at
  Gate 1 if it is unclear, and record the answer in the design.
- **Required reading, every time:**
  1. The repo's UI kit or design-system doc, if there is one (look for `docs/ui-kit.md`,
     `*/docs/*design*`, a component catalog, `app/CLAUDE.md`). Note what it says is dead or banned.
  2. The **golden screens**: the two or three existing screens most like what is being built. Open
     their source. With no kit doc, these ARE the kit: list the components, spacing and type classes
     they use.
  3. The source of every existing screen or component the plan touches.
- `--live`: load the claude-in-chrome tools, use the running app (start it only as `AGENTS.md` /
  `CLAUDE.md` says), and screenshot each touched screen at desktop and the narrowest width into
  `<scratchpad>/factory/design-<slug>/before-*.png`. If the app will not start, fall back to source and
  say so.

## Method

1. **Inventory what exists** — for every surface in the plan, the screen it lives in or resembles and
   the shared components used there.
2. **Map every new element to an existing component**, by import path. Only when nothing fits, propose
   a new one: where it lives, what it composes, and why nothing existing works.
3. **Dialog strategy, explicitly.** One purpose → one dialog. A flow that would tempt a second modal
   (pick-or-create, confirm-then-do, wizard) → one dialog with steps, an inline expansion, or a
   drawer. Write "No dialog opens on top of another dialog" into the design. Destructive actions use
   the app's existing confirmation pattern.
4. **Size and space in the app's own scale**, copied from the golden screen being matched — concrete
   classes, not habits.
5. **States**: empty, loading, error with retry, permission-gated (hidden versus disabled), zero search
   results, long text, narrow screens.
6. **Copy**: titles, buttons, empty states, notices — in the app's voice and the spec's exact words
   where the spec gives them.
7. **Motion**: what animates, how long, and that it is off under reduced motion.
8. **Accessibility**: focus into dialogs and back out, Esc closes, labelled controls, keyboard paths.

## Output — the design doc

```
# Design: <feature>   (plan: <path>)
## Summary            — 3–5 lines: surfaces that change, the headline reuse decisions, mockup-vs-current-style rule
## Screens
### <Screen or dialog>   (existing file, or NEW → <path>)
- Golden reference: <file> — copy its <header/toolbar/list/footer>
- Wireframe (ascii or a table)
- Components (import path → role → key props)
- Layout & sizing (concrete classes)
- Dialog strategy
- States: empty / loading / error / gated / narrow / long text
- Copy
- Interactions (what calls what; refetch vs optimistic; notices)
## New components — name, location, composition, why nothing existing fits
## Acceptance checklist — 8–20 binary, checkable items /ux-review verifies (grep-able or observable)
## Open questions for Gate 1 (at most 5)
```

Keep it dense. Return the design path and the acceptance checklist.
