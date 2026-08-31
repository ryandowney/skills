# skills — the marketplace repo

This repo is the **single source of truth** for Ryan's cross-repo Claude Code skills, distributed
as the `downey-skills` plugin marketplace (GitHub: `ryandowney/skills`, public — pushing here
publishes to other people, not just other machines).

## Making a change to a skill

1. Edit the source under `plugins/<plugin>/skills/<skill>/`. **Never** edit an installed copy
   (`~/.claude/plugins/cache/...` or a profile's cache) or a stray per-repo copy — those are
   downstream artifacts and will be overwritten.
2. Bump `version` in that plugin's `.claude-plugin/plugin.json` (patch for wording/fixes, minor
   for new behavior). No version bump = installed copies never update.
3. `claude plugin validate .` — must pass (warnings are tolerated, errors are not).
4. Commit with a message saying what behavior changed and why; push.
5. Run `./sync.sh` — pulls latest, then updates every plugin in all three local profiles
   (claude, claude-personal, claude-skyline). New versions load in **new** sessions only.

Adding a whole plugin: create `plugins/<name>/` (`.claude-plugin/plugin.json` + `skills/...`),
add its entry to `.claude-plugin/marketplace.json`, then per profile it is a one-time
`claude plugin install <name>@downey-skills` (sync.sh only updates already-installed plugins).

## Rules

- A skill lives here, nowhere else. Repo-local copies in project repos are drift — delete them.
- Skills stay generic: they resolve repo, solution, and namespace at runtime. A skill that
  hardcodes one project's paths is not ready for this repo (project-specific skills stay in that
  project's `.claude/skills/`).
- Scripts bundled with a skill are referenced via `${CLAUDE_PLUGIN_ROOT}`, never by repo path.
- The factory skills encode hard-won discipline (reviewer isolation, contract-driven tests,
  fresh-subagent rules, dispositions ledger). Do not weaken those properties in passing edits —
  they exist because their absence caused real failures.
- `docs/` holds captured ideas and deferred plans (v0.4 pipeline, wiki). Ideas there marked
  "not scheduled" are **not** to be implemented without Ryan's explicit go — capturing was the
  point. Record significant decisions in those docs' decision logs with dates.
