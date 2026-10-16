---
name: ux-review
description: UX/UI review of a frontend diff — checks the built UI against the design doc's acceptance checklist and the app's existing components and styles (reuse, no nested dialogs, spacing in the app's scale, every state present), static checks first, then the screens rendered in Chrome at desktop and narrow widths. Report-only; emits blocker / should-fix / nit findings in the same shape as /factory-review so /factory-fix can consume them. Invoke as /ux-review [--design <design path>] [--live].
---

# ux-review — does the UI look and behave like the rest of the app?

Report-only; the fix loop belongs to `/factory-fix`. Run it in a fresh subagent that did not build
the UI.

## Scope

The frontend part of the branch diff (merge-base with the base branch) plus uncommitted changes. No
frontend files changed → `UX-REVIEW: PASS (no frontend changes)` and stop. Inputs: `--design` (the
`/ux-design` doc — without one, review against the UI kit doc and golden screens and say so).

## Pass 1 — static checks (always, first)

Turn hits **inside the diff** into findings:

- A raw primitive used where the app has a wrapper (dialog, table, search input, select, button,
  empty state, menu) → should-fix; blocker if it breaks a golden screen's consistency.
- A dialog that can open while another is open → **blocker**.
- Inline styles for non-dynamic values; hard-coded colours where the app uses tokens; sizes off the
  app's scale (compare with the golden screen) → should-fix.
- A component built on something the kit doc marks dead or banned → should-fix.
- Missing loading, empty or error state on an async surface → should-fix.
- Spec copy not used where the spec gives exact wording → should-fix.
- Animation without a reduced-motion path → nit, should-fix if it is large.
- Every acceptance-checklist item: ✅ / ❌ with `file:line` evidence.

## Pass 2 — live render (`--live`, or when the factory passes it)

Load the claude-in-chrome tools; use the running app. For each touched screen: exercise the flow the
design describes, screenshot at desktop and the narrowest width into
`<scratchpad>/factory/review-<slug>/after-*.png`, open the golden screen next to it, and judge
alignment, spacing rhythm, type sizes, control sizes, dialog widths, overflow and horizontal scroll,
focus and Esc, and console errors. Keep the tab visible (background tabs pause animation). Never
trigger native alert/confirm.

## Report

Findings, most severe first: `file:line`, severity, the defect in one line, and the concrete fix naming
the component or class to use. Then the checklist table, then the screenshots. Only findings this diff
owns — pre-existing UI debt on a touched screen is listed separately and does not count.

End with exactly one of:
- `UX-REVIEW: PASS`
- `UX-REVIEW: CHANGES REQUESTED` — then the blocker / should-fix list
