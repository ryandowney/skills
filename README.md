# downey-skills

Claude Code skills for spec-to-PR feature work in IDesign-layered .NET + SvelteKit repos,
distributed as a plugin marketplace.

| Plugin | What it gives you |
|---|---|
| `flow` | `/flow [base-ref]` — service-level diff review: call trees + Mermaid sequence diagrams through the layers, payload drill-down, every edge cited to `file:line` |
| `factory` | `/factory <spec>` — spec → plan → build → review → fix → PR, with two human gates; plus standalone `/factory-plan`, `/factory-execute`, `/factory-review`, `/factory-fix`, `/factory-ship`, `/test-review`, `/test-write`, `/system-review`, `/architecture-review` |

The skills assume the conventions of the layered template (Clients → Managers → Engines →
Accessors → Utilities, convention-dispatched handlers, a `CLAUDE.md` contract). They resolve the
repo, solution, and namespace at runtime — nothing is hardcoded to one project.

## Install

```
/plugin marketplace add ryandowney/downey-skills
/plugin install flow@downey-skills
/plugin install factory@downey-skills
```

Get updates any time with `/plugin update flow` / `/plugin update factory` (or
`claude plugin update <name>` from a shell). Restart open sessions to pick up new versions.

## Maintaining (repo owner)

1. Edit the skill under `plugins/<plugin>/skills/`.
2. Bump `version` in that plugin's `.claude-plugin/plugin.json`.
3. Commit and push, then run `./sync.sh` to update every local Claude profile.

Rules:

- A skill lives here, nowhere else. Repo-local copies are drift — delete them after installing.
- Repo-specific skills stay in their repo; only cross-repo skills belong here. A skill that
  hardcodes one project's paths is not ready for this repo.
