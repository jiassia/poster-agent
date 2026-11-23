# Incremental Agent workflow and project editing loop

Poster Agent additions, 2026-11-10. Apache-2.0. This describes deterministic file
operations, not an Agent runtime. Codex interprets intent and makes design choices.

## Read current state before deciding

For an existing project read `poster.json`, `design-plan.md`, relevant
`asset-plan.json` entries and the latest `.trace/versions/REV/meta.json`. Run:

```bash
node <poster-agent-skill>/scripts/project.mjs status PROJECT
```

`index.html` is the latest valid, materialized design. `poster.json` contains
`agent.currentRevision`; the corresponding immutable HTML, configuration,
resource hashes/copies, task and validation metadata live in
`.trace/versions/REV/`. Never use `editor.html` or a downloaded `*.edited.html`
as an alternate source of truth. The service regenerates `editor.html` from
current `index.html`; a download can be explicitly imported as a candidate.

For an unmanaged existing design, inspect it first, run its ordinary checks,
then adopt it with `project.mjs adopt PROJECT TASK.json`. Adoption preserves the
original HTML as version one. It must not silently reinitialize an existing
poster. For a new design, finish its initial HTML/assets and font checks, then
adopt. Current saved resources must be immutable: create new filenames for
replacement artwork rather than overwriting an existing file.

## Model task recognition

| User intent and state | Task | Minimal execution |
| --- | --- | --- |
| New visual, no target project | `create` | Initialize once; use the inherited complete design workflow, then adopt |
| Change composition, hierarchy or visual language | `redesign` | Read latest; plan new structure; preserve explicit locks and facts; save candidate |
| Change background or decorations only | `background` | Read latest; modify named regions, preserve content layer geometry and text |
| Change specific text, image, card or layer | `layers` | Resolve stable IDs; modify only authorized units |
| Diagnose clipping, broken resources or editability | `repair` | Inspect latest render/contracts; fix demonstrated defects within scope |
| Download/render an already accepted design | `export` | Read latest revision; export it; no new composition/reference/artwork |

These are model decisions, not keyword matching or a separate classifier.
When the user names an existing project, that authorizes work on that project
within the stated scope. Ask only when the target/scope or required facts are
actually ambiguous. Do independent inspection while awaiting needed facts.
A task may combine intents; record its main task and all allowed targets.

## Methods are per region, topologies are spatial structure

- **A / HTML/CSS native:** precise text, solid fields, gradients, regular geometry,
  rules and diagrams. Do not force image generation for a precise CSS treatment.
- **B / AI imagery:** photographic surfaces, complex light, illustration,
  textures, transparent subjects. Check actual capability before promising pixels.
- **C / mixed:** generated/user-supplied imagery with live HTML text, shapes and cards.

Methods may coexist within one poster. Preserve the original five asset
architectures: Slot Matrix, Code-native Modular Field, Continuous Scene,
Cutout Stack, Layered Collage. A topology is not a provider or a locked template.
For example a slot matrix can use A for cards, B for photography and C overall.

Composition reference pixels remain non-shipping under `reference/`; deliverable
assets remain under `assets/`. Run reference generation only when composition
work needs it under the inherited reference rules and actual available tools.
Export, copy edits and background-only refinement do not restart a full poster
workflow or force a new reference. With absent imagery capability, record
`unavailable`; do not fabricate a file/result or pretend a CSS substitute meets
an intrinsically photographic request. A safe partial alternative requires
preserving the brief and explaining its actual limitation.

## Record the decision without duplicated state

Append the task's design reasoning to `design-plan.md`. Update `asset-plan.json`
only when asset topology or asset requests change. Reuse `poster.json` for the
current version and protection policy; `.trace/versions/REV/meta.json` and
`.trace/events.jsonl` record exact parent/output versions, task, tools, actual
scope and validation. Replay displays evidence after execution; it is not a
planner, state machine or model runtime. Never rerun `trace.sh init` in an adopted
project (the script rejects it to protect history).

A background patch request (save as a temporary or project-local request file):

```json
{
  "baseRevision": "<current exact revision from status>",
  "target": "region:background",
  "style": { "background": "linear-gradient(150deg, #eee9db, #8da89b)" },
  "task": {
    "type": "background",
    "summary": "Refine only the background, retaining the user's product placement",
    "preserve": ["all content layers and original product bytes"],
    "routes": [{"region":"background","method":"A","reason":"Precise gradient control"}],
    "tools": ["project.status", "project.patch", "Chromium validation"]
  }
}
```

