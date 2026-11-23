# Image Providers — second stage

Poster Agent additions, 2026-11-10. Apache-2.0. Optional tools, no Agent runtime.

## Decide whether imagery is needed

Codex chooses per region: A for CSS colors/geometry/type, B for photographic or
illustrative assets, C for independently generated imagery combined with HTML.
The five inherited asset topologies and non-shipping composition references stay
unchanged. A simple gradient edit never requires API access. A request to install,
configure or test an adapter does not authorize a paid generation call.

## Verified official API contract

Official documentation fetched 2026-11-10, without any authenticated API call:

- [Images generation API](https://developers.openai.com/api/reference/resources/images/methods/generate): `POST https://api.openai.com/v1/images/generations`, JSON.
- [Images edit API](https://developers.openai.com/api/reference/resources/images/methods/edit): `POST /v1/images/edits`, multipart `image[]` for local reference inputs.
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation): size, high-fidelity references and quality constraints.
- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2): the fetched page marks this model/snapshot deprecated. Keep an explicitly requested model; never silently migrate it. API reference still lists it, which does not prove an account has access.

The implementation sends `model`, `prompt`, `n:1`, `size`, `quality`, `background`,
`output_format:png`. GPT Image models return `data[0].b64_json`; do not send legacy
`response_format`. GPT Image 2 always handles references at high fidelity; do not
send `input_fidelity`. Reference images are at most 16 local PNG/JPEG/WebP files,
each below 50 MB. A generation with references uses edits, not text-only generation.

The adapter also appends the validated output width, height, reduced aspect ratio
and orientation to the effective API `prompt` (for example, exactly 1152x2048
pixels, width 1152 px, height 2048 px, aspect ratio 9:16, portrait). These describe
the image file, never lettering to paint. This applies to generation and edits.
The `size` field and decoded-PNG validation remain mandatory: prompt wording
cannot guarantee wrapper compliance. This prompt change invalidates old approval
hashes; create and review a new plan before any future paid request. Historical
plans and receipts must remain unchanged.

| Profile | Supported sizes | Quality | Transparent PNG |
| --- | --- | --- | --- |
| `gpt-image-2`, `gpt-image-2-2026-04-21` | Multiples of 16; max edge 3840; ratio ≤3:1; 655360–8294400 pixels | low/medium/high/auto | Preview: explicit `allowPreviewTransparency:true`; access not guaranteed |
| `gpt-image-1.5`, `gpt-image-1-mini` | 1024×1024, 1536×1024, 1024×1536 | low/medium/high/auto | Supported parameter; actual alpha still verified |
| `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare` and their 2026-09-08 snapshots | Same flexible limits above | Also xhigh/max | Supported parameter |

These are the implemented, reviewed profiles, not a live account inventory. New
official models need a reviewed profile in `providers/openai-image.mjs`; there is
no arbitrary parameter pass-through. Resolutions above 2560×1440 are experimental
according to the guide. Use explicit `size` for predictable output; aspect ratio
alone resolves to a standard orientation only if it matches that ratio. No silent
resizing or format conversion. This stage accepts decoded, non-interlaced 8-bit PNG;
other encodings fail clearly instead of publishing an unvalidated image.

## Credentials

No keys belong in request JSON, HTML, browser code, Git, prompts or trace records.
Supported sources, in priority order:

1. Process environment `OPENAI_API_KEY`.
2. `OPENAI_API_KEY_FILE`: absolute path to a plain-text key file outside both the
   poster and its enclosing Git repository. It must belong to the current user
   with private permissions (600). The code does not load `.env` automatically.

For a one-terminal session, use a hidden zsh input (do not paste a key into chat
or a shell command literal):

```zsh
read -rs 'OPENAI_API_KEY?OpenAI API Key: '
export OPENAI_API_KEY
printf '\n'
```

For desktop Codex, a private file is easier: create it with a password manager or
hidden input, set mode 600, then provide only its path to Codex. For example:

```zsh
mkdir -p ~/.config/poster-agent
umask 077
read -rs 'poster_agent_key?OpenAI API Key: '
printf '%s' "$poster_agent_key" > ~/.config/poster-agent/openai.api-key
unset poster_agent_key
chmod 600 ~/.config/poster-agent/openai.api-key
export OPENAI_API_KEY_FILE="$HOME/.config/poster-agent/openai.api-key"
```

An existing desktop process does not inherit exports from another terminal. Codex
can run its image CLI with `OPENAI_API_KEY_FILE=/absolute/private/path` once the
user supplies that path; the key itself is never placed in the command. No file
is read unless its source is explicitly configured. `.gitignore` also excludes
`.env*`, `*.api-key`, `*.secret` and `secrets/` as defense in depth.

`./dev.sh image detect` is local-only. `available:true` means credentials are
configured; `accountAccess:not-verified` explicitly means model access is unknown.
No key, Authorization header or raw upstream error body is printed or traced.

