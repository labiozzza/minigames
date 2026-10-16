---
name: minigames-assetgen
description: Creates, validates, slices, packs and registers Phaser game sprites for MiniGames using available GPT Image API, and produces primitive PLACEHOLDER fallbacks when generation or quota is unavailable. Use for requests for pipes, valves, reservoirs, environments, spritesheets and game art.
compatibility: opencode
metadata:
  workflow: image-assets
  opencode/slash: "true"
---

# MiniGames AssetGen skill

Read `03_ASSETGEN_AGENT_SPEC.md` from the project root if present. Follow all of its gates; this skill does not itself grant access to ChatGPT image generation.

## On receiving a request

1. Read existing asset registry, StyleBible and approved reference images. Check duplicates. Confirm logical ports, pivot, dimensions, style_id, source geometry. If the style has not been approved, produce reference candidates but do **not** silently approve the style.
2. Create one structured request per static tile/animation state. For grid-based pipes prefer generating individual PNGs rather than asking Image Gen for a multi-frame sheet.
3. Submit to the queue; use official OpenAI Image API **only if** actually configured and within budget. API limits and ChatGPT limits are independent; no invented access or quotas.
4. Local validation: RGBA, alpha truly transparent outside sprite, bounds/padding, object presence, no cropping, safe dimensions; previews over light/dark/checkerboard. Do not flatten glass transparency.
5. Independent review: geometry/ports on rotation + style/semantics against approved reference images with an actual vision-capable reviewer or human. Do not declare style approved based on histograms or alpha check alone.
6. Resize within logical cell without distorting shape. Slice only with explicit grid coordinates; build atlas and metadata. Verify screenshots in a real Phaser scene.
7. A failed review generates diagnostics and at most 3 attempts. If exhausted => `MANUAL_REVIEW_REQUIRED`; never turn failed candidate into final asset.
8. If provider unavailable, unavailable image tool, quota, billing or key issue => generate **technical primitives immediately** under `PLACEHOLDER`, keep original request pending. Continue the caller's independent work. Do not wait idly or claim a future automatic retry unless an external worker/scheduler is running.
9. Return a machine-readable manifest with explicit statuses (`APPROVED`, `PLACEHOLDER`, `WAITING_FOR_LIMITS`, `WAITING_FOR_PROVIDER`, `MANUAL_REVIEW_REQUIRED`, `BLOCKED_CONFIG`) and exact paths, evidence, next recommended actions.

## Suggested initial commands

From project root after installing `Pillow` (see `requirements.txt`):

```bash
python .opencode/skills/minigames-assetgen/scripts/assetgen.py validate --file path/to/sprite.png --padding 12
python .opencode/skills/minigames-assetgen/scripts/assetgen.py placeholder --kind pipe-elbow --size 256 --output assets/_placeholder/pipe_elbow.png
python .opencode/skills/minigames-assetgen/scripts/assetgen.py slice --file path/to/sheet.png --cols 4 --rows 2 --outdir assets/_sliced
python .opencode/skills/minigames-assetgen/scripts/assetgen.py atlas --inputs assets/_sliced/*.png --output assets/atlas.png --meta assets/atlas.json
```

The CLI performs **local preparation, not generation via a remote API**, unless OpenCode implements/configures a separate actual provider runner. Never report remote generation performed just because a request exists. Images for pipe masks are based on precise game geometry, not vision guesses. Maintain registries and queue until every required asset is approved.

## Gate for done

`DONE` is possible only when approved source + metadata + geometry + technical validation + visual review + Phaser integration screenshots/video are all present. PLACEHOLDER never equals DONE. If blocked, report PARTIAL with the completed code and remaining graphics tasks.
