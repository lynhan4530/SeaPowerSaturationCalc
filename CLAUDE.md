# CLAUDE.md — Sea Power Saturation Planner

Fire-control planning web app for the game *Sea Power*. Greenfield build from
`PRD.md`. Pure client-side React; no backend, no auth.

## Tech stack

- Vite 5 + React 18 + TypeScript 5.6 (strict mode, no `any`)
- Tailwind CSS 3 (custom palette in `tailwind.config.js`)
- State: `useReducer` + Context (no external state lib). See `src/hooks/useScenario.tsx`.
- Persistence: `localStorage`. See `src/lib/storage.ts`.
- Tests: Vitest + jsdom. Suite lives in `src/lib/__tests__/calc.test.ts` (TC-01..46).

## Commands

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
npm install         # one-time
npm run dev         # Vite dev server at http://localhost:5173/
npm test            # Vitest
npx tsc --noEmit    # typecheck only
```

The `$env:Path` line is only needed if PowerShell was opened before Node was
installed; new windows pick up PATH automatically.

## Build plan

See `C:\Users\lynha\.claude\plans\read-the-prd-md-file-validated-wolf.md`
for the full plan. The original six stages are **all shipped**:

1. **Foundation** ✅ — types, geo, storage, reducer, missile library modal
2. **Left Panel** ✅ — friendly ships, target ships, CompassInput, DefenseLayerEditor (drag reorder)
3. **Solver** ✅ — `src/lib/calc.ts` + Vitest suite (TC-01..17, TC-21..27, TC-35..36)
4. **Results Panel** ✅
5. **Timeline** ✅
6. **Polish** ✅ — Header (scenarios CRUD + import/export), theming, badges

### Post-launch work

- **Inverse solver** ✅ shipped on branch `feat/inverse-solver` (PR #1, left open
  for review). `solveInverseSaturation()` in `calc.ts` is the pure dual of
  `computeLayerBreakdown`: under synchronized arrival,
  `minSaturatingSalvo = Σ(interceptsPerWindow over engaging layers) + 1`. Surfaced
  as `SaturationThresholdCard` in `ResultsPanel`. Tests TC-41..46.
- **Channel-based defense + leak probability** ✅ built on branch
  `feat/channel-defense` (design in `PHASE2_DESIGN.md`). A `DefenseLayer` now holds
  `weaponSystems: WeaponSystem[]` (each `{guidance, channels, engagementsPerChannel,
  pk, min/maxRangeNm}`) instead of a flat `interceptsPerWindow`. Per window a layer
  fires `Σ engaging channels × engagementsPerChannel` shots, dealt one per live
  missile per pass (best-pk first); each missile carries a survival probability
  `q ×= (1 − pk)`. Verdict is now probabilistic: `hullImpacts = Σ q`,
  `saturationProbability = 1 − Π(1 − q)`, `saturated = saturationProbability ≥
  scenario.saturationConfidence` (default 0.5, editable in the Results header).
  At `pk = 1` it reduces exactly to the old integer model — the migration anchor
  (`storage.ts migrateScenario` synthesizes one pk=1 SARH system per legacy layer).
  Tests TC-47..55. Channel/pk data will come from the handed-off `presets.json`
  parser. **Branched off `feat/inverse-solver`**, so this branch also contains the
  inverse solver (PR #1); merge order matters.
- **`presets.json` parser** — handed off to a separate agent (Option B).

## PRD deviations (decided with user — do not silently revert)

The PRD has five internal inconsistencies that were resolved before coding.
**These take precedence over PRD wording.**

| # | Topic | Rule |
|---|---|---|
| 1 | Bearing clustering | **8 fixed 45° buckets** (N/NE/E/SE/S/SW/W/NW), bucket N = 337.5°–22.5°. Replaces the broken `floor(((bearing+15) % 360) / 30)` formula. TC-27 passes naturally. |
| 2 | Wait + reposition order | **Reposition first, then wait at firing point.** `fireTimeS = repositionTimeS + waitTimeS`. The PRD's stated `fireTimeS = repositionTimeS` and TC-09 wording need updating in Stage 3. |
| 3 | Target closing the gap | **Pre-check before iterative loop.** If target is closing on a stationary ship, set `repositionTimeS = 0` and `waitTimeS = (range - missileMaxRange) / targetClosingSpeed * 3600`. Required for TC-10. |
| 4 | Defense-layer window timing | **Sliding window from first arrival in each layer.** First arrival opens window 0; arrivals within `windowS` of it stay in window 0; first outside opens window 1. |
| 5 | Defense-layer envelope check | **At arrival (range ≈ 0).** Engages iff `0 ∈ [minRangeNm ?? -∞, maxRangeNm ?? +∞]`. Note: this makes `maxRangeNm` effectively useless for any positive value. TC-24 needs rewriting: 95nm salvo, SM-2 max 80nm → SM-2 **engages** (0 < 80). Post-Phase 2 this check is **per weapon system**, not per layer. |

## File structure

```
src/
  types.ts              — single source of truth for all entities
  App.tsx, main.tsx
  hooks/
    useScenario.tsx     — reducer + Context + 50-state history stack + persistence
  lib/
    geo.ts              — projectPosition, bearingTo, distance (pure, no React)
    storage.ts          — localStorage I/O, export/import, Phase 2 layer migration
    calc.ts             — solver, group sync, clustering, probabilistic defense sim, inverse solver
    __tests__/calc.test.ts — Vitest suite (TC-01..55)
  components/
    Header.tsx, LeftPanel.tsx, RightPanel.tsx
    CompassInput.tsx, DefenseLayerEditor.tsx, MissileLibrary.tsx
    ResultsPanel.tsx, Timeline.tsx
```

`PHASE2_DESIGN.md` (repo root) holds the channel-based-defense design note.

## Conventions

- **No `any`** anywhere in TypeScript.
- `calc.ts` and `geo.ts` are **pure** — zero React/DOM imports.
- All entity ids use `crypto.randomUUID()`.
- New scenarios default: `simultaneityToleranceS: 10`, `repositionWarningThresholdS: 3600`, `saturationConfidence: 0.5`.
- Bearings normalized to [0, 360); inputs clamped on edit.
- Numbers shown to user: 1 decimal for nm/kts, whole seconds for time.
- Custom Tailwind colors: `navy`, `panel`, `panelBorder`, `textPrimary`, `textSecondary`, `amberAccent`, `redAccent`, `greenAccent`. Use those instead of raw hex.

## What NOT to add

The PRD's "What NOT to Build" list is binding. No map rendering, no real lat/lon,
no multiplayer, no backend, no auth, no animation on timeline bars, no mobile
layout. Drag-to-reorder is **only** for defense layers in Stage 2.