```bash
node <poster-agent-skill>/scripts/project.mjs patch PROJECT REQUEST.json
```

`patch` always reads latest `index.html`, verifies `baseRevision`, and modifies
only one stable `layer:ID`, fixed `region:ID`, or inherited `group:ID` module.
A group/region selection records its contained layer IDs in the allowed scope. It supports CSS properties,
plain text on a leaf, and `src` on an IMG. For several targets or a full redesign,
create a separate candidate HTML with project-relative resource URLs, then save:

```json
{
  "baseRevision": "<exact current revision>",
  "candidate": "/absolute/path/to/candidate.html",
  "task": {
    "actor":"agent", "type":"layers", "summary":"Update only the requested caption",
    "scope":{"layers":["caption"],"regions":[],"preserveLayers":["product"]},
    "preserve":["product position"],
    "routes":[{"region":"caption","method":"A"}],
    "tools":["HTML candidate", "project.save"]
  }
}
```

```bash
node <poster-agent-skill>/scripts/project.mjs save PROJECT REQUEST.json
```

The validator compares geometry, visible styles, pseudo styles, image references
and live text on every non-authorized named unit. Global canvas changes are
rejected during partial edits. `scope.all: true` is for a user-authorized overall
redesign only; locked layers, trusted text and original assets stay protected.
Name fixed background/decorative units with `data-region-id` (not layer IDs) so
the inherited editor/exploded-view contract stays intact. For older posters,
introducing such anchors is a deliberate structural change and must be included
in the authorized candidate scope.

Untouched unnamed decoration should remain byte-identical in partial candidates;
the single-target `patch` operation is preferred because it only mutates its
resolved DOM element. The validator is a visual/editing guard, not a proof that
arbitrary semantically equivalent HTML has identical browser behavior.

## Human editor, save and export

```bash
node <poster-agent-skill>/scripts/serve-project.mjs PROJECT
```

Open the printed `http://127.0.0.1:PORT/editor.html#token=...` link in an independent
browser. No Codex preview is needed. The inherited editor still handles dragging,
resizing, text, fonts, undo, local drafts, scan/explode/collapse and HTML downloads.
A small `project-bridge.js` adds **保存到当前项目**, **保存并导出 PNG** and version restore.
An offline/file browser editor still supports downloads and explains how to
connect for project saves. Keep the session-token URL local.

Save uses the inherited `fullHTML()` serializer, with editor/bridge code removed.
A saved revision is backed up before `index.html` is replaced. Optimistic revision
checks reject stale tabs; the user can download their unsaved work before opening
the latest design. Missing/broken images or fonts, invalid layout, protected edits
and resource changes fail explicitly. Save and render are separate operations:
if render fails after save the UI says **design saved; PNG export failed**.

The service binds only 127.0.0.1, shares one explicit project, rejects wrong Host
and cross-origin API calls, requires a random session token for every API request,
limits JSON bodies and static resource types, and rejects traversal/symlink
escapes. It exposes no shell or arbitrary file-write endpoint. The token is in a
fragment, not a request/logged query string. Do not enable public binding/CORS.

```bash
node <poster-agent-skill>/scripts/project.mjs export PROJECT EXACT_CURRENT_REV
node <poster-agent-skill>/scripts/project.mjs restore PROJECT HISTORICAL_REV EXPECTED_CURRENT_REV
```

Export reuses `_browser.mjs` Chromium setup and waits for fonts/images, validates
current resource hashes and canvas size, reads PNG IHDR dimensions, and publishes
an atomic revision-specific PNG plus `out/poster.png` only on success. The export
receipt in `poster.json` records revision, dimensions and hash. A new save invalidates
the receipt; an older PNG is not the new version's export. Scale/DPI follow existing
`poster.json` settings. Rendering errors return failure, never a successful receipt.

Restore always creates a new version; it does not erase later history. Resources
are backed up with each version (including selected font licenses). A write journal
inside `.trace/` recovers interrupted index/config updates on the next operation.
A project lock rejects simultaneous operations. If an OS kill leaves
`.trace/project.lock`, inspect its owner PID and remove it only after confirming
that process has ended; do not blindly steal an active lock.

