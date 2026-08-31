# Wiki — generated system map (idea, not scheduled)

*Captured 2026-08-31 from an exploration session. Status: idea only — do not build without Ryan's
go. Companion reading: the Devin comparison (DeepWiki = "how is it structured", Knowledge = "how
should you behave"); this doc is the DeepWiki half. The knowledge loop (product.md + trigger-style
decision log) is the other half and is NOT this doc.*

## What it is

Auto-generated, always-current documentation of a template-derived repo: `docs/wiki/**` — an
index, a page per Manager domain, a page per endpoint (whole-repo `/flow`-style sequence diagram),
a data page (tables ← accessors ← flows), a frontend page (screens → endpoints). Everything
source-linked to `file:line`.

## Why it's cheap for us (and expensive for Devin)

Devin needs heavy AI indexing because arbitrary codebases are irregular. Our template's structure
is convention-encoded and *test-enforced* (LayerRuleTests, HandlerResolutionTests), so a wiki is
derivable near-deterministically. If the convention tests pass, the extractor works.

## Pipeline (two layers)

1. **Deterministic extractor** — walks the conventions (controllers → request types → handlers →
   engine/accessor calls → tables; api.ts + routes → screens) into one `model.json` of every node
   and edge, cited. Zero tokens, cannot hallucinate.
2. **Renderer + narration** — markdown + mermaid from the model; an LLM writes only short prose
   summaries per page, regenerated from the model. Generated pages carry a "do not hand-edit"
   header and never share a file with human prose (architecture.md, product.md stay hand-owned).

## Consumers

1. **Agents** — factory-plan links relevant wiki pages into the plan instead of re-exploring
   (faster + cheaper; addresses "agents don't understand the systems"); reviewers get the
   before-map; /qa gets its screen→handler mapping.
2. **Ryan re-entering a project** after weeks away.
3. **Clients + adopters** — the handoff deliverable: current, browsable, source-linked.
4. **PR review** — the wiki diff IS the service-level change summary (see below).

## Self-updating / self-healing

- **Regenerate at ship time; verify in CI**: factory-ship regenerates before commit so the wiki
  diff rides in the PR; CI runs regenerate + `git diff --exit-code docs/wiki/` — a stale wiki
  fails the gate like a failing convention test. Currency is structural: drift doesn't merge.
- **Per-page fact hashes**: re-narrate only pages whose slice of the model changed — cheap runs,
  meaningful diffs.
- **Extraction failure = conformance finding**, not a wiki bug (unresolvable handler, layer-rule
  violation). The wiki build doubles as a structural audit; /system-review keeps auditing prose.

## The load-bearing dependency

The deterministic extractor is now wanted by THREE things: /flow Phase 2 (trustworthy diagrams),
/qa's diff→screen mapping, and this wiki. Build it once as a shared tool; each consumer is then a
renderer. That is the first artifact to build if this ever leaves exploration.

## Open questions for build time

- Where the extractor lives (skills repo as a shared script? the template's scripts/?)
- Artifact HTML rendering of the same model for the pretty shareable view
- Whether wiki regen belongs in the template's CI for non-factory commits too
