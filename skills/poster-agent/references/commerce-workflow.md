# Complete commerce task entry

Copyright 2026 Poster Agent. Apache-2.0. Incremental tools over Editable Design.

The user can say: “用这些商品资料制作1152×2048双十一TOP6，两列三排，展示名称、ID、规格、价格、佣金和近7天数据，交付可编辑工程和PNG。” They attach source data, six images, QR, and an optional poster reference. Codex handles the sequence below without asking them to invoke tools. No independent runtime or fixed design generator is introduced.

## Intake and facts

Read actual files first, including the latest revision for an existing project. Convert structured attachments into `poster-commerce/v1` using the schema/example at `tests/fixtures/commerce/manifest.json`. For spreadsheets/PDFs use available readers and retain the source as evidence; this module does not implement a spreadsheet parser or OCR. Do not infer price, ID, commission, metric, date period or QR payload. Confirm uncertain extracted facts. The normalized manifest is a deterministic import boundary, not proof of commercial truth.

Required: `mode: real|mock`, provenance, brief, canvas, exactly six products. Product: unique stable id, name, spec, decimal-string price in CNY, commissionRate percentage, sevenDays `{value,unit,metric,start,end}` (seven inclusive calendar days), local raster image path. QR `{image,payload}` must be provided when required by the brief; when not supplied, real tasks must explicitly record `omissions.qr: "not-provided"`, omit the QR layer, and report scanning as unverified. Optional reference is a non-shipping local image. Paths resolve inside the manifest folder, including symlink checks. PNG/JPEG/WebP ≤32 MB and ≤32 million pixels are decoded locally. Missing data rejects import; no defaults invented. If mock is authorized, put “模拟数据” visibly on the poster and state real commercial/QR acceptance is pending.

Use `dev.sh commerce inspect MANIFEST`, then existing `init-poster.sh NEW_PROJECT`, then `dev.sh commerce import MANIFEST NEW_PROJECT`. Import never overwrites a managed project. It copies original bytes, records source hashes, creates `assets/commerce-input/manifest.json` and `facts.txt`, and populates existing `poster.json` protection rules. All six textual fields per product become trusted text. Product originals and QR pixels are immutable; placement/resize (product crop) remain editable. Real data truth and payload validity require trusted source review; decoding a PNG does not prove a QR is scannable.

## Model planning and tools

Codex decides task create/redesign/partial/repair/export and methods by region. Keep all five inherited topologies. TOP6 generally benefits from Slot Matrix with six separate supplied images and live card text, but do not force that architecture on other tasks. A: CSS for simple fields/type/geometry; B: provider for complex light/texture; C: mixed independent assets. AI must never redraw originals, facts or QR. Natural asset dimensions and display rectangles differ; use existing contain/cover previews with explicit crop review.

Record concrete route, current/parent version, permission boundaries, tools and their reasons in `design-plan.md`, per-asset plan, version task metadata and `.trace`. References stay under `reference/`, never ship as backgrounds. Resolve reference off for the offline fixture; if new paid reference/asset generation helps a real task, prepare the existing provider plan, ask for its specific approval, and wait before requesting images. Generation failure leaves design unchanged. A key is not spending authorization.

## Layout contract and acceptance

Codex authors the HTML for this particular content; there is no template renderer in the intake tool. Use `data-explode-group="card-PRODUCT_ID"`; preserve a nonzero 520-style or other explicit card rectangle, independent of leaves promoted by the editor. Product image IDs are `product-PRODUCT_ID`; fact IDs `PRODUCT_ID-name|id|spec|price|commission|sevenDays`. Use exported `facts(product)` to obtain exact strings. QR layer id `qr`. Independent text/image/surface leaves use inherited editor conventions; use local font-kit CJK and number families plus licenses.

Adopt using existing ProjectStore. Run `dev.sh commerce audit PROJECT`: checks every fact/image association, 2×3 unique card cells, card text clipping/overlap, missing/changed assets, visible mock labeling. This is a narrow TOP6 acceptance contract, not a general layout evaluator. Also visually inspect the PNG: automated rectangles cannot judge taste, subtle occlusion or truth. Locally fix only failures, save a new version with scope, recheck. Preserve evidence in `render-review.md` and `.trace`.

`dev.sh commerce deliver PROJECT` composes existing audit, latest-version PNG export, wire-editor, editor/layer verification, Replay build and Replay verification. It does not author HTML or call image APIs. Logs and receipt live in `.trace/commerce-*`; any failing subprocess fails delivery. Deliver only the receipt's revision. Start `dev.sh serve PROJECT` and provide its localhost link for independent editing; downloaded HTML is backup. The browser token stays local. An editor page opened directly from disk cannot save to the project.

After human save, reread status/latest index, use existing scoped patch/save. Never rerun import or initial build over the design. The new regression exercises actual pointer movement and browser save on a temporary copy of the commerce design, then background-only Agent continuation and exact rendered PNG comparison; it does not edit the delivered example or stage1 v14.

## Extensions

Spreadsheet adapters should output the same manifest with cell-level provenance. Future QR acceptance should decode final PNG and compare payload (not only source bytes). Inventory/truth verification and production commercial release remain separate from syntax checks. New providers go through the existing ImageProvider; none are added here.

Optional imported reference pixels are stored only under `reference/commerce-input/` with preserved original hashes, never `assets/`. They can be inspected and traced but ProjectStore refuses shipping HTML references to that directory. The fixture's reference test reuses a mock input solely to test this isolation, not as generated artwork.

## Real-source sales without fabricated calendar dates

A source table may report sales while omitting exact dates. Use either the existing fully dated `sevenDays` structure or `reportedSales` (never both): `{value:10921,display:"10,921",label:"近7天销量",period:"last7days",source:"Sheet1!E2; user confirmed"}`. `period` can be `last7days`, `cumulative` or `unspecified`, with exact labels `近7天销量`, `累计销量` or `销量`. Displayed integer must match value; preserve source grouping. Calendar dates/units are never inferred. `facts()` generates a protected `PRODUCT_ID-sales` layer. Save the user's period clarification with original cell addresses. Missing specs can be visibly labeled `规格未提供`; do not invent a quantity. The original dated fixtures and QR-required omission errors remain covered by regression.

User geometry preference (2026-11-16): never fully lock source notes or product
facts merely to protect content. Every card, picture, price, ID and caption must
remain movable/resizable. `trustedText` protects only wording; product/QR asset
hashes protect original pixels. Do not add `locked:true` or omit move/resize from
allowed image operations in new designs.


User clarification (2026-11-16): complete editing freedom supersedes the earlier
geometry-only preference and content guards. Do not enforce trustedText, locked,
product/QR editing restrictions or operation allowlists in new posters. Store
input evidence as provenance, set agent.freeEditing=true and protection to
{layers:{},assets:[]}. Existing projects: project.mjs unlock-editing with latest
baseRevision creates a visually identical new version. Users may edit wording,
images and delete any layer; Agent still follows sourced facts and edit scope.
