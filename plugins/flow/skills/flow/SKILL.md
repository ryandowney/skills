---
name: flow
description: Service-level flow review. Given a diff (feature branch vs a base ref), extracts every affected request flow through the IDesign layers — Client → Manager → Engine → Accessor — and renders it as a terminal call tree plus Mermaid sequence diagrams (HTML artifact + PR-ready markdown). Invoke as /flow [base-ref], default base is main (or develop if it exists).
---

# Flow — service-level diff review

Reviews a change at the **service level**, not the line level: which flows through the system did
this diff add, modify, or leave alone? Output is a call tree in the terminal and sequence diagrams
in a published artifact, every hop cited to `file:line`.

**Repo:** resolve at run time with `git rev-parse --show-toplevel` → `$REPO`. `Acme` below means
the project namespace (after `init-project.sh` it is the project's name — resolve it from
`ls src/*.sln`).

## 0. Inputs

- `BASE` = the argument if given, else `develop` if that branch exists, else `main`.
- Diff = `git diff $BASE...HEAD --name-status` **plus** uncommitted changes
  (`git diff HEAD --name-status`, `git status --porcelain` for untracked). Union them; a file's
  status is `A`dded, `M`odified, or `D`eleted.

If the diff is empty, say so and stop.

## 1. Classify changed files by layer