An externally edited `index.html`/`poster.json` is rejected as uncommitted instead
of silently overriding human changes. To import external HTML, first preserve it
as a candidate, restore the recorded snapshot to `index.html`, then use `save`
with that candidate and explicit scope. Keep `poster.json` policies managed once
adopted; changing trusted facts/policies needs a deliberate future policy-update
operation, not an editor-side bypass.

## Original assets, facts and locked layers

Configure before initial adoption in `poster.json`:

```json
{
  "agent": {
    "protection": {
      "assets": [{"path":"assets/product-original.png","kind":"product-original"}],
      "layers": {
        "product": {"kind":"product","operations":["move","resize","crop"]},
        "price": {"kind":"price","trustedText":"$129","trustedSource":"brief.md"},
        "product-id": {"kind":"product-id","trustedText":"SKU-001","trustedSource":"brief.md"},
        "qr": {"kind":"qr","operations":["move","resize"]},
        "brand": {"locked":true}
      }
    }
  }
}
```

Adoption fills original-asset SHA-256 values and verifies trusted text against
its input file. Original files never change; permitted position/size/crop affect
the display only. Locked-layer appearance, text and geometry may not change.
Price/ID edits must match trusted inputs. QR references/pixels must be preserved,
never regenerated by an image model. Put their source files in the protected
assets list too. Client guards explain restrictions; server validation enforces
them independently. Future fact ingestion belongs beside this protection policy;
future QR decoding must inspect the final exported PNG (not just source markup).
No QR scannability claim is made by this phase.

## ImageProvider extension seam

`scripts/image-provider.mjs` documents the request, detection and result interface.
It accepts purpose, prompt, target size/ratio, references, provider/model and a new
output filename; results contain actual PNG dimensions, status and each retry.
The registry now includes an optional OpenAI adapter; the CLI also offers an
explicitly labeled offline Mock. See [Image Providers](image-providers.md) for the
official parameter profiles, secure key sources and exact-plan spending gate.
`detectProviders()` checks only local credential presence/file permissions; it never
returns the key or calls an account/model endpoint. An unavailable provider returns
`status: unavailable`, null path/dimensions and an explicit reason. Generation
accepts a registered or injected adapter. Non-paid adapters may retry a declared
transient error at most once. Real OpenAI requests have one attempt and require
explicit user approval of their plan hash; retry requires new approval.

A future vendor adapter exports `{id, paid, detect(), plan(), generate(request, options)}` and is wired
into this one module/CLI seam. It must preserve raw results, map actual supported
model names and output controls, normalize errors, and return a local PNG. Add
request/result references to existing `asset-plan.json`, `prompts.md` and `.trace`
after actual generation. `image.mjs apply` requires visual review and reuses
`project.mjs patch` for the specified non-protected target. There are no stored API
keys or mandatory GPT Image 2 calls, and no claim that a model is available on an
account until an explicitly approved real call confirms it.

## Free geometry editing preference

User instruction, 2026-11-16: do not impose position locks on any poster layer.
Source captions and trusted prices/IDs must remain movable/resizable. Use
`trustedText` to protect sourced wording, and original hashes to protect pixels,
without `locked:true` or move/resize restrictions. Existing legacy lock support
remains for backwards compatibility, but new designs must not impose it.

For an explicitly requested removal, `project.mjs unlock-positions PROJECT REQUEST`
requires `{ "baseRevision": "LATEST_REVISION" }`. It reads the latest saved HTML,
converts full text locks to content-only guards, releases geometry restrictions,
checks that every measured record remains identical, and creates a new version.
Historical snapshots are never rewritten. The local editor bridge clears stale
serialized policy hints before applying server policy. An already-open stale
editor must preserve/download any unsaved work before reopening the new revision.


User clarification (2026-11-16): complete editing freedom supersedes the earlier
geometry-only preference and content guards. Do not enforce trustedText, locked,
product/QR editing restrictions or operation allowlists in new posters. Store
input evidence as provenance, set agent.freeEditing=true and protection to
{layers:{},assets:[]}. Existing projects: project.mjs unlock-editing with latest
baseRevision creates a visually identical new version. Users may edit wording,
images and delete any layer; Agent still follows sourced facts and edit scope.
