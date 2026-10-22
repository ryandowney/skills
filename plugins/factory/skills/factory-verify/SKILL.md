---
name: factory-verify
description: Final verification — click through EVERY path of a feature or bug fix in a real browser against the running app, record a GIF per flow, cross-check the database, and produce a pass/fail matrix with evidence. Stores the evidence in a per-branch folder outside the repo and posts it to the PR and the issue (GitHub Issues, or Linear when the repo allows tracker writes). Fails are fixed, given a regression test proven to fail on the old code, and re-verified live. Use as the factory's last stage before handoff, for bug fixes as well as features, or standalone on any branch.
---

# factory-verify — every path, clicked, recorded, posted

Green suites prove the code does what the tests say. This proves the **product** does what the spec
says, in the browser a person will use, and leaves evidence a reviewer can watch in thirty seconds
instead of taking on trust.

`$ARGUMENTS`: a plan or spec path, `bug-before <issue/description>` (record the reproduction before
any fix), or `bug <issue/description>` (verify the fix). With no argument: the current branch, and the
plan the caller names (the factory passes it; standalone, ask).

`REPO=$(git rev-parse --show-toplevel)`, `BRANCH=$(git branch --show-current)`,
`SLUG` = the branch with `/` → `-`.

---

## 1. The path matrix — written before anything is clicked

One numbered file, `<evidence dir>/matrix.md`, every line a path a user can take and the outcome it
must have, each tagged with its source (spec, a recorded decision, the plan). Later sources override
earlier ones; say so where they differ. When the plan already has a **Verification matrix** section
(the factory plan does), start from it and extend it with the diff — never shrink it.

Cover, for every surface the diff touches:

- **Each flow end to end** — create → read → edit every field → each state change → delete.
- **Each action from each place it is offered** — list row, detail pane, menu, keyboard.
- **States** — loading, empty, error (with recovery), zero search results, long text, many rows.
- **Validation** — required fields, limits, refused input, cancel / Esc / backdrop closing without saving.
- **Who** — a second user, permissions, "mine" versus "everyone".
- **Navigation** — deep links, stale links, back/forward, refresh, links between surfaces.
- **Consistency** — every count, badge and list that should agree after each action.
- **Layout** — desktop and the narrowest width the browser allows; nothing overflows.
- **Accessibility** — keyboard-only path, focus into and back out of dialogs, labels.
- **Motion** — animations finish, leave nothing behind, and respect reduced motion.

Bug-fix modes: `bug-before` records the reproduction on the branch **before any change** — a
`00-before.gif` showing the defect. `bug` then verifies the matrix: the reproduction steps now
behaving (`NN-after.gif`), the fixed behaviour, and the neighbouring paths the fix could disturb.

## 2. Evidence directory

Default: `~/factory-evidence/<repo name>/<SLUG>/` — outside every checkout, so it survives worktree
removal and never ships in a build. A repo can override it with a line in `AGENTS.md` / `CLAUDE.md`:
`Factory evidence: <path>` (for example `docs/verification/` to keep evidence in the branch itself —
only do that when the repo says so; GIFs bloat history forever).

```
<evidence dir>/
  README.md     the report: matrix table with verdicts, each row linking its GIF / screenshot
  matrix.md     the numbered paths (step 1)
  gifs/         NN-<flow>.gif, one per flow
  flows/        the Playwright script per flow (local; rerunnable)
  video/ frames/  raw recordings the GIFs are made from (local)
  screens/      NN-<state>.png for single-state checks
  data.md       what was seeded, every DB cross-check query and its result, what was cleaned up
```

## 3. Environment

- Reuse a running stack; start one only the way the repo's `AGENTS.md` / `CLAUDE.md` says. Never stop
  services other worktrees or sessions share.
- **Never hardcode a port or URL.** Derive `baseURL` and the API address for *this* worktree from the
  repo's own env / port mechanism (its dev scripts, env files, per-worktree instance settings) —
  another run may be up beside this one, and a fixed port clicks through someone else's server. Write
  helper scripts only under this branch's evidence dir (`flows/`), never at a shared name in `/tmp`.
- **Local stack only.** Seed, edit and query only the local development database this branch runs
  against — never a shared, staging or production database, whatever credentials are lying around.