| Path prefix | Layer |
|---|---|
| `src/1.Clients/` | Client |
| `src/2.Managers/` | Manager |
| `src/3.Engines/` | Engine |
| `src/4.Accessors/` | Accessor |
| `src/5.Utilities/` | Utility |
| `src/6.Common/`, `src/7.Database/` | Infrastructure |
| `apps/web/` | Web client |
| everything else | Other (list, don't trace) |

## 2. Find affected entry points

An **entry point** is a controller action or minimal-API endpoint in `src/1.Clients/`.

- Changed controller/endpoint files → their actions are entry points directly.
- Changed manager handler or contract → find the request type (`XxxRequest`), grep
  `src/1.Clients/` for `new XxxRequest` to find the entry point.
- Changed engine/accessor code (handlers, contracts, base classes) → grep upward for who calls it
  (who constructs its request type, or who uses the touched helper), then continue up to the
  entry point. A changed shared base (e.g. `ValidationHandlerBase`) can pull in flows whose other
  files are untouched — include them, they are *behaviourally* affected.
- Changed `apps/web/` files that call the API (look for the endpoint path or the typed client in
  `apps/web/src/lib/api.ts`) → note the page/component as the flow's origin above the controller.

Deleted flows count too: if a handler/action was deleted, report the flow as removed.

## 3. Walk each flow downward

Follow the repo's dispatch conventions — do **not** guess, verify each hop by opening the file:

1. **Controller action** → calls exactly one manager: `PlatformManager.<Verb>(new XxxRequest {…})`.
2. **Manager dispatch** (reflection, `HandlerResolver`): request type → handler by convention —
   `Acme.Managers.<Domain>.Contracts.Requests.<Verb>.XxxRequest` →
   `Acme.Managers.<Domain>.Handlers.<Verb>.XxxHandler`. **Confirm the handler file exists.**
3. **Validate-then-handle**: the manager run base calls the handler's `Validate()` (if present)
   before `Handle()`. `Validate()` typically calls
   `ValidationEngine.Validate(new XxxValidationRequest)` — resolve that to
   `Acme.Engines.Validation.Handlers.<Verb>.XxxValidationHandler` the same way. A
   `[NoValidation]` attribute means no validation hop — say so in the flow.
4. **Service calls inside any handler**: scan the body **and its base classes** for calls on
   properties whose names end in `Manager`, `Engine`, `Accessor`, `Utility`
   (e.g. `TenantAccessor.Filter(new ProjectFilterRequest {…})`). Base-class helpers
   (`RequireMember`, `ValidateNameAsync`, `LoadProjectAsync`, …) often contain accessor calls —
   follow them and attribute the hop to the helper (e.g. `via ValidateNameAsync`).
5. **Accessor handlers** are leaves: record what they touch (`context.<DbSet>` → table) and stop.
6. Record each hop's **request and response types** and the `file:line` of the call site.
7. **Payload shapes**: for every request, response, and DTO the flow carries, open its contract
   file and record the fields (`Name : Type`). Follow nested types one level per hop — a
   `HoldingStoreRequest` containing `List<HoldingStore>` records `HoldingStore`'s fields too, and
   a response's DTO/model gets its own shape. Note fields inherited from envelope bases
   separately (`ResponseBase`: `Success`, `Errors: List<ApiError>`, `CorrelationId`; request
   bases are markers with no fields; the HTTP edge wraps in `ApiResponse<T>`). Cite each
   contract's file path.

**Citation rule — non-negotiable:** every edge in the output carries the `file:line` where the
call appears, and every claimed handler was confirmed to exist on disk. An edge you cannot cite is
an edge you do not draw. If a hop violates the layer rules (Manager→Manager, Accessor→Accessor,
skipped layer), draw it and flag it loudly — that is a review finding, not a rendering problem.

## 4. Tag change status

For every node (service/handler/action) and edge:

- `[+]` added — the file containing it is `A` in the diff, or the call was added in a modified file
  (check the diff hunks, not just file status).
- `[~]` modified — file is `M` and the hunks touch this member.
- `[-]` removed — existed at `$BASE`, gone now.
- `[ ]` unchanged — traversed but untouched.

## 5. Render

### 5a. Terminal call tree (always, printed in the response)

One tree per entry point. Format:

```
POST /api/tenants/{tenantId}/holdings         HoldingController.Create             [+]
└─ PlatformManager.Create(HoldingCreateRequest)                                    [+]
   ├─ Validate → ValidationEngine.Validate(HoldingCreateValidationRequest)         [+]
   │  ├─ RequireMember(tenantId)                                        (via base) [ ]
   │  └─ TenantAccessor.Filter(HoldingFilterRequest)  ← duplicate check            [+]
   │       ⇒ holdings table (read)
   └─ Handle → TenantAccessor.Store(HoldingStoreRequest)                           [+]
        ⇒ holdings table (upsert)
        ↩ HoldingStoreResponse → HoldingDto → ApiResponse
```

Below the trees, a **summary paragraph**: N flows added, N modified, N untouched-but-affected;
any layer-rule violations; anything surprising (a flow that reaches more services than its
siblings, a handler with no validation, an accessor touched by many flows).

Then a **citations block**: every edge as `file:line`, so any hop can be jumped to and audited.

### 5b. Mermaid + artifact (always, unless the user says terminal-only)

Write `$SCRATCHPAD/flow-review.html` (or the session scratchpad) and publish it with the Artifact
tool (favicon suggestion: 🧭). The page contains, per entry point:

- A `<pre class="mermaid">sequenceDiagram</pre>` — participants are the **services**
  (WebApp, HoldingController, PlatformManager, ValidationEngine, TenantAccessor, Postgres), one
  arrow per hop labelled with the request type, return arrows with the response type. Artifacts
  render Mermaid natively — do not load any library.
- Change-status legend; mark added participants/arrows (Mermaid `rect` blocks or a `[+]`/`[~]`
  prefix in labels — keep it simple and readable over clever).
- A **Payloads** drill-down: one collapsed `<details>` per contract type, in hop order —
  summary line is the type name + its role (wire DTO, manager request, accessor response, …) +
  change tag; the body lists `Name : Type` fields in mono, with nested `<details>` for inner
  DTO/store/model types and inherited envelope fields rendered dimmed and labelled
  (`inherited from ResponseBase`). Nothing expanded by default — the diagram stays the page;
  shapes are there when the reviewer drills.
- A collapsed `<details>` with the same diagram as a fenced ```mermaid block, ready to paste
  into a PR body (GitHub renders it).
- The citations block.

Style: minimal, readable, no framework. The diagram is the page.

## 6. What this is not

No code-level review here — no style, naming, or test-coverage commentary. That is `/factory`'s
review stage. `/flow`'s single job is to make the shape of the change visible and cited.