## OpenAI-compatible relay Base URL

### Development checkout: explicit native OpenAI profile

The local checkout provides `./dev.sh image-native detect|plan|generate ...`.
This explicitly selects `https://api.openai.com/v1`, clears an inherited
`OPENAI_API_KEY` (which may belong to a relay), and reads the native credential
from `~/.config/poster-agent/openai-native.api-key`, outside the repository.
`POSTER_AGENT_OPENAI_KEY_FILE` can explicitly select another private file.
There is no relay fallback. The regular `image` command keeps its existing
environment-based configuration, so original relay configurations stay independent.

`image-native detect` is offline; a missing native file reports unavailable
instead of falling back to a relay environment key. Planning is keyless and
offline. Paid generation still requires the reviewed request hash and explicit
human authorization; saving the credential does not authorize another paid call.
This wrapper is a development-checkout convenience; packaged Skill users can
provide the same explicit official URL and private-file environment variables.

Set `OPENAI_BASE_URL` to the relay's API root; the default remains
`https://api.openai.com/v1`. For example:

```bash
export OPENAI_BASE_URL="https://your-api-provider.example/v1"
export OPENAI_API_KEY_FILE="$HOME/.config/poster-agent/relay.api-key"
./dev.sh image detect
./dev.sh image plan PROJECT skills/poster-agent/references/examples/openai-background.request.json
```

Create that private file with the hidden-input procedure above, using the relay's
own key and filename `relay.api-key`. If `OPENAI_API_KEY` is already set it takes
priority over the file: unset it when switching to a different key source.
Never send an official OpenAI key to a relay unintentionally. Desktop Codex must
receive the Base URL and private key file path in its own process environment;
exports in another terminal are not automatically inherited.

Only HTTPS is accepted; credentials, query parameters and fragments in the URL
are rejected. A bare hostname gets `/v1`; explicit API path prefixes are preserved,
and trailing slashes are removed. The adapter appends `/images/generations` or
`/images/edits` once. Supply an API root, not a complete generation endpoint.

The provider remains `openai`; select the model in request JSON's `model` field.
This adapter supports the reviewed model names above, not relay-specific aliases.
The relay must implement the same Images JSON/multipart protocol and return
`data[0].b64_json` containing PNG. Merely accepting chat requests does not prove
image compatibility. No live compatibility or model availability check is made.

The plan and receipt include the actual destination URL. After human approval,
the relay receives its key, the prompt and any selected reference images.
Destination changes invalidate the approval hash and require a new plan and
approval. Redirects remain forbidden; configuration and planning send no requests.
Unset `OPENAI_BASE_URL` to return to the official endpoint.

## Safe first real request

Use [the background request example](examples/openai-background.request.json).
It selects GPT Image 2, one 1152×2048 opaque background at low quality, no references.
The request creates a new asset only; it does not change the current design.

```bash
./dev.sh image plan PROJECT skills/poster-agent/references/examples/openai-background.request.json
```

Planning does not read the secret or contact an API. Show the exact effective
prompt, destination URL, model, size, quality, number of calls (one), output, any reference paths
and hashes, and the returned `requestHash`. State that costs and account/model
access have not been verified. Obtain explicit human approval for that real call.
Do not invent an exact cost estimate. Then, and only then:

```bash
./dev.sh image generate PROJECT skills/poster-agent/references/examples/openai-background.request.json --allow-paid-request --request-hash APPROVED_HASH
```

Without both the paid flag and the exact current plan hash, no OpenAI request is
sent. The hash binds the destination URL, normalized API parameters, output and reference file bytes.
Changing the destination/model/prompt/size/reference requires a new plan and approval. All
requests use the configured HTTPS endpoint, deny redirects, timeout at 180s,
and make one attempt. No automatic model fallback, prompt rewrite or retries.
Timeouts and server errors may already have been billed: inspect usage and obtain
new approval before retrying. Configuration alone never authorizes spending.

## Review, apply, version and export

The coordinator creates a new file with exclusive write, validates PNG CRC and
decoded scanlines, real dimensions and actual transparent pixels when requested.
It records request, effective plan, hash, model, result, numeric usage and attempts
in `.trace/image-jobs/JOB_ID.json`, with an event in existing `events.jsonl`.
Failures have null result paths. No original files are overwritten.

Open the generated image and inspect actual pixels. Shipping backgrounds or
decorations must be standalone assets with no lettering, prices, IDs, logos, QR
codes or complete poster layout. Prompt constraints cannot prove this. This stage
does not implement OCR: inspect and reject unsuitable results; never falsely mark
an unviewed image reviewed. References remain under `reference/` and cannot be
applied as shipping assets. Text stays in HTML; product originals stay untouched.

After inspection, read the current project status again. A separate apply JSON:

