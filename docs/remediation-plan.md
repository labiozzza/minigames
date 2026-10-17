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
10. Daily+weekly → both entries + server manifest cache (R4, done; weekly cloud sync PARTIAL).
11. Share → full-definition URL+code preserve mode/versions (done).
12. Accessibility/sound/quality → settings + auto-quality (R3, done; real-device FPS/long soak NOT_RUN).
13. Game/PWA versioning → migrations + hybrid cache (R5, done).
14. Admin panel → web UI + real preview/publish/rollback (R5, done).
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
| 2026-10-17 | _§10_ | §10 daily + weekly challenges | PARTIAL (weekly cloud sync) | one row with a "Задание дня" and a "Недельное испытание" entry; server manifest `challenge/1` pre-generates ≥7 daily + ≥2 weekly per mode with deterministic seeds (fnv parity with client); daily rolls at UTC midnight, weekly on Monday (non-Monday rejected 404); finished day archived in the panel; challenge replay keeps a single best score (double-reward safe); challenge wins never touch campaign `maxLevel`/collections; offline shows cached tasks with an honest note. Tests: `tests/unit/plumber-challenges.test.ts` 5/5, `server/tests/server.test.ts` manifest/resolve, `tests/e2e/challenge.spec.ts` 2/2 desktop+mobile (fake UTC clock). Weekly results are local-only (`save.weeklies`, not synced) → cloud weekly sync PARTIAL |
| 2026-10-17 | _§12_ | §12 accessibility, sound, auto-quality, renderer fallback | PARTIAL (real-device FPS/soak NOT_RUN) | shared settings: high contrast, large UI, reduced motion, flash-free, no-drag, quality pin; applied as `<html>` classes and synced into the profile (customised fields win conflicts); colour-independent liquid symbols in the pipe scene; leak/fill cues + separate music/sfx volume + audio suspend on hidden + vibration gated by settings; auto-quality measures real p95 frame time and steps decoration down/up (never physics/masks/colours/command order); WebGL unavailable → Canvas fallback (no black screen), `?renderer=canvas` override. Tests: `tests/unit/plumber-a11y.test.ts` 4/4, `tests/e2e/a11y.spec.ts` 4/4 desktop+mobile. Real-device 60/30 FPS and 10–30 min soak = NOT_RUN |
| 2026-10-17 | _§13_ | §13 game/PWA versioning, migrations, hybrid cache | DONE | save schema v3 (v1→v2 assembly + v2→v3 additive normalisation), pre-migration backup + one-tap restore, corrupt/future snapshots rejected, no level duplication; per-game asset cache (`mg-game-<id>-v<assets>`) for download/free that never touches the IndexedDB save; SW `skipWaiting:false` so updates never swap an active trial. Tests: unit `plumber-versioning` 5/5 + `plumber-offline` 3/3; e2e `offline.spec.ts` 3/3 (offline first-launch/relaunch, download+free keeps save, deferred update mid-trial). Ленивые чанки (code-split modules) — существующий bundler, отдельного per-game chunk пока нет → PARTIAL по ленивости |
| 2026-10-17 | _§14_ | §14 real admin panel: draft, strict schema, certified preview, publish, audit, rollback | DONE | separate `admin.html` entry (real clicks; every `/admin/*` route returns 403 for a player); draft editor for generator/mechanics/collections/challenges/modules; strict schema validation (unknown key/type/range rejected 422 with field list); preview and publish run **real** generator+certification on a seed batch (replay to WON, volume conserved, no trivial win) — publish refused below `minSeeds` or on any rejected level; each published version stores checksum (fnv1a), revision, who/when and changed-field list; history is immutable and rollback re-publishes the previous snapshot as a new version (no destructive pop); public `/games/:id/config` returns revision+checksum and a level pins `configRevision` for its whole life (persisted in the active snapshot). Tests: `server/tests/config-schema.test.ts` 4/4, server admin pipeline (draft/preview/publish/rollback/audit/403), `tests/e2e/admin.spec.ts` 2/2 desktop+mobile (player 403, admin draft→preview→blocked publish→publish→rollback), `plumber-versioning` pin test. Admin panel does not publish emails/tokens in reports |
| 2026-10-17 | _§15_ | §15 analytics with data minimisation/consent, optional push, data rights (export/erase) | DONE | two telemetry channels: mandatory PII-free `diag` (`perf_sample/sync_ok/sync_fail`, tied to the user for export/erase) and optional `analytics` (server requires a versioned `scope:'analytics'` consent, otherwise `{ok:false,reason:'no-consent'}` and nothing is stored; stored anonymised with `userId=null`); `childMode` limits analytics to `app_open/game_open/level_start`; retention 180 days; client `recordDiag`/`recordAnalytics` gated by consent and a revoked consent drops the queue; notifications are strictly opt-in from an explicit button (no auto `Notification.requestPermission`), real `PushManager` subscribe/unsubscribe + `/push/*` endpoints, honest `pending-deployment` when no VAPID is configured (live delivery BLOCKED_EXTERNAL); data rights `GET /me/export` + `POST /me/erase` (erasure also drops sessions) surfaced in settings behind sign-in; SW push handler `public/push-sw.js`. Tests: `tests/unit/telemetry.test.ts` 4/4, `tests/unit/notifications.test.ts` 3/3, `tests/e2e/privacy.spec.ts` 2/2 desktop+mobile, server telemetry/data-rights/report tests. Cross-field minimisation (unknown/nested fields) dropped server-side |
| 2026-10-17 | _§16_ | §16 dev diagnostics, replay, developer editor | DONE | dev/test-only panel (live ports/directions/volumes/colours/valves/tick/seed/versions/FPS/generator+solver state) mounted only when `__TEST_HOOKS__`; a versioned `plumber-diag/1` JSON captures the start `LevelDefinition`, tick-stamped command log and per-step checksums and replays 1:1 through the official model (version gate refuses cross-version replay, tampering is detected as `checksum-mismatch`); dev editor ops (place/remove/rotate/source/receiver/inventory) with a certify save-gate that refuses any publicly invalid level (no-win / volume / trivial-win / not-solvable); batch `generate→certify→report` keeps rejections and converts them to fixtures; export sanitises PII-like keys. Tests: `tests/unit/plumber-devtools.test.ts` 7/7, `tests/e2e/dev.spec.ts` 2/2 (real session export → fresh-browser import with 100% phase/checksum match; batch + certify for real). Release guard now also fails on `__PLUMBER_DEV__`/`dev-panel`/`plumber-diag/`, so the editor is absent from the production bundle |
| 2026-10-17 | _§17_ | §17 AssetGen single queue, provenance audit, fallback right | DONE | `assetgen.py reconcile` makes `registry.json` the single canonical status source and `budget.json` the canonical budget ledger: legacy `WAITING_FOR_PROVIDER`/`approved=false` jobs are migrated to the registry state; every registry asset gets a synced (or synthesised) job file so queue and registry agree; APPROVED files are re-validated (missing/opaque/RGB → downgraded to placeholder/rejected with reason + primitive placeholder emitted, queue kept pending for provider-unavailable); per-PNG provenance records provider/origin/source/sha256/size/alpha/bbox/style_id/prompt-hash/version/license/ports + ports-after-rotation/previews/phaser snapshot; atlas metadata frame-match is checked against shipped files. Re-run is idempotent (`changed: 0`); the 11 previously approved tiles are preserved. Tests: `assetgen` unittest 6/6 (canonical+idempotent, opaque→rejected, missing→placeholder). Not yet DONE for new story assets (still placeholder-pending, provider BLOCKED_EXTERNAL) |
| — | — | §18 P2 | TODO | — |

** Art-dependent item: temporary geometric prototypes allowed, kept `BLOCKED_ASSET`
until real assets exist. Postgres/external items marked `BLOCKED_EXTERNAL`.

