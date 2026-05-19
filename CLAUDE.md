# CLAUDE.md — Sea Power Saturation Planner

Fire-control planning web app for the game *Sea Power*. Greenfield build from
`PRD.md`. Pure client-side React; no backend, no auth.

## Tech stack

- Vite 5 + React 18 + TypeScript 5.6 (strict mode, no `any`)
- Tailwind CSS 3 (custom palette in `tailwind.config.js`)
- State: `useReducer` + Context (no external state lib). See `src/hooks/useScenario.tsx`.
- Persistence: `localStorage`. See `src/lib/storage.ts`.
- Tests: Vitest + jsdom (added but not yet exercised — Stage 3 will populate).

## Commands

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
npm install         # one-time
npm run dev         # Vite dev server at http://localhost:5173/
npm test            # Vitest (Stage 3 onwards)
npx tsc --noEmit    # typecheck only
```

The `$env:Path` line is only needed if PowerShell was opened before Node was
installed; new windows pick up PATH automatically.

## Build plan

See `C:\Users\lynha\.claude\plans\read-the-prd-md-file-validated-wolf.md`
for the full plan. Six stages:

1. **Foundation** ✅ — types, geo, storage, reducer, missile library modal
2. **Left Panel** ✅ — friendly ships, target ships, CompassInput, DefenseLayerEditor (drag reorder)
3. **Solver** ⬜ — `src/lib/calc.ts` + Vitest suite (TC-01..17, TC-21..27, TC-35..36)
4. **Results Panel** ⬜
5. **Timeline** ⬜
6. **Polish** ⬜ — Header (scenarios CRUD + import/export), theming, badges

## PRD deviations (decided with user — do not silently revert)

The PRD has five internal inconsistencies that were resolved before coding.
**These take precedence over PRD wording.**

| # | Topic | Rule |
|---|---|---|
| 1 | Bearing clustering | **8 fixed 45° buckets** (N/NE/E/SE/S/SW/W/NW), bucket N = 337.5°–22.5°. Replaces the broken `floor(((bearing+15) % 360) / 30)` formula. TC-27 passes naturally. |
| 2 | Wait + reposition order | **Reposition first, then wait at firing point.** `fireTimeS = repositionTimeS + waitTimeS`. The PRD's stated `fireTimeS = repositionTimeS` and TC-09 wording need updating in Stage 3. |
| 3 | Target closing the gap | **Pre-check before iterative loop.** If target is closing on a stationary ship, set `repositionTimeS = 0` and `waitTimeS = (range - missileMaxRange) / targetClosingSpeed * 3600`. Required for TC-10. |
| 4 | Defense-layer window timing | **Sliding window from first arrival in each layer.** First arrival opens window 0; arrivals within `windowS` of it stay in window 0; first outside opens window 1. |
| 5 | Defense-layer envelope check | **At arrival (range ≈ 0).** Layer engages iff `0 ∈ [minRangeNm ?? -∞, maxRangeNm ?? +∞]`. Note: this makes `maxRangeNm` effectively useless for any positive value. TC-24 needs rewriting: 95nm salvo, SM-2 max 80nm → SM-2 **engages** (0 < 80). |

## File structure

```
src/
  types.ts              — single source of truth for all entities
  App.tsx, main.tsx
  hooks/
    useScenario.tsx     — reducer + Context + 50-state history stack + persistence
  lib/
    geo.ts              — projectPosition, bearingTo, distance (pure, no React)
    storage.ts          — localStorage I/O, export/import with rename-on-collision
    calc.ts             — Stage 3: solver, group sync, clustering, layer breakdown
  components/
    Header.tsx, LeftPanel.tsx, RightPanel.tsx
    CompassInput.tsx, DefenseLayerEditor.tsx, MissileLibrary.tsx
    ResultsPanel.tsx, Timeline.tsx  (later stages)
```

## Conventions

- **No `any`** anywhere in TypeScript.
- `calc.ts` and `geo.ts` are **pure** — zero React/DOM imports.
- All entity ids use `crypto.randomUUID()`.
- New scenarios default: `simultaneityToleranceS: 10`, `repositionWarningThresholdS: 3600`.
- Bearings normalized to [0, 360); inputs clamped on edit.
- Numbers shown to user: 1 decimal for nm/kts, whole seconds for time.
- Custom Tailwind colors: `navy`, `panel`, `panelBorder`, `textPrimary`, `textSecondary`, `amberAccent`, `redAccent`, `greenAccent`. Use those instead of raw hex.

## What NOT to add

The PRD's "What NOT to Build" list is binding. No map rendering, no real lat/lon,
no multiplayer, no backend, no auth, no animation on timeline bars, no mobile
layout. Drag-to-reorder is **only** for defense layers in Stage 2.
