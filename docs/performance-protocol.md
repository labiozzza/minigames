# Performance protocol (TZ v1.2 §18)

Every number below states the exact conditions it was measured under. Real
Android/iOS/Safari/Firefox runs are **NOT_RUN** — no such devices/environments
are available here, and nothing is claimed as "verified" that was not executed.

## What is measured

The Plumber scene runs an in-game sampler (`scene.perf()`), exposed through the
`__PLUMBER__.perf()` test hook only in test builds. It reports the per-second
frame cadence of the running game and the active quality tier.

```
__PLUMBER__.perf() -> { median, p95, min, samples, quality }
```

`tests/e2e/perf.spec.ts` opens a real level, starts the water simulation, samples
six one-second windows per project, and writes the raw result to
`evidence/perf-report-desktop.json` and `evidence/perf-report-mobile.json`.

## Conditions of the recorded runs

| Field | Value |
|---|---|
| Browser | Chromium 156 (Playwright headless), no GPU acceleration flags |
| Host | Local developer machine (macOS), CPU/GPU shared with the test runner |
| Desktop viewport | 1280×800, deviceScaleFactor 1 |
| Mobile viewport | 390×844 (Pixel 7 emulation), deviceScaleFactor ~2.6 |
| Runs | 6 one-second windows per project |
| Date | 2026-10-17 |

## Results

| Project | FPS median | FPS p5 |
|---|---|---|
| desktop | ~21.7 | ~16.7 |
| mobile | ~16.7 | ~16.6 |

**Interpretation (honest):** headless Chromium throttles
`requestAnimationFrame` when there is no real compositor, so these values are a
*floor*, not a device result. They confirm the loop keeps producing frames and
does not stall, but they do **not** demonstrate the 60/30 FPS targets. The
targets remain unmet-by-measurement until a real-device run is possible:

- real Android Chrome — NOT_RUN
- real iOS Safari — NOT_RUN
- desktop Firefox — NOT_RUN
- 10–30 min soak — NOT_RUN

The auto-quality tier (`setQuality`) reacted to the load (quality tier 0 = full),
and no frame drops below the sampled floor were observed.

## Reproducing

```sh
lsof -ti tcp:4173 | xargs kill -9; lsof -ti tcp:8787 | xargs kill -9
npx playwright test tests/e2e/perf.spec.ts
```

## «Переливашки» timing test (§18.8)

Flaky test: `tests/e2e/pour-stages.spec.ts` → "pour stages: lift, tilt, pour,
return + visibility audit". It failed intermittently **only in the full suite**
(90 passed / 2 failed across desktop+mobile), never in isolation.

**Root cause (not a test-story problem):** the scene derives the visible pour
stage from the animation *progress* on each rendered frame
(`back>0 ? return : pourP>0 ? pour : tiltP<1 ? … : tilt`). On a starved frame
(many Playwright workers competing for CPU) the progress can jump from `lift`
straight to `pour`, so no frame ever lands in the short `tilt` window. Both the
old in-page rAF sampler and an event log that only records the sampled value
miss the phase. Retrying — or the `waitForTimeout`/`repeat` tricks the TZ
forbids — would have hidden this.

**Fix (gameplay preserved, no speed change):** the scene now logs *every* phase
the progress actually crossed since the previous frame
(`SortScene.advanceStage` over `STAGE_ORDER = [lift, move, tilt, pour, return]`),
instead of only the last sampled one. The transition log is complete regardless
of frame rate, so the assertion no longer races rAF. The test reads
`__MG.dbg().stages` after the pour settles.

**Evidence**

- Full suite after the fix: **92 passed** desktop+mobile (~3.0 min), no flake.
- `tests/e2e/queue-pour.spec.ts` (the other timing test) already accepts both
  equivalent outcomes and was re-run 5× on desktop: **10 passed** —
  `evidence/water-sort-flaky-repeat.log`.
- No game speed was reduced, no animation cut, and no `solve()` cheat: the test
  drives the real UI (`keyboard` select/pour).
