# Remediation plan — ТЗ v1.2 (R0–R6)

Baseline: `278801b` (branch `feat/plumber-tz-v1.1-assetgen`). Addendum read in
full: `04_PLUMBER_REMEDIATION_TZ_v1.2.md`, `README.md`,
`05_OPENCODE_START_PROMPT.md`. The 69 approved decisions remain binding.

## Priority map (per ТЗ §0.2)
- **P0** (product/safety): server storage integrity, client↔account↔backend
  sync, liquid rendering inside pipe geometry, removal of test/dev bypasses
  from release.
- **P1**: three selectable modes, generator/solver quality + 10k mass test,
  real input/camera, reading-free onboarding, collections/dioramas, daily**+weekly**,
  correct share links/codes, accessibility/sound/quality adaptation.
- **P2**: admin web panel, analytics/consent, notifications, devtools, PWA
  versioning/migrations, AssetGen single source of truth, CI, docs.

## Risk register
| Risk | Mitigation |
|---|---|
| Breaking Water Sort | never rewrite it; regression suite after each phase |
| FileStore fix changing API shape | additive `syncSave` on `Store`; records keep fields |
| pg dependency leaking into PWA bundle | `pg` is devDependency + only imported by `server/` |
| Release bundling test hooks | `__TEST_HOOKS__` compile-time flag + `check:release` gate |
| Migration data loss | additive migrations, indexed unique keys, no destructive ops |

## Section → work mapping (details in `docs/remediation-report.md`)
1. Storage → FileStore+syncSave (done), PgStore+migrations (done, live run BLOCKED_EXTERNAL).
2. Client sync → `src/platform/{api,sync,auth}` + IDB queue + shell UI (done).
3. Pipe liquid → channel geometry + masked layers (done, R2).
4. Test bypasses → `__TEST_HOOKS__`, hashed secrets, schema validation (done).
5. Modes → explicit `mode` field + per-mode save (R3).
6. Solver/generator → action model + bounded search + 10k mass (done).
7. Input/camera → touch drag/pinch + keyboard + context (R3).
8. Onboarding → action-based (R3).
9. Collections/dioramas → unique objects + animated sets (R3/R4, art BLOCKED_ASSET).
10. Daily+weekly → both entries + server manifest cache (R4).
11. Share → full-definition URL+code preserve mode/versions (done).
12. Accessibility/sound/quality → settings + auto-quality (R3).
13. Game/PWA versioning → migrations + hybrid cache (R5).
14. Admin panel → web UI + real preview/publish/rollback (R5).
15. Analytics/consent/notifications (R5).
16. Devtools (R5).
17. AssetGen reconcile (R5).
18. CI + independent verification (R5).
19. Docs consistency (R6).

## Progress log
| Date (UTC) | Commit | Item | Status | Evidence |
|---|---|---|---|---|
| 2026-10-17 | `08c7771` | §1 FileStore/`syncSave`/pg init | DONE (pg live BLOCKED_EXTERNAL) | `server/tests/{store,pg}.test.ts` 23 passed / 6 skipped |
| 2026-10-17 | `6086299` | §3 liquid inside pipe channel | DONE | `tests/unit/plumber-channel.test.ts` (48); e2e plumber 6/6; screenshots |
| 2026-10-17 | `eef6817` | §2 client↔account↔backend sync (whole platform) | DONE | unit sync-merge (7), server idempotency/stats/CORS/OTP (4), e2e `sync.spec.ts` 2/2 (two contexts) |
| 2026-10-17 | `364a59e` | §11 short codes preserve `(mode, level)`; shared progress isolated | DONE | unit round-trip; e2e `share.spec.ts` 2/2 (identical across contexts) |
| 2026-10-17 | `cbcd733` | §6 generator/solver proof at scale | DONE | 10000+ mass, 0 fails; `diagnose()` statuses; `evidence/plumber-mass-report.json` |
| 2026-10-17 | _§5_ | §5 three independent selectable modes + lossless v1→v2 migration | DONE | save schema v2 (`modes`/`selected`, per-mode `maxLevel/completed/active`, mirror kept); per-mode family schedule; server `modes` merge; mode-selector UI. Tests: `plumber-save` (11 incl. migration/stability/no-loss), server per-mode (2), e2e `modes.spec.ts` 2/2 (desktop) |
| 2026-10-17 | _§7_ | §7 full input, camera, contextual UI | DONE | tap/long-press/drag-drop via real pointer+touch, guarded accidental rotation, pinch+wheel zoom (clamped), 1-finger pan when zoomed, release-outside cancel, keyboard (arrows/Enter/space/V/Z/Y/H/N) + visible focus ring, min 44px targets. Tests: `tests/e2e/input.spec.ts` 5/5 desktop + mobile |
| 2026-10-17 | _§8_ | §8 reading-free onboarding | DONE | guide follows the certified witness and highlights the real cell/button with an action icon (rotate/valve/carry/start); single guided tap performs the action; mechanic unlocks introduce valve/filter/carry/multiflow/mixer/program on their levels; failure cause pulses on the real leaking cell; non-text skip, reduced-motion safe. Tests: `tests/unit/plumber-tutorial.test.ts` 4/4, `tests/e2e/onboarding.spec.ts` 3/3 desktop+mobile |
| 2026-10-17 | _§9_ | §9 collections & dioramas | PARTIAL (art BLOCKED_ASSET) | 12 unique versioned projects in 4 themed sets (garden/city/industry/special); theme derived from level goals (not random); album grouped by set with locked silhouettes and tap-to-alive; completed set opens a full-screen living composition (touch interactive, no distortion at 390×844); unlocked object gets a skippable "came alive" flourish. Prototype geometry used (never emoji) — final unique art = BLOCKED_ASSET. Tests: `tests/unit/plumber-collections.test.ts` 3/3, `tests/e2e/collection.spec.ts` 2/2 desktop+mobile |
| — | — | §10 daily+weekly, §12 a11y/quality, §13 versioning | TODO | — |
| — | — | §14–§18 P2 | TODO | — |

** Art-dependent item: temporary geometric prototypes allowed, kept `BLOCKED_ASSET`
until real assets exist. Postgres/external items marked `BLOCKED_EXTERNAL`.

