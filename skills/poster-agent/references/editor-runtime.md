<!-- Modified 2026-11-10: resolve tools from the Poster Agent fork. -->
# Editor and exploded views

Read this when wiring, validating, baking, or diagnosing the bundled poster
editor. `poster-agent` is the only required skill; no separate editor skill
or runtime is needed.

## Ownership and delivery

- `assets/editor/layer-editor.css`, `layer-editor.js` and the optional
  `project-bridge.js` are the canonical
  runtime. Do not rewrite them per poster.
- `scripts/init-poster.sh` copies that runtime into
  `PROJECT/scripts/editor-assets/`.
- `PROJECT/scripts/wire-editor.mjs` copies the runtime beside `index.html` and
  creates `editor.html` without modifying `index.html`.
- The finished project remains offline and self-contained. Editor controls never
  enter the PNG because rendering always targets `index.html`.

## First use of validation tools

The browser-driven validation tools need `puppeteer-core`. Install it once in
the skill's `scripts/` directory:

```bash
npm ci --prefix <poster-agent-skill>/scripts
```

The offline interactive `editor.html` needs no installation or local server for downloads.
Project saves use the restricted local service described in [Project workflow](project-workflow.md);
`project-bridge.js` adds save/export/restore controls to the inherited editor without replacing it.

## Contract and wiring

Run the poster's normal static check first. For a browser-measured compatibility
preflight before the first render, then wire and verify from any directory with
absolute paths:

```bash
node <poster-agent-skill>/scripts/check-contract.mjs PROJECT/index.html
node PROJECT/scripts/wire-editor.mjs PROJECT/index.html
node <poster-agent-skill>/scripts/verify.mjs PROJECT/index.html
```

Fix every contract or verification failure before delivery. Do not patch the
editor runtime around a poster-specific violation. Verification compares both
layer geometry and rendered pixels: matching rectangles alone cannot detect a
lost card surface, contextual style, pseudo-element, blend, or paint order.

The poster authoring contract is defined in `SKILL.md`; this reference owns only
runtime wiring, verification, baking, and diagnosis.

## Standalone exploded view

`editor.html` already provides scan, one-level content spreading,
reverse-collapse, and download controls. Every poster also ships a standalone
`layers.html`. Groups appear as whole modules; ungrouped content appears as
individual units. If that produces fewer than five primary content units, the
gallery keeps those modules and additionally promotes their grouped text leaves
to companion units. This is a one-level density fallback, not a second-level
drilldown. The normal
`verify.mjs` run writes the verified file without another browser launch.
Use `explode.mjs` only to regenerate it separately while diagnosing a failure:

```bash
node <poster-agent-skill>/scripts/explode.mjs PROJECT/index.html
node <poster-agent-skill>/scripts/explode.mjs PROJECT/index.html PROJECT/layers.html
```

The exported view contains a small complete-composition overview, a small tile
for the unmarked paper/texture/fixed frame, whole content modules, and ungrouped
units. They spread into a 2–5 column component gallery with no
permanent central base. At the animation origin all tiles overlap at their
original coordinates, so the complete poster is reconstructed before it
separates. Text, images, and SVG remain DOM clones. The stage follows the
poster's actual paper or background tone, including dark hues, instead of
collapsing every dark poster to generic black. This preserves the intended
contrast of thin and low-opacity layers. In isolated content tiles only,
computed opacity below 0.55 receives a bounded presentation boost; the complete
overview remains visually faithful to the poster. It is a presentation artifact,
not a second editor.
Continue editing in `editor.html`.

The transition uses a scan beam followed by deterministic FLIP-style spreading.
Only `transform`, `opacity`, and `filter` animate; final `left` and `top` remain
deterministic. `prefers-reduced-motion` is respected, and `?motion=0` opens at a
stable end state for screenshots and automated review, with the replay-animation
control hidden because there is no motion to replay.