- Seed through the UI where the matrix exercises creation; seed through the database or API only to
  *set up* a state (overdue, closed, someone else's). Prefix everything you create (`QA-<slug>-`) so
  cleanup is exact.
- Know how to read that database directly — every write the UI claims is checked against it.

## 4. Click through it

**Recorder: Playwright, when the repo has it** (its `node_modules` has `playwright` or `@playwright/test`).
It does what the Chrome extension cannot: a true 390 px width, reduced motion switched on, a page that is
never a paused background tab, and a video of every flow. Use the Chrome extension (below) only when the
repo has no Playwright, when Playwright cannot sign in, or for a quick exploratory look.

**Delegate the click-through to one subagent** with the matrix, the environment notes and the rules
below, so thousands of lines of page output stay out of the orchestrator's context. It returns the
verdict table; it changes no code.

**Playwright, one script per flow**, written in the evidence dir's `flows/` (never the repo), using the
repo's own copy so nothing is installed:

```js
import { createRequire } from 'node:module'
const { chromium } = createRequire('<app dir>/package.json')('playwright')   // or '@playwright/test'
const ctx = await (await chromium.launch()).newContext({
  baseURL, viewport: { width, height }, reducedMotion,           // e.g. 1280 / 390, 'reduce' / 'no-preference'
  storageState,                                                  // the repo's e2e sign-in state, if it has one
  recordVideo: { dir: '<evidence>/video/NN-flow', size: { width, height } } })
const page = await ctx.newPage()
let n = 0; const shot = () => page.screenshot({ path: `<evidence>/frames/NN-flow/${String(++n).padStart(2, '0')}.png` })
// goto → shot() → each step → shot() → assert with page.evaluate / expect-style checks → ctx.close()
```

- **Sign in** the way the repo's e2e suite does (its global setup, saved storage state, or dev-auth
  bypass). Never type a real person's password. No way in → fall back to the extension, which uses
  the signed-in browser.
- **GIF per flow**: with ffmpeg installed, convert the video
  (`ffmpeg -i in.webm -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" NN-flow.gif`);
  otherwise stitch the step screenshots: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/factory-verify/frames-to-gif.py <frames dir> gifs/NN-flow.gif`
  (needs Pillow). Playwright's bundled ffmpeg can only *write* video, not convert it. Keep the `.webm`
  videos locally next to the GIFs; they are not published.
- **Run each flow at every width and motion setting the matrix asks for** — at least desktop, and 390 px
  with `reducedMotion: 'reduce'` when the matrix has narrow or motion lines. Those lines are then PASS
  or FAIL, not SKIPPED.
- **Prove motion with numbers**: sample the element in `page.evaluate` every animation frame, and
  assert it ends up exactly once, in the right place, with nothing still animating
  (`document.getAnimations().length === 0`).
- **Error states**: `page.route('**/the-url', r => r.abort())` (or `fulfill` with a 500) for one call,
  then `unroute`. Never stop the API or a container to get an error.
- **Console errors**: collect `page.on('console')` and `page.on('pageerror')` per flow; any error fails the line.
- **Overflow**: at each width, `document.documentElement.scrollWidth > innerWidth` is a FAIL (say if it
  is pre-existing on the base branch).

**Chrome extension (fallback)**: claude-in-chrome. Load its tools in one `ToolSearch` call (tabs_context_mcp,
tabs_create_mcp, navigate, computer, find, read_page, javascript_tool, browser_batch, gif_creator,
resize_window, read_console_messages, tabs_close_mcp). Create your own tab; batch predictable steps.

- **One GIF per flow.** `gif_creator start_recording` → screenshot → the steps → screenshot →
  `stop_recording` → `export` with `download: true` and `filename: "NN-<flow>.gif"`. A GIF holds about
  50 frames, so a flow that needs more is two flows. Exports land in the browser's downloads folder —
  move them into `gifs/` afterwards.
  If the shell cannot read `~/Downloads` ("Operation not permitted" — macOS privacy controls), have
  Finder copy them: `osascript -e 'tell application "Finder" to duplicate {POSIX file "<file>"} to
  POSIX file "<gifs dir>" with replacing'`.
- **The tab must be visible.** Chrome pauses animations and timers in a background tab
  (`document.visibilityState === "hidden"`), which makes motion look broken and waits hang.
- **Motion**: trigger the action from `javascript_tool` and sample positions every animation frame.
- **Never trigger native `alert` / `confirm`** — they freeze the extension.
- **Error states**: override `window.fetch` in the page to fail one URL, then restore it.
- **Width**: `resize_window` to the narrowest the browser allows (often 500 px on macOS) and say which
  width was tested; 390 px and reduced motion need Playwright.

Both recorders:

- **What neither can do** (OS-level settings beyond reduced motion, push notifications, real email) is
  verified from the code and marked **SKIPPED — code-verified**, with the file and line. Never PASS.
- Every write the UI claims is checked in the database, and the value goes in `data.md`.

Verdicts: **PASS**, **FAIL** (repro, expected, actual, likely file), **PARTIAL** (what part is
unverified and why), **SKIPPED** (with the reason). Every matrix line gets one.

## 5. Fix what failed (inside the factory; report-only when standalone)

For each FAIL, and each PARTIAL that is a real defect:

1. Fix it on the branch, add a regression test, and **commit** (`FIX=$(git rev-parse HEAD)`).
2. **Prove the test fails on the old code**: for each production file the fix changed,
   `git show $FIX^:<file> > <file>`; run the test (it must go red); then `git checkout -- <file>` to
   restore the fix. Never do this on uncommitted work — the overwrite would destroy it. A test that
   passes on the old code does not cover the bug: say so instead of claiming coverage. Some bugs only
   reproduce in a real browser (router timing, focus, animation): swap the old file in the same way,
   reproduce it live, restore, and record that instead.
3. Run the tests the fix touches (not the full suites — `/factory-ship` and CI run those once), then
   **re-verify that path live** and re-record its GIF.
4. Inside the factory, the fixes then go through `/factory-fix` (fresh reviewers), and are pushed with
   CI re-checked, before Gate 2.

Things outside the work (pre-existing bugs, unrelated screens) are reported, not fixed.

## 6. Clean up

Delete every `QA-<slug>-` row and revert every direct DB edit (record both in `data.md`). Close the
tabs and browsers you opened. Leave the stack as you found it.

## 7. Publish the evidence

Write `README.md`: one line of context, the verdict counts, the matrix table (path · verdict ·
evidence link), the fixes made, and what is not verified and why.

Then post it where the work is reviewed. **Read the repo's rules first** (`AGENTS.md` / `CLAUDE.md`,
stored memory): some repos forbid tracker writes, or forbid issue identifiers in anything GitHub can
see. Those rules win over this section.

**Publish only** `README.md`, `matrix.md`, `gifs/` and `screens/`. `data.md` (queries, ids, results)
stays local.

**GitHub (PR and, when the work has one, its issue).** Comments cannot take uploads through the API,
so GIFs go on an orphan evidence branch in the same repo, never on the feature branch (needs git ≥ 2.42):

```bash
set -euo pipefail
EV=factory-evidence; T="$(mktemp -d)/ev"; SRC="<evidence dir>"
if git fetch -q origin "+refs/heads/$EV:refs/remotes/origin/$EV" 2>/dev/null; then
  git worktree add -q --detach "$T" "origin/$EV"          # detached: never fights another worktree for the branch
else
  git worktree add -q --orphan -b "$EV-$SLUG" "$T"        # first ever publish
fi
trap 'git worktree remove --force "$T"; git branch -D "$EV-$SLUG" 2>/dev/null || true' EXIT
mkdir -p "$T/$SLUG"
cp "$SRC/README.md" "$SRC/matrix.md" "$T/$SLUG/"
for d in gifs screens; do [ -d "$SRC/$d" ] && cp -R "$SRC/$d" "$T/$SLUG/"; done
git -C "$T" add "$SLUG"
git -C "$T" commit -qm "Verification evidence for $BRANCH [skip ci]"
for i in 1 2 3; do                                       # another branch may have published meanwhile
  git -C "$T" push -q origin "HEAD:refs/heads/$EV" && break
  git -C "$T" pull -q --rebase origin "$EV"
done
```

Embed each GIF as `![NN flow](https://github.com/<owner>/<repo>/blob/factory-evidence/<SLUG>/gifs/NN-flow.gif?raw=true)`
in a comment (`gh pr comment`, `gh issue comment`) holding the README table. The images render only
for people who can read the repo. **On a public repo the evidence is public and permanent**: confirm
with the user before pushing, and make sure only seeded test data appears in the GIFs.

**Linear**, only when the repo allows tracker writes: upload each GIF with the Linear MCP
(`prepare_attachment_upload` → PUT the file → `create_attachment_from_upload`) on the issue, then add a
comment with the README table. When tracker writes are not allowed, say which issue the evidence
belongs to and where it lives, and leave the posting to the user.

## Output

The verdict counts, the matrix table, the fixes made (each with its regression-test proof), what is
not verified and why, the evidence directory, and the comment / attachment links.
