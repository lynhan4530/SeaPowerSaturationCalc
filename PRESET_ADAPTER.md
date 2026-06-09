# Preset Consuming Adapter — `presets.json` → Saturation Planner

This note documents the adapter that turns the `SeaPowerDataExtraction` parser
output (`presets.json`) into the planner's defense model, the derivation it
implements, and the doc/data **mismatches** it reconciles.

Source of truth (parser side, branch `claude/sharp-bell-vlhoez`):
`INTEGRATION.md` (field mapping), `sample-presets.json` (fixture),
`SAMPLE_USAGE.md` (worked example).

## Where it lives

| Concern | File |
|---|---|
| Pure derivation (formulas, defaults, null handling) | `src/lib/presetAdapter.ts` |
| Live wiring into defense layers | `src/lib/vesselSync.ts` (`buildDefenseLayersForShip`) |
| IndexedDB ingest of `presets.json` | `src/lib/db.ts`, `src/hooks/useDbLoader.tsx` |
| Validation against the fixture | `src/lib/__tests__/presetAdapter.test.ts` (+ `fixtures/sample-presets.json`) |

`presetAdapter.ts` is **pure** (no React/DOM/Dexie); callers supply
missile/launcher lookup maps. `vesselSync.ts` does the IndexedDB lookups and
calls into it.

## The derivation (Option B)

```
flightTimeS           = (interceptRangeNm / samSpeedKnots) × 3600
cycleS                = reloadTimeS ?? (60 / fireRatePerMin)
timePerEngagementS    = flightTimeS + cycleS
engagementsPerChannel = floor(raidWindowS / timePerEngagementS)     (clamped ≥ 1)
totalIntercepts       = channels × engagementsPerChannel × pk
leakers               = max(0, inbound − round(totalIntercepts))
```

`engagementsPerChannel` is **app-derived**: it depends on the planner's raid
window (attack geometry), not on any game field. The raid window is
`raidWindowFromGeometry({contact, intercept, attacker, ship})` when salvos exist,
else `DEFAULT_RAID_WINDOW_S` (300 s).

### Validated against the fixture (Ticonderoga, SAMPLE_USAGE walkthrough)

| Quantity | Value |
|---|---|
| channels (2× SPG-62 Targeting, SPY-1A excluded) | 4 |
| RIM-66C Pk | 0.8 |
| flight time @ 30 nm, 600 kt | 180 s |
| MK 13 cycle (`reloadTimeS`) | 4.5 s |
| time / engagement | 184.5 s |
| raid window (50 nm / 482 kt) | 373.4 s |
| engagementsPerChannel = ⌊373.4 / 184.5⌋ | **2** |
| totalIntercepts = 4 × 2 × 0.8 | **6.4** |
| leakers of 12 inbound = 12 − round(6.4) | **6** |

## Mismatches found & how they're reconciled

1. **`cycleS`: formula 4.5 s vs walkthrough 6.5 s.** `INTEGRATION.md` defines
   `cycleS = reloadTimeS ?? 60/fireRatePerMin`, which is **4.5 s** for the MK 13.
   The `SAMPLE_USAGE.md` prose uses **6.5 s** ("reload + re-aim"), adding a ~2 s
   re-aim term that is not in the formula or in any preset field. The adapter
   follows the **documented formula (4.5 s)**; re-aim/slew is unmodeled. Harmless
   here: `⌊373.4/184.5⌋ = ⌊373.4/186.5⌋ = 2`.

2. **`totalIntercepts`: with or without Pk.** `INTEGRATION.md` writes
   `totalIntercepts = channels × engagementsPerChannel` and applies Pk only in
   `leakers = max(0, N − round(totalIntercepts × pk))`. `SAMPLE_USAGE.md` and the
   task spec write `totalIntercepts = channels × eng × pk = 6.4`. These give
   **identical leakers** (`round(channels×eng×pk)` either way). The adapter adopts
   the **Pk-inclusive "expected kills" form** so the headline number is the 6.4
   the walkthrough reports.

3. **Raid window 373.4 s vs "≈374 s".** The walkthrough rounds loosely; the
   adapter computes the exact value. No effect on the engagement count.

4. **Channel source: sum directors vs read `weaponChannels`.**
   `INTEGRATION.md` says "sum directors where `type === 'Targeting'`"; the agreed
   design decision (and `SAMPLE_USAGE.md`) says "`weaponChannels` is pre-computed,
   don't re-sum." The adapter **reads `ship.weaponChannels` directly**, cross-checks
   it against the resolved Targeting-director sum, and **warns** on a mismatch
   (both are 4 in the fixture). `DirectedSearch` directors (SPY-1A, 24 ch) are
   excluded from the headline but stay in the data for command-guidance modeling.

5. **Null values are expected, never zero.** `MK 46.killProbability` is `null`;
   the adapter substitutes a **guidance-family default** (`defaultPkForGuidance`,
   warned) rather than assuming 0. CIWS Pk comes from
   `launcher.missileInterceptChance / 100`. Unresolvable engagement timing
   (e.g. null interceptor speed) falls back to `engagementsPerChannel = 1` (the
   documented single-shot default), with a warning.

## Live wiring & a semantic caveat

`buildDefenseLayersForShip` now derives `engagementsPerChannel` for each SAM from
interceptor kinematics + the missile mount's launcher cycle (replacing the old
hardcoded `1`). Consequences:

- Long-flight **area SAMs** (RIM-66C, 70 nm @ 600 kt) collapse to a single
  engagement at the default window — unchanged from before.
- Fast / short-range **point-defense** missiles earn multiple engagements.
- **CIWS stays at `engagementsPerChannel = 1`.** Its re-fire is already modeled in
  `calc.ts` via the gun cadence + radar-horizon reach (deviation #6); feeding the
  AK-630's ~14 ms cycle into this raid-window formula would produce thousands of
  spurious engagements.

The doc's "engagements over the whole raid" maps cleanly onto the planner's
per-window model **because saturation attacks are synchronized into one arrival
window** (`solveGroup` drives every salvo to a single `synchronizedArrivalTimeS`),
so re-engagements-per-window equals re-engagements-per-raid.

The `estimateShipSaturation()` headline estimate is a standalone, geometry-aware
"quick check" (channels / Pk / leakers) that does not depend on, and does not
disturb, the probabilistic per-window simulation in `calc.ts`.
