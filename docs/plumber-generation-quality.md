# Plumber generation quality (Playtest Round 2 — P2)

Report for the task-conditioned generator redesign: levels are now built from a
task spec, several certified candidates are compared, and the best is kept —
quality is measured, not assumed. Generator version: `plumber-gen/0.4-candidates`.

## What changed
- **Candidate-and-select (§2.2).** `generateLevelReport` builds up to 3 certified
  candidates for the requested family, ranks them with a cheap quality heuristic,
  and keeps the best. The winner then gets full structural analysis.
- **Measured difficulty evidence (§2.3).** Every level carries
  `difficultyEvidence.{essentialLength, decisions, falseAlternatives,
  interactions, meaningfulRatio, blockingMatters, score}` computed by
  `analyzeLevel` (source→receiver reachability over the solved pipe graph).
- **Canonical, rotation-invariant structure (§2.3).** `canonicalFingerprint`
  normalises connectivity + IO roles over the four quarter-turns, so a mere
  rotation of one shape cannot count as variety. `structuralSimilarity` blends
  canonical cell-mask overlap with route/action metrics. (Reflections excluded:
  the tile set is not mirror-symmetric, so a mirror is a genuinely new puzzle.)
- **New topology (§2.1).** `branch`: one source splits at a `t` into **two**
  receivers, so the player must orient the split, not just a single path.
- **Field-density control (§2.4).** Metrics reward meaningful cells and count
  blockers that actually pinch the route; the corpus floor asserts the field is
  mostly meaningful rather than padded with noise.
- **Back-compat.** Existing saves replay their pinned `def`; the generator bump
  only affects newly generated levels.

## Evidence (10 000+ level mass certification)
Source: `evidence/plumber-mass-report.json` (11 100 levels across modes + families).

| metric | value |
| --- | --- |
| levels checked | 11 100 |
| fallback / unsolvable | 0 / 0 |
| positional overlap | 1.0 % |
| logical overlap | 0.6 % |
| **canonical overlap (rotation-invariant)** | **2.0 %** |
| levels missing difficulty evidence | 0 |
| mean essential route length | 4.59 |
| mean decisions (rotatable on route) | 4.27 |
| mean interaction types / level | 1.18 |
| mean meaningful-cell ratio | 48.3 % |
| mean / min quality score | 12.31 / 2.98 |

All 11 100 levels: witness replays to `WON`, volume conserved, scrambled state
never wins, byte-identical regeneration.

## 30 consecutive gameplay levels per mode
Source: `evidence/plumber-quality-sample.json` (script reproduces the game's
`familyForMode` + seed formula).

- 30/30 levels certify per mode; **30/30 structurally distinct** canonical
  fingerprints per mode.
- Families vary within each run (child: path/leakfix/branch; normal includes
  filter/exact/carry/valve/multiflow/branch; expert includes
  valve/mixer/program/multiflow/exact/filter/carry/branch).
- Real initial-state screenshots: `evidence/screenshots/p2-expert-lvl-01..30-dry.png`
  (expert), plus `p2-expert-lvl-13-{running,filled}.png` showing the `branch`
  split (`t` + two receivers) filling to both goals.
- Per-level solution types and metrics: see the JSON rows (`solutionType`,
  `essentialLength`, `decisions`, `falseAlternatives`, `interactions`,
  `meaningfulRatio`, `score`, `canonicalFingerprint`).

## Reproduce
```
npm run typecheck
npm test                 # unit suite (includes P2 generator-quality tests)
npm run test:levels      # mass cert + 20/mode + 30/mode quality samples
npm run test:e2e         # full browser suite
```
