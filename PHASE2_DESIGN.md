# Phase 2 — Channel-Based Defense Model + Leak Probability

Design note. **No code yet** — review this first. Drafted 2026-05-21.

Decisions locked with the user before drafting:

1. **Scope:** channels **and** Pk leak-probability in the first build (not channels-only).
2. **Data model:** weapon-system sub-entities under each layer (not flat fields on the layer).
3. **Formula:** per-window cap = `Σ channels × engagementsPerChannel` (re-engagement multiplier in).

---

## 1. Why this change

The current `DefenseLayer.interceptsPerWindow` is a hand-typed flat kill cap. The
game models saturation precisely: a SARH SAM needs an illuminator radar locked
through terminal homing, so a ship's **simultaneous-guidance channel count** is
the real saturation ceiling. A CIWS kills with a literal per-engagement
probability (`MissileInterceptChance`). Phase 2 replaces the hand-wave with that
structure and turns the binary **SATURATED / DEFENDED** verdict into a **leak
probability**.

---

## 2. New type model (`types.ts`)

```ts
export type GuidanceType = 'SARH' | 'ARH' | 'gun';

export type WeaponSystem = {
  id: string;                    // crypto.randomUUID()
  name: string;                  // e.g. "SM-2MR / SPG-62"
  guidance: GuidanceType;        // SARH = illuminator-bound, ARH = fire-and-forget, gun = CIWS
  channels: number;              // simultaneous guidance channels
  engagementsPerChannel: number; // re-engagements available within one window (≥1)
  pk: number;                    // single-shot kill probability, 0..1
  minRangeNm?: number;
  maxRangeNm?: number;           // Deviation #5 still applies (envelope checked at arrival)
};

export type DefenseLayer = {
  id: string;
  name: string;
  windowS: number;               // unchanged — the saturation interval
  weaponSystems: WeaponSystem[]; // NEW: replaces interceptsPerWindow
  // Deprecated, retained only so old saved scenarios still parse during migration:
  interceptsPerWindow?: number;
  minRangeNm?: number;
  maxRangeNm?: number;
};
```

Per-system shot budget in a window: `shots = channels × engagementsPerChannel`.

`engagementsPerChannel > 1` is modeled as **extra independent shots in the same
window, spread across the raid** — not shoot-look-shoot re-fire at the *same*
missile. This is the main approximation; flagged again in §6.

---

## 3. Saturation math (`calc.ts`)

### 3.1 Per-window evaluation (the new core)