The settled view uses the center as part of the gallery. Column count depends
only on the effective component count after the small-gallery text fallback;
original horizontal position is a light placement preference, and visual weight
balances the columns. There is no second detailed collection pass.

## Optional offline bake

Use baking only when a stable, absolute-positioned source is useful for CI or
future editing:

```bash
node <poster-agent-skill>/scripts/bake.mjs PROJECT/index.html
node <poster-agent-skill>/scripts/bake.mjs PROJECT/index.html --in-place
```

The in-place form overwrites the source, so use it only when that exact target
is intended and recoverable. Baking must not land when any layer drifts by more
than 1px.

## Editor scope

The editor supports dragging, alignment snapping, arrow-key nudging, eight-handle
resizing, plain-text editing, proportional font scaling, switching among
declared font stacks, delete, undo, local drafts, scan/explode/collapse, and
clean normal or exploded HTML downloads. Left and right handles change width,
top and bottom handles change height, and corners change both. A width set by a
handle remains fixed during later text or font-size edits so wrapping follows
the user's chosen box; resize state participates in undo, draft restore, reset,
position-CSS export, and clean HTML export.

Pointer gestures must always have an exit path. Releasing anywhere, pointer
cancellation, capture loss, window blur, or hiding the page ends the active
gesture. Pressing Escape during a drag or resize cancels that gesture and
restores its starting geometry; pressing Escape afterward clears selection.

It intentionally does not add arbitrary layers, import images, reorder the
stack, rotate, recolor, or expose full typography controls. It is for human
micro-adjustments after design, not for redesigning the poster.

The automation anchor is `html[data-hf-ready]`. The public API is
`window.__layerEditor`, including `fullHTML()`, `explodedHTML()`, `download()`,
`downloadExploded()`, `undo()`, `select()`, `scaleFont()`, `setFont()`,
`removeLayer()`, `setExploded()`, `layers()`, and `state`.

When validation reports drift or an interaction fails, read
[Editor pitfalls](editor-pitfalls.md) before changing the runtime.


### Upload and replace an image (2026-11-16)
Select an IMG layer (or a layer with exactly one IMG), then choose
“上传替换图片” in Properties. PNG/JPEG/WebP up to 5 MB are supported. The
localhost bridge imports the decoded original bytes under assets/editor-uploads/
using a content hash; existing originals remain untouched. The image's frame,
position and object-fit are retained. Replacement supports Undo and drafts.
Click Save to create a version; uploading alone does not change the current
project version. A stale revision or failed decode leaves the selected image
unchanged. Standalone offline editors embed the image for downloaded HTML;
managed project saving requires the localhost service.

`./dev.sh test-editor-image` verifies upload, undo, save/reopen, unchanged geometry
and other layers, original retention, export and rejected invalid/stale requests.


### Add independent images and resize them
“上传新图片” is always available above the layer list, without a selected layer.
It reuses the local image importer, appends a unique editable IMG layer above
existing content, fits its original aspect ratio within 40% of the canvas and
selects it. Existing layers and originals remain untouched. The image supports
dragging, deletion, undo, draft recovery and the existing versioned save/export.
In image Properties, enter width/height or drag resize handles. “等比缩放” is on
by default and can be disabled; it is a user toggle, never a protection rule.
“按原图比例适合画布” restores the source ratio and sizes within 80% of the canvas.
Uploads do not save a design version until the user chooses Save.
`./dev.sh test-add-image` verifies add/undo, numeric/proportional/free sizing,
draft reload, pointer movement, versioned save/reopen, unchanged existing layers
and PNG export.

In a project with `agent.freeEditing:true`, text-hit overlap is a warning during
save/export, not a blocker: users may deliberately overlay images and text. The
strict standalone contract checker remains strict by default;
`--allow-text-overlap` reports C5 overlap as warning. Warnings are recorded in
version validation. Geometry/asset decoding and integrity checks remain active.