```json
{
  "jobId":"JOB_ID",
  "baseRevision":"EXACT_LATEST_REVISION",
  "target":"region:background",
  "review":{
    "sha256":"EXACT_GENERATED_ASSET_SHA256",
    "noText":true,
    "independentAsset":true,
    "notes":"Actual pixel review findings"
  }
}
```

```bash
./dev.sh image apply PROJECT APPLY.json
./dev.sh project export PROJECT NEW_REVISION
```

Apply accepts a leaf IMG layer or empty region, refuses protected layers and
originals even if called outside the Skill, reuses scoped `project.patch`, and
creates a new version with image-job/review metadata and `image-application.json`
comparison evidence. An updated project rejects stale apply requests. Only the
selected target receives `src` or CSS background changes; the existing validator
preserves other geometry, styles, text, references and originals. Review the final
PNG for contrast/load/placement. Update `design-plan.md`, and `asset-plan.json` /
`prompts.md` where applicable, using real results. Replay remains the evidence viewer.

## Future adapters

Extend the existing registry with `{id, paid, detect, plan, generate}`. `detect`
must be local-only; `plan` describes the exact billable request and hash; `generate`
returns PNG bytes plus provenance/usage. The coordinator owns validation, new-file
publication, bounded non-paid retries and receipts. Paid adapters must implement
the same plan-hash gate; local models set `paid:false` and use the same asset
validation/application path. No separate model planner or Agent framework is needed.

## Failure diagnostics and isolated PNGs (2026-11-11)

Every result now includes `diagnostic.requestedSize`, `actualSize` (null until
successful PNG decoding), safe response metadata and the serialized wire request
fields plus JSON body SHA-256. The adapter records HTTP status, sanitized request
ID, response MIME type and response model ID when supplied. Missing model IDs stay
null; a requested model is not evidence of the model actually used upstream.
Authorization headers, credential values and raw upstream error bodies are excluded.

Failures distinguish HTTP, explicit upstream model-support errors, malformed
responses/PNG and size validation. Generic HTTP 400 and wrong dimensions do not
prove model unsupported. A validated, bounded PNG with wrong dimensions remains
a failed job with null shipping path and is saved exclusively under
`.trace/image-diagnostics/JOB_ID/attempt-N.png`, file mode 600.
Its original bytes/hash/dimensions are recorded, without resizing or cropping.
Invalid/corrupt/oversized images are not quarantined. Quarantine write failures
are reported without masking the dimensions; symlink paths are rejected.
The apply operation rejects failed jobs, including quarantined images.

Never retry a real request
to recover lost diagnostics: older receipts cannot retroactively recover response
bytes. A fresh paid test requires a new explicit human approval.

## Native asset dimensions versus canvas dimensions (2026-11-11)

Generation `size` is the requested native raster size, never a canvas declaration.
Receipts keep `dimensions.requested` and `dimensions.source` (actual decoded PNG).
`poster.json.canvas` remains the independent design canvas. A wrong native result
still fails with its original PNG quarantined; adaptation never turns this into
successful provider compliance or silently resizes a source file.

`./dev.sh image fit-preview PROJECT PREVIEW_REQUEST.json` creates read-only previews
in a new directory outside PROJECT. Example request:

```json
{
  "jobId":"b13505e4-f72b-4bbb-bcdb-f757eb1af8a1",
  "target":"region:background",
  "outputDirectory":"/absolute/new/preview-directory",
  "padding":96,
  "fill":"#740a0e"
}
```

This currently supports an empty full-canvas background region. It reads latest
saved design and resource hashes, validates the receipt/source SHA-256, and writes
three 1152×2048 composition PNGs, an unchanged original PNG, dimension/geometry
metadata, and an HTML comparison with source crop outlines. External requests are
blocked before preview navigation. Existing layer positions/content stay intact.
It does not save a design version, promote failed jobs or publish a shipping asset.
Preview includes existing project content: review locally before sharing.

- `contain`: proportional scale, full source visible, uncovered area uses fill.
- `cover`: proportional scale, crop visible in preview; cannot infer subject safety.
- `safe-padding`: contain inside an explicitly padded rectangle; full source visible.

No stretch mode exists. Optional `subject:{x,y,width,height}` uses native source
pixels; a fit that clips that rectangle cannot be applied. This is a deterministic
bounding-box guard, not image understanding. Agent/user pixel review remains required.

For an otherwise successful job, `image apply` now rejects background aspect-ratio
changes without an explicit `fit:{mode,padding?,fill?,subject?}` and matching
`review.fitPreviewHash` from preview.json. `cover` additionally requires human
approval recorded as `review.cropApproved:true`; a clipped declared subject always
fails. Version metadata records fitting source size, canvas size, scale and crop.
Failed/quarantined jobs remain ineligible for apply, even if their fit was previewed.
A later explicit asset-adoption operation would require separate user authorization;
this task does not implement or perform it. No image API request is made by fit-preview.
