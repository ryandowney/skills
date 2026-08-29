# downey-skills

Single source of truth for my cross-repo Claude Code skills, distributed as a plugin marketplace.

## Use (once per machine)

```
/plugin marketplace add /Users/ryandowney/workspace/personal/skills
/plugin install flow@downey-skills
```

(Or push this repo to GitHub and `add` it by `owner/repo` for other machines.)

## Update a skill

1. Edit the skill under `plugins/<name>/skills/`.
2. Bump `version` in that plugin's `.claude-plugin/plugin.json`.
3. Commit, then run `./sync.sh` — it updates the plugin in all three profiles (claude, claude-personal, claude-skyline). Restart open sessions to pick it up.

## Rules

- A skill lives here, nowhere else. Repo-local copies are drift — delete them after installing.
- Repo-specific skills (e.g. the template's `factory`) stay in their repo; only skills used
  across repos belong here. A skill that hardcodes one project's paths is not ready for this repo.