For one sliding window of a layer (windowing rule = Deviation #4, unchanged):

- Missiles in the window: `n`, each carrying a cumulative **survival probability**
  `q` (1.0 on first layer; reduced by prior layers).
- Engaging systems = those whose envelope contains arrival range ≈ 0
  (Deviation #5, now evaluated per weapon system).
- Build the shot pool: for each engaging system, `channels × engagementsPerChannel`
  shots, each tagged with that system's `pk`. Total `S` shots.
- **Allocation:** sort shots by `pk` descending; deal them round-robin, one per
  missile per pass, until exhausted. Even spread — the defender can't know which
  missiles are already dead, so it covers every threat before doubling up.
- Per missile `i` receiving shots with probabilities `p₁…p_k`:
  `q_i ← q_i × Π(1 − p_j)`.

### 3.2 Chaining layers

Carry each missile's `q` through layers in order (outer → inner). Inner layers
window and allocate over the same missile set, multiplying `q` further.

### 3.3 Outputs

```ts
expectedHullImpacts = Σ q_i                       // fractional
saturationProbability = 1 − Π(1 − q_i)            // P(≥1 leaker), independence assumed
saturated = saturationProbability ≥ scenario.saturationConfidence   // default 0.5
```

### 3.4 Reduces exactly to the legacy model

With `pk = 1` for every shot, `q_i` is 0 for any engaged missile and 1 for any
un-engaged one → `expectedHullImpacts` equals the old integer leaker count and
`saturated` matches the old boolean. **This is the migration anchor and a test
(see §5, TC-50).**

---

## 4. Inverse solver rework (`solveInverseSaturation`)

`minSaturatingSalvo` is no longer a hard integer threshold. New definition:

> Smallest synchronized salvo `N` such that `saturationProbability ≥ confidence`.

Under synchronization all `N` land in one window per layer, so the forward
per-window evaluator (§3.1) can be reused directly. Implement as a short search:
increment `N`, evaluate, stop at the confidence crossing. Stays a **pure
function**. Report alongside it:

- `totalEngagementCapacity = Σ engaging (channels × engagementsPerChannel)` — shots available.
- `expectedKillCapacity` — expected kills at full coverage (capacity weighted by Pk).
- `minSaturatingSalvo(confidence)`.

`SaturationThresholdCard` (shipped in Phase 1) updates to show the confidence
figure and the capacity breakdown.

---

## 5. Migration (`storage.ts`)

Bump the persisted schema version. On load, convert each legacy layer:

```
weaponSystems: [{
  name: layer.name, guidance: 'SARH',
  channels: layer.interceptsPerWindow, engagementsPerChannel: 1, pk: 1.0,
  minRangeNm: layer.minRangeNm, maxRangeNm: layer.maxRangeNm,
}]
```

`pk = 1.0` makes the new math reproduce the old result bit-for-bit, so existing
saved scenarios behave identically until the user edits them.

New scenario default: `saturationConfidence: 0.5`.

---

## 6. Open assumptions to confirm at review

1. **Even shot spread, no shoot-look-shoot** (§2, §3.1). Re-engagements hit
   fresh threats, not confirmed kills. Simpler, deterministic, defensible for a
   *planner*; a Monte-Carlo shoot-look-shoot variant is possible later.
2. **Independence in `P(≥1 leaker)`** (§3.3) — per-missile outcomes treated as
   independent. True given independent shots; stated explicitly.
3. **Default confidence 0.5** for the binary verdict and the inverse solver.
   Scenario-level field so it's tunable.
4. **Data dependency:** `channels` (from `sensors.ini WeaponChannels`) and `pk`
   (from `weapons.ini MissileInterceptChance`) come from the handed-off parser.
   The model + UI are built now against manually-entered numbers; parser fills
   them later with no rewrite. *(Resolved — supplied by the IndexedDB presets via
   `vesselSync.ts`.)*

**Update (post-launch):** a radar-horizon cap now scales each system's per-window
shots against sea-skimming attackers — see CLAUDE.md "Radar Horizon SAM Range
Capping" and deviation #6. `altitudeFt == null` ⇒ no cap, so this design's math is
unchanged for high-altitude raids.

---

## 7. Files touched

| File | Change |
|---|---|
| `src/types.ts` | `GuidanceType`, `WeaponSystem`; rework `DefenseLayer`; `Scenario.saturationConfidence` |
| `src/lib/calc.ts` | rewrite `computeLayerBreakdown` (probabilistic), `computeSaturation` verdict, `solveInverseSaturation` (confidence search); new result types |
| `src/lib/storage.ts` | version bump + legacy-layer migration |
| `src/components/DefenseLayerEditor.tsx` | weapon-system sub-editor (add/remove/edit per system) |
| `src/components/ResultsPanel.tsx` | leak-probability display; update `SaturationThresholdCard` |
| `src/components/Timeline.tsx` | impact coloring → leak-probability shading (verify) |
| `src/lib/__tests__/calc.test.ts` | TC-47.. new suite (see §8) |
| `CLAUDE.md` | document the new model + any new deviations |

---

## 8. Test plan (Vitest, extends existing TC numbering)

- **TC-47** single SARH system, 4 channels ×1, pk 1.0, 4 incoming → 0 expected impacts.
- **TC-48** same, 6 incoming → 2.0 expected impacts, P(≥1)=1.
- **TC-49** pk 0.8, 1 channel ×1, 1 incoming → 0.2 expected, P=0.2.
- **TC-50 (migration equivalence)** legacy layer (`interceptsPerWindow=4`) →
  synthesized system reproduces the old `computeLayerBreakdown` leaker count
  exactly across the existing TC-21..27 inputs.
- **TC-51** `engagementsPerChannel=2`, 2 channels, 4 incoming, pk 0.5 → each
  missile gets 1 shot (4 shots / 4 missiles) → expected impacts 2.0; with 2
  incoming each gets 2 shots → expected 2×0.25=0.5.
- **TC-52** two systems different pk in one layer → shots dealt high-pk first;
  verify allocation order.
- **TC-53** non-engaging system (minRange 5, excluded at arrival) contributes 0 shots.
- **TC-54 (inverse)** confidence 0.5 vs 0.9 yields different `minSaturatingSalvo`;
  at pk=1 it equals the Phase 1 integer `Σ channels + 1`.
- **TC-55** multi-layer chaining: outer pk 0.5 then inner pk 0.5, 1 incoming →
  q = 0.25, expected impacts 0.25.
