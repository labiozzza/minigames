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
2. Client sync → `src/platform/{api,sync,auth}` + IDB queue + shell UI (in progress).
3. Pipe liquid → channel geometry + masked layers (planned, R2).
4. Test bypasses → `__TEST_HOOKS__`, hashed secrets, schema validation (done).
5. Modes → explicit `mode` field + per-mode save (R3).
6. Solver/generator → action model + bounded search + 10k mass (R3).
7. Input/camera → touch drag/pinch + keyboard + context (R3).
8. Onboarding → action-based (R3).
9. Collections/dioramas → unique objects + animated sets (R3/R4, art BLOCKED_ASSET).
10. Daily+weekly → both entries + server manifest cache (R4).
11. Share → full-definition URL+code preserve mode/versions (R3).
12. Accessibility/sound/quality → settings + auto-quality (R3).
13. Game/PWA versioning → migrations + hybrid cache (R5).
14. Admin panel → web UI + real preview/publish/rollback (R5).
15. Analytics/consent/notifications (R5).
16. Devtools (R5).
17. AssetGen reconcile (R5).
18. CI + independent verification (R5).
19. Docs consistency (R6).
